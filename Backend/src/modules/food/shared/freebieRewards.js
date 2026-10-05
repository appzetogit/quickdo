/**
 * "Spend ₹200, get a free dish."
 *
 * A restaurant sets one or more thresholds, each with something given away when
 * the order reaches it -- a menu item, an add-on, or a manual, free-text name
 * for a reward that isn't one of the restaurant's own catalogue rows. Whether a
 * tier is EARNED is always resolved by the server from the order's own subtotal,
 * never chosen by the client -- a customer cannot claim a threshold they have
 * not reached. Claiming an earned one is the customer's own choice, though (see
 * resolveFreebieForOrder's `claimed` argument): earning it only unlocks an Add
 * button, it does not add the item for them.
 *
 * Two rules do most of the work here:
 *
 *   The threshold is measured on what the customer PAYS for -- the item subtotal
 *   before fees and before the freebie itself is added. Counting the freebie
 *   would let a ₹0 line push an order over a threshold it never reached, and
 *   with two tiers it could cascade.
 *
 *   When several tiers qualify, the highest one wins, and only that one. A ₹500
 *   order on a ₹200/₹300 ladder earns the ₹300 reward, not both. Giving every
 *   passed tier would make the ladder additive, which is not what "spend more,
 *   get a better freebie" means to either side.
 */

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const toFiniteNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

export const FREEBIE_REWARD_TYPES = Object.freeze(['item', 'addon', 'manual']);

/** Max tiers a restaurant may configure. A ladder longer than this is a menu, not an offer. */
export const MAX_FREEBIE_TIERS = 10;

/**
 * Validate and tidy the tier list an item form submitted.
 *
 * Sorted ascending and de-duplicated by threshold, so the resolver can rely on
 * ordering and a restaurant cannot configure two different rewards at the same
 * amount -- which would make the freebie depend on array order rather than on
 * anything they chose.
 *
 * Returns undefined when the body does not mention tiers at all, so a partial
 * update leaves the stored ladder alone.
 */
export function normalizeFreebieTiersInput(body = {}) {
    if (body?.tiers === undefined) return undefined;

    const raw = Array.isArray(body.tiers) ? body.tiers : [];
    if (raw.length > MAX_FREEBIE_TIERS) {
        throw new Error(`At most ${MAX_FREEBIE_TIERS} reward tiers can be configured`);
    }

    const seen = new Set();
    const tiers = [];

    for (const entry of raw) {
        const minOrderValue = toFiniteNumber(entry?.minOrderValue);
        if (minOrderValue === null || minOrderValue <= 0) {
            throw new Error('Each reward tier needs an order amount greater than 0');
        }

        const rewardType = String(entry?.rewardType || 'item').trim().toLowerCase();
        if (!FREEBIE_REWARD_TYPES.includes(rewardType)) {
            throw new Error('A reward must be a menu item, an add-on, or a manual name');
        }

        const key = round2(minOrderValue);
        if (seen.has(key)) {
            throw new Error(`Two rewards are set for orders over ${key}. Use one reward per amount.`);
        }
        seen.add(key);

        if (rewardType === 'manual') {
            // No FoodItem/FoodAddon backs this one -- it's whatever the admin
            // typed, for a reward that isn't (yet, or ever) a real menu row.
            const rewardName = String(entry?.rewardName || '').trim();
            if (!rewardName) {
                throw new Error('A manual reward needs a name');
            }
            tiers.push({
                minOrderValue: key,
                rewardType,
                rewardItemId: null,
                rewardAddonId: null,
                rewardName: rewardName.slice(0, 120),
            });
            continue;
        }

        const rewardId = String(
            (rewardType === 'addon' ? entry?.rewardAddonId : entry?.rewardItemId) ?? entry?.rewardId ?? ''
        ).trim();
        if (!rewardId) {
            throw new Error('Each reward tier needs an item or add-on to give away');
        }

        tiers.push({
            minOrderValue: key,
            rewardType,
            rewardItemId: rewardType === 'item' ? rewardId : null,
            rewardAddonId: rewardType === 'addon' ? rewardId : null,
            rewardName: '',
        });
    }

    tiers.sort((a, b) => a.minOrderValue - b.minOrderValue);
    return { tiers };
}

/**
 * The tier an order of this size earns, or null.
 *
 * @param {Array} tiers      configured tiers, any order
 * @param {number} subtotal  item subtotal, excluding fees and any freebie
 */
export function resolveFreebieTier(tiers = [], subtotal = 0) {
    const amount = toFiniteNumber(subtotal) ?? 0;
    if (amount <= 0) return null;

    let best = null;
    for (const tier of tiers || []) {
        const min = toFiniteNumber(tier?.minOrderValue);
        if (min === null || min <= 0) continue;
        if (amount < min) continue;
        if (!best || min > best.minOrderValue) best = { ...tier, minOrderValue: min };
    }

    return best;
}

/**
 * The next tier a customer has not reached, and what it would take.
 *
 * Powers the "add ₹40 more for a free Gulab Jamun" nudge. Returns null when the
 * top tier is already earned, so the client has nothing left to prompt for.
 */
export function describeNextFreebieTier(tiers = [], subtotal = 0) {
    const amount = toFiniteNumber(subtotal) ?? 0;

    let next = null;
    for (const tier of tiers || []) {
        const min = toFiniteNumber(tier?.minOrderValue);
        if (min === null || min <= 0) continue;
        if (amount >= min) continue;
        if (!next || min < next.minOrderValue) next = { ...tier, minOrderValue: min };
    }

    if (!next) return null;
    return { ...next, amountAway: round2(next.minOrderValue - amount) };
}

/**
 * Build the order line for an earned reward.
 *
 * Priced at 0 and flagged, rather than discounted: the kitchen has to see it,
 * the customer has to see why it costs nothing, and commission is taken on the
 * subtotal -- which this is deliberately not part of.
 *
 * Returns null when the reward no longer resolves to something sellable. A
 * freebie is a bonus, so a withdrawn reward quietly stops being offered instead
 * of blocking an order the customer is trying to place.
 */
export function buildFreebieLine(tier, reward) {
    if (!tier || !reward) return null;

    const name = String(reward.name || '').trim();
    if (!name) return null;

    return {
        itemId: reward._id,
        name,
        price: 0,
        quantity: 1,
        variantName: '',
        addons: [],
        addonsTotal: 0,
        foodPackagingCharge: 0,
        isFreebie: true,
        freebie: {
            minOrderValue: round2(tier.minOrderValue),
            rewardType: tier.rewardType,
        },
    };
}
