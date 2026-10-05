import { ValidationError } from '../../../core/auth/errors.js';

/**
 * Printed maximum retail price, shown struck through next to the selling price.
 *
 * Two things, not one:
 *   mrp   — what the pack says. Selling above it is illegal, so this is a
 *           constraint the server refuses to break, not a marketing number.
 *   price — what the customer actually pays. The discount is the gap.
 *
 * Ported from the quick-commerce module, which already had exactly this, so the
 * two verticals agree on what MRP means rather than drifting into two rules.
 *
 * `null` means "not recorded" and is the default: most existing rows predate the
 * field, and treating an absent MRP as 0 would make every one of them look like
 * it was being sold above MRP.
 */

const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
};

/**
 * Normalize an MRP from a menu-item form.
 * Returns undefined when the caller sent nothing, so a partial update leaves the
 * stored value alone; `{ mrp: null }` when explicitly cleared.
 */
export function normalizeMrpInput(body = {}) {
    if (body?.mrp === undefined) return undefined;
    if (body.mrp === null || String(body.mrp).trim() === '') return { mrp: null };

    const mrp = toNumber(body.mrp);
    if (!Number.isFinite(mrp) || mrp < 0) throw new ValidationError('MRP is invalid');
    return { mrp };
}

/**
 * Normalize the compare-at / other-platform price.
 *
 * Deliberately not validated against `price`: being cheaper than the rival price
 * you typed is the normal case, and the whole point of showing it. The client
 * strikes it through only when it is higher, so a lower value simply renders
 * nothing. 0 means "not set", matching what quick-commerce stores.
 */
export function normalizeOtherPriceInput(body = {}) {
    if (body?.otherPrice === undefined) return undefined;
    if (body.otherPrice === null || String(body.otherPrice).trim() === '') return { otherPrice: 0 };

    const value = toNumber(body.otherPrice);
    if (!Number.isFinite(value) || value < 0) throw new ValidationError('Other platform price is invalid');
    return { otherPrice: value };
}

/** What the client should strike through, or 0 when there is nothing to show. */
export function resolveComparePrice(price, otherPrice) {
    const sell = toNumber(price);
    const compare = toNumber(otherPrice);
    if (!Number.isFinite(compare) || compare <= 0) return 0;
    if (Number.isFinite(sell) && compare <= sell) return 0;
    return compare;
}

/**
 * Refuse a selling price above the printed MRP.
 *
 * Checks variants too: a dish can be cheap in its small size and above MRP in
 * its large one, and validating only the base price would let that through.
 */
export function assertPriceWithinMrp(price, mrp, variants = []) {
    const cap = toNumber(mrp);
    if (!Number.isFinite(cap) || cap <= 0) return; // not recorded: nothing to enforce

    const candidates = [
        toNumber(price),
        ...(Array.isArray(variants) ? variants.map((v) => toNumber(v?.price)) : []),
    ].filter((n) => Number.isFinite(n));

    if (candidates.length === 0) return;

    const highest = Math.max(...candidates);
    if (highest > cap) {
        throw new ValidationError(`Price cannot be above the MRP of ${cap}`);
    }
}

/**
 * What the client needs to render "₹80  ₹̶1̶0̶0̶  20% OFF".
 *
 * Returns hasDiscount false whenever there is nothing honest to show — no MRP,
 * an MRP at or below the price, or a non-numeric price — so a client can render
 * on that one flag rather than re-deriving the rule.
 *
 * The percentage is floored, not rounded: showing "20% OFF" for a 19.6% discount
 * overstates it, and this is a number customers check.
 */
export function computeMrpDiscount(price, mrp) {
    const sell = toNumber(price);
    const printed = toNumber(mrp);

    if (!Number.isFinite(sell) || !Number.isFinite(printed) || printed <= 0 || printed <= sell) {
        return { mrp: Number.isFinite(printed) && printed > 0 ? printed : null, hasDiscount: false, discountPercent: 0, savings: 0 };
    }

    const savings = Math.round((printed - sell) * 100) / 100;
    return {
        mrp: printed,
        hasDiscount: true,
        discountPercent: Math.floor(((printed - sell) / printed) * 100),
        savings,
    };
}
