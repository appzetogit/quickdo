import { ValidationError } from '../../../../../core/auth/errors.js';
import { isMedicalStore } from './storeType.js';

/**
 * Sending one prescription to every pharmacy nearby, and letting the first to
 * answer take it.
 *
 * There are two ways to order medicine, and they are not variations of each
 * other:
 *
 *   - DIRECT. The customer picks a pharmacy and sends the prescription to it.
 *     That order belongs to that shop and reaches nobody else, whatever else is
 *     open nearby. This is the older path (createPrescriptionOrder) and it
 *     stays exactly as it was.
 *
 *   - BROADCAST. The customer does not know or care which shop fills it, so the
 *     prescription is offered to every pharmacy within range at once and the
 *     first to accept gets it. Until one does, no order exists.
 *
 * The distinction matters commercially -- a customer who chose a shop expects
 * that shop -- and medically: a prescription is a health record, so a broadcast
 * shows it to more people than a direct order does. That is the customer's
 * decision to make, which is why the two are separate calls rather than one
 * call with an optional seller.
 *
 * Range is the admin's, not the shop's and not the customer's: the platform
 * decides how far a prescription may travel, because that is a delivery-time
 * and a liability question. See admin/models/medicalSettings.model.js.
 *
 * Pure, so the same rules serve the customer's request, the pharmacy queue, the
 * claim and the admin panel without a database.
 */

export const REQUEST_STATUS = Object.freeze({
    OPEN: 'open',
    CLAIMED: 'claimed',
    EXPIRED: 'expired',
    CANCELLED: 'cancelled',
});

/**
 * How far a broadcast may travel, in kilometres.
 *
 * Five is a delivery radius, not a map radius: a rider carries medicine that
 * far in a reasonable time in the towns this runs in. The admin may widen or
 * narrow it; the bounds exist so a typed zero cannot silently mean "nowhere"
 * and a typed 500 cannot mean "the whole state".
 */
export const DEFAULT_REQUEST_RADIUS_KM = 5;
export const MIN_REQUEST_RADIUS_KM = 0.5;
export const MAX_REQUEST_RADIUS_KM = 50;

/**
 * How long a broadcast stays open.
 *
 * A prescription nobody answered has to stop being offered: the customer is
 * waiting, and a shop opening hours later should not be able to accept what the
 * customer has long since bought elsewhere.
 */
export const DEFAULT_REQUEST_EXPIRY_MINUTES = 30;
export const MIN_REQUEST_EXPIRY_MINUTES = 5;
export const MAX_REQUEST_EXPIRY_MINUTES = 720;

const clampNumber = (value, { min, max, fallback, label }) => {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) {
        throw new ValidationError(`${label} must be a number`);
    }
    if (n < min || n > max) {
        throw new ValidationError(`${label} must be between ${min} and ${max}`);
    }
    return n;
};

export const normalizeRadiusKm = (value) => clampNumber(value, {
    min: MIN_REQUEST_RADIUS_KM,
    max: MAX_REQUEST_RADIUS_KM,
    fallback: DEFAULT_REQUEST_RADIUS_KM,
    label: 'Delivery range',
});

export const normalizeExpiryMinutes = (value) => clampNumber(value, {
    min: MIN_REQUEST_EXPIRY_MINUTES,
    max: MAX_REQUEST_EXPIRY_MINUTES,
    fallback: DEFAULT_REQUEST_EXPIRY_MINUTES,
    label: 'Request timeout',
});

const EARTH_RADIUS_KM = 6371;
const toRadians = (deg) => (Number(deg) * Math.PI) / 180;

/**
 * A coordinate, or null -- never a coordinate invented from nothing.
 *
 * `Number(null)` is 0 and `Number('')` is 0, so the obvious Number.isFinite
 * guard turns a missing latitude into the equator. A shop with no location
 * saved would then sit at 0N 0E, which is in the Atlantic and therefore out of
 * range of everywhere -- until the customer is also missing a coordinate, at
 * which point the two agree perfectly and the distance is zero.
 */
const coord = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

/**
 * Great-circle distance in kilometres.
 *
 * Straight-line, not road distance, which always understates the ride. The
 * radius the admin types is therefore a generous one; using it to *exclude* a
 * shop is the safe direction of that error, since a shop excluded by crow-flight
 * would have been further still by road.
 */
export function distanceKm(from, to) {
    const lat1 = coord(from?.lat);
    const lng1 = coord(from?.lng);
    const lat2 = coord(to?.lat);
    const lng2 = coord(to?.lng);
    if ([lat1, lng1, lat2, lng2].some((v) => v === null)) return null;

    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
    return Math.round(EARTH_RADIUS_KM * 2 * Math.asin(Math.min(1, Math.sqrt(a))) * 100) / 100;
}

/** The [lng, lat] a seller document carries, in the shape this module reads. */
export function sellerPoint(seller) {
    const coords = seller?.location?.coordinates;
    if (Array.isArray(coords) && coords.length === 2) {
        const lng = coord(coords[0]);
        const lat = coord(coords[1]);
        if (lat !== null && lng !== null) return { lat, lng };
    }
    const lat = coord(seller?.location?.latitude ?? seller?.latitude);
    const lng = coord(seller?.location?.longitude ?? seller?.longitude);
    if (lat !== null && lng !== null) return { lat, lng };
    return null;
}

/**
 * The pharmacies a broadcast should reach, nearest first.
 *
 * Every exclusion here is deliberate and none of them is cosmetic:
 *
 *   - not a pharmacy: a grocery cannot dispense medicine, and showing it a
 *     prescription would put a health record in front of a shop with no reason
 *     to see one;
 *   - not approved, or not accepting orders: it cannot fill the order, so
 *     offering it the prescription only delays the customer;
 *   - no saved location: it cannot be placed on the map, and a shop that might
 *     be anywhere is not "within range";
 *   - beyond the radius: the admin's rule, applied literally.
 *
 * `isOpen` is passed in rather than computed, because opening hours need the
 * seller's timetable and a clock, and this stays pure.
 */
export function pharmaciesInRange(sellers = [], point, radiusKm, { isOpen = () => true } = {}) {
    const limit = Number(radiusKm);
    if (!Number.isFinite(limit) || limit <= 0) return [];
    if (coord(point?.lat) === null || coord(point?.lng) === null) return [];

    return sellers
        .map((seller) => {
            if (!isMedicalStore(seller?.storeType)) return null;
            if (String(seller?.status || '').toLowerCase() !== 'approved') return null;
            if (seller?.isAcceptingOrders === false) return null;
            if (!isOpen(seller)) return null;
            const at = sellerPoint(seller);
            if (!at) return null;
            const km = distanceKm(point, at);
            if (km === null || km > limit) return null;
            return {
                pharmacyId: seller._id,
                name: String(seller.restaurantName || seller.name || 'Pharmacy'),
                distanceKm: km,
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * What a stored request actually is right now.
 *
 * A request written as open goes on saying so until something reads it, so
 * expiry is decided against the clock rather than trusted from the field. The
 * stored value is still corrected when convenient -- the admin panel would
 * otherwise show a queue of open requests nobody can accept -- but no decision
 * anywhere depends on that having happened.
 */
export function effectiveStatus(request, now = new Date()) {
    const stored = String(request?.status || '').toLowerCase();
    if (stored !== REQUEST_STATUS.OPEN) return stored || REQUEST_STATUS.OPEN;
    const expiresAt = request?.expiresAt ? new Date(request.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= now.getTime()) return REQUEST_STATUS.EXPIRED;
    return REQUEST_STATUS.OPEN;
}

/** Whether this pharmacy was one of the shops the request went to. */
export function wasInvited(request, pharmacyId) {
    const id = String(pharmacyId || '');
    if (!id) return false;
    return (request?.invited || []).some((row) => String(row?.pharmacyId) === id);
}

/** Whether this pharmacy has already passed on it. */
export function hasDeclined(request, pharmacyId) {
    const id = String(pharmacyId || '');
    if (!id) return false;
    return (request?.declinedBy || []).some((row) => String(row) === id);
}

/**
 * Whether this pharmacy may take this request, with the reason when it may not.
 *
 * The reasons are worth separating because they read very differently to the
 * pharmacist: "somebody else got there first" is ordinary and happens all day,
 * while "you were not sent this" means something is wrong with the queue they
 * are looking at.
 */
export function assertClaimable(request, pharmacyId, now = new Date()) {
    if (!request) throw new ValidationError('That request no longer exists');
    if (!wasInvited(request, pharmacyId)) {
        throw new ValidationError('This request was not sent to your pharmacy');
    }
    const status = effectiveStatus(request, now);
    if (status === REQUEST_STATUS.CLAIMED) {
        throw new ValidationError('Another pharmacy has already accepted this prescription');
    }
    if (status === REQUEST_STATUS.EXPIRED) {
        throw new ValidationError('This request has expired');
    }
    if (status === REQUEST_STATUS.CANCELLED) {
        throw new ValidationError('The customer cancelled this request');
    }
    return true;
}
