import { isCancelledOrder } from '../orders/services/order.helpers.js';
import { resolveDiscountSplit } from './discountSplit.util.js';

/** Delivered / completed orders that count toward restaurant earnings. */
export function isRestaurantEarnedOrder(order) {
    if (isCancelledOrder(order)) return false;
    const orderStatus = String(order?.orderStatus || order?.status || '').trim().toLowerCase();
    const deliveryPhase = String(order?.deliveryState?.currentPhase || '').trim().toLowerCase();
    return (
        orderStatus === 'delivered' ||
        deliveryPhase === 'delivered' ||
        deliveryPhase === 'completed'
    );
}

/**
 * Restaurant net share for one order — same formula as Hub Finance / wallet payout.
 */
export function computeRestaurantOrderShare(order, tx = null, offers = [], restaurantId = null) {
    const pricing = tx?.pricing || order?.pricing || {};
    const amounts = tx?.amounts || {};
    const subtotal = Number(pricing.subtotal) || 0;
    const packagingFee = Number(pricing.packagingFee) || 0;
    const commission = Number(amounts.restaurantCommission) || Number(pricing.restaurantCommission) || 0;
    const discountSplit = resolveDiscountSplit({ order, pricing, amounts, offers, restaurantId });
    const restaurantDiscountShare = discountSplit.restaurantDiscountShare;
    const storedRestaurantShare = Number(amounts.restaurantShare);

    const payout = Number.isFinite(storedRestaurantShare)
        ? storedRestaurantShare
        : subtotal + packagingFee - commission - restaurantDiscountShare;

    return Math.max(0, payout);
}
