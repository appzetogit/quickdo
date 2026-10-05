/**
 * Refund arithmetic for quick-commerce returns.
 *
 * Pure functions, no database, no I/O — so the money rules can be tested exhaustively
 * and read in one sitting. Everything that touches an order or writes a record lives
 * in return.service.js.
 *
 * Two decisions drive the whole file:
 *
 * 1. All arithmetic runs in integer paise. Rupee floats do not survive proportional
 *    splits: 0.1 + 0.2 !== 0.3, and a discount apportioned across five lines drifts
 *    by a paisa or two per line. Over a month of returns that is a reconciliation
 *    mismatch nobody can explain. Values arrive and leave as rupees; the conversion
 *    happens at the boundary.
 *
 * 2. A partial return refunds the customer's *effective* price for the returned
 *    lines, not the list price. If a 500 coupon was applied to a 2000 order, the
 *    customer paid 1500. Refunding the full line price on a partial return hands back
 *    more than was collected, and repeating that with a discounted cart is a way to
 *    extract money from the platform.
 */

/** Rupees -> integer paise. Rounds, because upstream prices are not always integral. */
const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);

/** Integer paise -> rupees, to 2dp. */
const toRupees = (paise) => Math.round(paise) / 100;

/**
 * Split `totalPaise` across `weights` so the parts always sum exactly to the total.
 *
 * Largest-remainder: floor every share, then hand the leftover paise out one at a
 * time to the lines with the biggest truncated fraction. Rounding each share
 * independently does not add up — five lines of 33.33% of 100 leaves a paisa
 * unallocated, and that paisa is what makes a refund total disagree with the sum of
 * its own line items.
 */
export const apportion = (totalPaise, weights) => {
    const total = Math.round(totalPaise);
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 0 || total === 0) return weights.map(() => 0);

    const exact = weights.map((w) => (total * w) / sum);
    const shares = exact.map(Math.floor);
    let remainder = total - shares.reduce((a, b) => a + b, 0);

    const order = exact
        .map((value, index) => ({ index, frac: value - Math.floor(value) }))
        .sort((a, b) => b.frac - a.frac);

    for (let i = 0; remainder > 0 && i < order.length; i += 1, remainder -= 1) {
        shares[order[i].index] += 1;
    }
    return shares;
};

/**
 * Who caused the return. This is the only input that changes which fees come back,
 * so it is a first-class argument rather than something inferred from the reason text.
 *
 * - `seller`   damaged, expired, wrong or missing item. The platform failed to
 *              deliver what was paid for, so every fee on the order is refundable.
 * - `customer` changed mind, ordered by mistake. Goods money comes back; the
 *              delivery and platform fees paid for a service that was performed.
 */
export const FAULT = Object.freeze({ SELLER: 'seller', CUSTOMER: 'customer' });

/**
 * Compute what a return is worth.
 *
 * @param {object}   order              the order being returned against
 * @param {object[]} order.items        line items as stored on the order
 * @param {object}   order.pricing      { subtotal, tax, deliveryFee, deliveryFeeGst, platformFee, discount, total }
 * @param {object[]} returnedLines      [{ itemId, variantId, quantity }]
 * @param {string}   fault              FAULT.SELLER | FAULT.CUSTOMER
 * @param {number}   alreadyRefunded    rupees refunded by earlier returns on this order
 *
 * @returns {{
 *   goods: number, tax: number, discountReversed: number,
 *   deliveryFee: number, platformFee: number, total: number,
 *   isFullReturn: boolean, lines: object[], capApplied: boolean
 * }}
 */
export const calculateReturnRefund = ({
    order,
    returnedLines,
    fault = FAULT.CUSTOMER,
    alreadyRefunded = 0,
} = {}) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    const pricing = order?.pricing || {};

    // Match each requested line back to what was actually ordered. The order is the
    // authority on price and quantity: a client that sends its own price, or a
    // quantity larger than was bought, must not be able to inflate the refund.
    const matched = [];
    for (const requested of returnedLines || []) {
        const line = items.find((it) => String(it.itemId) === String(requested.itemId)
            && String(it.variantId || '') === String(requested.variantId || ''));
        if (!line) continue;

        const quantity = Math.max(0, Math.min(
            Math.floor(Number(requested.quantity) || 0),
            Number(line.quantity) || 0,
        ));
        if (quantity === 0) continue;

        // `price` alone is the unit the customer paid: order creation folds the chosen
        // size and every add-on into it (resolveOrderCartItems). `variantPrice` is not
        // an extra on top -- resolveFoodItemPrice() stamps it with the same unit price
        // on every line, sized or not -- so adding it refunded every line twice.
        const unitPaise = toPaise(line.price);
        matched.push({
            itemId: String(line.itemId),
            variantId: String(line.variantId || ''),
            name: line.name,
            quantity,
            unitPricePaise: unitPaise,
            grossPaise: unitPaise * quantity,
            gstRate: line.gstRate,
        });
    }

    if (matched.length === 0) {
        return {
            goods: 0, tax: 0, discountReversed: 0, deliveryFee: 0, platformFee: 0,
            total: 0, isFullReturn: false, lines: [], capApplied: false,
        };
    }

    // ── Goods ─────────────────────────────────────────────────────────────────
    const goodsPaise = matched.reduce((sum, l) => sum + l.grossPaise, 0);

    // ── Discount claw-back ────────────────────────────────────────────────────
    // The order-level discount was funded across the whole basket, so returning part
    // of the basket returns part of the discount's benefit too. Apportioned by each
    // line's share of the ORDER subtotal, not of the returned subset, otherwise a
    // partial return reverses the entire discount.
    const orderSubtotalPaise = toPaise(pricing.subtotal)
        || items.reduce((s, it) => s + toPaise(it.price) * (it.quantity || 0), 0);
    const discountPaise = toPaise(pricing.discount);
    const discountSharePaise = orderSubtotalPaise > 0
        ? Math.round((discountPaise * goodsPaise) / orderSubtotalPaise)
        : 0;

    // ── Tax ───────────────────────────────────────────────────────────────────
    // Mirrors computeItemsTax() in orders/services/order-pricing.service.js exactly:
    // GST is EXCLUSIVE in this codebase — charged on top of the post-discount line
    // value, and the order total is `subtotal + fees + tax - discount`. Extracting it
    // out of the price instead (gross * rate / (100 + rate), the inclusive formula)
    // under-refunds every taxed line, which is what the full-return assertion in
    // tests/qc.returns.smoke.mjs caught.
    //
    // Each line's own snapshotted rate wins over the order-wide one, because a
    // product's GST slab can be reclassified after the order and the refund has to
    // match what was actually charged. A line with no rate of its own was taxed at
    // the order-wide fallback rate in force when the order was placed, so it refunds
    // at that rate on its own net value -- see untaggedLineRate() for where the rate
    // comes from. It used to take a value share of the ORDER's whole tax instead,
    // which handed a 5% line part of its neighbour's 18%.
    //
    // A PLATFORM-funded coupon was taxed on the full line value, because the
    // seller was paid in full and the supply was worth the whole basket. The
    // refund has to use that same base: taking the discount off here would
    // return less tax than was collected, and the order would never reconcile.
    // Orders since 2026-09-28 record the base explicitly (always post-coupon);
    // older ones were taxed pre-coupon whenever the platform funded the coupon.
    const taxedOnFullValue = typeof pricing?.gstOnPreDiscountValue === 'boolean'
        ? pricing.gstOnPreDiscountValue
        : pricing?.discountFundedByPlatform === true;
    const fallbackRate = untaggedLineRate(items, pricing, orderSubtotalPaise);
    let taxPaise = 0;
    for (const line of matched) {
        const own = line.gstRate;
        const rate = own === null || own === undefined ? fallbackRate : Number(own);
        if (!(rate > 0)) continue;
        const net = taxedOnFullValue
            ? line.grossPaise
            : line.grossPaise - discountShareOf(line, goodsPaise, discountSharePaise);
        taxPaise += Math.round((net * rate) / 100);
    }

    // ── Fees ──────────────────────────────────────────────────────────────────
    // A full return means every line the customer received is coming back, so the
    // delivery leg bought nothing and the fee goes back regardless of fault. On a
    // partial return only seller fault refunds it: the trip still happened and the
    // rest of the basket still arrived.
    const isFullReturn = items.every((it) => {
        const back = matched.find((m) => m.itemId === String(it.itemId)
            && m.variantId === String(it.variantId || ''));
        return back && back.quantity >= (Number(it.quantity) || 0);
    });

    const sellerAtFault = fault === FAULT.SELLER;
    const refundFees = isFullReturn || sellerAtFault;
    const deliveryPaise = refundFees ? toPaise(pricing.deliveryFee) + toPaise(pricing.deliveryFeeGst) : 0;
    // The platform fee goes back with its GST, the way the delivery fee does.
    const platformPaise = refundFees ? toPaise(pricing.platformFee) + toPaise(pricing.platformFeeGst) : 0;

    // ── Total, capped at what is left to give back ────────────────────────────
    let totalPaise = goodsPaise - discountSharePaise + taxPaise + deliveryPaise + platformPaise;
    totalPaise = Math.max(0, totalPaise);

    // Never refund more than the customer actually paid, across ALL returns on this
    // order. Without this cap, a sequence of partial returns whose fees each qualify
    // (seller fault every time) can exceed the order total.
    const paidPaise = toPaise(pricing.total);
    const remainingPaise = Math.max(0, paidPaise - toPaise(alreadyRefunded));
    const capApplied = totalPaise > remainingPaise;
    if (capApplied) totalPaise = remainingPaise;

    // Per-line breakdown for the credit note. Apportioned from the final (possibly
    // capped) total so the lines always sum to exactly what is refunded.
    const lineShares = apportion(totalPaise, matched.map((l) => l.grossPaise));

    return {
        goods: toRupees(goodsPaise),
        tax: toRupees(taxPaise),
        discountReversed: toRupees(discountSharePaise),
        deliveryFee: toRupees(deliveryPaise),
        platformFee: toRupees(platformPaise),
        total: toRupees(totalPaise),
        isFullReturn,
        capApplied,
        lines: matched.map((l, i) => ({
            itemId: l.itemId,
            variantId: l.variantId,
            name: l.name,
            quantity: l.quantity,
            unitPrice: toRupees(l.unitPricePaise),
            refundAmount: toRupees(lineShares[i]),
        })),
    };
};

/**
 * The GST rate a line with no slab of its own was charged at.
 *
 * computeItemsTax() taxes such a line at the fee settings' order-wide `gstRate`.
 * Orders placed since that rate was recorded carry it as pricing.gstFallbackRate.
 * Older orders do not, and the fee settings may have changed since, so the rate is
 * worked back out of the order itself: whatever tax the order recorded beyond what its
 * own-slab lines account for was charged on its untagged lines. Derived that way, the
 * untagged lines of an order refund exactly the tax they were charged, rounding included.
 */
function untaggedLineRate(items, pricing, orderSubtotalPaise) {
    const stored = pricing?.gstFallbackRate;
    if (stored !== null && stored !== undefined && Number.isFinite(Number(stored))) {
        return Math.max(0, Number(stored));
    }
    if (!(orderSubtotalPaise > 0)) return 0;

    const taxableShare = Math.max(0, orderSubtotalPaise - toPaise(pricing?.discount)) / orderSubtotalPaise;
    let ownTaxPaise = 0;
    let untaggedNetPaise = 0;
    for (const it of items) {
        const net = toPaise(it.price) * (Number(it.quantity) || 0) * taxableShare;
        const own = it.gstRate;
        if (own === null || own === undefined) untaggedNetPaise += net;
        else ownTaxPaise += (net * (Number(own) || 0)) / 100;
    }
    if (!(untaggedNetPaise > 0)) return 0;
    return Math.max(0, ((toPaise(pricing?.tax) - ownTaxPaise) * 100) / untaggedNetPaise);
}

/** This line's slice of the returned-set discount, by gross value. */
function discountShareOf(line, goodsPaise, discountSharePaise) {
    if (goodsPaise <= 0 || discountSharePaise <= 0) return 0;
    return Math.round((discountSharePaise * line.grossPaise) / goodsPaise);
}
