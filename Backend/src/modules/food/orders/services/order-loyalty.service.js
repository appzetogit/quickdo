import { FoodOrder } from '../models/order.model.js';
import {
    quoteRedemption,
    burnPoints,
    reverseBurn,
    earnForOrder,
    safely,
} from '../../../../core/loyalty/loyalty.service.js';
import { LoyaltyLedger } from '../../../../core/loyalty/loyaltyLedger.model.js';

/**
 * Food's calls into the shared loyalty ledger (core/loyalty, plan §5.7), the
 * same way quick commerce makes them (quickCommerce/.../order-loyalty.service.js).
 * Every rule -- on/off, the rupee value of a point, the most of an order points
 * may pay -- lives in core and is read for the `food` vertical.
 *
 *   quoteFoodLoyalty     what the asked-for points take off (clamped, never refused)
 *   applyLoyaltyToPricing  takes the discount off AFTER GST, like a wallet
 *   burnFoodOrderLoyalty   at placement; idempotent per order
 *   reverseFoodOrderLoyalty  when an order that used points is cancelled; once
 *   awardFoodOrderLoyalty    on delivery; once
 *
 * With loyalty off (the default) a quote is zero points, so checkout is
 * exactly what it was.
 */

export const VERTICAL = 'food';
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export const redeemKeyFor = (orderId) => `food:${orderId}`;

/** The item value points are capped against: the food after any coupon. */
const itemValueOf = (pricing = {}) =>
    Math.max(0, (Number(pricing.subtotal) || 0) - (Number(pricing.discount) || 0));

/** What `points` would take off this bill. Zero (with the reason) when loyalty is off. */
export async function quoteFoodLoyalty(userId, points, pricing) {
    return quoteRedemption({
        customerId: userId,
        vertical: VERTICAL,
        points,
        orderValue: itemValueOf(pricing),
    });
}

/**
 * Take a quoted redemption off a priced bill, in place. The GST lines are left
 * exactly as they were (points are a payment, not a discount on the supply);
 * the grand total is re-rounded to the rupee with its round-off line, and the
 * stored bill carries the deduction so it still adds up.
 */
export function applyLoyaltyToPricing(pricing, quote) {
    if (!pricing || !(Number(quote?.points) > 0) || !(Number(quote?.discount) > 0)) return pricing;
    const before = round2((Number(pricing.total) || 0) - (Number(pricing.roundOff) || 0));
    const discount = round2(Math.min(Number(quote.discount), before));
    const payable = round2(Math.max(0, before - discount));
    const total = Math.round(payable);
    const roundOff = round2(total - payable);
    pricing.loyaltyDiscount = discount;
    pricing.loyaltyPoints = Math.floor(Number(quote.points));
    pricing.total = total;
    pricing.roundOff = roundOff;
    if (pricing.bill && typeof pricing.bill === 'object') {
        pricing.bill = {
            ...pricing.bill,
            loyaltyDiscount: discount,
            loyaltyPoints: pricing.loyaltyPoints,
            payableBeforeRounding: payable,
            roundOff,
            grandTotal: total,
        };
    }
    return pricing;
}

/** Spend the order's points. Throws ValidationError('Not enough loyalty points'). */
export async function burnFoodOrderLoyalty(userId, order) {
    const points = Number(order?.pricing?.loyaltyPoints) || 0;
    if (points <= 0) return { burned: 0 };
    // The ledger's unique idempotency key is what makes a retry a no-op; make
    // sure the index exists before relying on it (a no-op once built).
    await LoyaltyLedger.init();
    return burnPoints({
        customerId: userId,
        vertical: VERTICAL,
        points,
        key: redeemKeyFor(order._id),
        orderId: String(order._id),
        orderRef: order.order_id || '',
        amount: Number(order.pricing?.loyaltyDiscount) || 0,
    });
}

/**
 * Give back the points a cancelled (or never-saved) order redeemed. Idempotent:
 * the ledger keys the reversal on the order, so every cancel path may call it.
 * Never throws into an order flow.
 */
export async function reverseFoodOrderLoyalty(orderLike, { force = false } = {}) {
    return safely('food reverse', async () => {
        const order = orderLike?.toObject ? orderLike.toObject() : orderLike;
        const points = Number(order?.pricing?.loyaltyPoints) || 0;
        if (!order?._id || points <= 0) return null;
        if (!force && !String(order.orderStatus || '').startsWith('cancelled')) return null;
        const res = await reverseBurn({
            customerId: String(order.userId?._id || order.userId),
            vertical: VERTICAL,
            points,
            key: redeemKeyFor(order._id),
            orderId: String(order._id),
            orderRef: order.order_id || '',
        });
        if (res?.returned > 0) {
            await FoodOrder.updateOne({ _id: order._id }, { $set: { 'loyalty.reversedAt': new Date() } }).catch(() => {});
        }
        return res;
    });
}

/** Points for a delivered order, on the food value paid for. Idempotent per order. */
export async function awardFoodOrderLoyalty(orderLike) {
    return safely('food earn', async () => {
        const order = orderLike?.toObject ? orderLike.toObject() : orderLike;
        if (!order?._id || order.orderStatus !== 'delivered') return null;
        const p = order.pricing || {};
        const amount = Math.max(0, itemValueOf(p) - (Number(p.loyaltyDiscount) || 0));
        const res = await earnForOrder({
            customerId: String(order.userId?._id || order.userId),
            vertical: VERTICAL,
            orderId: String(order._id),
            orderRef: order.order_id || '',
            amount,
        });
        if (res?.earned > 0 && !res.duplicate) {
            await FoodOrder.updateOne(
                { _id: order._id },
                { $set: { 'loyalty.pointsEarned': res.earned, 'loyalty.earnedAt': new Date() } },
            );
        }
        return res;
    });
}
