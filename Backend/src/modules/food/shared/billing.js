/**
 * The customer's bill, computed in one place.
 *
 * Every figure the customer is shown, and the order in which they add up. It
 * lives here rather than inline in order-pricing.service.js so the whole bill
 * can be checked without a database, a request or a restaurant -- a change to
 * any line moves what people are charged, so it has to be provable in isolation.
 *
 * The shape of the bill:
 *
 *     Item amount                                200.00
 *     Packaging charges                           15.00   the restaurant's, or the platform's
 *     Add: GST @ 5%                               10.75   on the food and the packaging
 *     Delivery fee                                25.00   goes to the rider, untaxed
 *     Surge fee                                   10.00   goes to the rider, untaxed
 *     Platform fee                                10.00
 *       Govt. fee @ 18% on the platform fee        1.80
 *     Tip                                         10.00   goes to the rider, untaxed
 *     ------------------------------------------------
 *     Total                                      272.55
 *     Round off                                  + 0.45
 *     Grand total                                273.00
 *
 * Four rules worth stating because they are all easy to get wrong:
 *
 * Everything is computed to PAISE and only the grand total is rounded to a
 * rupee. Rounding each line to a rupee as it is computed, which is what the tax
 * line used to do, makes the printed lines fail to add up to the printed total
 * -- and a bill whose own arithmetic is visibly wrong is worse than one that is
 * a paisa out.
 *
 * WHAT IS TAXED, AND AT WHAT RATE. The food and the packaging are one supply
 * and carry the food's GST rate. The platform fee is a service charge and
 * carries its own, higher rate. The delivery fee, the surge and the tip are the
 * rider's money: taxing them would charge the customer for something the
 * platform never receives, and they are not the platform's to tax.
 *
 * WHAT COMMISSION IS CHARGED ON. `commissionBase` -- the listed food, before
 * any coupon and net of any GST inside it. Not the packaging, which the
 * restaurant is reimbursed for rather than earning; not the discount, which is
 * settled separately in the payout ledger; and never the tax, which is
 * collected for the government.
 *
 * INCLUSIVE PRICES ARE A DIFFERENT SUM. Adding a tax and extracting one do not
 * give the same figure: 200 x 0.05 is 10, but 200 - 200/1.05 is 9.52. Using
 * the first for an inclusive price overstates the tax and understates what the
 * restaurant earns, on every single dish.
 */

const round2 = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
};

const nonNegative = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

const rate = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, 100);
};

/** A tip is the customer's choice, but not an unbounded one. */
export const MAX_TIP = 5000;

/** GST on a platform/service fee in India. Overridable per deployment. */
export const DEFAULT_PLATFORM_FEE_GST_RATE = 18;

export function normalizeTip(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return round2(Math.min(n, MAX_TIP));
}

/**
 * Build the bill.
 *
 * `discount` is applied to the food and the packaging before tax, and it cannot
 * reach the delivery fee, the surge or the tip, which are the rider's.
 *
 * WHICH VALUE THE GST IS CHARGED ON depends on who paid for the coupon, and the
 * two answers are not interchangeable -- see `discountFundedByPlatform`.
 */
export function computeBill({
    itemAmount = 0,
    packagingFee = 0,
    deliveryFee = 0,
    platformFee = 0,
    surgeAmount = 0,
    discount = 0,
    tip = 0,
    gstRate = 0,
    platformFeeGstRate = DEFAULT_PLATFORM_FEE_GST_RATE,
    /*
     * Whether the menu prices already contain GST.
     *
     * Off by default, which is what every restaurant did before this existed:
     * the stored price is net and tax is added on top, so a Rs 200 dish costs
     * the customer Rs 210. On, the Rs 200 is the whole price and the tax is
     * extracted from inside it -- Rs 190.48 of food and Rs 9.52 of tax -- so
     * the customer still pays Rs 200.
     */
    pricesIncludeGst = false,
    /*
     * How much of `itemAmount` is priced inclusive of GST.
     *
     * The answer belongs to the dish -- the restaurant is asked when it adds
     * one -- so a cart can hold both kinds at once and this is the part that
     * already contains its tax. Undefined means "use `pricesIncludeGst` for the
     * whole amount", which is what every caller did before dishes could differ.
     */
    gstInclusiveItemAmount = undefined,
    /*
     * Whether the packaging charge is the restaurant's own per-item charge
     * rather than the platform's flat one.
     *
     * It decides whether an inclusive restaurant's setting reaches the
     * packaging line. The restaurant typed that figure alongside its prices, so
     * "my prices include GST" covers it; a charge the admin set platform-wide
     * is not the restaurant's to declare inclusive.
     */
    packagingBelongsToRestaurant = false,
    /*
     * Whether the PLATFORM funded the coupon rather than the restaurant.
     *
     * This decides what the GST is charged on, and the two cases are genuinely
     * different rather than a matter of preference.
     *
     * A restaurant's own coupon is a discount by the supplier at the time of
     * supply, shown on the invoice: it comes out of the taxable value, and the
     * customer is taxed on what they actually pay. Charging tax on the full
     * price there would overcharge them.
     *
     * A platform-funded coupon is not the supplier's discount. The restaurant
     * is paid in full -- part by the customer, part by the platform -- so the
     * consideration for the supply is still the whole amount and the tax is due
     * on it. Treating it as a supplier discount under-collects GST, quietly,
     * on every order that used one.
     *
     * Off by default: a caller that does not know who funded the coupon gets
     * the treatment this function has always applied.
     */
    discountFundedByPlatform = false,
} = {}) {
    const items = nonNegative(itemAmount);
    const packaging = nonNegative(packagingFee);
    const delivery = nonNegative(deliveryFee);
    const platform = nonNegative(platformFee);
    const surge = nonNegative(surgeAmount);
    const tipAmount = normalizeTip(tip);

    // A coupon cannot take more than the food and its packaging are worth.
    const appliedDiscount = round2(Math.min(nonNegative(discount), items + packaging));

    // The coupon comes off the food first; only an unusually large one reaches
    // the packaging, and it can never make either line negative.
    const itemsAfterDiscount = round2(Math.max(0, items - appliedDiscount));
    const packagingAfterDiscount = round2(
        Math.max(0, packaging - Math.max(0, appliedDiscount - items)),
    );

    const gstFraction = rate(gstRate) / 100;
    const deTax = (gross) => round2(gross / (1 + gstFraction));
    // A restaurant whose prices include GST has its packaging treated the same
    // way: no GST is added on top of either (business rule, 2026-09-29).
    const packagingIsInclusive = pricesIncludeGst === true;

    /*
     * The two halves of the food, and the coupon shared between them.
     *
     * A cart can hold dishes priced inclusive of GST alongside dishes priced
     * exclusive of it. The coupon is split in proportion to what each half
     * contributed, because it was earned by the order as a whole and there is
     * no principled reason it should land entirely on one tax treatment --
     * doing so would change the tax the customer pays depending on which half
     * an arbitrary rule picked.
     */
    const inclusiveItems = gstInclusiveItemAmount === undefined
        ? (pricesIncludeGst ? items : 0)
        : Math.min(nonNegative(gstInclusiveItemAmount), items);
    const exclusiveItems = round2(Math.max(0, items - inclusiveItems));

    const inclusiveShare = items > 0 ? inclusiveItems / items : 0;
    const discountOnInclusive = round2(Math.min(inclusiveItems, appliedDiscount * inclusiveShare));
    const discountOnExclusive = round2(
        Math.min(exclusiveItems, Math.min(appliedDiscount, items) - discountOnInclusive),
    );

    const inclusiveAfterDiscount = round2(Math.max(0, inclusiveItems - discountOnInclusive));
    const exclusiveAfterDiscount = round2(Math.max(0, exclusiveItems - discountOnExclusive));

    /*
     * GST inside a GST-inclusive price, worked out on the price BEFORE the
     * coupon (client rule, 2026-09-29: the coupon comes off last, as on the
     * exclusive side). Rs 600 incl. 5% holds 28.57 of GST whatever the coupon;
     * the customer still pays 600 - coupon, so the net line takes the coupon.
     * Never more than what is left to pay for that line, so a coupon that
     * covers the whole price cannot leave a negative net line.
     */
    const inclusiveItemsTax = round2(Math.min(inclusiveItems - deTax(inclusiveItems), inclusiveAfterDiscount));
    const inclusivePackagingTax = packagingIsInclusive
        ? round2(Math.min(packaging - deTax(packaging), packagingAfterDiscount))
        : 0;

    // The inclusive half has its tax taken out; the exclusive half keeps its
    // price and the tax is added below.
    const netItemAmount = round2(inclusiveAfterDiscount - inclusiveItemsTax + exclusiveAfterDiscount);
    const netPackagingFee = packagingIsInclusive
        ? round2(packagingAfterDiscount - inclusivePackagingTax)
        : packagingAfterDiscount;

    /*
     * The same two lines before the coupon, and what the coupon actually took
     * off them.
     *
     * A bill that prints the discounted line AND the coupon deducts the same
     * money twice on screen; one that prints the full line and the full coupon
     * over-deducts, because for an inclusive menu the coupon comes off a price
     * that still had tax in it. These three figures let a summary print
     *     item - discount + tax
     * and land exactly on the total.
     */
    const netItemAmountBeforeDiscount = round2(deTax(inclusiveItems) + exclusiveItems);
    const netPackagingFeeBeforeDiscount = packagingIsInclusive ? deTax(packaging) : round2(packaging);
    const discountOnNet = round2(
        (netItemAmountBeforeDiscount + netPackagingFeeBeforeDiscount)
        - (netItemAmount + netPackagingFee),
    );

    /*
     * The tax, line by line: taken out of a line whose price already contained
     * it, added on top of one that did not. Summed once so a bill that mixes
     * the two -- an inclusive restaurant under a platform-set packaging charge
     * -- still reconciles.
     */
    /*
     * The value the tax is charged on. Pre-coupon when the platform funded it,
     * because the restaurant is still paid in full and the supply is still
     * worth the whole amount; post-coupon when the restaurant funded it, which
     * is a supplier discount and comes out of the taxable value.
     */
    /*
     * GST is charged on the full price before any coupon, whoever funded it
     * (business decision, 2026-09-29: the tax base is the listed value of the
     * supply). The customer still pays the discounted food price; only the base
     * the tax is worked out on is the pre-coupon one. `discountFundedByPlatform`
     * is still accepted and recorded for settlement.
     */
    const platformFundedDiscount = appliedDiscount > 0;
    /*
     * Prices that EXCLUDE GST: GST is added on the full price, before the coupon
     * (food 200 + packaging 5 -> GST 10.25 whatever the coupon).
     * Prices that INCLUDE GST: nothing is added. The GST shown is the part
     * inside the full listed price, before the coupon (600 -> 28.57 whatever
     * the coupon), and food + packaging costs exactly the listed price minus
     * the coupon (200 + 5 - 50 = 155).
     */
    const exclusiveTaxBase = exclusiveItems;
    const packagingTaxBase = round2(packaging);

    const taxOnItems =
        // taken out of the prices that already contained it...
        inclusiveItemsTax
        // ...and added to the prices that did not.
        + (exclusiveTaxBase * gstFraction);
    const taxOnPackaging = packagingIsInclusive
        ? inclusivePackagingTax
        : packagingTaxBase * gstFraction;

    /*
     * Two different figures, and they are equal only when the restaurant funded
     * the coupon. `chargedFoodNet` is what the customer pays for the food;
     * `taxableAmount` is what the tax is calculated on. Keeping them separate is
     * what lets a platform-funded coupon reduce the bill without also reducing
     * the tax due on the supply.
     */
    const chargedFoodNet = round2(netItemAmount + netPackagingFee);
    const taxableAmount = round2(
        exclusiveTaxBase
        + deTax(inclusiveItems)
        + (packagingIsInclusive ? deTax(packagingTaxBase) : packagingTaxBase),
    );
    const gstOnItems = round2(taxOnItems + taxOnPackaging);

    const platformFeeGst = round2(platform * (rate(platformFeeGstRate) / 100));

    // What the bill shows above the tip line.
    const totalBeforeTip = round2(
        chargedFoodNet + gstOnItems + delivery + surge + platform + platformFeeGst,
    );
    const payableBeforeRounding = round2(totalBeforeTip + tipAmount);

    // Only the final figure is rounded, so the printed lines add up to the
    // printed total once the round-off line is read.
    const grandTotal = Math.max(0, Math.round(payableBeforeRounding));
    const roundOff = round2(grandTotal - payableBeforeRounding);

    return {
        /** The food as listed, before any coupon. */
        itemAmount: round2(items),
        /** The packaging as listed, before any coupon. */
        packagingFee: round2(packaging),
        discount: appliedDiscount,
        /**
         * True when the WHOLE food total was priced inclusive of GST. False for
         * a cart that mixes the two, which is why the figures above are the
         * ones to print and this is only good for wording.
         */
        pricesIncludeGst: items > 0 ? inclusiveItems >= items - 0.005 : pricesIncludeGst === true,
        /** How much of `itemAmount` already contained its tax. */
        gstInclusiveItemAmount: round2(inclusiveItems),
        /** What the customer sees against the food and its packaging, before tax is separated out. */
        listedFoodAmount: round2(itemsAfterDiscount + packagingAfterDiscount),
        /** The "Item amount" line: food after any coupon, net of GST. */
        netItemAmount,
        /** The "Packaging charges" line, net of GST. */
        netPackagingFee,
        /** The same two before the coupon, for a summary that shows it as its own line. */
        netItemAmountBeforeDiscount,
        netPackagingFeeBeforeDiscount,
        /** What the coupon took off those two. Never print `discount` beside them. */
        discountOnNet,
        /**
         * The base the food GST is charged on. Equal to netItemAmount +
         * netPackagingFee for a restaurant-funded coupon, and the PRE-coupon
         * value for a platform-funded one -- so never assume it is what the
         * customer paid for the food.
         */
        taxableAmount,
        /** True when the base above is the pre-coupon value. Recorded so an invoice can say why. */
        // GST is always worked out on the pre-coupon price now, inclusive or not.
        gstOnPreDiscountValue: platformFundedDiscount && (items > 0 || packaging > 0),
        gstRate: rate(gstRate),
        gstOnItems,
        /**
         * What restaurant commission is charged on: the listed food, before any
         * coupon and net of any GST inside it. Equal to the food subtotal for a
         * restaurant that prices net, which is every restaurant by default.
         */
        commissionBase: netItemAmountBeforeDiscount,
        /*
         * The customer sees one "Delivery fee" line with the zone surge inside
         * it (ops request 2026-09-28), so surgeAmount here is 0 and the split is
         * kept in the two fields below. The order's top-level pricing.deliveryFee
         * / pricing.surgeAmount stay separate: rider pay and the P&L read those.
         */
        // Except when delivery itself is free: the apps print "FREE" for a
        // free-delivery order whatever the amount, so a surge folded in there
        // would be charged but never shown. It keeps its own line then.
        deliveryFee: delivery > 0 ? round2(delivery + surge) : round2(delivery),
        surgeAmount: delivery > 0 ? 0 : round2(surge),
        deliveryFeeBeforeSurge: round2(delivery),
        surgeIncludedInDeliveryFee: delivery > 0 ? round2(surge) : 0,
        platformFee: round2(platform),
        platformFeeGstRate: rate(platformFeeGstRate),
        platformFeeGst,
        tip: tipAmount,
        totalBeforeTip,
        payableBeforeRounding,
        roundOff,
        grandTotal,
    };
}

/**
 * Does the bill add up? Used by the checks, and safe to call in a test or a
 * script that wants to assert a real order rather than trust it.
 *
 * Every line the customer is shown, summed. If this is false the bill on screen
 * contradicts the amount being charged, which is the one failure a customer
 * always notices.
 */
export function billAddsUp(bill = {}) {
    const sum = round2(
        Number(bill.netItemAmount ?? bill.taxableAmount ?? 0)
        + Number(bill.netPackagingFee || 0)
        + Number(bill.gstOnItems || 0)
        + Number(bill.deliveryFee || 0)
        + Number(bill.surgeAmount || 0)
        + Number(bill.platformFee || 0)
        + Number(bill.platformFeeGst || 0)
        + Number(bill.tip || 0)
        // Loyalty points are a payment taken off after tax (core/loyalty).
        - Number(bill.loyaltyDiscount || 0)
        + Number(bill.roundOff || 0),
    );
    return Math.abs(sum - Number(bill.grandTotal || 0)) < 0.005;
}
