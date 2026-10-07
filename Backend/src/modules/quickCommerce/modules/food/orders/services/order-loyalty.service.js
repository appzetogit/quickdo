import { FoodOrder } from '../models/order.model.js';
import { earnForOrder, reverseBurn, safely } from '../../../../../../core/loyalty/loyalty.service.js';

/**
 * Quick commerce's calls into the shared loyalty ledger (core/loyalty, plan §5.7).
 * Thin on purpose: every rule lives in core. Never throws into an order flow.
 */

/** Points for a delivered order. Idempotent: the ledger keys the earn on the order. */
export async function awardQcOrderLoyalty(orderLike) {
    return safely('earn', async () => {
        const order = orderLike?.toObject ? orderLike.toObject() : orderLike;
        if (!order?._id || order.orderStatus !== 'delivered') return null;
        const p = order.pricing || {};
        const amount = Math.max(0, (Number(p.subtotal) || 0) - (Number(p.discount) || 0) - (Number(p.loyaltyDiscount) || 0));
        const res = await earnForOrder({
            customerId: order.userId?._id || order.userId,
            vertical: 'quickCommerce',
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

/**
 * Give back the points a cancelled order redeemed: the order's own share for a
 * child of a multi-store checkout, or all of them for a single-store order.
 */
export async function reverseQcOrderLoyalty(orderLike) {
    return safely('reverse', async () => {
        const order = orderLike?.toObject ? orderLike.toObject() : orderLike;
        const points = Number(order?.pricing?.loyaltyPoints) || 0;
        if (!order?._id || points <= 0) return null;
        const res = await reverseBurn({
            customerId: order.userId?._id || order.userId,
            vertical: 'quickCommerce',
            points,
            key: `qc:${order._id}`,
            orderId: String(order._id),
            orderRef: order.order_id || '',
        });
        if (res?.returned > 0) {
            await FoodOrder.updateOne({ _id: order._id }, { $set: { 'loyalty.reversedAt': new Date() } });
        }
        return res;
    });
}
