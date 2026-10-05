/**
 * What the restaurant earns on one order, line by line.
 *
 * The restaurant app used to show the CUSTOMER's bill -- delivery fee, platform
 * fee, grand total -- none of which is the restaurant's money. This is the
 * other side of the same order: what was sold, what of it is tax, what the
 * platform takes, and what is paid out.
 *
 * The lines are derived from the figures stored on the order, and the total
 * they add up to is the same `restaurantNet` the payout ledger credits
 * (orders/services/foodTransaction.service.js). Anything shown to a restaurant
 * that its payout does not match is worse than showing nothing.
 *
 * Every percentage here is worked out from the rupees beside it rather than
 * read from a rate stored somewhere else, so a figure and its label cannot
 * contradict each other on a screen a restaurant is paid from.
 *
 * Two shapes, because a GST-inclusive menu is a different sum:
 *
 *   prices exclude GST        prices include GST
 *   ------------------        ------------------
 *   Sub total       100.00    Sub total (GST incl)   100.00
 *   GST @5%           5.00    GST @5% included        -4.76
 *     collected from the        Taxable food value     95.24
 *     customer, paid to
 *     the government
 *   Packing         + 5.00    Packing               + 5.00
 *   Commission 10%  -10.00    Commission 10%         -9.52
 *   PAY TO YOU       95.00    PAY TO YOU             90.72
 *
 * Extracting a tax is not the same sum as adding one: 100 x 5% is 5.00, but
 * 100 - 100/1.05 is 4.76. The inclusive column uses the extraction, which is
 * what the bill charged and what the ledger pays.
 */

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
 *   What a coupon the RESTAURANT created took off this order. The platform's
 *   own coupons cost the restaurant nothing and must not appear here -- see
 *   resolveRestaurantFundedDiscounts.
 */
export function buildRestaurantPayoutBreakdown(order, { restaurantFundedDiscount = 0 } = {}) {
    const pricing = order?.pricing || {};

    const subTotal = round2(finite(pricing.subtotal));
    /*
     * `?? subtotal` for both, matching the payout ledger: an order placed
     * before these fields existed has neither, and its food was all net.
     */
    const taxableFoodValue = round2(finite(pricing.commissionableAmount, subTotal));
    const pricesIncludeGst = pricing.pricesIncludeGst === true;
    const storedGstRate = round2(finite(pricing.gstRate));

    /*
     * The tax on the food, from whichever side of the price it sat.
     *
     * Inclusive: the gap between what was listed and what is left after the
     * tax is taken out -- read from the two stored figures rather than
     * re-derived, so it agrees with the bill to the paisa even if the rate has
     * since changed.
     */
    const gstOnFood = pricesIncludeGst
        ? round2(Math.max(0, subTotal - taxableFoodValue))
        : round2(taxableFoodValue * (storedGstRate / 100));

    /*
     * The percentage printed beside the tax is DERIVED FROM THE TAX, not read
     * from the rate stored on the order -- the same way commissionPercent is
     * derived below.
     *
     * A restaurant saw "GST 13%" against Rs 8.63 on a Rs 172.50 sub total. The
     * rupees were right (8.63 is 5% of 172.50) and 13% was the commission rate
     * standing where the tax rate belonged. Passing the stored rate straight
     * through let the label and the money disagree, and of the two the money is
     * the one that was actually charged -- so the label is now computed from it
     * and cannot say anything else.
     *
     * For an exclusive order this is the stored rate exactly, since the tax was
     * computed from it. It differs only when the two already disagreed, which
     * is the case worth protecting against.
     */
    const gstRate = taxableFoodValue > 0
        ? round2((gstOnFood / taxableFoodValue) * 100)
        : 0;

    /*
     * Packaging is only the restaurant's when the restaurant set it. The
     * platform's flat per-order charge is the platform's, and crediting it
     * here would promise money the restaurant is never paid. Orders from
     * before the mode was recorded keep the old behaviour.
     */
    const packagingMode = String(pricing.packagingMode || '');
    const packagingIsRestaurants = packagingMode === '' || packagingMode === 'RESTAURANT';
    const netPackagingFee = round2(finite(pricing.netPackagingFee, finite(pricing.packagingFee)));
    const packagingCharge = packagingIsRestaurants ? netPackagingFee : 0;

    const commissionAmount = round2(finite(pricing.restaurantCommission));
    // Shown as a percentage only when it reads as one: a flat-fee commission,
    // or one on an order with no taxable food, has no honest percent.
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
        /** False when the platform set the packaging charge and keeps it. */
        packagingIsRestaurants,
        commissionAmount,
        commissionPercent,
        /** Only ever a coupon the restaurant itself created. */
        discountFundedByRestaurant: fundedDiscount,
        payout,
        currency: pricing.currency || 'INR',
    };
}

/**
 * Which of these orders carried a coupon the restaurant itself funded, in one
 * query for the whole page rather than one per order.
 *
 * Returns a Map of order id -> the amount that coupon took off the net lines.
 * The face value is the wrong figure on an inclusive menu, where part of it
 * was tax the restaurant never kept -- the ledger deducts `discountOnNet`, so
 * this does too.
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
            .select('couponCode createdByRole')
            .lean();
        const restaurantFunded = new Set(
            (offers || [])
                .filter((o) => String(o.createdByRole).toUpperCase() === 'RESTAURANT')
                .map((o) => String(o.couponCode).toUpperCase()),
        );
        for (const [code, list] of byCode) {
            if (!restaurantFunded.has(code)) continue;
            for (const order of list) {
                const funded = finite(
                    order?.pricing?.bill?.discountOnNet,
                    finite(order?.pricing?.discount),
                );
                result.set(String(order._id || order.orderMongoId || ''), round2(funded));
            }
        }
    } catch {
        /*
         * Attribution unavailable: show no discount line rather than guessing.
         * The ledger, which is what actually pays, is unaffected -- and the
         * platform funds every coupon by default, so silence is the likelier
         * truth as well as the safer one.
         */
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
