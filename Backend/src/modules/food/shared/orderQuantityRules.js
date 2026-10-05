import { ValidationError } from '../../../core/auth/errors.js';

/**
 * Per-menu-item order quantity limits, set by the restaurant (or admin) on the item.
 *
 *   minOrderQuantity — smallest quantity a customer may order (default 1).
 *                      e.g. Rasgulla priced per piece with a minimum of 4.
 *   maxOrderQuantity — largest quantity per order; 0 means "no item-specific cap",
 *                      in which case the platform ceiling below applies.
 *
 * Enforced server-side at every write: cart add, cart update, cart hydrate, and
 * order creation. The UIs mirror these rules but are never the authority.
 */

export const DEFAULT_MIN_ORDER_QUANTITY = 1;
/** Platform ceiling; also the cart's hard per-line cap. */
export const ABSOLUTE_MAX_ORDER_QUANTITY = 99;

const toInt = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? Math.floor(num) : NaN;
};

/**
 * Effective limits for a stored menu item.
 * `max` is always a usable number (the ceiling when the item sets no cap).
 */
/**
 * `ceiling` is the platform-wide cap, which an admin can now set under fee
 * settings (maxOrderQuantityCeiling). It defaults to the constant this module
 * has always used, so a caller that does not pass one behaves exactly as before
 * and an unset setting changes nothing.
 */
export const resolveCeiling = (ceiling) => {
    const value = toInt(ceiling);
    return Number.isFinite(value) && value > 0 ? value : ABSOLUTE_MAX_ORDER_QUANTITY;
};

/**
 * A dish's sizes do not sell alike. A half plate may go out in ones while a
 * family pack is capped at two, and a per-piece size may carry a minimum the
 * boxed size should not inherit. So a variant may set its own limits.
 *
 * Each bound falls back to the dish INDEPENDENTLY: a variant that sets only a
 * maximum keeps the dish's minimum. All-or-nothing fallback would silently
 * reset a minimum somebody had deliberately set on the dish.
 *
 * null (or absent) means "this size sets none". Zero keeps the meaning it has
 * everywhere else here -- for a max it means no cap of its own.
 */
export function resolveVariantQuantityLimits(foodDoc = null, variantId = null) {
    const fallback = {
        minOrderQuantity: foodDoc?.minOrderQuantity,
        maxOrderQuantity: foodDoc?.maxOrderQuantity,
    };
    if (!variantId) return fallback;

    // A dish with variants switched off prices and limits from its own fields,
    // whatever the stored rows still say -- the same rule pricing follows.
    if (foodDoc?.variantsEnabled === false) return fallback;

    const rows = Array.isArray(foodDoc?.variants) ? foodDoc.variants : [];
    const variant = rows.find((v) => String(v?._id ?? v?.id ?? '') === String(variantId));
    if (!variant) return fallback;

    return {
        minOrderQuantity: variant.minOrderQuantity ?? fallback.minOrderQuantity,
        maxOrderQuantity: variant.maxOrderQuantity ?? fallback.maxOrderQuantity,
    };
}

/**
 * `variantId` is optional and defaults to the dish-level behaviour, so every
 * existing caller is unaffected.
 */
export function resolveOrderQuantityRules(foodDoc = null, ceiling = ABSOLUTE_MAX_ORDER_QUANTITY, variantId = null) {
    const cap = resolveCeiling(ceiling);
    const limits = resolveVariantQuantityLimits(foodDoc, variantId);

    const rawMin = toInt(limits.minOrderQuantity);
    const hasMin = Number.isFinite(rawMin) && rawMin > 0;
    const min = hasMin
        ? Math.min(rawMin, cap)
        : DEFAULT_MIN_ORDER_QUANTITY;

    const rawMax = toInt(limits.maxOrderQuantity);
    const hasCap = Number.isFinite(rawMax) && rawMax > 0;
    const max = hasCap
        ? Math.min(Math.max(rawMax, min), cap)
        : cap;

    // Carried on the result so assertOrderQuantity can enforce the platform cap
    // for items that set no cap of their own, without every caller having to
    // pass the ceiling twice.
    return { min, max, hasMin, hasCap, ceiling: cap };
}

/**
 * Stored shape to hand to clients. 0 means "not set" on BOTH ends -- max 0 is
 * unlimited, min 0 is no minimum -- so an editor can show what was actually
 * saved rather than the effective figure.
 *
 * Returning the effective min here meant a dish with no minimum came back as 1
 * and the form redisplayed 1, so 0 could never be entered and never stayed.
 * Ordering is unaffected: resolveOrderQuantityRules still yields an effective
 * min of 1, because nobody can order zero of something.
 */
export function formatOrderQuantityLimits(foodDoc = null, ceiling = ABSOLUTE_MAX_ORDER_QUANTITY, variantId = null) {
    const { min, max, hasMin, hasCap } = resolveOrderQuantityRules(foodDoc, ceiling, variantId);
    return {
        minOrderQuantity: hasMin ? min : 0,
        maxOrderQuantity: hasCap ? max : 0
    };
}

/** Pull a quantity into range. Used when limits change under an existing cart. */
export function clampOrderQuantity(quantity, rules) {
    const { min, max } = rules || resolveOrderQuantityRules(null);
    const qty = toInt(quantity);
    if (!Number.isFinite(qty)) return min;
    return Math.min(max, Math.max(min, qty));
}

/**
 * Hard gate for explicit writes (cart update, checkout). Throws a message the
 * customer can act on rather than silently changing what they asked for.
 */
export function assertOrderQuantity(quantity, rules, label = 'This item') {
    const { min, max, hasCap } = rules || resolveOrderQuantityRules(null);
    const qty = toInt(quantity);

    if (!Number.isFinite(qty) || qty <= 0) {
        throw new ValidationError(`Enter a valid quantity for "${label}"`);
    }
    if (qty < min) {
        throw new ValidationError(
            `You need to order at least ${min} of "${label}".`,
            'MIN_ORDER_QUANTITY'
        );
    }
    if (hasCap && qty > max) {
        throw new ValidationError(
            `You can order at most ${max} of "${label}".`,
            'MAX_ORDER_QUANTITY'
        );
    }
    // The platform cap, which also covers items that set no cap of their own --
    // for those, hasCap is false and the check above never fires.
    const platformCap = resolveCeiling(rules?.ceiling);
    if (qty > platformCap) {
        throw new ValidationError(
            `You can order at most ${platformCap} of "${label}" in a single order.`,
            'MAX_ORDER_QUANTITY'
        );
    }
    return qty;
}

/**
 * Menu-item form input (restaurant/admin). Returns undefined for each field the
 * caller didn't send, so partial updates never reset a stored limit.
 */
export function normalizeOrderQuantityInput(body = {}, { label = 'This item', ceiling = ABSOLUTE_MAX_ORDER_QUANTITY } = {}) {
    const update = {};
    const cap = resolveCeiling(ceiling);

    if (body.minOrderQuantity !== undefined && body.minOrderQuantity !== null && body.minOrderQuantity !== '') {
        const min = toInt(body.minOrderQuantity);
        // 0 is allowed and means "no minimum", matching what 0 already means for
        // the maximum. Negative is still nonsense.
        if (!Number.isFinite(min) || min < 0) {
            throw new ValidationError(
                `"${label}": the smallest order quantity cannot be negative. Use 0 for no minimum.`
            );
        }
        if (min > cap) {
            throw new ValidationError(
                `"${label}": the smallest order quantity cannot be more than ${cap}, `
                + `which is the platform limit right now. An admin can change it under Fee Settings.`
            );
        }
        update.minOrderQuantity = min;
    } else if (body.minOrderQuantity === null || body.minOrderQuantity === '') {
        update.minOrderQuantity = DEFAULT_MIN_ORDER_QUANTITY;
    }

    if (body.maxOrderQuantity !== undefined && body.maxOrderQuantity !== null && body.maxOrderQuantity !== '') {
        const max = toInt(body.maxOrderQuantity);
        if (!Number.isFinite(max) || max < 0) {
            throw new ValidationError(
                `"${label}": the largest order quantity must be 0 or more. Use 0 for no limit.`
            );
        }
        if (max > cap) {
            throw new ValidationError(
                `"${label}": the largest order quantity can be at most ${cap} — that is the `
                + `platform limit right now. Enter ${cap} or less, or 0 for no limit. `
                + `An admin can raise the limit under Fee Settings.`
            );
        }
        update.maxOrderQuantity = max;
    } else if (body.maxOrderQuantity === null || body.maxOrderQuantity === '') {
        update.maxOrderQuantity = 0;
    }

    return Object.keys(update).length ? update : undefined;
}

/**
 * Cross-field check against the values that will actually be stored (incoming
 * merged over existing), so "max below min" can't slip through a partial update.
 */
export function assertOrderQuantityRange(nextValues = {}, { label = 'This item' } = {}) {
    const min = toInt(nextValues.minOrderQuantity) || DEFAULT_MIN_ORDER_QUANTITY;
    const max = toInt(nextValues.maxOrderQuantity) || 0;
    if (max > 0 && max < min) {
        throw new ValidationError(
            `Maximum order quantity for "${label}" must be greater than or equal to the minimum (${min})`
        );
    }
}
