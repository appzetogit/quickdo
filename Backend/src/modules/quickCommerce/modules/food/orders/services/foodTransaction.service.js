import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodRestaurantCommission } from '../../admin/models/restaurantCommission.model.js';
import { resolveDiscountSplitByCoupon } from '../../shared/discountSplit.util.js';
import mongoose from 'mongoose';

const RESTAURANT_COMMISSION_CACHE_MS = 60 * 1000;
let restaurantCommissionRulesCache = null;
let restaurantCommissionRulesLoadedAt = 0;

async function getActiveRestaurantCommissionRules() {
  const now = Date.now();
  if (
    restaurantCommissionRulesCache &&
    now - restaurantCommissionRulesLoadedAt < RESTAURANT_COMMISSION_CACHE_MS
  ) {
    return restaurantCommissionRulesCache;
  }

  const list = await FoodRestaurantCommission.find({
    status: { $ne: false },
  }).lean();
  restaurantCommissionRulesCache = list || [];
  restaurantCommissionRulesLoadedAt = now;
  return restaurantCommissionRulesCache;
}

export function computeRestaurantCommissionAmount(baseAmount, rule) {
  const safeBase = Math.max(0, Number(baseAmount) || 0);
  if (!Number.isFinite(safeBase) || safeBase < 0) return 0;

  const commissionType = rule?.defaultCommission?.type || 'percentage';
  const commissionValue = Math.max(
    0,
    Number(rule?.defaultCommission?.value ?? 0) || 0
  );

  let commissionAmount = 0;
  if (commissionType === 'percentage') {
    commissionAmount = safeBase * (commissionValue / 100);
  } else if (commissionType === 'amount') {
    commissionAmount = commissionValue;
  }

  // Round to 2 decimals and clamp to [0, base]
  commissionAmount = Math.round((commissionAmount || 0) * 100) / 100;
  commissionAmount = Math.max(0, Math.min(commissionAmount, safeBase));

  return { commissionAmount, commissionType, commissionValue, baseAmount: safeBase };
}

export async function getRestaurantCommissionSnapshot(orderDoc) {
  const baseAmount = Number(orderDoc?.pricing?.subtotal ?? 0) || 0;
  const restaurantIdRaw =
    orderDoc?.restaurantId?._id ?? orderDoc?.restaurantId ?? null;

  if (!restaurantIdRaw) {
    return {
      commissionAmount: 0,
      commissionType: 'percentage',
      commissionValue: 0,
      baseAmount,
    };
  }

  const rules = await getActiveRestaurantCommissionRules();
  const rule =
    rules.find((r) => String(r.restaurantId) === String(restaurantIdRaw)) ||
    // Fallback: accept legacy docs where restaurantId may be stored under `restaurant` / `restaurant_id`
    rules.find((r) => String(r.restaurant || r.restaurant_id || '') === String(restaurantIdRaw)) ||
    null;

  if (!rule) {
    return {
      commissionAmount: 0,
      commissionType: 'percentage',
      commissionValue: 0,
      baseAmount,
    };
  }

  return computeRestaurantCommissionAmount(baseAmount, rule);
}

/**
 * Creates an initial 'pending' transaction when an order is created.
 */
export async function createInitialTransaction(order) {
    if (!order) return null;

    const { commissionAmount = 0 } = await getRestaurantCommissionSnapshot(order).catch(() => ({ commissionAmount: 0 }));
    
    // Split logic - Ensure all values are finite numbers
    const totalCustomerPaid = Number(order.pricing?.total) || 0;
    const riderShare = Number(order.riderEarning) || 0;
    
    // Prefer commission already computed & stored on the order (source of truth for this order),
    // fallback to rule snapshot for older orders.
    const restaurantCommissionFromOrder = Number(order.pricing?.restaurantCommission);
    const restaurantCommission =
        Number.isFinite(restaurantCommissionFromOrder) && restaurantCommissionFromOrder > 0
            ? restaurantCommissionFromOrder
            : (Number(commissionAmount) || 0);

    const discount = Number(order.pricing?.discount) || 0;
    const subtotal = Number(order.pricing?.subtotal) || 0;
    const packagingFee = Number(order.pricing?.packagingFee) || 0;
    const platformFee = Number(order.pricing?.platformFee) || 0;
    const deliveryFee = Number(order.pricing?.deliveryFee) || 0;
    const deliveryFeeGst = Number(order.pricing?.deliveryFeeGst) || 0;
    // Tax like the other two: collected for the government, not platform profit.
    const platformFeeGst = Number(order.pricing?.platformFeeGst) || 0;
    const tax = Number(order.pricing?.tax) || 0;

    let restaurantNet = subtotal + packagingFee - restaurantCommission;
    // The 18% GST on the delivery fee is collected for the government, like the
    // item GST, so it is booked as tax below rather than as platform profit.
    // The round-off the customer paid (to the rupee) is the platform's.
    const roundOff = Number(order.pricing?.roundOff) || 0;
    let platformNetProfit = platformFee + deliveryFee + restaurantCommission - riderShare + roundOff;
    let adminDiscountShare = 0;
    let restaurantDiscountShare = 0;
    let discountAdminBearPercentage = 0;
    let discountRestaurantBearPercentage = 0;

    // Handle discount attribution via the shared split util (single source of truth).
    const couponCode = order.pricing?.couponCode;
    if (discount > 0 && couponCode) {
        const split = await resolveDiscountSplitByCoupon({ couponCode, discount });
        adminDiscountShare = split.adminDiscountShare;
        restaurantDiscountShare = split.restaurantDiscountShare;
        discountAdminBearPercentage = split.adminBearPercentage;
        discountRestaurantBearPercentage = split.restaurantBearPercentage;
    }
    restaurantNet -= restaurantDiscountShare;
    platformNetProfit -= adminDiscountShare;

    // Ensure nets are finite and rounded
    restaurantNet = Math.round((Number(restaurantNet) || 0) * 100) / 100;
    platformNetProfit = Math.round((Number(platformNetProfit) || 0) * 100) / 100;

    const transaction = new FoodTransaction({
        orderId: order._id,
        userId: order.userId,
        restaurantId: order.restaurantId,
        deliveryPartnerId: order.dispatch?.deliveryPartnerId,
        paymentMethod: order.payment?.method || 'cash',
        status: order.payment?.status === 'paid' ? 'captured' : 'pending',
        payment: {
            method: String(order.payment?.method || 'cash'),
            status: String(order.payment?.status || 'cod_pending'),
            amountDue: Number(order.payment?.amountDue ?? totalCustomerPaid) || 0,
            razorpay: {
                orderId: String(order.payment?.razorpay?.orderId || ''),
                paymentId: String(order.payment?.razorpay?.paymentId || ''),
                signature: String(order.payment?.razorpay?.signature || ''),
            },
            qr: {
                qrId: String(order.payment?.qr?.qrId || ''),
                imageUrl: String(order.payment?.qr?.imageUrl || ''),
                paymentLinkId: String(order.payment?.qr?.paymentLinkId || ''),
                shortUrl: String(order.payment?.qr?.shortUrl || ''),
                status: String(order.payment?.qr?.status || ''),
                expiresAt: order.payment?.qr?.expiresAt || null,
            }
        },
        pricing: {
            subtotal: subtotal,
            tax: tax,
            packagingFee: packagingFee,
            deliveryFee: deliveryFee,
            deliveryFeeGst: deliveryFeeGst,
            platformFeeGst: platformFeeGst,
            platformFee: platformFee,
            restaurantCommission: restaurantCommission,
            discount: discount,
            couponCode: couponCode ? String(couponCode).toUpperCase() : null,
            total: totalCustomerPaid,
            currency: String(order.pricing?.currency || order.currency || 'INR'),
        },
        amounts: {
            totalCustomerPaid: totalCustomerPaid,
            restaurantShare: Math.max(0, restaurantNet),
            restaurantCommission: restaurantCommission,
            riderShare: riderShare,
            platformNetProfit: platformNetProfit,
            // Item GST plus the GST on the delivery fee: both are owed to the
            // government, neither is platform profit.
            taxAmount: Math.round((tax + deliveryFeeGst + platformFeeGst) * 100) / 100,
            adminDiscountShare,
            restaurantDiscountShare,
            discountAdminBearPercentage,
            discountRestaurantBearPercentage
        },
        gateway: {
            razorpayOrderId: order.payment?.razorpay?.orderId,
            qrUrl: order.payment?.qr?.imageUrl
        },
        history: [{
            kind: 'created',
            amount: totalCustomerPaid,
            note: 'Initial transaction created with order'
        }]
    });

    await transaction.save();

    // Link back to the order
    try {
        await mongoose.model('QCOrder').updateOne(
            { _id: order._id },
            { $set: { transactionId: transaction._id } }
        );
    } catch (err) {
        // Log but don't fail transaction if the backlink fails
    }

    return transaction;
}

/**
 * Updates transaction status (captured, settled, etc) and appends to history.
 */
export async function updateTransactionStatus(orderId, kind, details = {}) {
    const query = { orderId };
    const transaction = await FoodTransaction.findOne(query);
    if (!transaction) return null;

    if (details.status) transaction.status = details.status;
    if (details.razorpayPaymentId) transaction.gateway.razorpayPaymentId = details.razorpayPaymentId;
    if (details.razorpaySignature) transaction.gateway.razorpaySignature = details.razorpaySignature;
    
    transaction.history.push({
        kind,
        amount: transaction.amounts.totalCustomerPaid,
        at: new Date(),
        note: details.note || `Transaction updated: ${kind}`,
        recordedBy: { role: details.recordedByRole || 'SYSTEM', id: details.recordedById }
    });

    await transaction.save();

    return transaction;
}

/**
 * Book a post-delivery return refund against the order's ledger.
 *
 * Returns used to move money without touching the ledger at all: the seller kept its
 * full payout for goods it had failed to supply, and the refunded money still showed
 * as earned. The refund is now taken out of the shares it came from:
 *
 *   - GST first: the item GST and, when fees came back, the delivery-fee GST. That
 *     money was owed to the government only because the sale stood.
 *   - The seller, on a seller-fault return: the part of its original payout that the
 *     returned goods earned (payout x goods / subtotal), so commission and any
 *     seller-funded discount come off in proportion.
 *   - The platform bears the rest: the fees it refunds, its commission on the goods,
 *     and -- on a customer-fault return, where the seller is not at fault -- the goods.
 *
 * So restaurant + rider + platform + tax always equals totalCustomerPaid minus
 * refundedAmount: every rupee the customer still paid for is credited exactly once.
 *
 * Applied with a compare-and-swap on refundedAmount, because two refunds on one order
 * can land together and a read-modify-save would let one overwrite the other.
 */
export async function recordReturnRefund(orderId, {
    amount = 0,
    tax = 0,
    goods = 0,
    subtotal = 0,
    sellerFault = false,
    returnCode = '',
    recordedById,
} = {}) {
    const toP = (n) => Math.round((Number(n) || 0) * 100);
    const amountP = toP(amount);
    if (amountP <= 0) return null;

    for (let attempt = 0; attempt < 8; attempt += 1) {
        const tx = await FoodTransaction.findOne({ orderId }).lean();
        if (!tx) return null;
        const a = tx.amounts || {};

        const taxBackP = Math.max(0, Math.min(toP(tax), toP(a.taxAmount), amountP));
        let sellerP = 0;
        if (sellerFault && Number(subtotal) > 0) {
            const originalShareP = toP(a.restaurantShare) + toP(a.sellerReturnDebit);
            const earnedByGoodsP = Math.round((originalShareP * Number(goods)) / Number(subtotal));
            sellerP = Math.max(0, Math.min(earnedByGoodsP, toP(a.restaurantShare), amountP - taxBackP));
        }
        const platformP = amountP - taxBackP - sellerP;

        const refundedP = toP(a.refundedAmount) + amountP;
        const set = {
            'amounts.taxAmount': (toP(a.taxAmount) - taxBackP) / 100,
            'amounts.restaurantShare': (toP(a.restaurantShare) - sellerP) / 100,
            'amounts.platformNetProfit': (toP(a.platformNetProfit) - platformP) / 100,
            'amounts.refundedAmount': refundedP / 100,
            'amounts.sellerReturnDebit': (toP(a.sellerReturnDebit) + sellerP) / 100,
        };
        // Fully given back: reports stop counting it as earned revenue.
        if (refundedP >= toP(a.totalCustomerPaid)) set.status = 'refunded';

        const entry = {
            kind: 'return_refunded',
            amount: amountP / 100,
            at: new Date(),
            note: `Return ${returnCode}: refunded ${amountP / 100} (GST ${taxBackP / 100}, seller ${sellerP / 100}, platform ${platformP / 100})`,
            recordedBy: {
                role: 'ADMIN',
                ...(mongoose.Types.ObjectId.isValid(String(recordedById || '')) ? { id: recordedById } : {}),
            },
        };

        // Matches only if nobody booked a refund since the read; null also matches a
        // ledger written before the field existed.
        const res = await FoodTransaction.updateOne(
            { _id: tx._id, 'amounts.refundedAmount': a.refundedAmount ?? null },
            { $set: set, $push: { history: entry } },
        );
        if (res.modifiedCount === 1) return FoodTransaction.findById(tx._id).lean();
    }
    throw new Error(`Ledger for order ${orderId} kept changing; return refund not booked`);
}

/**
 * Updates the rider in the transaction when an order is accepted.
 */
export async function updateTransactionRider(orderId, riderId) {
    const query = { orderId };
    return await FoodTransaction.findOneAndUpdate(
        query,
        { $set: { deliveryPartnerId: riderId } },
        { new: true }
    );
}

/**
 * Marks restaurant as settled in the finance record.
 */
export async function settleRestaurant(orderId, adminId) {
    return await updateTransactionStatus(orderId, 'settled', {
        status: 'captured', // Ensure it's marked as captured if it was pending cash
        note: 'Restaurant payout settled by admin',
        recordedByRole: 'ADMIN',
        recordedById: adminId
    });
}
