/**
 * "Buy 1, get 1 free."
 *
 * A restaurant nominates dishes and a ratio; the server hands out the free units
 * from the quantity actually ordered. Nothing the client sends decides how many
 * units are free, for the same reason the spend-threshold freebie is resolved
 * server-side -- a client that could ask for free units would ask for all of them.
 *
 * Three rules do the work here:
 *
 *   Free units come out of the SAME line, not from a new one the customer never
 *   ordered. Two pizzas in the cart means one paid pizza and one free pizza, not
 *   two paid pizzas plus a bonus. So the line is split rather than discounted.
 *
 *   That split is what keeps the money right downstream. Commission is taken on
 *   pricing.subtotal, and the POS is sent price x quantity per line, so a line
 *   left at full quantity with a discount bolted on would charge the restaurant
 *   commission on food it gave away and desynchronise the POS total. A zero-
 *   priced line is subtracted from both by construction.
 *
 *   Only the item price is given away. Add-ons and packaging ride along on the
 *   free line at their real values: extra cheese on a free pizza is still cheese
 *   somebody has to pay for, and the free pizza still leaves in a box.
 */

const toFiniteNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const toPositiveInteger = (value) => {
    const parsed = toFiniteNumber(value);
    if (parsed === null) return null;
    if (!Number.isInteger(parsed) || parsed < 1) return null;
    return parsed;
};

const toDateOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Buy N, get M. The defaults are the classic offer, which is what nearly everyone configures. */
export const DEFAULT_BUY_QTY = 1;
export const DEFAULT_GET_QTY = 1;

/** How many dishes one restaurant may put on offer. Beyond this it is a price list, not a promotion. */
export const MAX_BOGO_OFFERS = 25;

/**
 * Validate and tidy the offer rows a panel submitted.
 *
 * De-duplicated by item, because two rows on the same dish would make the ratio
 * a customer gets depend on array order rather than on anything the restaurant
 * chose. Returns undefined when the body does not mention offers at all, so a
 * request that only flips isActive leaves the configured rows alone.
 */
export function normalizeBogoOffersInput(body = {}) {
    if (body?.offers === undefined) return undefined;

    const raw = Array.isArray(body.offers) ? body.offers : [];
    if (raw.length > MAX_BOGO_OFFERS) {
        throw new Error(`At most ${MAX_BOGO_OFFERS} dishes can be on a buy-one-get-one offer`);
    }

    const seen = new Set();
    const offers = [];

    for (const entry of raw) {
        const itemId = String(entry?.itemId ?? '').trim();
        if (!itemId) {
            throw new Error('Each buy-one-get-one row needs a dish');
        }
        if (seen.has(itemId)) {
            throw new Error('The same dish is listed twice. Use one row per dish.');
        }
        seen.add(itemId);

        const buyQty = toPositiveInteger(entry?.buyQty ?? DEFAULT_BUY_QTY);
        if (buyQty === null) {
            throw new Error('Buy quantity must be a whole number of 1 or more');
        }

        const getQty = toPositiveInteger(entry?.getQty ?? DEFAULT_GET_QTY);
        if (getQty === null) {
            throw new Error('Free quantity must be a whole number of 1 or more');
        }

        // Optional. Null means uncapped, which is the sensible default for a
        // promotion; a cap exists so one 40-unit order cannot empty a kitchen the
        // restaurant expected to serve all evening.
        let maxFreeUnitsPerOrder = null;
        const capRaw = entry?.maxFreeUnitsPerOrder;
        if (capRaw !== undefined && capRaw !== null && capRaw !== '') {
            maxFreeUnitsPerOrder = toPositiveInteger(capRaw);
            if (maxFreeUnitsPerOrder === null) {
                throw new Error('Maximum free units per order must be a whole number of 1 or more');
            }
        }

        const startDate = toDateOrNull(entry?.startDate);
        const endDate = toDateOrNull(entry?.endDate);
        if (entry?.startDate && !startDate) throw new Error('The offer start date is not a valid date');
        if (entry?.endDate && !endDate) throw new Error('The offer end date is not a valid date');
        if (startDate && endDate && endDate <= startDate) {
            throw new Error('The offer end date must be after its start date');
        }

        offers.push({ itemId, buyQty, getQty, maxFreeUnitsPerOrder, startDate, endDate });
    }

    return { offers };
}

/**
 * Is this row running right now?
 *
 * An absent window means always on. The end is exclusive, matching how coupon
 * windows are read in the pricing service, so a row that ends on the 1st does not
 * quietly include the whole of the 1st.
 */
export function isBogoOfferLive(offer, now = new Date()) {
    if (!offer) return false;
    const at = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(at.getTime())) return false;

    if (offer.startDate && at < new Date(offer.startDate)) return false;
    if (offer.endDate && at >= new Date(offer.endDate)) return false;
    return true;
}

/**
 * How many units of a line are free.
 *
 *   freeUnits = floor(quantity / (buyQty + getQty)) * getQty
 *
 * On a classic buy-one-get-one that is 2 -> 1, 3 -> 1, 4 -> 2. The floor is the
 * whole point: three pizzas is one complete pair plus a spare, and the spare is
 * paid for. Rounding up instead would hand a free dish to anyone ordering an odd
 * quantity.
 *
 * @param {number} quantity   units ordered on this line
 * @param {object} offer      the configured row, for its ratio
 * @param {number|null} allowance  free units still permitted for this dish on this
 *   order, or null for uncapped. Passed in rather than read off the offer because
 *   one dish can occupy several lines (one per variant) and a per-order cap has to
 *   be shared across them, not applied afresh to each.
 */
export function computeFreeUnits(quantity, offer = {}, allowance = null) {
    const qty = toFiniteNumber(quantity);
    if (qty === null || qty < 2) return 0;

    const buyQty = toPositiveInteger(offer?.buyQty ?? DEFAULT_BUY_QTY);
    const getQty = toPositiveInteger(offer?.getQty ?? DEFAULT_GET_QTY);
    if (buyQty === null || getQty === null) return 0;

    const groupSize = buyQty + getQty;
    let freeUnits = Math.floor(qty / groupSize) * getQty;
    if (freeUnits <= 0) return 0;

    if (allowance !== null && allowance !== undefined) {
        const remaining = toFiniteNumber(allowance);
        if (remaining === null || remaining <= 0) return 0;
        freeUnits = Math.min(freeUnits, Math.floor(remaining));
    }

    return Math.max(0, freeUnits);
}

/**
 * Split a resolved order line into what is paid for and what is free.
 *
 * The free half keeps the line's add-ons, per-unit add-on total and packaging
 * charge untouched and zeroes only the item price, which is what makes the
 * subtotal, the packaging fee and the POS payload all come out right without any
 * of them knowing this feature exists.
 *
 * Returns the line unchanged when nothing is free. It also refuses to make an
 * ENTIRE line free: the formula above cannot produce that while buyQty is at
 * least 1, so reaching it means a malformed offer, and a malformed offer should
 * cost the restaurant nothing rather than everything.
 */
export function splitBogoLine(line, freeUnits, offer = {}) {
    const qty = toFiniteNumber(line?.quantity) ?? 0;
    const free = Math.floor(toFiniteNumber(freeUnits) ?? 0);
    if (free <= 0 || free >= qty) return [line];

    const paidLine = { ...line, quantity: qty - free };

    const freeLine = {
        ...line,
        quantity: free,
        price: 0,
        isBogoFree: true,
        bogo: {
            buyQty: toPositiveInteger(offer?.buyQty ?? DEFAULT_BUY_QTY) ?? DEFAULT_BUY_QTY,
            getQty: toPositiveInteger(offer?.getQty ?? DEFAULT_GET_QTY) ?? DEFAULT_GET_QTY,
            sourceItemId: String(line?.itemId ?? ''),
        },
    };

    // Paid first: the kitchen ticket and the invoice are both read top to bottom,
    // and a free unit only makes sense after the paid one that earned it.
    return [paidLine, freeLine];
}

/**
 * How close a line is to earning another free unit, or null.
 *
 * Powers the "add 1 more and get it free" nudge, which is the whole point of
 * advertising the offer: a customer holding one pizza is one tap from a second
 * one costing nothing, and nobody reads a menu badge again once they are in the
 * cart.
 *
 * Deliberately silent on a clean multiple. Someone holding exactly two on a buy
 * one get one has already taken the offer, and telling them to add two more to
 * take it again is nagging rather than helping.
 *
 * @param {number} quantity  units ordered on this line
 * @param {object} offer     the configured row, for its ratio
 * @param {number|null} remainingAllowance  free units this dish may still give
 *   away on this order AFTER what it has already granted, or null for uncapped.
 *   A dish that has hit its cap cannot earn another, so it is not offered one.
 */
export function describeNextBogoUnits(quantity, offer = {}, remainingAllowance = null) {
    const qty = toFiniteNumber(quantity);
    if (qty === null || qty < 1) return null;

    const buyQty = toPositiveInteger(offer?.buyQty ?? DEFAULT_BUY_QTY);
    const getQty = toPositiveInteger(offer?.getQty ?? DEFAULT_GET_QTY);
    if (buyQty === null || getQty === null) return null;

    if (remainingAllowance !== null && remainingAllowance !== undefined) {
        const remaining = toFiniteNumber(remainingAllowance);
        if (remaining === null || remaining < 1) return null;
    }

    const groupSize = buyQty + getQty;
    const remainder = qty % groupSize;
    if (remainder === 0) return null;

    const freeQuantity = remainingAllowance === null || remainingAllowance === undefined
        ? getQty
        : Math.min(getQty, Math.floor(Number(remainingAllowance)));
    if (freeQuantity < 1) return null;

    return { unitsAway: groupSize - remainder, freeQuantity };
}

/**
 * The offer as a badge, or null when the row is unusable.
 *
 * Built here rather than in each client so the menu, the dish card and the cart
 * cannot end up phrasing the same ratio three different ways -- "buy 2 get 1" is
 * already easy enough to misread as "3 for the price of 1".
 */
export function describeBogoOffer(offer) {
    if (!offer) return null;

    const buyQty = toPositiveInteger(offer?.buyQty ?? DEFAULT_BUY_QTY);
    const getQty = toPositiveInteger(offer?.getQty ?? DEFAULT_GET_QTY);
    if (buyQty === null || getQty === null) return null;

    return { buyQty, getQty, label: `Buy ${buyQty} Get ${getQty} Free` };
}

/**
 * What the customer saved on one split line.
 *
 * The item price only, matching what splitBogoLine actually gave away -- add-ons
 * stayed chargeable, so counting them here would overstate the saving on the
 * banner and understate what the customer is about to be charged.
 */
export function describeBogoSaving(line, freeUnits) {
    const free = Math.floor(toFiniteNumber(freeUnits) ?? 0);
    if (free <= 0) return null;

    const unitPrice = toFiniteNumber(line?.price) ?? 0;

    return {
        itemId: String(line?.itemId ?? ''),
        name: String(line?.name ?? ''),
        variantName: String(line?.variantName ?? ''),
        freeQuantity: free,
        savedAmount: Math.round(unitPrice * free * 100) / 100,
    };
}
