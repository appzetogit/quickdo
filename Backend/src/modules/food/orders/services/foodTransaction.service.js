import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodRestaurantCommission } from '../../admin/models/restaurantCommission.model.js';
import { FoodCommissionSchedule } from '../../admin/models/commissionSchedule.model.js';
import { FoodFeeSettings } from '../../admin/models/feeSettings.model.js';
import {
  COMMISSION_SOURCES,
  computeCommissionAmount,
  resolveCommissionRate,
} from '../../shared/commissionSchedule.js';
import mongoose from 'mongoose';

export const MONETIZATION_MODES = Object.freeze({ COMMISSION: 'commission', PLAN: 'plan' });

/**
 * Which model the platform is billing restaurants under right now.
 *
 * Cached for the same reason and the same minute as the commission rules below:
 * it is read on every order, and a switch taking effect within a minute rather
 * than on the instant is acceptable for a setting an admin changes by hand.
 *
 * Falls back to commission whenever the settings row is missing or unreadable.
 * That is the safe direction: failing into commission bills the restaurant its
 * configured rate, while failing into plan mode would silently hand every
 * restaurant a 0% cut until someone noticed the revenue gap.
 */
const MONETIZATION_MODE_CACHE_MS = 60 * 1000;
let monetizationModeCache = null;
let monetizationModeLoadedAt = 0;

export const invalidateMonetizationModeCache = () => {
  monetizationModeCache = null;
  monetizationModeLoadedAt = 0;
};

export async function getActiveMonetizationMode() {
  const now = Date.now();
  if (monetizationModeCache && now - monetizationModeLoadedAt < MONETIZATION_MODE_CACHE_MS) {
    return monetizationModeCache;
  }
  let mode = MONETIZATION_MODES.COMMISSION;
  try {
    const doc = await FoodFeeSettings.findOne({ isActive: true })
      .sort({ createdAt: -1 })
      .select('monetizationMode')
      .lean();
    if (doc?.monetizationMode === MONETIZATION_MODES.PLAN) mode = MONETIZATION_MODES.PLAN;
  } catch {
    mode = MONETIZATION_MODES.COMMISSION;
  }
  monetizationModeCache = mode;
  monetizationModeLoadedAt = now;
  return mode;
}

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

/**
 * Dated commission overrides that could apply right now.
 *
 * Cached like the standing rules, and for the same reason: this is read on every
 * order. A minute of staleness is acceptable -- a festive rate starting at
 * midnight takes effect within a minute of it, not on the stroke.
 */
const COMMISSION_SCHEDULE_CACHE_MS = 60 * 1000;
let commissionScheduleCache = null;
let commissionScheduleLoadedAt = 0;

export const invalidateCommissionScheduleCache = () => {
  commissionScheduleCache = null;
  commissionScheduleLoadedAt = 0;
};

async function getActiveCommissionSchedules(at = new Date()) {
  const now = Date.now();
  if (commissionScheduleCache && now - commissionScheduleLoadedAt < COMMISSION_SCHEDULE_CACHE_MS) {
    return commissionScheduleCache;
  }

  // Only schedules whose window contains this instant; the resolver re-checks,
  // so this narrowing is an optimisation rather than the rule.
  const list = await FoodCommissionSchedule.find({
    status: { $ne: false },
    startsAt: { $lte: at },
    endsAt: { $gt: at },
  }).lean();

  commissionScheduleCache = list || [];
  commissionScheduleLoadedAt = now;
  return commissionScheduleCache;
}

/**
 * The commission owed on one order.
 *
 * The base is the SUBTOTAL -- the food bill. Delivery is collected from the
 * customer and passed through, so commissioning the customer's total would take
 * a cut of money that was never the restaurant's.
 *
 * The rate itself now comes from shared/commissionSchedule.js, which knows about
 * dated overrides; this function keeps its shape so every existing caller is
 * unaffected, and gains the source/label so an invoice can explain a rate that
 * was not the restaurant's usual one.
 */
export async function getRestaurantCommissionSnapshot(orderDoc, at = new Date()) {
  /*
   * Commission is charged on the food net of GST.
   *
   * commissionableAmount equals subtotal for a restaurant that prices net,
   * which is every restaurant by default, so this changes nothing for them.
   * For one whose menu prices include GST it is the smaller figure: the tax
   * inside the price is collected for the government and the restaurant never
   * keeps it, so a commission percentage of it would be a cut of tax.
   *
   * Falls back to subtotal for orders placed before the field existed.
   */
  const baseAmount = Number(
    orderDoc?.pricing?.commissionableAmount ?? orderDoc?.pricing?.subtotal ?? 0,
  ) || 0;
  const restaurantIdRaw =
    orderDoc?.restaurantId?._id ?? orderDoc?.restaurantId ?? null;

  /*
   * The order's own mode wins over the live setting.
   *
   * An order placed under plan mode must still read as plan mode after an admin
   * switches back to commission, or settling last week's orders would bill
   * commission that was never charged at the time. The stamp is absent on
   * orders predating this field and on the synthetic order the rate-preview
   * endpoints pass in, and both correctly want today's setting.
   */
  const mode =
    orderDoc?.pricing?.monetizationMode === MONETIZATION_MODES.PLAN ||
    orderDoc?.pricing?.monetizationMode === MONETIZATION_MODES.COMMISSION
      ? orderDoc.pricing.monetizationMode
      : await getActiveMonetizationMode();

  const none = {
    commissionAmount: 0,
    commissionType: 'percentage',
    commissionValue: 0,
    commissionSource: COMMISSION_SOURCES.NONE,
    commissionLabel: '',
    commissionScheduleId: null,
    baseAmount,
    monetizationMode: mode,
  };

  // Plan mode: the restaurant pays a recurring fee, so no per-order cut. Said
  // explicitly rather than as an unexplained zero -- see COMMISSION_SOURCES.
  if (mode === MONETIZATION_MODES.PLAN) {
    return { ...none, commissionSource: COMMISSION_SOURCES.PLAN_MODE };
  }

  if (!restaurantIdRaw) return none;

  const [rules, schedules] = await Promise.all([
    getActiveRestaurantCommissionRules(),
    getActiveCommissionSchedules(at),
  ]);

  const defaultRule =
    rules.find((r) => String(r.restaurantId) === String(restaurantIdRaw)) ||
    // Fallback: accept legacy docs where restaurantId may be stored under `restaurant` / `restaurant_id`
    rules.find((r) => String(r.restaurant || r.restaurant_id || '') === String(restaurantIdRaw)) ||
    null;

  const rate = resolveCommissionRate({
    defaultRule,
    schedules,
    restaurantId: restaurantIdRaw,
    at,
  });

  return {
    commissionAmount: computeCommissionAmount(baseAmount, rate),
    commissionType: rate.type,
    commissionValue: rate.value,
    commissionSource: rate.source,
    commissionLabel: rate.label,
    commissionScheduleId: rate.scheduleId,
    baseAmount,
    monetizationMode: mode,
  };
}

/**
 * Creates an initial 'pending' transaction when an order is created.
 */
export async function createInitialTransaction(order) {
    if (!order) return null;

    const { commissionAmount = 0 } = await getRestaurantCommissionSnapshot(order).catch(() => ({ commissionAmount: 0 }));
    
    // Split logic - Ensure all values are finite numbers
    const totalCustomerPaid = Number(order.pricing?.total) || 0;
    /*
     * The tip is the rider's in full.
     *
     * The bill charges it and the customer pays it, so leaving it out of the
     * payout collected money on the rider's behalf and credited it to nobody.
     */
    const riderTipPay = Number(order.pricing?.tip) || 0;
    /*
     * On the order, riderTotalPayout is the rider's pay BEFORE the tip and
     * riderEarning is that plus the tip. riderEarning is what the rider's
     * balance is built from, so it has to hold the tip. The tip is added below,
     * exactly once. So when this falls back to riderEarning (a payout of zero,
     * e.g. no distance slab matched) the tip is taken back out first. Otherwise
     * a tipped order would pay the tip twice and book it as a platform cost.
     */
    const storedPayoutBeforeTip =
        Number(order.riderTotalPayout) ||
        Math.max(0, (Number(order.riderEarning) || 0) - riderTipPay);
    const riderShare = storedPayoutBeforeTip;
    
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
    const adminDeliveryCommissionEnabled = order.pricing?.adminDeliveryCommissionEnabled === true;
    const adminDeliveryCommissionPercent = Number(order.pricing?.adminDeliveryCommissionPercent) || 0;
    const adminDeliveryCommissionAmount = Number(order.pricing?.adminDeliveryCommissionAmount) || 0;
    const riderDeliveryEarningAfterAdminCommission = Number(order.pricing?.riderDeliveryEarningAfterAdminCommission) || deliveryFee;
    const deliveryPartnerIncentiveEnabled = order.pricing?.deliveryPartnerIncentiveEnabled === true;
    const deliveryPartnerIncentivePercent = Number(order.pricing?.deliveryPartnerIncentivePercent) || 0;
    const deliveryPartnerIncentiveAmount = Number(order.pricing?.deliveryPartnerIncentiveAmount) || 0;
    const deliveryPartnerIncentiveEligible = order.pricing?.deliveryPartnerIncentiveEligible === true;
    const surgeAmount = Number(order.pricing?.surgeAmount) || 0;
    const tax = Number(order.pricing?.tax) || 0;
    const riderBasePay = Number(order.riderBasePay) || Number(order.pricing?.deliveryFeeBreakdown?.basePayout) || 0;
    const riderDeliveryFeeShare = Number(order.riderDeliveryFeeShare) || riderDeliveryEarningAfterAdminCommission;
    const riderSurgePay = Number(order.riderSurgePay) || surgeAmount;
    const riderIncentivePay = Number(order.riderIncentivePay) || deliveryPartnerIncentiveAmount;
    // Added on top of the stored pre-tip payout, never folded into it.
    const riderPayoutBeforeTip =
        storedPayoutBeforeTip ||
        Math.round((riderBasePay + riderDeliveryFeeShare + riderSurgePay + riderIncentivePay) * 100) / 100;
    const riderTotalPayout = Math.round((riderPayoutBeforeTip + riderTipPay) * 100) / 100;

    /*
     * What the restaurant keeps: the food net of GST, not the listed total.
     *
     * Identical to subtotal for a restaurant that prices net -- the tax is a
     * separate line the customer pays on top. For one whose menu prices
     * include GST the tax is inside the subtotal and is owed to the
     * government, so crediting the whole subtotal would pay the restaurant its
     * own tax liability.
     */
    const restaurantFoodEarnings =
        Number(order.pricing?.commissionableAmount ?? subtotal) || 0;

    /*
     * Packaging is only the restaurant's when the restaurant set it.
     *
     * Admin mode is one flat charge per order that the platform keeps, so
     * crediting it here paid the restaurant money it never received. Orders
     * placed before packagingMode was stored fall back to the old behaviour
     * rather than retroactively docking a restaurant that was already paid.
     */
    const packagingMode = String(order.pricing?.packagingMode || '');
    // Net of GST for the same reason the food is: an inclusive restaurant does
    // not keep the tax inside its own packaging charge either.
    const netPackagingFee = Number(order.pricing?.netPackagingFee ?? packagingFee) || 0;
    const restaurantPackagingEarnings =
        packagingMode === '' || packagingMode === 'RESTAURANT' ? netPackagingFee : 0;

    let restaurantNet =
        restaurantFoodEarnings + restaurantPackagingEarnings - restaurantCommission;
    /*
     * The platform keeps the packaging charge only in admin mode, and only net
     * of its tax. The difference between the listed packagingFee and the net is
     * GST: it belongs to the government, so it is neither side's profit.
     */
    const platformPackagingEarnings = packagingMode === 'ADMIN' ? netPackagingFee : 0;

    /*
     * The bill rounds the grand total to a whole rupee and the customer pays the
     * rounded figure. The difference is the platform's -- it was collected and
     * nobody else is credited it -- so it belongs here. Left out, every order's
     * ledger came up to 50 paise short of what the customer paid.
     */
    const roundOff = Number(order.pricing?.roundOff ?? order.pricing?.bill?.roundOff) || 0;

    let platformNetProfit =
        platformFee
        + deliveryFee
        + surgeAmount
        + restaurantCommission
        + platformPackagingEarnings
        + roundOff
        - riderShare;

    /*
     * Whoever funded the coupon wears it.
     *
     * The figure deducted is what the coupon actually took off the net lines,
     * not its face value: on a GST-inclusive menu the coupon came off a price
     * that still had tax in it, so part of its face value was tax the
     * restaurant was never going to keep anyway. Falls back to the face value
     * for orders placed before the bill carried the distinction.
     */
    const fundedDiscount = Number(order.pricing?.bill?.discountOnNet ?? discount) || 0;

    const couponCode = order.pricing?.couponCode;
    if (discount > 0 && couponCode) {
        try {
            // Dynamic import to avoid circular dependency if any
            const { FoodOffer } = await import('../../admin/models/offer.model.js');
            const offer = await FoodOffer.findOne({ couponCode: String(couponCode).toUpperCase() }).lean();
            if (offer?.createdByRole === 'RESTAURANT') {
                restaurantNet -= fundedDiscount;
            } else {
                // Admin created (default) or not found
                platformNetProfit -= fundedDiscount;
            }
        } catch (err) {
            // Log but don't fail, default to admin attribution
            platformNetProfit -= fundedDiscount;
        }
    }

    /*
     * Finite and rounded, but NOT floored at zero.
     *
     * Either side can end an order out of pocket when it funded a coupon worth
     * more than it earned. Clamping that to zero did not prevent the loss, it
     * only stopped the ledger recording it -- an order that cost the platform
     * 100 was written as 0, and the earnings report read 100 too high. The
     * schema's `min: 0` is what forced the clamp; both are gone.
     */
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
            deliveryFeeBreakdown: order.pricing?.deliveryFeeBreakdown || null,
            adminDeliveryCommissionEnabled,
            adminDeliveryCommissionPercent,
            adminDeliveryCommissionAmount,
            riderDeliveryEarningAfterAdminCommission,
            deliveryPartnerIncentiveEnabled,
            deliveryPartnerIncentivePercent,
            deliveryPartnerIncentiveAmount,
            deliveryPartnerIncentiveEligible,
            platformFee: platformFee,
            surgeAmount: surgeAmount,
            restaurantCommission: restaurantCommission,
            discount: discount,
            tip: riderTipPay,
            total: totalCustomerPaid,
            currency: String(order.pricing?.currency || order.currency || 'INR'),
        },
        amounts: {
            totalCustomerPaid: totalCustomerPaid,
            restaurantShare: restaurantNet,
            restaurantCommission: restaurantCommission,
            riderShare: riderTotalPayout,
            riderDeliveryFeeShare: riderDeliveryFeeShare,
            adminDeliveryCommissionAmount: adminDeliveryCommissionAmount,
            riderBasePay: riderBasePay,
            riderSurgePay: riderSurgePay,
            riderIncentivePay: riderIncentivePay,
            riderTipPay: riderTipPay,
            riderTotalPayout: riderTotalPayout,
            platformNetProfit: platformNetProfit,
            taxAmount: tax
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
        await mongoose.model('FoodOrder').updateOne(
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
