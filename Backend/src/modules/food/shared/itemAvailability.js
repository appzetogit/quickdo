import { ValidationError } from '../../../core/auth/errors.js';

/**
 * Per-menu-item availability windows, in both directions:
 *
 *   "this dish is only orderable 08:00-11:30"   (mode 'available')
 *   "this dish is off 12:00-15:00"              (mode 'unavailable')
 *
 * The second is the kitchen break, and for a long time it could not be said at
 * all. A restaurant that wanted a dish off between noon and three had only one
 * control -- a window meaning "available then" -- so typing 12:00-15:00 into it
 * produced the exact opposite of what they wanted, and the dish sold for those
 * three hours and no others. Hence `mode`, per day.
 *
 * Distinct from outlet timings, which say when the whole restaurant trades. An
 * item window narrows that further; it never widens it. Breakfast items are the
 * motivating case, so overnight windows (22:00-02:00) have to work too.
 *
 * Shape mirrors outletTimings.service.js -- day names, "HH:mm" strings -- so the
 * platform has one way of expressing a schedule rather than two.
 *
 * Disabled by default. Every existing item, and every item saved without touching
 * this, stays permanently available, so switching it on is opt-in per item.
 *
 * Enforced server-side at cart add and order creation. The UIs mirror the rules
 * and are never the authority.
 */

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Windows are wall-clock times in the restaurant's city, but the server runs UTC.
 * Evaluating "09:00-22:00" against a UTC clock would have put breakfast on the
 * menu from 14:30 to 03:30 local. Every comparison goes through the zone below.
 */
export const DEFAULT_ITEM_TIMEZONE = 'Asia/Kolkata';

const DEFAULT_START = '09:00';
const DEFAULT_END = '22:00';

/**
 * What a day's window means.
 *
 * 'available' is the default and what every schedule stored before this existed
 * carries implicitly, so nothing already saved changes meaning.
 */
export const WINDOW_MODES = Object.freeze({ AVAILABLE: 'available', UNAVAILABLE: 'unavailable' });
export const DEFAULT_WINDOW_MODE = WINDOW_MODES.AVAILABLE;

export const normalizeWindowMode = (value) => {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === WINDOW_MODES.UNAVAILABLE || raw === 'off' || raw === 'break') {
        return WINDOW_MODES.UNAVAILABLE;
    }
    return WINDOW_MODES.AVAILABLE;
};

const isBreak = (entry) => normalizeWindowMode(entry?.mode) === WINDOW_MODES.UNAVAILABLE;

export const normalizeDayName = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const exact = DAY_NAMES.find((d) => d.toLowerCase() === raw.toLowerCase());
    if (exact) return exact;
    const abbr = raw.slice(0, 3).toLowerCase();
    return DAY_NAMES.find((d) => d.toLowerCase().startsWith(abbr)) || null;
};

/** "H:mm" or "HH:mm" -> "HH:mm". Returns `fallback` for anything else. */
export const normalizeTimeOfDay = (value, fallback = null) => {
    const raw = String(value ?? '').trim();
    const m = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return fallback;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return fallback;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + m;
};

const isSupportedTimeZone = (tz) => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
};

/**
 * Weekday and minutes-since-midnight for `date` as observed in `timeZone`.
 * Intl is used rather than a fixed +05:30 so the same code stays correct for a
 * zone that observes DST, should the platform ever trade outside India.
 */
export const getZonedDayAndMinutes = (date, timeZone = DEFAULT_ITEM_TIMEZONE) => {
    const zone = isSupportedTimeZone(timeZone) ? timeZone : DEFAULT_ITEM_TIMEZONE;
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);

    const get = (type) => parts.find((p) => p.type === type)?.value;
    const day = normalizeDayName(get('weekday'));
    const hour = Number(get('hour'));
    const minute = Number(get('minute'));
    return { day, minutes: hour * 60 + minute };
};

const previousDay = (day) => DAY_NAMES[(DAY_NAMES.indexOf(day) + 6) % 7];

/**
 * Does `minutes` fall inside one day-entry's window?
 *
 * `sameDay` distinguishes the two ways an entry can match. A window whose end is
 * at or before its start (22:00-02:00) spans midnight: on its own day it covers
 * everything from the start onwards, and on the following day it covers
 * everything before the end. A caller checking yesterday's entry passes
 * sameDay=false to ask only about that second, post-midnight tail.
 */
const windowCovers = (entry, minutes, sameDay) => {
    if (!entry || entry.isAvailable === false) return false;
    const start = toMinutes(entry.startTime);
    const end = toMinutes(entry.endTime);

    if (start === end) return sameDay; // degenerate: treated as all day
    if (start < end) return sameDay && minutes >= start && minutes < end;
    return sameDay ? minutes >= start : minutes < end;
};

const findDay = (schedule, day) =>
    (Array.isArray(schedule?.days) ? schedule.days : []).find((d) => normalizeDayName(d?.day) === day) || null;

/**
 * True when the item may be ordered at `date`.
 *
 * A schedule that is absent or disabled means always available -- the default for
 * every item that predates this feature.
 */
export function isItemAvailableAt(schedule, date = new Date()) {
    if (!schedule || schedule.isEnabled !== true) return true;

    const days = Array.isArray(schedule.days) ? schedule.days : [];
    if (days.length === 0) return true;

    const { day, minutes } = getZonedDayAndMinutes(date, schedule.timezone);
    if (!day) return true;

    const today = findDay(schedule, day);
    const yesterday = findDay(schedule, previousDay(day));

    /*
     * A break wins over everything, including an overnight "available" window
     * opened yesterday that is still running. Someone who typed a closure meant
     * it, and the safe direction of a disagreement between two rules is to
     * refuse the order rather than sell something the kitchen is not making.
     */
    if (isBreak(today) && windowCovers(today, minutes, true)) return false;
    if (isBreak(yesterday) && windowCovers(yesterday, minutes, false)) return false;

    // Inside a positive window, on either day.
    if (!isBreak(today) && windowCovers(today, minutes, true)) return true;
    if (!isBreak(yesterday) && windowCovers(yesterday, minutes, false)) return true;

    /*
     * A break day has no positive window: outside the break the item is simply
     * on, for as long as the outlet is open. `isAvailable === false` still means
     * the whole day is off, and beats the mode.
     */
    if (today && today.isAvailable !== false && isBreak(today)) return true;

    return false;
}

/** Convenience for a stored menu-item document. */
export function isFoodAvailableNow(foodDoc, date = new Date()) {
    if (!foodDoc) return false;
    return isItemAvailableAt(foodDoc.availabilitySchedule, date);
}

/** "08:00-11:30 on Monday" -- for the message shown when an order is refused. */
export function describeTodaysWindow(schedule, date = new Date()) {
    if (!schedule || schedule.isEnabled !== true) return '';
    const { day } = getZonedDayAndMinutes(date, schedule.timezone);
    const entry = findDay(schedule, day);
    if (!entry || entry.isAvailable === false) return `not available on ${day}`;
    if (isBreak(entry)) return `not available ${entry.startTime}-${entry.endTime} on ${day}`;
    return `available ${entry.startTime}-${entry.endTime} on ${day}`;
}

/**
 * Refuse an order line for an item that is outside its window. Called from the
 * same places as the quantity rules, so the two behave alike.
 */
export function assertFoodAvailableNow(foodDoc, date = new Date()) {
    if (isFoodAvailableNow(foodDoc, date)) return;
    const name = foodDoc?.name || 'This item';
    const when = describeTodaysWindow(foodDoc?.availabilitySchedule, date);
    throw new ValidationError(when ? `${name} is ${when}` : `${name} is not available right now`);
}

/**
 * Normalize what a panel submitted into what the schema stores.
 *
 * Returns undefined when the caller sent nothing, so a partial update that never
 * mentions the schedule leaves the stored one untouched.
 */
export function normalizeAvailabilityScheduleInput(input) {
    if (input === undefined) return undefined;
    if (input === null || input === false) return { isEnabled: false, timezone: DEFAULT_ITEM_TIMEZONE, days: [] };
    if (typeof input !== 'object' || Array.isArray(input)) {
        throw new ValidationError('availabilitySchedule must be an object');
    }

    const isEnabled = input.isEnabled === true || input.isEnabled === 'true';

    const timezone = typeof input.timezone === 'string' && isSupportedTimeZone(input.timezone.trim())
        ? input.timezone.trim()
        : DEFAULT_ITEM_TIMEZONE;

    // Accept either an array of entries or an object keyed by day name, since the
    // outlet-timings screen already speaks the keyed form.
    let raw = [];
    if (Array.isArray(input.days)) {
        raw = input.days;
    } else if (input.days && typeof input.days === 'object') {
        raw = Object.entries(input.days).map(([day, v]) => ({ ...(v || {}), day }));
    }

    const days = DAY_NAMES.map((day) => {
        const src = raw.find((d) => normalizeDayName(d?.day) === day) || {};
        const available = src.isAvailable !== false;
        const startTime = normalizeTimeOfDay(src.startTime, DEFAULT_START);
        const endTime = normalizeTimeOfDay(src.endTime, DEFAULT_END);
        // Anything unrecognised reads as 'available', which is the meaning every
        // schedule saved before modes existed already has.
        const mode = normalizeWindowMode(src.mode);
        return { day, isAvailable: available, startTime, endTime, mode };
    });

    // Only meaningful once switched on: an enabled schedule with every day off
    // would silently hide the item forever, which is a mistake, not an intent.
    if (isEnabled && days.every((d) => d.isAvailable === false)) {
        throw new ValidationError('Enable at least one day, or turn the schedule off');
    }

    return { isEnabled, timezone, days };
}
