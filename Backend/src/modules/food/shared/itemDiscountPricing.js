/**
 * Base price + discount, the way an item is priced now.
 *
 * A restaurant types what the dish is worth (`basePrice`, say 50) and how much
 * off they are giving (`discountPercent`, say 20). The customer pays `price`
 * (40), and 50 is what gets struck through next to it.
 *
 * `price` stays the authoritative selling price, exactly as it was before this
 * field pair existed. That is deliberate and load-bearing: order subtotals,
 * commission, payouts and every cart total already read `price`, so pricing an
 * item this way changes what those numbers are without changing any of that
 * code. In particular the platform commission is charged on what the customer
 * actually pays (40), not on the pre-discount sticker (50), because commission
 * is taken from the order subtotal and the subtotal is built from `price`.
 *
 * This replaces the older pair of compare-at fields:
 *   mrp        - the printed maximum retail price, enforced as a legal ceiling
 *   otherPrice - a rival platform's price, purely presentational
 * Both existed only to produce a struck-through number. `basePrice` produces the
 * same strikethrough from a figure the restaurant sets itself, so the two are
 * no longer written by the item forms. The columns are left on the schema so
 * existing rows keep their data rather than being silently erased.
 */

import { resolveFormulationPricing, rebaseFormulationFields } from './formulationPricing.js';

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const toFiniteNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

export const MAX_DISCOUNT_PERCENT = 100;

/**
 * What the customer pays, given a sticker price and a discount.
 *
 * Rounded to paise so a price never carries floating-point noise into an order
 * total. A 100% discount yields 0, which is a legitimate thing to configure
 * (a giveaway) and is why the floor is 0 rather than some minimum.
 */
export function computeSellingPrice(basePrice, discountPercent) {
    const base = toFiniteNumber(basePrice);
    if (base === null || base < 0) return null;

    const percent = toFiniteNumber(discountPercent) ?? 0;
    const clamped = Math.min(Math.max(percent, 0), MAX_DISCOUNT_PERCENT);

    return round2(Math.max(0, base * (1 - clamped / 100)));
}

/**
 * The discount implied by a base price and a selling price.
 *
 * Used to display a percentage for rows written before this field pair existed,
 * and to keep the two in step when only one side is supplied.
 */
export function computeDiscountPercent(basePrice, price) {
    const base = toFiniteNumber(basePrice);
    const selling = toFiniteNumber(price);
    if (base === null || selling === null || base <= 0) return 0;
    if (selling >= base) return 0;
    return round2(((base - selling) / base) * 100);
}

/**
 * Normalise whatever the item form submitted into the three numbers stored.
 *
 * Accepts a partial body, because both panels PATCH single fields: `existing`
 * supplies whatever the request left out, so editing only the discount keeps
 * the base price, and editing only the base price keeps the discount.
 *
 * A row that predates this feature has no basePrice. Rather than treating that
 * as 0 -- which would compute every such item down to a free dish -- the
 * existing `price` is adopted as the base, which is exactly what an undiscounted
 * item means.
 *
 * Returns null when the body mentions none of the three, so callers can leave
 * the document untouched instead of rewriting it with recomputed values.
 */
export function normalizeDiscountPricingInput(body = {}, existing = {}) {
    const mentionsBase = body.basePrice !== undefined;
    const mentionsDiscount = body.discountPercent !== undefined;
    const mentionsPrice = body.price !== undefined;

    if (!mentionsBase && !mentionsDiscount && !mentionsPrice) return null;

    const existingBase =
        toFiniteNumber(existing.basePrice) ?? toFiniteNumber(existing.price) ?? 0;
    const existingDiscount = toFiniteNumber(existing.discountPercent) ?? 0;

    let basePrice = mentionsBase ? toFiniteNumber(body.basePrice) : existingBase;
    let discountPercent = mentionsDiscount
        ? toFiniteNumber(body.discountPercent)
        : existingDiscount;

    /*
     * `price` alone still arrives from older clients and from bulk upload. It is
     * the SELLING price, so on a discounted dish it must not be written into the
     * base -- that is how a base price walks downwards.
     *
     * Gajrela on production: base 100, discount 10%, selling at 90. A save that
     * sent only `price: 90` set basePrice to 90 and cleared the discount, so the
     * dish now derived 81 and the next such save would make it 72.90. Its
     * siblings from the same run (Masala Mushroom, Paneer Bhurji, Butter Chicken)
     * all still read base 100 / discount 10% / selling 90, which is what this
     * dish should have looked like.
     *
     * So the selling price is honoured by holding the discount and solving for
     * the base it implies. A dish with no discount is unaffected: the base and
     * the selling price are the same number, and this reduces to what it did
     * before.
     */
    if (!mentionsBase && !mentionsDiscount && mentionsPrice) {
        const submitted = toFiniteNumber(body.price);
        if (submitted === null || submitted < 0) {
            throw new Error('Price must be a number of 0 or more');
        }
        if (existingDiscount > 0 && existingDiscount < 100) {
            const impliedBase = round2(submitted / (1 - existingDiscount / 100));
            return {
                basePrice: impliedBase,
                discountPercent: round2(existingDiscount),
                price: computeSellingPrice(impliedBase, existingDiscount),
            };
        }
        return { basePrice: submitted, discountPercent: 0, price: round2(submitted) };
    }

    if (basePrice === null || basePrice < 0) {
        throw new Error('Base price must be a number of 0 or more');
    }
    if (discountPercent === null) discountPercent = 0;
    if (discountPercent < 0 || discountPercent > MAX_DISCOUNT_PERCENT) {
        throw new Error(`Discount must be between 0 and ${MAX_DISCOUNT_PERCENT} percent`);
    }

    return {
        basePrice: round2(basePrice),
        discountPercent: round2(discountPercent),
        price: computeSellingPrice(basePrice, discountPercent),
    };
}

/**
 * The pricing a client should render for an item.
 *
 * `strikePrice` is non-null only when there is genuinely something to strike
 * through, so a client can render it unconditionally without having to decide
 * whether a discount exists. An item with no discount returns null there rather
 * than repeating the selling price, which would otherwise show as "₹40 ₹40".
 */
export function resolveItemDisplayPricing(food = {}) {
    /*
     * Delegated to the formulation rule, which is now the only place a
     * displayed price is decided. Every caller of this function -- menus, the
     * public listing, the seller app, the 99-store shelf -- picks up the new
     * derivation without knowing about it, which is the point: the last time
     * two pricing paths existed side by side they disagreed, and a disagreement
     * about price is not the kind that surfaces as an error.
     *
     * The returned shape is unchanged, so nothing downstream had to move. The
     * formulation figures are added rather than substituted, for the admin
     * panel, which edits against them.
     */
    const derived = resolveFormulationPricing(food);

    return {
        price: derived.price,
        basePrice: derived.basePrice,
        discountPercent: derived.discountPercent,
        strikePrice: derived.strikePrice,
        savings: derived.savings,
        formulationPercent: derived.formulationPercent,
        formulationPrice: derived.formulationPrice,
    };
}

/**
 * What the restaurant keeps once the platform takes its cut.
 *
 * Charged against the selling price, matching how commission is actually taken
 * on an order: the order subtotal is built from `price`, and the commission is
 * a share of that subtotal.
 */
export function computeRestaurantTakeHome(price, commissionPercent) {
    const selling = Math.max(0, toFiniteNumber(price) ?? 0);
    const percent = Math.min(Math.max(toFiniteNumber(commissionPercent) ?? 0, 0), 100);
    const commission = round2((selling * percent) / 100);

    return {
        price: round2(selling),
        commissionPercent: round2(percent),
        commissionAmount: commission,
        takeHome: round2(selling - commission),
    };
}

/**
 * The pricing fields to write for a create or update, for either item form.
 *
 * The admin panel and the restaurant panel maintain separate, near-identical
 * copies of the item write path. Putting the decision here rather than in both
 * is deliberate: the two have drifted before, and a divergence in pricing is
 * not the kind that shows up as an error -- it shows up as the wrong amount of
 * money moving.
 *
 * @param {object}  o
 * @param {object}  o.body            the submitted form body
 * @param {object}  o.existing        the stored item, for partial updates
 * @param {number}  [o.variantPrice]  cheapest variant price, when the item has variants
 * @param {boolean} [o.hasVariants]   whether variants are in play
 * @param {boolean} [o.requirePositive] admin rejects 0; the restaurant panel allows it
 * @returns {{price:number, basePrice:number, discountPercent:number}|null}
 *          null when the body says nothing about pricing, so the caller leaves
 *          the stored values alone rather than rewriting them.
 */
export function resolveItemPricingForWrite({
    body = {},
    existing = {},
    variantPrice = null,
    hasVariants = false,
    requirePositive = false,
} = {}) {
    // With variants the item's own price is the cheapest option after discount --
    // the "from" price a listing shows. Each variant is discounted individually
    // when an order is priced.
    const input = hasVariants
        ? { basePrice: variantPrice, discountPercent: body.discountPercent }
        : body;

    const resolved = normalizeDiscountPricingInput(input, existing);
    if (!resolved) return null;

    if (requirePositive && !(resolved.basePrice > 0)) {
        throw new Error('Price must be greater than 0');
    }

    /*
     * Re-derive against the dish's active adjustment.
     *
     * The base price is the restaurant's to set and this is where they set it.
     * The markup and discount are the platform's and are not in this form, so
     * they are carried over from the stored dish and everything derived from the
     * base -- the charged price, the struck figure, the saving -- is worked out
     * again (see rebaseFormulationFields).
     *
     * It used to carry one signed percent, which on a dish holding a hike AND a
     * discount kept only the hike: a Rs 200 dish sold at 180 was re-saved at 200
     * while the menu went on showing 180. And it never touched the stored strike,
     * which is the figure the menu shows.
     */
    const rebased = rebaseFormulationFields(existing, resolved.basePrice);
    return rebased || resolved;
}
