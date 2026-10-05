import crypto from 'crypto';
import mongoose from 'mongoose';
import { QCReturn } from '../models/qcReturn.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { incrementStock } from '../../orders/services/inventory.service.js';
import { initiateRazorpayRefund } from '../../orders/helpers/razorpay.helper.js';
import { recordReturnRefund } from '../../orders/services/foodTransaction.service.js';
import { refundWalletBalance } from '../../user/services/userWallet.service.js';
import { logger } from '../../../../utils/logger.js';
import { calculateReturnRefund, apportion, FAULT } from './returnRefund.service.js';
import {
    checkEligibility,
    assertTransition,
    shouldRestock,
    getReason,
    RETURN_STATUS,
    PERISHABILITY,
} from './returnPolicy.service.js';

/**
 * Orchestration for quick-commerce returns.
 *
 * The rules live next door and are pure: returnPolicy decides what is allowed,
 * returnRefund decides what it is worth. This file is the only one that reads an
 * order, writes a return, moves stock or moves money — so a rule change never has to
 * be made in two places, and the rules stay testable without a database.
 */

class ReturnError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'ReturnError';
        this.status = status;
    }
}

const newReturnCode = () => `RET-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

const recordStatus = (doc, status, { byRole = 'SYSTEM', byId = '', note = '' } = {}) => {
    assertTransition(doc.status, status);
    doc.status = status;
    doc.statusHistory.push({ status, at: new Date(), byRole, byId, note });
};

/**
 * How perishable an order's returned lines are, taken as the WORST case across them.
 *
 * A basket of rice and strawberries is governed by the strawberries: giving the whole
 * request the ambient 7-day window because most of it is ambient would make spoiled
 * produce returnable a week later.
 */
const resolvePerishability = async (itemIds) => {
    const ids = itemIds
        .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => new mongoose.Types.ObjectId(String(id)));
    if (ids.length === 0) return PERISHABILITY.AMBIENT;

    const products = await FoodItem.find({ _id: { $in: ids } })
        .select('perishability')
        .lean();

    const rank = {
        [PERISHABILITY.AMBIENT]: 0,
        [PERISHABILITY.CHILLED]: 1,
        [PERISHABILITY.FRESH]: 2,
    };
    let worst = PERISHABILITY.AMBIENT;
    for (const product of products) {
        const value = product.perishability || PERISHABILITY.AMBIENT;
        if ((rank[value] ?? 0) > rank[worst]) worst = value;
    }
    return worst;
};

/**
 * Quantities already spoken for by earlier returns on this order.
 *
 * Rejected and cancelled returns release their claim; everything else — including a
 * request still sitting at `requested` — holds it, so a customer cannot open five
 * overlapping requests for the same two bottles.
 */
const alreadyClaimed = async (orderId) => {
    const open = await QCReturn.find({
        orderId,
        status: { $nin: [RETURN_STATUS.REJECTED, RETURN_STATUS.CANCELLED] },
    }).select('items refund.total status').lean();

    const claimed = new Map();
    let refundedTotal = 0;
    for (const doc of open) {
        for (const line of doc.items || []) {
            const key = `${line.itemId}::${line.variantId || ''}`;
            claimed.set(key, (claimed.get(key) || 0) + (line.quantity || 0));
        }
        if (doc.status === RETURN_STATUS.REFUNDED) refundedTotal += doc.refund?.total || 0;
    }
    return { claimed, refundedTotal };
};

/**
 * Open a return request.
 *
 * Everything the money depends on — price, quantity, fault, window — is resolved from
 * the order and the policy here. The request body contributes only which lines, how
 * many, why, and the photos.
 */
export const requestReturn = async ({ userId, orderId, lines, reasonCode, reasonNote = '', images = [] }) => {
    if (!mongoose.Types.ObjectId.isValid(String(orderId))) {
        throw new ReturnError('Invalid order id');
    }
    if (!Array.isArray(lines) || lines.length === 0) {
        throw new ReturnError('Select at least one item to return');
    }

    // Scoped to the caller: without userId in the filter this is an IDOR, and anyone
    // could open a return against a stranger's order and collect the refund.
    const order = await FoodOrder.findOne({ _id: orderId, userId }).lean();
    if (!order) throw new ReturnError('Order not found', 404);

    const reason = getReason(reasonCode);
    if (!reason) throw new ReturnError('Unknown return reason');

    const requestedIds = lines.map((l) => l.itemId);
    const perishability = await resolvePerishability(requestedIds);

    const eligibility = checkEligibility({ order, reasonCode, perishability });
    if (!eligibility.eligible) throw new ReturnError(eligibility.reason);

    // Subtract what earlier returns already claimed, so overlapping requests cannot
    // return the same bottle twice.
    const { claimed, refundedTotal } = await alreadyClaimed(order._id);
    const available = [];
    for (const line of lines) {
        const orderLine = (order.items || []).find((it) => String(it.itemId) === String(line.itemId)
            && String(it.variantId || '') === String(line.variantId || ''));
        if (!orderLine) continue;
        const key = `${line.itemId}::${line.variantId || ''}`;
        const remaining = (orderLine.quantity || 0) - (claimed.get(key) || 0);
        const quantity = Math.min(Math.floor(Number(line.quantity) || 0), remaining);
        if (quantity > 0) available.push({ ...line, quantity });
    }
    if (available.length === 0) {
        throw new ReturnError('These items have already been returned or are not on this order');
    }

    const refund = calculateReturnRefund({
        order,
        returnedLines: available,
        fault: eligibility.fault === 'seller' ? FAULT.SELLER : FAULT.CUSTOMER,
        alreadyRefunded: refundedTotal,
    });

    const doc = new QCReturn({
        returnCode: newReturnCode(),
        orderId: order._id,
        orderNumber: order.orderNumber || '',
        userId: order.userId,
        sellerId: order.restaurantId,
        items: refund.lines.map((l) => ({
            itemId: l.itemId,
            variantId: l.variantId,
            name: l.name,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            refundAmount: l.refundAmount,
        })),
        reasonCode: reason.code,
        reasonNote,
        fault: reason.fault,
        perishability,
        images: Array.isArray(images) ? images.slice(0, 6) : [],
        refund: {
            goods: refund.goods,
            tax: refund.tax,
            discountReversed: refund.discountReversed,
            deliveryFee: refund.deliveryFee,
            platformFee: refund.platformFee,
            total: refund.total,
            isFullReturn: refund.isFullReturn,
            capApplied: refund.capApplied,
        },
        windowExpiresAt: eligibility.expiresAt,
        status: RETURN_STATUS.REQUESTED,
        statusHistory: [{ status: RETURN_STATUS.REQUESTED, byRole: 'USER', byId: String(userId) }],
    });

    // ponytail: two requests filed in the same instant can both pass the
    // already-claimed check and over-claim a line. The refund cap in
    // calculateReturnRefund means the platform still cannot pay out more than the
    // order was worth, so the exposure is a duplicate row rather than duplicate money.
    // Move the claim check into a transaction if support starts seeing double filings.
    await doc.save();
    return doc;
};

/** Admin decision on a pending request. */
export const decideReturn = async ({ returnId, approve, note = '', adminId }) => {
    const doc = await QCReturn.findById(returnId);
    if (!doc) throw new ReturnError('Return not found', 404);

    recordStatus(doc, approve ? RETURN_STATUS.APPROVED : RETURN_STATUS.REJECTED, {
        byRole: 'ADMIN', byId: String(adminId || ''), note,
    });
    if (!approve) doc.rejectionReason = note;
    await doc.save();
    return doc;
};

export const schedulePickup = async ({ returnId, scheduledFor, partnerId, adminId }) => {
    const doc = await QCReturn.findById(returnId);
    if (!doc) throw new ReturnError('Return not found', 404);

    doc.pickup.scheduledFor = scheduledFor ? new Date(scheduledFor) : new Date();
    doc.pickup.partnerId = partnerId || null;
    // Handover code: without it a rider can mark a pickup collected from the kerb and
    // the goods are never actually surrendered.
    doc.pickup.otp = String(crypto.randomInt(1000, 9999));
    recordStatus(doc, RETURN_STATUS.PICKUP_SCHEDULED, { byRole: 'ADMIN', byId: String(adminId || '') });
    await doc.save();
    return doc;
};

export const markPickedUp = async ({ returnId, otp, partnerId }) => {
    const doc = await QCReturn.findById(returnId);
    if (!doc) throw new ReturnError('Return not found', 404);
    if (doc.pickup.otp && String(otp || '') !== doc.pickup.otp) {
        throw new ReturnError('Incorrect pickup code');
    }

    doc.pickup.pickedUpAt = new Date();
    recordStatus(doc, RETURN_STATUS.PICKED_UP, { byRole: 'DELIVERY_PARTNER', byId: String(partnerId || '') });
    await doc.save();
    return doc;
};

/**
 * Record what came back, and restock whatever is still sellable.
 *
 * Restocking happens here rather than at refund time because it is a judgement about
 * the goods, not about the money: an inspection that ends in rejection has still
 * established that three of the five bottles were sealed.
 */
export const inspectReturn = async ({ returnId, conditions = [], notes = '', inspectedBy }) => {
    const doc = await QCReturn.findById(returnId);
    if (!doc) throw new ReturnError('Return not found', 404);

    for (const line of doc.items) {
        const found = conditions.find((c) => String(c.itemId) === String(line.itemId)
            && String(c.variantId || '') === String(line.variantId || ''));
        line.condition = found?.condition || 'opened';
    }

    doc.inspection = { inspectedAt: new Date(), inspectedBy: String(inspectedBy || ''), notes };
    recordStatus(doc, RETURN_STATUS.INSPECTED, { byRole: 'ADMIN', byId: String(inspectedBy || ''), note: notes });
    await doc.save();

    for (const line of doc.items) {
        if (!shouldRestock({
            reasonCode: doc.reasonCode,
            perishability: doc.perishability,
            condition: line.condition,
        })) continue;
        try {
            await incrementStock(line.itemId, line.quantity, line.variantId, { reason: 'return', note: doc.returnCode });
            line.restocked = true;
        } catch (err) {
            // Never fail an inspection over a restock: the goods are physically back
            // either way, and blocking here would strand the customer's refund.
            logger.error(`[QC returns] restock failed for ${doc.returnCode} item ${line.itemId}: ${err?.message || err}`);
        }
    }
    await doc.save();
    return doc;
};

const toPaise = (rupees) => Math.round((Number(rupees) || 0) * 100);

/**
 * Where a return's money goes, decided from what the order itself holds.
 *
 * This used to require a core Payment document for the order. Nothing on the
 * quick-commerce order path writes one -- the order carries its payment in
 * order.payment -- so every refund failed with 409 and no approved return could ever
 * be paid. The destinations are the two the quick-commerce cancellation refund
 * (applyCancellationRefund in orders/services/order.service.js) already uses:
 *
 *   - Razorpay: refunded to the card/UPI it came from, via the same helper, unless
 *     the admin chooses the wallet (refundTo 'wallet').
 *   - Wallet, and cash collected on delivery: credited to the customer's
 *     quick-commerce wallet. Cash cannot be pushed back to a card, and a rider cannot
 *     be sent back with notes.
 *
 * An order whose money was never collected has nothing to refund.
 */
const resolveRefundDestination = (order, refundTo) => {
    const method = String(order?.payment?.method || 'cash').toLowerCase();
    const status = String(order?.payment?.status || '').toLowerCase();
    if (status !== 'paid') {
        throw new ReturnError('No payment was collected on this order, so there is nothing to refund', 409);
    }

    const paymentId = String(order.payment?.razorpay?.paymentId || '').trim();
    if (refundTo === 'wallet') return { to: 'wallet' };
    if (refundTo === 'gateway' && !(method === 'razorpay' && paymentId)) {
        throw new ReturnError('This order was not paid online, so it can only be refunded to the wallet');
    }
    if (method === 'razorpay' && paymentId) return { to: 'gateway', paymentId };
    return { to: 'wallet' };
};

/**
 * Reserve `wantedPaise` of the order's refundable headroom, or as much as is left.
 *
 * A compare-and-swap on order.returnRefundedPaise: the increment lands only if nobody
 * else reserved since the read, so two refunds on one order can never both spend the
 * same headroom. The cap in calculateReturnRefund() is not enough on its own -- it
 * runs when a return is REQUESTED, and two returns opened before either is paid both
 * see the whole order as unrefunded.
 */
const reserveRefund = async (order, wantedPaise) => {
    const paidPaise = toPaise(order.pricing?.total);

    // Orders refunded before the counter existed: seed it from the returns already
    // paid, once, so their money is not handed out a second time.
    if (order.returnRefundedPaise === undefined || order.returnRefundedPaise === null) {
        const prior = await QCReturn.find({ orderId: order._id, status: RETURN_STATUS.REFUNDED })
            .select('refund.total').lean();
        const priorPaise = prior.reduce((s, r) => s + toPaise(r.refund?.total), 0);
        await FoodOrder.updateOne(
            { _id: order._id, returnRefundedPaise: null },
            { $set: { returnRefundedPaise: priorPaise } },
        );
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
        const fresh = await FoodOrder.findById(order._id).select('returnRefundedPaise').lean();
        const already = Number(fresh?.returnRefundedPaise) || 0;
        const grant = Math.min(wantedPaise, paidPaise - already);
        if (grant <= 0) return 0;
        const res = await FoodOrder.updateOne(
            { _id: order._id, returnRefundedPaise: already },
            { $inc: { returnRefundedPaise: grant } },
        );
        if (res.modifiedCount === 1) return grant;
    }
    throw new ReturnError('Another refund on this order is in progress. Try again.', 409);
};

const payOut = async (destination, { order, doc, amount }) => {
    if (destination.to === 'gateway') {
        let result;
        try {
            result = await initiateRazorpayRefund(destination.paymentId, amount);
        } catch (err) {
            result = { success: false, error: err?.message || String(err) };
        }
        if (!result?.success) {
            throw new ReturnError(
                `The refund to the original payment failed (${result?.error || 'gateway error'}). Nothing was refunded; try again or refund to the wallet.`,
                502,
            );
        }
        return { method: 'gateway', reference: String(result.refundId || '') };
    }

    await refundWalletBalance(order.userId, amount, `Refund for return ${doc.returnCode}`, {
        orderId: String(order._id),
        returnId: String(doc._id),
        returnCode: doc.returnCode,
    });
    return { method: 'wallet', reference: '' };
};

/**
 * Move the money.
 *
 * Four steps, in an order that means a failure never pays twice and never strands
 * money: claim the return, reserve its amount against what the order has left to
 * give, pay, then record. A payout that fails releases both the claim and the
 * reservation, so the return can be retried. Once money has moved nothing is undone:
 * a failure after that point leaves the claim in place, so a retry cannot pay again.
 */
export const refundReturn = async ({ returnId, adminId, refundTo }) => {
    const existing = await QCReturn.findById(returnId);
    if (!existing) throw new ReturnError('Return not found', 404);
    if (existing.status === RETURN_STATUS.REFUNDED) return existing; // replay is a no-op
    assertTransition(existing.status, RETURN_STATUS.REFUNDED);

    if (!(existing.refund.total > 0)) {
        throw new ReturnError('This return has no refundable amount');
    }

    const order = await FoodOrder.findById(existing.orderId).lean();
    if (!order) throw new ReturnError('Order not found', 404);
    const destination = resolveRefundDestination(order, refundTo);

    const doc = await QCReturn.findOneAndUpdate(
        { _id: existing._id, status: existing.status, 'refundClaim.at': null },
        { $set: { 'refundClaim.at': new Date(), 'refundClaim.by': String(adminId || '') } },
        { new: true },
    );
    if (!doc) throw new ReturnError('This return is already being refunded', 409);

    let grantedPaise = 0;
    let payout;
    try {
        grantedPaise = await reserveRefund(order, toPaise(doc.refund.total));
        if (grantedPaise <= 0) {
            throw new ReturnError('Everything paid on this order has already been refunded', 409);
        }
        payout = await payOut(destination, { order, doc, amount: grantedPaise / 100 });
    } catch (err) {
        if (grantedPaise > 0) {
            await FoodOrder.updateOne({ _id: order._id }, { $inc: { returnRefundedPaise: -grantedPaise } });
        }
        await QCReturn.updateOne({ _id: doc._id }, { $set: { 'refundClaim.at': null, 'refundClaim.by': '' } });
        throw err;
    }

    // Earlier refunds on this order used up part of what this return was quoted: the
    // record says what was actually paid, and its lines still add up to it.
    if (grantedPaise < toPaise(doc.refund.total)) {
        doc.refund.total = grantedPaise / 100;
        doc.refund.capApplied = true;
        const shares = apportion(grantedPaise, doc.items.map((l) => toPaise(l.refundAmount)));
        doc.items.forEach((line, i) => { line.refundAmount = shares[i] / 100; });
    }

    doc.payout = { ...payout, amount: grantedPaise / 100 };
    doc.refundedAt = new Date();
    recordStatus(doc, RETURN_STATUS.REFUNDED, { byRole: 'ADMIN', byId: String(adminId || '') });
    await doc.save();

    // The GST that came back: item GST, plus the delivery-fee GST when fees did.
    const taxBack = (Number(doc.refund.tax) || 0)
        + ((Number(doc.refund.deliveryFee) || 0) > 0 ? Number(order.pricing?.deliveryFeeGst) || 0 : 0);
    try {
        await recordReturnRefund(order._id, {
            amount: grantedPaise / 100,
            tax: taxBack,
            goods: doc.refund.goods,
            subtotal: order.pricing?.subtotal,
            sellerFault: doc.fault === FAULT.SELLER,
            returnCode: doc.returnCode,
            recordedById: adminId,
        });
    } catch (err) {
        // The customer has been paid; a ledger that failed to follow is a finance
        // correction, not a reason to report the refund as failed.
        logger.error(`[QC returns] ledger not updated for ${doc.returnCode}: ${err?.message || err}`);
    }
    // The cashback paid on this order goes back with the refund, pro rata.
    try {
        const { reverseOrderCashback } = await import('../../user/services/cashback.service.js');
        await reverseOrderCashback(order._id, {
            refundedAmount: grantedPaise / 100,
            orderTotal: order.pricing?.total,
            key: doc.returnCode,
        });
    } catch (err) {
        logger.warn(`[QC returns] cashback not reversed for ${doc.returnCode}: ${err?.message || err}`);
    }
    return doc;
};

/** Customer withdraws a request that has not been collected yet. */
export const cancelReturn = async ({ returnId, userId }) => {
    const doc = await QCReturn.findOne({ _id: returnId, userId });
    if (!doc) throw new ReturnError('Return not found', 404);

    recordStatus(doc, RETURN_STATUS.CANCELLED, { byRole: 'USER', byId: String(userId) });
    await doc.save();
    return doc;
};

export const listUserReturns = async ({ userId, page = 1, limit = 20 }) => {
    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
        QCReturn.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        QCReturn.countDocuments({ userId }),
    ]);
    return { items, total, page, limit };
};

export const listAdminReturns = async ({ status, page = 1, limit = 20 }) => {
    const filter = status ? { status } : {};
    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
        QCReturn.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        QCReturn.countDocuments(filter),
    ]);
    return { items, total, page, limit };
};

export const getReturnForUser = async ({ returnId, userId }) => {
    const doc = await QCReturn.findOne({ _id: returnId, userId }).lean();
    if (!doc) throw new ReturnError('Return not found', 404);
    return doc;
};

/**
 * What a customer may still send back from an order, and why not when they cannot.
 *
 * The client needs this to render the return screen without guessing at the policy —
 * and rendering a return button that the server then refuses is the single most
 * common support ticket in this flow.
 */
export const getReturnableItems = async ({ orderId, userId }) => {
    const order = await FoodOrder.findOne({ _id: orderId, userId }).lean();
    if (!order) throw new ReturnError('Order not found', 404);

    const perishability = await resolvePerishability((order.items || []).map((i) => i.itemId));
    const { claimed } = await alreadyClaimed(order._id);

    // Probed with a seller-fault reason: it has the widest eligibility, so a denial
    // here means nothing on this order is returnable for any reason.
    const eligibility = checkEligibility({ order, reasonCode: 'damaged', perishability });

    return {
        eligible: eligibility.eligible,
        reason: eligibility.reason || null,
        windowExpiresAt: eligibility.expiresAt || null,
        perishability,
        items: (order.items || []).map((it) => {
            const key = `${it.itemId}::${it.variantId || ''}`;
            return {
                itemId: it.itemId,
                variantId: it.variantId || '',
                name: it.name,
                orderedQuantity: it.quantity,
                returnableQuantity: Math.max(0, (it.quantity || 0) - (claimed.get(key) || 0)),
                unitPrice: it.price,
            };
        }),
    };
};

export { ReturnError };
