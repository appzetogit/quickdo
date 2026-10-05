/**
 * What the seller (restaurant or medical store) earns on one order, line by
 * line. See the food-tree twin at modules/food/shared/restaurantPayout.js for
 * the full rationale — this is the same pure computation, kept as a separate
 * copy because the qc tree's Order model, commission model and FoodOffer model
 * are separate collections from the food tree's (see order.model.js).
 *
 * Works unchanged for a prescription order: `order.pricing.subtotal` is the
 * pharmacist's billed amount, `order.pricing.restaurantCommission` is what
 * submitPrescriptionBill/fillPrescriptionOrder already computed and stored via
 * getRestaurantCommissionSnapshot, and there is no packaging fee or coupon on
 * this kind of order, so those lines simply read as zero.
 */

import { splitDiscountForOffer } from './discountSplit.util.js';

const round2 = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
};

const finite = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

/**
 * One order's payout breakdown.
 *
 * @param {object} order                          the stored order
 * @param {object} [options]
 * @param {number} [options.restaurantFundedDiscount]
 *   What a coupon the RESTAURANT created took off this order.
 */
export function buildRestaurantPayoutBreakdown(order, { restaurantFundedDiscount = 0 } = {}) {
    const pricing = order?.pricing || {};

    const subTotal = round2(finite(pricing.subtotal));
    const taxableFoodValue = round2(finite(pricing.commissionableAmount, subTotal));
    const pricesIncludeGst = pricing.pricesIncludeGst === true;
    const storedGstRate = round2(finite(pricing.gstRate));

    const gstOnFood = pricesIncludeGst
        ? round2(Math.max(0, subTotal - taxableFoodValue))
        : round2(taxableFoodValue * (storedGstRate / 100));

    const gstRate = taxableFoodValue > 0
        ? round2((gstOnFood / taxableFoodValue) * 100)
        : 0;

    const packagingMode = String(pricing.packagingMode || '');
    const packagingIsRestaurants = packagingMode === '' || packagingMode === 'RESTAURANT';
    const netPackagingFee = round2(finite(pricing.netPackagingFee, finite(pricing.packagingFee)));
    const packagingCharge = packagingIsRestaurants ? netPackagingFee : 0;

    const commissionAmount = round2(finite(pricing.restaurantCommission));
    const commissionPercent = taxableFoodValue > 0
        ? round2((commissionAmount / taxableFoodValue) * 100)
        : null;

    const fundedDiscount = round2(Math.max(0, finite(restaurantFundedDiscount)));

    const payout = round2(taxableFoodValue + packagingCharge - commissionAmount - fundedDiscount);

    return {
        pricesIncludeGst,
        gstRate,
        subTotal,
        gstOnFood,
        taxableFoodValue,
        packagingCharge,
        packagingIsRestaurants,
        commissionAmount,
        commissionPercent,
        discountFundedByRestaurant: fundedDiscount,
        payout,
        currency: pricing.currency || 'INR',
    };
}

/**
 * Which of these orders carried a coupon the restaurant itself funded, in one
 * query for the whole page rather than one per order.
 */
export async function resolveRestaurantFundedDiscounts(orders = []) {
    const byCode = new Map();
    for (const order of orders) {
        const code = String(order?.pricing?.couponCode || '').trim().toUpperCase();
        const discount = finite(order?.pricing?.discount);
        if (!code || discount <= 0) continue;
        if (!byCode.has(code)) byCode.set(code, []);
        byCode.get(code).push(order);
    }
    const result = new Map();
    if (byCode.size === 0) return result;

    try {
        const { FoodOffer } = await import('../admin/models/offer.model.js');
        const offers = await FoodOffer.find({ couponCode: { $in: [...byCode.keys()] } })
            .select('couponCode createdByRole adminBearPercentage restaurantBearPercentage')
            .lean();
        // The store's share, by the same split the ledger deducts (discountSplit.util).
        // Keying only on createdByRole showed an admin coupon the store half-funds
        // as fully platform-funded: the payout on screen was more than was paid.
        const storeShare = new Map(
            (offers || []).map((o) => [
                String(o.couponCode).toUpperCase(),
                splitDiscountForOffer(o, 100).restaurantBearPercentage / 100,
            ]),
        );
        for (const [code, list] of byCode) {
            const share = storeShare.get(code) || 0;
            if (share <= 0) continue;
            for (const order of list) {
                const funded = finite(
                    order?.pricing?.bill?.discountOnNet,
                    finite(order?.pricing?.discount),
                );
                result.set(String(order._id || order.orderMongoId || ''), round2(funded * share));
            }
        }
    } catch {
        return new Map();
    }
    return result;
}

/** Attach the breakdown to each restaurant-facing order in a list. */
export async function attachRestaurantPayout(orders = []) {
    const list = Array.isArray(orders) ? orders : [];
    const funded = await resolveRestaurantFundedDiscounts(list);
    for (const order of list) {
        if (!order || typeof order !== 'object') continue;
        order.restaurantPayout = buildRestaurantPayoutBreakdown(order, {
            restaurantFundedDiscount: funded.get(String(order._id || order.orderMongoId || '')) || 0,
        });
    }
    return list;
}
