import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { getIO, rooms } from '../../../../config/socket.js';
import {
    loadRestaurantForOrdering,
    assertRestaurantOpenForOrdering,
    getDeliveryDistanceKm,
    loadActiveFeeSettings,
    resolveUserDeliveryFee,
    platformFeeGstFor,
    calculateRiderEarning,
    estimateDeliveryPromiseMinutes,
} from './order-pricing.service.js';
import { getRestaurantCommissionSnapshot } from './foodTransaction.service.js';
import { attachRestaurantPayout } from '../../shared/restaurantPayout.js';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
import { normalizeDeliveryAddress, fillAddressLocality } from '../../shared/geo.utils.js';
import { findZoneForPoint, readAddressPoint, ZONE_VERTICALS } from '../../shared/zoneServiceability.js';
import { buildOrderPrescription, PRESCRIPTION_STATUS } from '../../shared/prescriptionRules.js';
import {
    assertBillApproved,
    assertFillable,
    assertSellerDispensesMedicine,
    BILL_STATUS,
    computeQuoteSubtotal,
    normalizeBillSubmission,
    normalizeQuoteItems,
} from '../../shared/prescriptionOrder.js';
import {
    createRazorpayOrder,
    getRazorpayKeyId,
    isRazorpayConfigured,
} from '../helpers/razorpay.helper.js';
import {
    buildOrderIdentityFilter,
    enqueueOrderEvent,
    notifyOwnerSafely,
    notifyRestaurantNewOrder,
    pushStatusHistory,
    sanitizeOrderForExternal,
} from './order.helpers.js';
import { tryAutoAssign } from './order-dispatch.service.js';

/**
 * Prescription-only orders: placed from a photograph, priced by the pharmacist.
 *
 * Kept out of order.service.js deliberately. That file builds an order from
 * catalogue lines — resolving products, reserving stock, applying coupons,
 * taking payment — and none of it applies to an order whose contents are not
 * known yet. Threading a "no items" mode through it would put a branch in every
 * one of those steps; this is the same document written by a shorter path, and
 * it rejoins the ordinary lifecycle the moment the pharmacist prices it.
 */

const toObjectId = (value, label) => {
    const raw = String(value || '');
    if (!mongoose.Types.ObjectId.isValid(raw)) throw new ValidationError(`Invalid ${label}`);
    return new mongoose.Types.ObjectId(raw);
};

/** Zero pricing: nothing is known until the pharmacist reads the prescription. */
const emptyPricing = () => ({
    subtotal: 0,
    tax: 0,
    packagingFee: 0,
    deliveryFee: 0,
    deliveryFeeGst: 0,
    platformFee: 0,
    quickDeliveryFee: 0,
    deliveryMode: 'basic',
    restaurantCommission: 0,
    discount: 0,
    couponCode: null,
    total: 0,
    currency: 'INR',
    distanceKm: null,
});

/**
 * A prescription order is always cash on delivery.
 *
 * There is no total at placement, so there is nothing to charge — and asking the
 * customer to pay again after the pharmacist prices it would mean an order that
 * can be abandoned after the medicine has already been set aside.
 */
const codPayment = () => ({
    method: 'cash',
    status: 'cod_pending',
});

const emitToCustomer = (order, event, payload) => {
    try {
        const io = getIO();
        if (!io) return;
        io.to(rooms.user(String(order.userId))).emit(event, payload);
        io.to(rooms.tracking(String(order._id))).emit(event, payload);
    } catch (err) {
        logger.warn(`prescription order socket emit failed: ${err?.message || err}`);
    }
};

/**
 * Place an order from a photographed prescription.
 *
 * @param {string} userId
 * @param {{restaurantId: string, address: object, prescriptionImage: string, note?: string, customerName?: string, customerPhone?: string}} dto
 */
export async function createPrescriptionOrder(userId, dto = {}) {
    const restaurantId = toObjectId(dto.restaurantId, 'Restaurant ID');
    const restaurant = await loadRestaurantForOrdering(restaurantId);

    // Only a pharmacy may take one of these, and only while it is open — the same
    // two gates an ordinary order passes, asked before anything is written.
    assertSellerDispensesMedicine(restaurant);
    const orderAt = new Date();
    assertRestaurantOpenForOrdering(restaurant, orderAt);

    const deliveryAddress = fillAddressLocality(normalizeDeliveryAddress({
        label: dto.address?.label || 'Home',
        name: dto.address?.name || dto.address?.fullName || dto.customerName || '',
        fullName: dto.address?.fullName || dto.address?.name || dto.customerName || '',
        street: dto.address?.street || '',
        additionalDetails: dto.address?.additionalDetails || '',
        city: dto.address?.city || '',
        state: dto.address?.state || '',
        zipCode: dto.address?.zipCode || '',
        phone: dto.address?.phone || '',
        ...(dto.address || {}),
    }), restaurant);

    const point = readAddressPoint(deliveryAddress);
    if (!point) {
        throw new ValidationError('This address has no location saved. Please re-select it on the map.');
    }

    const zone = await findZoneForPoint(point.lat, point.lng, ZONE_VERTICALS.MEDICAL);
    if (!zone) throw new ValidationError("We don't deliver to this address yet");
    const sellerZoneId = restaurant?.zoneId ? String(restaurant.zoneId) : '';
    if (sellerZoneId && sellerZoneId !== String(zone._id)) {
        throw new ValidationError('This store does not deliver to the selected address');
    }

    // buildOrderPrescription is the same rule the catalogue path uses, so a
    // medical order can never exist without a prescription no matter which way in
    // it took. It throws when the image is missing.
    const prescription = buildOrderPrescription(restaurant, dto, orderAt);

    const order = new FoodOrder({
        userId: toObjectId(userId, 'User ID'),
        restaurantId,
        zoneId: zone._id,
        prescriptionOnly: true,
        prescription,
        items: [],
        deliveryAddress,
        customerName: String(dto.customerName || deliveryAddress.fullName || ''),
        customerPhone: String(dto.customerPhone || deliveryAddress.phone || ''),
        pricing: emptyPricing(),
        payment: codPayment(),
        orderStatus: 'created',
        note: String(dto.note || '').slice(0, 500),
    });

    pushStatusHistory(order, {
        byRole: 'USER',
        byId: userId,
        from: '',
        to: 'created',
        note: 'Prescription uploaded',
    });

    await order.save();

    // The pharmacist has to be told, or the order sits unread: there is no
    // catalogue notification path for an order with no items.
    notifyRestaurantNewOrder(order).catch((err) =>
        logger.warn(`prescription order seller notify failed: ${err?.message || err}`),
    );

    enqueueOrderEvent('prescription_order_created', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        restaurantId: String(restaurantId),
        userId: String(userId),
    });

    return sanitizeOrderForExternal(order);
}

/**
 * The pharmacist enters what they will dispense, and the order gets a price.
 *
 * Delivery fee, its GST and the rider's earning are computed the same way the
 * catalogue path computes them, from the same fee settings — a prescription
 * order costs the platform exactly what any other order of that distance does.
 */
export async function fillPrescriptionOrder(orderId, restaurantId, dto = {}) {
    const identity = buildOrderIdentityFilter(orderId);
    if (!identity) throw new ValidationError('Order id required');

    const order = await FoodOrder.findOne({
        ...identity,
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
    });
    if (!order) throw new NotFoundError('Order not found');

    assertFillable(order);

    // Pricing an order whose prescription was rejected would be busywork: it can
    // only be cancelled from here.
    if (order.prescription?.status === PRESCRIPTION_STATUS.REJECTED) {
        throw new ValidationError('The prescription on this order was rejected, so it cannot be priced.');
    }

    const items = normalizeQuoteItems(dto.items);
    const subtotal = computeQuoteSubtotal(items);

    const restaurant = await loadRestaurantForOrdering(order.restaurantId);
    const distanceKm = await getDeliveryDistanceKm(restaurant, order.deliveryAddress);
    const feeSettings = await loadActiveFeeSettings({ vertical: 'medical', zoneId: order.zoneId ? String(order.zoneId) : undefined });

    // resolveUserDeliveryFee() returns { deliveryFee, distanceKm, source }. Storing
    // the whole object as the fee made its GST 0 and the total NaN, and the save
    // failed -- no prescription order could be priced.
    const { deliveryFee: resolvedFee } = resolveUserDeliveryFee(feeSettings, { subtotal, distanceKm });
    const deliveryFee = round2(resolvedFee);
    // A prescription order is a medical order: no GST on delivery or medicines.
    const deliveryFeeGst = 0;
    const platformFee = Number(feeSettings?.platformFee) || 0;
    const { platformFeeGstRate, platformFeeGst } = platformFeeGstFor(feeSettings, platformFee);

    // Item GST and seller commission, exactly as the catalogue path charges them
    // (calculateOrderPricing / createOrder). Left at 0 here, a medicine sold on a
    // prescription paid no GST and earned the platform nothing, where the same box
    // bought from the catalogue pays both. No coupon applies, so nothing is discounted.
    const gstFallbackRate = Number(feeSettings?.gstRate || 0);
    const tax = 0;

    let restaurantCommission = 0;
    try {
        const snapshot = await getRestaurantCommissionSnapshot({
            pricing: { subtotal },
            restaurantId: order.restaurantId,
        });
        restaurantCommission = Number(snapshot?.commissionAmount) || 0;
    } catch (err) {
        logger.error(`Commission calculation failed for prescription order ${order._id}: ${err?.message || err}`);
    }

    // Charged to the rupee, like Food: 336.80 -> 337 with a +0.20 round-off line.
    const payableBeforeRounding = round2(subtotal + tax + deliveryFee + deliveryFeeGst + platformFee + platformFeeGst);
    const total = Math.round(payableBeforeRounding);
    const roundOff = round2(total - payableBeforeRounding);

    order.items = items;
    order.pricing = {
        ...emptyPricing(),
        subtotal,
        tax,
        gstFallbackRate,
        deliveryFee,
        deliveryFeeGst,
        platformFee,
        platformFeeGst,
        platformFeeGstRate,
        restaurantCommission,
        roundOff,
        total,
        distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
    };
    order.riderEarning = calculateRiderEarning(feeSettings, distanceKm);

    const promiseMinutes = estimateDeliveryPromiseMinutes(distanceKm);
    if (Number.isFinite(promiseMinutes)) {
        order.deliveryPromiseMinutes = promiseMinutes;
    }

    pushStatusHistory(order, {
        byRole: 'RESTAURANT',
        byId: restaurantId,
        from: order.orderStatus,
        to: order.orderStatus,
        note: `Priced: ${items.length} item(s), ₹${total}`,
    });

    await order.save();

    const payload = sanitizeOrderForExternal(order);

    // The customer's screen is showing "waiting for the pharmacy" — this is what
    // moves it on, so it is pushed rather than waited for on the next poll.
    emitToCustomer(order, 'order_status_update', payload);
    notifyOwnerSafely(
        { ownerType: 'USER', ownerId: String(order.userId) },
        {
            title: 'Your medicines are priced',
            body: `${restaurant?.restaurantName || 'The pharmacy'} has priced your prescription — ₹${total}.`,
            data: {
                type: 'prescription_order_priced',
                orderId: String(order._id),
                total: String(total),
            },
        },
    ).catch(() => {});

    enqueueOrderEvent('prescription_order_priced', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        restaurantId: String(restaurantId),
        total,
    });

    // The commission breakdown is the pharmacy's own money, not the customer's --
    // attached only to what this call returns to the restaurant, never to the
    // `payload` object already broadcast to the customer above.
    const restaurantResponse = { ...payload };
    await attachRestaurantPayout([restaurantResponse]);
    return restaurantResponse;
}

/**
 * The pharmacy's bill, and the customer's answer to it.
 *
 * A prescription order is placed with no price: the customer photographs a
 * prescription and the pharmacist decides what it comes to. That leaves a gap
 * the catalogue path never has -- an order everyone is committed to at an
 * amount the customer has never seen. These three functions close it: the
 * pharmacist submits the paper bill and its total, the customer approves it
 * (paying then, if they are paying online) or declines it, and only an approved
 * bill lets the order be prepared and dispatched.
 *
 * The payment itself is the ordinary one. A priced order moves to
 * `pending_payment` and takes the same Razorpay order, the same signature and
 * amount cross-check in verifyPayment, and the same transition back to
 * `created` as any other online order. A second payment path for medicines
 * would be a second place for money to go missing.
 */
export async function submitPrescriptionBill(orderId, restaurantId, dto = {}) {
    const identity = buildOrderIdentityFilter(orderId);
    if (!identity) throw new ValidationError('Order id required');

    const order = await FoodOrder.findOne({
        ...identity,
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
    });
    if (!order) throw new NotFoundError('Order not found');

    assertFillable(order);
    if (order.prescription?.status !== PRESCRIPTION_STATUS.APPROVED) {
        throw new ValidationError('Verify the prescription before billing this order.');
    }
    /*
     * A bill the customer has already paid is not re-openable here. Re-pricing
     * it would move the amount away from the one they authorised, and the
     * payment on file would no longer match what verifyPayment expects.
     */
    if (order.prescription?.bill?.status === BILL_STATUS.APPROVED) {
        throw new ValidationError('This bill has already been approved by the customer.');
    }

    const { imageUrl, amount } = normalizeBillSubmission(dto);

    const restaurant = await loadRestaurantForOrdering(order.restaurantId);
    const distanceKm = await getDeliveryDistanceKm(restaurant, order.deliveryAddress);
    const feeSettings = await loadActiveFeeSettings({ vertical: 'medical', zoneId: order.zoneId ? String(order.zoneId) : undefined });

    /*
     * The medicines are the bill total, as one line.
     *
     * The pharmacist reads a paper bill that already itemises them; asking for
     * every row again is transcription work that would not change the total and
     * would invite it to disagree with the document beside it. The bill image is
     * stored precisely so the detail is not lost.
     */
    const items = normalizeQuoteItems([
        { name: 'Medicines as per pharmacy bill', quantity: 1, price: amount },
    ]);
    const subtotal = computeQuoteSubtotal(items);

    const { deliveryFee: resolvedFee } = resolveUserDeliveryFee(feeSettings, { subtotal, distanceKm });
    const deliveryFee = round2(resolvedFee);
    // A prescription order is a medical order: no GST on delivery or medicines.
    const deliveryFeeGst = 0;
    const platformFee = Number(feeSettings?.platformFee) || 0;
    const { platformFeeGstRate, platformFeeGst } = platformFeeGstFor(feeSettings, platformFee);
    const gstFallbackRate = Number(feeSettings?.gstRate || 0);
    const tax = 0;

    let restaurantCommission = 0;
    try {
        const snapshot = await getRestaurantCommissionSnapshot({
            pricing: { subtotal },
            restaurantId: order.restaurantId,
        });
        restaurantCommission = Number(snapshot?.commissionAmount) || 0;
    } catch (err) {
        logger.error(`Commission calculation failed for prescription order ${order._id}: ${err?.message || err}`);
    }

    // Charged to the rupee, like Food: 336.80 -> 337 with a +0.20 round-off line.
    const payableBeforeRounding = round2(subtotal + tax + deliveryFee + deliveryFeeGst + platformFee + platformFeeGst);
    const total = Math.round(payableBeforeRounding);
    const roundOff = round2(total - payableBeforeRounding);

    order.items = items;
    order.pricing = {
        ...emptyPricing(),
        subtotal,
        tax,
        gstFallbackRate,
        deliveryFee,
        deliveryFeeGst,
        platformFee,
        platformFeeGst,
        platformFeeGstRate,
        restaurantCommission,
        roundOff,
        total,
        distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
    };
    order.prescription.bill = {
        imageUrl,
        amount,
        uploadedAt: new Date(),
        uploadedBy: new mongoose.Types.ObjectId(restaurantId),
        status: BILL_STATUS.SUBMITTED,
        approvedAt: null,
        declinedAt: null,
        declineReason: '',
    };
    order.riderEarning = calculateRiderEarning(feeSettings, distanceKm);

    const promiseMinutes = estimateDeliveryPromiseMinutes(distanceKm);
    if (Number.isFinite(promiseMinutes)) order.deliveryPromiseMinutes = promiseMinutes;

    // Accept ('confirmed') no longer implies a price -- the pharmacist prices
    // and bills from here, after accepting. Submitting the bill is what packs
    // the order, so this is where 'confirmed' actually becomes 'preparing'
    // (shown to the pharmacist as "Packed"). Only from 'confirmed': an order
    // already further along (or re-billed under the old created-first flow)
    // keeps whatever status it already has.
    const statusFrom = order.orderStatus;
    if (order.orderStatus === 'confirmed') {
        order.orderStatus = 'preparing';
    }

    pushStatusHistory(order, {
        byRole: 'RESTAURANT',
        byId: restaurantId,
        from: statusFrom,
        to: order.orderStatus,
        note: `Pharmacy bill Rs ${amount} submitted, payable Rs ${total}`,
    });

    await order.save();

    const payload = sanitizeOrderForExternal(order);
    emitToCustomer(order, 'order_status_update', payload);
    notifyOwnerSafely(
        { ownerType: 'USER', ownerId: String(order.userId) },
        {
            title: 'Your bill is ready',
            body: `Medicines Rs ${amount} + delivery Rs ${round2(deliveryFee + deliveryFeeGst)} — Rs ${total} to pay.`,
            data: {
                type: 'prescription_bill_submitted',
                orderId: String(order._id),
                billAmount: String(amount),
                total: String(total),
            },
        },
    ).catch(() => {});

    enqueueOrderEvent('prescription_bill_submitted', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        restaurantId: String(restaurantId),
        billAmount: amount,
        total,
    });

    // See the same note in fillPrescriptionOrder above: the payout breakdown is
    // the pharmacy's own money and goes only into what this call returns to it,
    // never into `payload`, which was already broadcast to the customer.
    const restaurantResponse = { ...payload };
    await attachRestaurantPayout([restaurantResponse]);
    return restaurantResponse;
}

/**
 * The customer accepts the bill.
 *
 * Paying online does NOT approve it here: the order moves to `pending_payment`
 * and the approval is stamped when the payment verifies, so a customer who
 * opens the payment sheet and abandons it has not agreed to anything and the
 * pharmacy is not left preparing an order nobody paid for. Cash on delivery has
 * no such moment, so there the approval is the agreement.
 */

/**
 * The pharmacy hands the packet to the delivery partner.
 *
 * Requires a photograph of the sealed packet. That photo is the only record
 * of what actually left the shop: the partner takes their own at pickup, and
 * when a customer says something was missing, the pair of them is the whole
 * evidence either side has.
 *
 * Refused until the customer has paid. Sending stock out against an amount
 * nobody authorised is the one thing this flow must not allow.
 */
export async function dispatchPrescriptionOrder(orderId, restaurantId, dto = {}) {
    const identity = buildOrderIdentityFilter(orderId);
    if (!identity) throw new ValidationError('Order id required');

    const order = await FoodOrder.findOne({
        ...identity,
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
    });
    if (!order) throw new NotFoundError('Order not found');

    if (order.prescriptionOnly !== true) {
        throw new ValidationError('This is not a prescription order.');
    }

    // Same rule every other forward transition uses, so the refusal reads
    // identically wherever the pharmacist runs into it.
    assertBillApproved(order, 'dispatched');

    const imageUrl = String(dto.packetImageUrl || dto.imageUrl || '').trim();
    if (!imageUrl) {
        throw new ValidationError('Photograph the sealed packet before dispatching.');
    }

    // Idempotent: a pharmacist who taps twice, or retries on a dropped
    // connection, must not overwrite the first photo with a second one taken
    // minutes later.
    if (order.prescription?.packet?.imageUrl) {
        return order;
    }

    order.prescription.packet = {
        imageUrl,
        dispatchedAt: new Date(),
        dispatchedBy: new mongoose.Types.ObjectId(restaurantId),
    };

    // Only advance a status that has not already moved past this point: a
    // partner who has already collected must not be walked backwards.
    if (order.orderStatus === 'confirmed' || order.orderStatus === 'preparing') {
        order.orderStatus = 'ready_for_pickup';
    }

    await order.save();

    try {
        const io = getIO();
        if (io) {
            io.to(rooms.order(String(order._id))).emit('order:prescription-dispatched', {
                orderId: String(order._id),
                packetImageUrl: imageUrl,
                orderStatus: order.orderStatus,
            });
        }
    } catch (err) {
        // The packet is photographed and saved; a socket that is down must
        // not undo that.
        logger.warn(`[Prescription] dispatch broadcast failed: ${err.message}`);
    }

    return order;
}

export async function approvePrescriptionBill(orderId, userId, dto = {}) {
    const identity = buildOrderIdentityFilter(orderId);
    if (!identity) throw new ValidationError('Order id required');

    const order = await FoodOrder.findOne({
        ...identity,
        userId: new mongoose.Types.ObjectId(userId),
    });
    if (!order) throw new NotFoundError('Order not found');
    if (!order.prescriptionOnly) {
        throw new ValidationError('This order was not placed from a prescription photo.');
    }

    const billStatus = String(order.prescription?.bill?.status || BILL_STATUS.NONE);
    if (billStatus === BILL_STATUS.APPROVED) {
        // Idempotent: a double tap, a retried request or a second device must
        // not create a second Razorpay order against the same bill.
        return { order: sanitizeOrderForExternal(order), payment: null };
    }
    if (billStatus !== BILL_STATUS.SUBMITTED) {
        throw new ValidationError('The pharmacy has not sent a bill for this order yet.');
    }
    if (String(order.orderStatus) === 'pending_payment' && order.payment?.razorpay?.orderId) {
        // Already waiting on the gateway for this same amount: hand back the
        // existing Razorpay order rather than opening another one, or two
        // payments exist for one bill and only one can ever be verified.
        return {
            order: sanitizeOrderForExternal(order),
            payment: {
                key: getRazorpayKeyId(),
                orderId: order.payment.razorpay.orderId,
                amount: Math.round((Number(order.pricing?.total) || 0) * 100),
                currency: 'INR',
            },
        };
    }

    const method = String(dto.paymentMethod || order.payment?.method || 'cash').toLowerCase();
    const payingOnline = method === 'razorpay' || method === 'online';

    if (!payingOnline) {
        order.prescription.bill.status = BILL_STATUS.APPROVED;
        order.prescription.bill.approvedAt = new Date();
        order.payment.method = 'cash';
        pushStatusHistory(order, {
            byRole: 'USER',
            byId: userId,
            from: order.orderStatus,
            to: order.orderStatus,
            note: `Bill approved, paying cash on delivery (Rs ${order.pricing?.total})`,
        });
        await order.save();

        // The customer has now agreed to a price (COD needs no payment step to
        // wait on), so this is the moment -- not accept, which happens before
        // any price exists -- a rider should be found. Fire-and-forget, same
        // as every other dispatch trigger: a hunt failure must not fail the
        // customer's approval of their own bill.
        void tryAutoAssign(order._id).catch((err) => {
            logger.warn(`Auto-dispatch failed after COD bill approval for ${order._id}: ${err?.message || err}`);
        });

        const payload = sanitizeOrderForExternal(order);
        notifyOwnerSafely(
            { ownerType: 'RESTAURANT', ownerId: String(order.restaurantId) },
            {
                title: 'Bill approved',
                body: 'The customer approved the bill. You can prepare this order.',
                data: { type: 'prescription_bill_approved', orderId: String(order._id) },
            },
        ).catch(() => {});
        enqueueOrderEvent('prescription_bill_approved', {
            orderMongoId: order._id?.toString?.(),
            orderId: order._id.toString(),
            paymentMethod: 'cash',
        });
        return { order: payload, payment: null };
    }

    if (!isRazorpayConfigured()) {
        throw new ValidationError('Online payment is unavailable right now. Choose cash on delivery.');
    }
    const amountPaise = Math.round((Number(order.pricing?.total) || 0) * 100);
    if (amountPaise < 100) throw new ValidationError('Amount too low for online payment');

    let rzOrder;
    try {
        rzOrder = await createRazorpayOrder(amountPaise, 'INR', order._id.toString());
    } catch (err) {
        logger.error(`Razorpay order creation failed for prescription order ${order._id}: ${err?.message || err}`);
        throw new ValidationError(err?.message || 'Payment gateway error');
    }

    order.payment.method = 'razorpay';
    order.payment.status = 'created';
    order.payment.razorpay = { orderId: rzOrder.id, paymentId: '', signature: '' };
    order.payment.amountDue = Number(order.pricing?.total) || 0;
    const from = order.orderStatus;
    order.orderStatus = 'pending_payment';
    pushStatusHistory(order, {
        byRole: 'USER',
        byId: userId,
        from,
        to: 'pending_payment',
        note: `Bill approved, awaiting online payment of Rs ${order.pricing?.total}`,
    });
    await order.save();

    return {
        order: sanitizeOrderForExternal(order),
        payment: {
            key: getRazorpayKeyId(),
            orderId: rzOrder.id,
            amount: rzOrder.amount,
            currency: rzOrder.currency || 'INR',
        },
    };
}

/**
 * The customer refuses the bill, which cancels the order.
 *
 * Nothing has been paid and nothing has left the pharmacy, so this is a plain
 * cancellation rather than a refund. The reason is kept and sent on: a
 * pharmacist who is told "too expensive" can offer a substitute next time,
 * where a silent disappearance teaches them nothing.
 */
export async function declinePrescriptionBill(orderId, userId, dto = {}) {
    const identity = buildOrderIdentityFilter(orderId);
    if (!identity) throw new ValidationError('Order id required');

    const order = await FoodOrder.findOne({
        ...identity,
        userId: new mongoose.Types.ObjectId(userId),
    });
    if (!order) throw new NotFoundError('Order not found');
    if (!order.prescriptionOnly) {
        throw new ValidationError('This order was not placed from a prescription photo.');
    }
    if (order.payment?.status === 'paid') {
        throw new ValidationError('This order is already paid. Cancel it instead so the refund is recorded.');
    }
    if (String(order.prescription?.bill?.status || '') !== BILL_STATUS.SUBMITTED) {
        throw new ValidationError('There is no bill to decline on this order.');
    }

    const reason = String(dto.reason || '').trim().slice(0, 200);
    order.prescription.bill.status = BILL_STATUS.REJECTED;
    order.prescription.bill.declinedAt = new Date();
    order.prescription.bill.declineReason = reason;
    const from = order.orderStatus;
    order.orderStatus = 'cancelled_by_user';
    order.cancelledBy = 'user';
    order.cancellationReason = reason || 'Customer declined the pharmacy bill';
    pushStatusHistory(order, {
        byRole: 'USER',
        byId: userId,
        from,
        to: 'cancelled_by_user',
        note: reason ? `Bill declined: ${reason}` : 'Bill declined',
    });
    await order.save();

    const payload = sanitizeOrderForExternal(order);
    notifyOwnerSafely(
        { ownerType: 'RESTAURANT', ownerId: String(order.restaurantId) },
        {
            title: 'Bill declined',
            body: reason
                ? `The customer declined the bill: ${reason}`
                : 'The customer declined the bill, so the order is cancelled.',
            data: { type: 'prescription_bill_declined', orderId: String(order._id) },
        },
    ).catch(() => {});
    enqueueOrderEvent('prescription_bill_declined', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        reason,
    });

    return payload;
}
