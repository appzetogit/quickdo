/**
 * When an outlet is actually trading.
 *
 * The hours were being collected and never consulted. A restaurant set
 * "09:00-22:00, closed Sunday" in its panel, and the customer app listed it as
 * orderable at four in the morning on a Sunday, because every public endpoint
 * filtered on `status: 'approved'` and nothing else.
 *
 * Two places have claimed to hold the hours:
 *
 *   food_restaurant_outlet_timings   per-day rows the restaurant panel writes
 *   restaurant.openingTime/closingTime/openDays   older flat fields
 *
 * The per-day rows win where they exist, because that is the form the panel
 * edits today; the flat fields are the fallback for a restaurant that has never
 * opened that screen. A restaurant with neither is treated as open, which is
 * what every one of them effectively was until now -- refusing orders on the
 * strength of hours nobody has entered would take shops offline that are
 * trading perfectly well.
 *
 * Windows are wall-clock times in the restaurant's city and the server runs
 * UTC, so every comparison goes through the same timezone helpers the per-item
 * schedules use. Overnight hours (18:00-02:00) work for the same reason: they
 * were already solved once for items, and solving them a second time here is
 * how the two would drift.
 */

import {
    DAY_NAMES,
    DEFAULT_ITEM_TIMEZONE,
    getZonedDayAndMinutes,
    normalizeDayName,
    normalizeTimeOfDay,
} from './itemAvailability.js';

export const DEFAULT_OUTLET_TIMEZONE = DEFAULT_ITEM_TIMEZONE;

const toMinutes = (value) => {
    const hhmm = normalizeTimeOfDay(value, null);
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};

const previousDay = (day) => DAY_NAMES[(DAY_NAMES.indexOf(day) + 6) % 7];

const pad = (n) => String(n).padStart(2, '0');
const fromMinutes = (mins) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

/**
 * The per-day rows for a restaurant, from whichever source has them.
 *
 * Returns null when the restaurant has said nothing about its hours, which
 * callers must read as "always open" rather than "closed".
 */
export function resolveOutletSchedule({ timingsDoc = null, restaurant = null } = {}) {
    const rows = Array.isArray(timingsDoc?.timings) ? timingsDoc.timings : [];
    const usable = rows
        .map((row) => ({
            day: normalizeDayName(row?.day),
            isOpen: row?.isOpen !== false,
            openingTime: normalizeTimeOfDay(row?.openingTime, null),
            closingTime: normalizeTimeOfDay(row?.closingTime, null),
        }))
        .filter((row) => row.day);

    if (usable.length) return usable;

    /*
     * The older flat fields. `openDays` is a list of day names; absent means
     * every day, which is what a restaurant that only ever set opening and
     * closing times meant by it.
     */
    const open = normalizeTimeOfDay(restaurant?.openingTime, null);
    const close = normalizeTimeOfDay(restaurant?.closingTime, null);
    if (!open || !close) return null;

    const rawDays = Array.isArray(restaurant?.openDays) ? restaurant.openDays : [];
    const openDays = rawDays.map(normalizeDayName).filter(Boolean);

    return DAY_NAMES.map((day) => ({
        day,
        isOpen: openDays.length === 0 || openDays.includes(day),
        openingTime: open,
        closingTime: close,
    }));
}

/** Does one day-row cover `minutes`? `sameDay=false` asks only about an overnight tail. */
const rowCovers = (row, minutes, sameDay) => {
    if (!row || row.isOpen === false) return false;
    const start = toMinutes(row.openingTime);
    const end = toMinutes(row.closingTime);
    // A row marked open with no usable times is open all day, which is what the
    // panel's own default row means before anyone edits it.
    if (start === null || end === null) return sameDay;
    if (start === end) return sameDay;
    if (start < end) return sameDay && minutes >= start && minutes < end;
    // Spans midnight: from the start onwards today, before the end tomorrow.
    return sameDay ? minutes >= start : minutes < end;
};

const findRow = (schedule, day) => schedule.find((r) => r.day === day) || null;

/**
 * Is the outlet trading at `when`, and if not, when does it next open?
 *
 * `isOpen` is the answer callers act on. `opensAt` and `closesAt` are for the
 * badge the app shows, so "Closed - opens 09:00" does not have to be
 * reconstructed on the client from raw rows.
 */
export function describeOutletHours({
    timingsDoc = null,
    restaurant = null,
    when = new Date(),
    timeZone = DEFAULT_OUTLET_TIMEZONE,
} = {}) {
    const schedule = resolveOutletSchedule({ timingsDoc, restaurant });
    if (!schedule) {
        return { isOpen: true, hasSchedule: false, opensAt: null, closesAt: null, todayIsOpen: true };
    }

    const { day, minutes } = getZonedDayAndMinutes(when, timeZone);
    if (!day) {
        return { isOpen: true, hasSchedule: true, opensAt: null, closesAt: null, todayIsOpen: true };
    }

    const today = findRow(schedule, day);
    const openNow = rowCovers(today, minutes, true)
        || rowCovers(findRow(schedule, previousDay(day)), minutes, false);

    const todayOpening = today && today.isOpen !== false ? toMinutes(today.openingTime) : null;
    const todayClosing = today && today.isOpen !== false ? toMinutes(today.closingTime) : null;

    return {
        isOpen: openNow,
        hasSchedule: true,
        todayIsOpen: !!(today && today.isOpen !== false),
        // Only meaningful while shut, and only for today; a full "opens Tuesday
        // 09:00" needs a calendar and is not what a listing badge shows.
        opensAt: !openNow && todayOpening !== null && minutes < todayOpening
            ? fromMinutes(todayOpening)
            : null,
        closesAt: openNow && todayClosing !== null ? fromMinutes(todayClosing) : null,
    };
}

/** Just the boolean, for callers that only gate on it. */
export function isOutletOpen(args) {
    return describeOutletHours(args).isOpen;
}

/**
 * Attach open/closed to a page of restaurants in one query rather than N.
 *
 * A listing renders up to a thousand rows and each one needs its hours; asking
 * per row is what turns a fast endpoint into a slow one.
 */
export async function attachOutletOpenState(restaurants = [], when = new Date()) {
    const list = Array.isArray(restaurants) ? restaurants : [];
    if (!list.length) return list;

    const { FoodRestaurantOutletTimings } = await import(
        '../restaurant/models/outletTimings.model.js'
    );
    const ids = list.map((r) => r?._id || r?.id).filter(Boolean);
    const docs = await FoodRestaurantOutletTimings.find({ restaurantId: { $in: ids } })
        .select('restaurantId timings')
        .lean();

    const byRestaurant = new Map(docs.map((d) => [String(d.restaurantId), d]));

    return list.map((restaurant) => {
        const hours = describeOutletHours({
            timingsDoc: byRestaurant.get(String(restaurant?._id || restaurant?.id)) || null,
            restaurant,
            when,
        });
        return {
            ...restaurant,
            isOpenNow: hours.isOpen,
            opensAt: hours.opensAt,
            closesAt: hours.closesAt,
        };
    });
}
