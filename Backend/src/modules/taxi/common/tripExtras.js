/**
 * The parts of a taxi fare that sit beside the distance-and-time fare:
 * round trips, night charges, extra kilometres, tolls and the stops a ride
 * passes through (SOW plan §4.1-4.5).
 *
 * Pure functions only, so the quote, the booking, completion and the checks all
 * agree and can be tested without a database.
 *
 * Every setting here reads from the vehicle's price row (SetPrice), and every
 * default keeps today's fare: a row nobody has touched prices a one-way ride
 * with no night charge and no extra-km charge.
 */
import { localClock, parseTime } from './surgeSlot.js';
import { MAX_STOPS } from './tripMeasure.js';

const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const nonNegative = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
};

/* ----------------------------------------------------------------- stops -- */

/**
 * The stops a rider asked for, in order, as the ride stores them:
 * { address, lat, lng, order, reachedAt }.
 *
 * Accepts the shapes the apps send: { lat, lng }, { latitude, longitude },
 * { location: [lng, lat] } or { coordinates: [lng, lat] }, each with an
 * optional address. A stop with no usable coordinate is dropped -- it cannot be
 * priced or navigated to, and the trip measure (tripMeasure.normalizeStops)
 * drops it too, so what is stored is exactly what was priced.
 */
export const normalizeRideStops = (stops) => {
    const list = Array.isArray(stops) ? stops : [];
    const out = [];
    for (const stop of list) {
        if (!stop || typeof stop !== 'object') continue;
        const pair = Array.isArray(stop.location)
            ? stop.location
            : Array.isArray(stop.coordinates) ? stop.coordinates : null;
        const lat = Number(pair ? pair[1] : (stop.lat ?? stop.latitude));
        const lng = Number(pair ? pair[0] : (stop.lng ?? stop.longitude));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
        out.push({
            address: String(stop.address || stop.label || stop.title || '').trim().slice(0, 300),
            lat,
            lng,
            order: out.length + 1,
            reachedAt: null,
        });
        if (out.length >= MAX_STOPS) break;
    }
    return out;
};

/* ------------------------------------------------------------ round trip -- */

export const TRIP_TYPES = Object.freeze(['one_way', 'round_trip']);
export const ROUND_TRIP_MAX_DAYS = 7;

export const normalizeTripType = (value) =>
    String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_') === 'round_trip' ? 'round_trip' : 'one_way';

/** The admin's round-trip factors from a price row, with today's defaults. */
export const roundTripSettings = (pricingRule = {}) => ({
    // The return leg as a share of the outbound trip fare: 1 = same again,
    // 0.8 = 20% off the way back.
    returnFactor: nonNegative(pricingRule?.round_trip_return_factor, 1),
    // Waiting at the destination before the return that costs nothing.
    waitFreeMinutes: nonNegative(pricingRule?.round_trip_wait_free_minutes, 60),
    // Each started hour of waiting beyond that.
    waitPerHour: nonNegative(pricingRule?.round_trip_wait_per_hour, 0),
});

/**
 * Minutes the driver waits at the destination: from when the outbound trip
 * should arrive (departure + its duration) to the return time the rider chose.
 * No return time means the driver turns straight round.
 */
export const roundTripWaitMinutes = ({ departAt = new Date(), durationMinutes = 0, returnAt = null } = {}) => {
    if (!returnAt) return 0;
    const arrive = new Date(departAt).getTime() + nonNegative(durationMinutes) * 60000;
    const back = new Date(returnAt).getTime();
    if (!Number.isFinite(arrive) || !Number.isFinite(back)) return 0;
    return Math.max(0, (back - arrive) / 60000);
};

/**
 * Checks a round trip's return time. Returns null when it is fine, or the
 * message to refuse the booking with.
 */
export const validateReturnAt = ({ departAt = new Date(), durationMinutes = 0, returnAt } = {}) => {
    if (!returnAt) return null;
    const back = new Date(returnAt).getTime();
    if (!Number.isFinite(back)) return 'returnAt is invalid';
    const depart = new Date(departAt).getTime();
    if (back < depart + nonNegative(durationMinutes) * 60000) {
        return 'The return time must be after you reach the destination';
    }
    if (back > depart + ROUND_TRIP_MAX_DAYS * 24 * 60 * 60000) {
        return `A round trip can return within ${ROUND_TRIP_MAX_DAYS} days`;
    }
    return null;
};

export const roundTripWaitingAllowance = ({ waitMinutes = 0, settings }) => {
    const chargeable = Math.max(0, nonNegative(waitMinutes) - settings.waitFreeMinutes);
    return money(Math.ceil(chargeable / 60) * settings.waitPerHour);
};

/* ---------------------------------------------------------- night charge -- */

/** The night charge from a price row, or null when it is switched off. */
export const nightChargeSettings = (pricingRule = {}) => {
    const night = pricingRule?.night_charge;
    if (!night || night.enabled !== true) return null;
    const start = parseTime(night.start);
    const end = parseTime(night.end);
    const value = nonNegative(night.value);
    if (start === null || end === null || start === end || !(value > 0)) return null;
    return {
        start,
        end,
        type: String(night.type || '').toLowerCase() === 'fixed' ? 'fixed' : 'percentage',
        value,
        label: `${night.start}-${night.end}`,
    };
};

/**
 * Whether `at` falls in the night window, read on the wall clock of the surge
 * timezone (Asia/Kolkata). An end at or before the start runs past midnight:
 * 22:00-06:00 covers 22:00 to 05:59 the next morning.
 */
export const isNightTime = (settings, at = new Date()) => {
    if (!settings) return false;
    const { minute } = localClock(at);
    return settings.end > settings.start
        ? minute >= settings.start && minute < settings.end
        : minute >= settings.start || minute < settings.end;
};

/** The night charge on a ride subtotal priced for a pickup at `at`. */
export const computeNightCharge = ({ pricingRule, subtotal = 0, at = new Date() }) => {
    const settings = nightChargeSettings(pricingRule);
    if (!settings || !isNightTime(settings, at)) return 0;
    return money(settings.type === 'fixed' ? settings.value : (nonNegative(subtotal) * settings.value) / 100);
};

/* ------------------------------------------------------------- extra km -- */

/** The extra-km rule from a price row, or null when it is switched off. */
export const extraKmSettings = (pricingRule = {}) => {
    const rule = pricingRule?.extra_km_charge;
    if (!rule || rule.enabled !== true) return null;
    return {
        toleranceType: String(rule.tolerance_type || '').toLowerCase() === 'km' ? 'km' : 'percent',
        toleranceValue: nonNegative(rule.tolerance_value, 10),
    };
};

/**
 * Kilometres driven beyond what the rider was quoted, past the admin's
 * tolerance, at the per-km rate.
 *
 * Charged only from a trace the server trusts (see rideService's trip trace):
 * with no trace, or one with holes in it, nothing extra is charged -- a
 * guessed distance is not a reason to bill anyone.
 */
export const computeExtraKmCharge = ({ settings, quotedMeters = 0, tracedMeters = 0, traceReliable = false, perKm = 0 }) => {
    const none = { extraKm: 0, amount: 0, allowanceKm: 0 };
    if (!settings || !traceReliable) return none;
    const quotedKm = nonNegative(quotedMeters) / 1000;
    const tracedKm = nonNegative(tracedMeters) / 1000;
    const allowanceKm = settings.toleranceType === 'km'
        ? settings.toleranceValue
        : (quotedKm * settings.toleranceValue) / 100;
    const extraKm = tracedKm - quotedKm - allowanceKm;
    if (!(extraKm > 0) || !(perKm > 0)) return { ...none, allowanceKm: money(allowanceKm) };
    // Charged on the km beyond the allowance, rounded to 0.1 km.
    const roundedKm = Math.round(extraKm * 10) / 10;
    return { extraKm: roundedKm, amount: money(roundedKm * perKm), allowanceKm: money(allowanceKm) };
};

/* ----------------------------------------------------------------- tolls -- */

export const TOLL_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);
export const MAX_TOLLS_PER_RIDE = 20;
export const MAX_TOLL_AMOUNT = 5000;

/**
 * Whether a new toll is approved on the spot: the ride's auto-approved tolls,
 * this one included, stay within the admin's per-ride limit. A limit of 0
 * (the default) approves nothing automatically.
 */
export const shouldAutoApproveToll = ({ tolls = [], amount = 0, limit = 0 }) => {
    const cap = nonNegative(limit);
    if (!(cap > 0)) return false;
    const already = tolls
        .filter((toll) => toll?.status === 'approved' && toll?.autoApproved)
        .reduce((sum, toll) => sum + nonNegative(toll.amount), 0);
    return already + nonNegative(amount) <= cap;
};

/** The approved tolls on a ride: the separate toll line on the fare. */
export const approvedTollTotal = (tolls = []) => money(
    (Array.isArray(tolls) ? tolls : [])
        .filter((toll) => toll?.status === 'approved')
        .reduce((sum, toll) => sum + nonNegative(toll.amount), 0),
);
