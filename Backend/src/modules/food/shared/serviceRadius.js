/**
 * How far a restaurant delivers: "we serve within 10 km of the kitchen."
 *
 * One rule, one place. The number lives on the restaurant document
 * (`serviceRadiusKm`) and nowhere else. The restaurant app and the admin panel
 * both write it through the same service (restaurant/services/serviceRadius.
 * service.js), which validates it here, so neither side can store something the
 * other would have refused. Everything that reads it -- the customer listing,
 * the cart quote, order placement -- resolves it here too, so a restaurant can
 * never be listed by one rule and refused by another.
 *
 * The radius narrows the zone; it does not replace it. An address still has to
 * be inside the zone the admin drew AND within the restaurant's radius.
 *
 * Unset (null) is what every restaurant had before this existed and means "no
 * radius of our own -- the zone decides", so adding the field changes no
 * listing and refuses no order until somebody deliberately sets it.
 *
 * The platform ceiling (`maxRadiusKm`) is admin-owned. It bounds what can be
 * saved, and it also bounds what is enforced: an admin who lowers the ceiling
 * to 8 km does not have to chase every restaurant that had saved 12 -- they are
 * served at 8 until they choose otherwise, and their own 12 is kept, so raising
 * the ceiling again restores it.
 *
 * This module is pure -- no database, no request -- so the rule can be tested
 * on its own.
 */

export const SERVICE_RADIUS_LIMITS = Object.freeze({
    /** Below this a typo (0.1 for 10) would hide a restaurant from nearly everyone. */
    MIN_KM: 1,
    /** The ceiling when an admin has never set one. */
    DEFAULT_MAX_KM: 20,
    /** The highest ceiling an admin may set. A radius wider than this is not a radius. */
    ABSOLUTE_MAX_KM: 100,
});

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** "Nothing entered" -- which, for a radius, means no radius. */
const isBlank = (value) => value === null || value === undefined || value === '';

/** Fill in whatever the settings document is missing. */
export function normalizeServiceRadiusSettings(raw = null) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const max = Number(source.maxRadiusKm);
    return {
        maxRadiusKm: Number.isFinite(max)
            && max >= SERVICE_RADIUS_LIMITS.MIN_KM
            && max <= SERVICE_RADIUS_LIMITS.ABSOLUTE_MAX_KM
            ? round2(max)
            : SERVICE_RADIUS_LIMITS.DEFAULT_MAX_KM,
    };
}

/** Validate the platform ceiling an admin typed. Returns a reason rather than throwing. */
export function validateServiceRadiusSettings(raw = {}) {
    const max = Number(raw?.maxRadiusKm);
    if (isBlank(raw?.maxRadiusKm) || !Number.isFinite(max)) {
        return { ok: false, reason: 'Enter the largest delivery radius a restaurant may set, in km.' };
    }
    if (max < SERVICE_RADIUS_LIMITS.MIN_KM) {
        return { ok: false, reason: `The largest radius must be at least ${SERVICE_RADIUS_LIMITS.MIN_KM} km.` };
    }
    if (max > SERVICE_RADIUS_LIMITS.ABSOLUTE_MAX_KM) {
        return { ok: false, reason: `The largest radius cannot be more than ${SERVICE_RADIUS_LIMITS.ABSOLUTE_MAX_KM} km.` };
    }
    return { ok: true, reason: '', settings: { maxRadiusKm: round2(max) } };
}

/**
 * Validate a radius a restaurant or an admin typed.
 *
 * Blank clears it (back to "the zone decides"). Anything else must be a number
 * between the minimum and the platform ceiling. The same bounds apply to both
 * sides on purpose: if an admin could save 30 km under a 20 km ceiling, the
 * restaurant would open its own settings, see a value it is not allowed to
 * save, and be unable to change anything else on that screen.
 */
export function validateServiceRadius(value, settings = null) {
    if (isBlank(value)) return { ok: true, reason: '', radiusKm: null };

    const { maxRadiusKm } = normalizeServiceRadiusSettings(settings);
    const km = typeof value === 'boolean' ? NaN : Number(value);

    if (!Number.isFinite(km)) {
        return { ok: false, reason: 'Enter the delivery radius as a number of km.' };
    }
    if (km < SERVICE_RADIUS_LIMITS.MIN_KM) {
        return { ok: false, reason: `The delivery radius must be at least ${SERVICE_RADIUS_LIMITS.MIN_KM} km.` };
    }
    if (km > maxRadiusKm) {
        return { ok: false, reason: `The delivery radius cannot be more than ${maxRadiusKm} km.` };
    }
    return { ok: true, reason: '', radiusKm: round2(km) };
}

/**
 * The radius actually enforced for this restaurant today.
 *
 * A restaurant that saved no radius of its own gets the platform's
 * (`isDefault`). It used to get none at all -- "only the zone applies" -- so
 * the admin's radius setting bound one restaurant in seven: with 15 km set, six
 * restaurants still listed and delivered at any distance, which is the reverse
 * of what anyone setting a delivery radius means. A restaurant's own radius can
 * only narrow it.
 *
 * `capped` is true when the platform ceiling is holding it below what it saved,
 * so both panels can say so instead of showing a number that is not in force.
 */
export function resolveEffectiveServiceRadius({ restaurantRadiusKm = null, settings = null } = {}) {
    const { maxRadiusKm } = normalizeServiceRadiusSettings(settings);
    const saved = isBlank(restaurantRadiusKm) ? NaN : Number(restaurantRadiusKm);

    if (!Number.isFinite(saved) || saved <= 0) {
        return { radiusKm: maxRadiusKm, savedRadiusKm: null, maxRadiusKm, capped: false, isDefault: true };
    }
    const radiusKm = round2(Math.min(saved, maxRadiusKm));
    return { radiusKm, savedRadiusKm: round2(saved), maxRadiusKm, capped: radiusKm < saved, isDefault: false };
}

/**
 * Does this restaurant deliver to this address?
 *
 * Judged on the SAME road distance the delivery fee was priced from, so a cart
 * that shows "8.4 km" can never be refused by a 10 km restaurant because the
 * check measured something else.
 *
 * A distance that was never measured (no delivery coordinates, no restaurant
 * coordinates) does NOT pass when a radius is set. Number(null) is 0, and
 * treating "unknown" as "zero kilometres away" would let every geocoding
 * failure through the one check the restaurant asked for.
 *
 * Inclusive at the edge: "within 10 km" is read that way by the restaurant
 * that set it and by the customer 10.0 km away.
 */
export function judgeServiceRadius({ radiusKm = null, distanceKm = null, measured = true } = {}) {
    const limit = isBlank(radiusKm) ? NaN : Number(radiusKm);
    if (!Number.isFinite(limit) || limit <= 0) {
        return { applies: false, deliverable: true, radiusKm: null, distanceKm: toKm(distanceKm), reason: '' };
    }

    const km = measured ? toKm(distanceKm) : null;
    if (km === null) {
        return {
            applies: true,
            deliverable: false,
            radiusKm: round2(limit),
            distanceKm: null,
            code: 'DISTANCE_UNKNOWN',
            reason: `This restaurant only delivers within ${round2(limit)} km, and we could not work out how far your address is. Please pick a delivery address with a location.`,
        };
    }
    if (km > limit) {
        return {
            applies: true,
            deliverable: false,
            radiusKm: round2(limit),
            distanceKm: km,
            code: 'OUTSIDE_SERVICE_RADIUS',
            reason: `This restaurant only delivers within ${round2(limit)} km. Your address is ${km} km away.`,
        };
    }
    return { applies: true, deliverable: true, radiusKm: round2(limit), distanceKm: km, reason: '' };
}

function toKm(value) {
    if (isBlank(value) || typeof value === 'boolean') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? round2(n) : null;
}
