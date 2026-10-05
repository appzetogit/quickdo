/**
 * Platform-funded free delivery: "order Rs 300 or more from a restaurant within
 * 3 km, and delivery is free."
 *
 * Two conditions, both required. Distance alone would give away long trips on
 * tiny baskets; order value alone would give away a 20 km run because someone
 * spent enough. Together they describe the case the platform actually wants to
 * subsidise -- a nearby restaurant and a basket worth the trip.
 *
 * Admin-only, deliberately. Waiving the fee costs the platform, not the
 * restaurant: the rider is still paid in full and the difference is absorbed
 * centrally, which is the same reasoning behind the per-dish `freeDelivery` flag
 * being admin-only.
 *
 * This module is pure -- no database, no request -- so the rule can be tested on
 * its own. The distance handed in must be the same road distance the delivery
 * slab was priced from, never a straight line, or a customer would be quoted a
 * hill-road fee and then judged against a crow-flies radius.
 *
 * NOTE: an older `freeDeliveryThreshold` field exists on the fee settings and is
 * editable, but nothing ever read it -- setting it had no effect on any order.
 * This rule replaces it and is opt-in, so a stale value cannot suddenly start
 * giving delivery away.
 */

export const DEFAULT_FREE_DELIVERY_RULE = Object.freeze({
    isEnabled: false,
    maxDistanceKm: 3,
    minOrderAmount: 300,
});

/**
 * A distance that was never measured. Number(null) is 0, so without this an
 * absent coordinate would read as "zero kilometres away" and qualify -- turning
 * every geocoding failure into free delivery.
 */
const isUnmeasured = (value) =>
    value === null || value === undefined || value === '' || typeof value === 'boolean';

const toNonNegative = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * Fill in whatever the settings document is missing, so pricing never has to
 * reason about a half-configured rule.
 */
export function normalizeFreeDeliveryRule(raw = null) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        isEnabled: source.isEnabled === true,
        maxDistanceKm: toNonNegative(source.maxDistanceKm, DEFAULT_FREE_DELIVERY_RULE.maxDistanceKm),
        minOrderAmount: toNonNegative(source.minOrderAmount, DEFAULT_FREE_DELIVERY_RULE.minOrderAmount),
    };
}

/**
 * Validate what an admin typed. Returns a reason rather than throwing so the
 * panel can show it against the field.
 */
export function validateFreeDeliveryRule(raw = {}) {
    const rule = normalizeFreeDeliveryRule(raw);
    if (!rule.isEnabled) return { ok: true, reason: '', rule };

    if (!(rule.maxDistanceKm > 0)) {
        return { ok: false, reason: 'Set a radius above zero, or switch the rule off.', rule };
    }
    // A radius wider than the platform delivers is not a rule, it is free
    // delivery on everything -- almost certainly a typo for 5 rather than 50.
    if (rule.maxDistanceKm > 50) {
        return { ok: false, reason: 'That radius looks too large. Use 50 km or less.', rule };
    }
    if (!(rule.minOrderAmount > 0)) {
        return { ok: false, reason: 'Set a minimum order amount above zero, or switch the rule off.', rule };
    }
    return { ok: true, reason: '', rule };
}

/**
 * Does this order qualify?
 *
 * `distanceKm` null means the distance could not be measured -- a missing
 * address or a failed lookup. That does NOT qualify: giving delivery away
 * because a coordinate was absent would turn every geocoding failure into a
 * free trip.
 *
 * The comparison is inclusive at both edges, because a rule written as
 * "within 3 km" and "Rs 300 and above" is read that way by the person who set it
 * and by the customer who was shown it.
 */
export function qualifiesForFreeDelivery({ rule, distanceKm, subtotal } = {}) {
    const normalized = normalizeFreeDeliveryRule(rule);
    if (!normalized.isEnabled) return false;
    if (!(normalized.maxDistanceKm > 0) || !(normalized.minOrderAmount > 0)) return false;

    if (isUnmeasured(distanceKm) || isUnmeasured(subtotal)) return false;
    const km = Number(distanceKm);
    const value = Number(subtotal);
    if (!Number.isFinite(km) || km < 0) return false;
    if (!Number.isFinite(value)) return false;

    return km <= normalized.maxDistanceKm && value >= normalized.minOrderAmount;
}

/**
 * How a single restaurant relates to the platform-wide rule.
 *
 * 'inherit' is the default and what every existing restaurant does, so adding
 * this field changes nothing until somebody deliberately sets it. 'off' exists
 * as its own state rather than as a disabled custom rule: an admin excluding one
 * restaurant from a platform promotion is saying something different from one
 * who set a custom radius and later switched it off, and squashing the two
 * together loses the numbers they had typed.
 */
export const RESTAURANT_FREE_DELIVERY_MODES = Object.freeze(['inherit', 'off', 'custom']);

export const DEFAULT_RESTAURANT_FREE_DELIVERY = Object.freeze({
    mode: 'inherit',
    maxDistanceKm: 3,
    minOrderAmount: 300,
});

export function normalizeRestaurantFreeDelivery(raw = null) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const mode = RESTAURANT_FREE_DELIVERY_MODES.includes(source.mode)
        ? source.mode
        : DEFAULT_RESTAURANT_FREE_DELIVERY.mode;
    return {
        mode,
        maxDistanceKm: toNonNegative(source.maxDistanceKm, DEFAULT_RESTAURANT_FREE_DELIVERY.maxDistanceKm),
        minOrderAmount: toNonNegative(source.minOrderAmount, DEFAULT_RESTAURANT_FREE_DELIVERY.minOrderAmount),
    };
}

/**
 * Merge what an admin just submitted over what is already stored.
 *
 * The point is that switching a restaurant to 'inherit' or 'off' must not throw
 * away the radius and minimum it had, so switching back to 'custom' restores the
 * numbers instead of silently resetting them to 3 km and Rs 300. Normalising the
 * incoming body on its own would do exactly that, because an absent field falls
 * back to the module default rather than to the stored value.
 *
 * A non-positive number counts as absent. No valid rule uses zero, so a panel
 * that sends 0 for a disabled input is saying "nothing here", not "make it zero".
 */
export function mergeRestaurantFreeDelivery(incoming = {}, stored = null) {
    const current = normalizeRestaurantFreeDelivery(stored);
    const source = incoming && typeof incoming === 'object' ? incoming : {};

    const keep = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    };

    return {
        mode: RESTAURANT_FREE_DELIVERY_MODES.includes(source.mode) ? source.mode : current.mode,
        maxDistanceKm: keep(source.maxDistanceKm, current.maxDistanceKm),
        minOrderAmount: keep(source.minOrderAmount, current.minOrderAmount),
    };
}

export function validateRestaurantFreeDelivery(raw = {}) {
    const setting = normalizeRestaurantFreeDelivery(raw);
    // Only a custom rule has numbers worth checking. Inherit and off carry
    // whatever was last typed, so validating them would block saving an opt-out.
    if (setting.mode !== 'custom') return { ok: true, reason: '', setting };

    const verdict = validateFreeDeliveryRule({ ...setting, isEnabled: true });
    return { ok: verdict.ok, reason: verdict.reason, setting };
}

/**
 * Which rule actually governs this order, and where it came from.
 *
 * A restaurant's own setting wins outright when it is not 'inherit'. That means
 * an explicit 'off' beats an enabled platform rule -- an admin excluding one
 * restaurant expects that exclusion to hold, not to be overridden by the global
 * switch it was written against.
 *
 * `source` is returned so the order can record which rule paid for the trip;
 * reconciliation needs to tell a platform promotion from a per-restaurant one.
 */
export function resolveEffectiveFreeDeliveryRule({ restaurant = null, platform = null } = {}) {
    const setting = normalizeRestaurantFreeDelivery(restaurant);

    if (setting.mode === 'off') {
        return { rule: { ...DEFAULT_FREE_DELIVERY_RULE, isEnabled: false }, source: 'restaurant_off' };
    }

    if (setting.mode === 'custom') {
        return {
            rule: {
                isEnabled: true,
                maxDistanceKm: setting.maxDistanceKm,
                minOrderAmount: setting.minOrderAmount,
            },
            source: 'restaurant',
        };
    }

    const platformRule = normalizeFreeDeliveryRule(platform);
    return { rule: platformRule, source: platformRule.isEnabled ? 'platform' : 'none' };
}

/** Menu and checkout copy: "Free delivery within 3 km on orders over ₹300". */
export function describeFreeDeliveryRule(raw = null) {
    const rule = normalizeFreeDeliveryRule(raw);
    if (!rule.isEnabled) return '';
    return `Free delivery within ${rule.maxDistanceKm} km on orders of ₹${rule.minOrderAmount} or more`;
}

/**
 * How much more the customer needs to spend to earn it, when they are already
 * close enough. Returns null when the rule cannot apply at this distance, so the
 * checkout never nudges toward something unreachable.
 */
export function describeFreeDeliveryGap({ rule, distanceKm, subtotal } = {}) {
    const normalized = normalizeFreeDeliveryRule(rule);
    if (!normalized.isEnabled) return null;

    if (isUnmeasured(distanceKm)) return null;
    const km = Number(distanceKm);
    if (!Number.isFinite(km) || km < 0 || km > normalized.maxDistanceKm) return null;

    const value = Number(subtotal) || 0;
    if (value >= normalized.minOrderAmount) return null;

    const shortBy = Math.round((normalized.minOrderAmount - value) * 100) / 100;
    return { shortBy, minOrderAmount: normalized.minOrderAmount, maxDistanceKm: normalized.maxDistanceKm };
}
