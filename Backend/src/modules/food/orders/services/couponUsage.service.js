import mongoose from 'mongoose';
import { resolvePromoCeiling, tighten } from '../../../../core/finance/promoLimits.service.js';
import { FoodOrder } from '../models/order.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';
import { logger } from '../../../../utils/logger.js';

/**
 * When a coupon counts as used, and when it stops counting.
 *
 * Usage used to be counted the moment an order document was created, including
 * an online checkout the customer then abandoned at the payment sheet. That use
 * was never given back. A first-order coupon was gone after a failed payment,
 * and a limited coupon ran out on attempts nobody paid for.
 *
 * The rule now: a use counts once the order is real, and is given back if the
 * order is cancelled.
 *
 *   cash / wallet / QR   counted at placement, before the order is saved, so
 *                        the usage cap is enforced atomically (see createOrder)
 *   razorpay (online)    marked `pending` at placement and counted only when
 *                        the payment is verified -- by the app's /verify call
 *                        or the gateway webhook, whichever arrives first
 *   any cancellation     gives back a use that was counted
 *
 * `order.couponUsage` records the state, and every transition is a conditional
 * update on it. /verify and the webhook can race, and a cancel can arrive twice,
 * but each use is counted at most once and given back at most once.
 */

/**
 * Orders that are not a use of a coupon, and not a customer's "first order":
 * never paid for (an online checkout abandoned or failed at the gateway stays
 * in pending_payment for good -- nothing expires it) or cancelled.
 */
export const ORDER_STATUSES_NOT_COUNTED_FOR_COUPONS = Object.freeze([
    'pending_payment',
    'cancelled_by_user',
    'cancelled_by_restaurant',
    'cancelled_by_admin',
]);

export const COUPON_USAGE = Object.freeze({
    PENDING: 'pending',
    COUNTED: 'counted',
    RELEASED: 'released',
});

const toObjectId = (id) => {
    if (!id) return null;
    if (id instanceof mongoose.Types.ObjectId) return id;
    const raw = String(id?._id ?? id);
    return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
};

const appliedCouponCode = (order) => {
    const code = order?.pricing?.appliedCoupon?.code;
    return code ? String(code).trim().toUpperCase() : '';
};

/**
 * Count one use of a coupon: the offer's global counter and the customer's own.
 *
 * With `enforceLimit` the global increment only happens while the offer is under
 * its cap, and `exhausted` reports when it was not. The caller then refuses the
 * order rather than keep a discount the coupon no longer allows. Without it the
 * use is counted regardless, and `overLimit` says so. That is only for an order
 * that has already been paid at the discounted price (see countCouponUseOnPayment).
 */
export async function takeCouponUse(code, userId, { enforceLimit = true } = {}) {
    const offer = await FoodOffer.findOne({ couponCode: code }).select('_id usageLimit perUserLimit').lean();
    if (!offer) return { taken: false, exhausted: false, overLimit: false };

    /*
     * The customer's own limit, claimed atomically first. It was only checked
     * by reading the count while pricing, so several orders placed at the same
     * moment each saw "not used yet" and all kept a one-per-customer coupon.
     * The unique (offerId, userId) index turns a claim at the limit into a
     * duplicate-key error on the upsert, which is the refusal.
     */
    /*
     * The coupon's own limits with the Master > Promotions ceiling applied.
     * `tighten` never loosens, and keeps 0 meaning unlimited on both sides.
     */
    const ceiling = await resolvePromoCeiling({ vertical: 'food' });
    const perUser = tighten(offer.perUserLimit, ceiling.perUser) || 0;
    const claimUserId = toObjectId(userId);
    let perUserClaimed = false;
    if (enforceLimit && perUser > 0 && claimUserId) {
        try {
            const r = await FoodOfferUsage.updateOne(
                { offerId: offer._id, userId: claimUserId, count: { $lt: perUser } },
                { $inc: { count: 1 }, $set: { lastUsedAt: new Date() } },
                { upsert: true },
            );
            perUserClaimed = r.matchedCount === 1 || r.upsertedCount === 1;
        } catch (err) {
            if (err?.code !== 11000) throw err;
        }
        if (!perUserClaimed) return { taken: false, exhausted: true, overLimit: false, perUser: true };
    }

    const limit = tighten(offer.usageLimit, ceiling.total) || 0;
    const capped = await FoodOffer.updateOne(
        limit > 0 ? { _id: offer._id, usedCount: { $lt: limit } } : { _id: offer._id },
        { $inc: { usedCount: 1 } },
    );

    let overLimit = false;
    if (capped.matchedCount === 0) {
        if (enforceLimit) {
            if (perUserClaimed) {
                await FoodOfferUsage.updateOne({ offerId: offer._id, userId: claimUserId, count: { $gt: 0 } }, { $inc: { count: -1 } });
            }
            return { taken: false, exhausted: true, overLimit: false };
        }
        overLimit = true;
        await FoodOffer.updateOne({ _id: offer._id }, { $inc: { usedCount: 1 } });
    }

    const userObjectId = toObjectId(userId);
    if (userObjectId && !perUserClaimed) {
        await FoodOfferUsage.updateOne(
            { offerId: offer._id, userId: userObjectId },
            { $inc: { count: 1 }, $set: { lastUsedAt: new Date() } },
            { upsert: true },
        );
    }
    return { taken: true, exhausted: false, overLimit };
}

/** Undo one takeCouponUse. Never takes a counter below zero. */
export async function giveBackCouponUse(code, userId) {
    const offer = await FoodOffer.findOne({ couponCode: code }).select('_id').lean();
    if (!offer) return;
    await FoodOffer.updateOne({ _id: offer._id, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
    const userObjectId = toObjectId(userId);
    if (userObjectId) {
        await FoodOfferUsage.updateOne(
            { offerId: offer._id, userId: userObjectId, count: { $gt: 0 } },
            { $inc: { count: -1 } },
        );
    }
}

/**
 * Count the coupon on an online order whose payment has just been verified.
 *
 * The cap is NOT enforced here. By this point the customer has paid the
 * discounted total that was quoted, and the cap was checked when it was quoted.
 * Refusing now would mean refunding and cancelling a paid order the kitchen may
 * already be cooking, for a race the customer did not cause. So the use is
 * counted and the overrun is logged loudly for whoever owns the offer. Orders
 * the platform can still refuse, cash and wallet, are refused at placement.
 *
 * Never throws: a bookkeeping failure must not fail a payment that succeeded.
 */
export async function countCouponUseOnPayment(order) {
    try {
        const code = appliedCouponCode(order);
        if (!code || !order?._id) return;

        const claim = await FoodOrder.updateOne(
            { _id: order._id, couponUsage: COUPON_USAGE.PENDING },
            { $set: { couponUsage: COUPON_USAGE.COUNTED } },
        );
        if (!claim.modifiedCount) return;

        const use = await takeCouponUse(code, order.userId, { enforceLimit: false });
        if (use.overLimit) {
            logger.error(
                `Coupon ${code} went past its usage limit on paid online order ${order._id}: `
                + 'another order used the last slot between this one being quoted and paid.',
            );
        }
    } catch (err) {
        logger.error(`Coupon usage could not be counted for order ${order?._id}: ${err?.message || err}`);
    }
}

/**
 * Give back the coupon use of a cancelled order.
 *
 * An online order cancelled before its payment was verified has nothing to give
 * back. It is marked released anyway, so a payment that arrives afterwards cannot
 * count a use for an order that no longer exists.
 *
 * Never throws: the cancellation has already happened.
 */
export async function releaseCouponUse(order) {
    try {
        const code = appliedCouponCode(order);
        if (!code || !order?._id) return;

        const released = await FoodOrder.updateOne(
            { _id: order._id, couponUsage: COUPON_USAGE.COUNTED },
            { $set: { couponUsage: COUPON_USAGE.RELEASED } },
        );
        if (!released.modifiedCount) {
            await FoodOrder.updateOne(
                { _id: order._id, couponUsage: COUPON_USAGE.PENDING },
                { $set: { couponUsage: COUPON_USAGE.RELEASED } },
            );
            return;
        }
        await giveBackCouponUse(code, order.userId);
    } catch (err) {
        logger.error(`Coupon usage could not be given back for order ${order?._id}: ${err?.message || err}`);
    }
}
