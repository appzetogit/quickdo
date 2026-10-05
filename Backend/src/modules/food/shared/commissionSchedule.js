import { ValidationError } from '../../../core/auth/errors.js';

/**
 * Which commission rate applies to one order, at the moment it is placed.
 *
 * The platform charges the restaurant a percentage of the FOOD BILL -- the
 * subtotal. Delivery is collected from the customer and passed through, so it is
 * never part of the base: commissioning a ₹125 total on a ₹100 bill would take a
 * cut of a delivery fee that was never the restaurant's money.
 *
 * Rates can be scheduled. Resolution is most-specific-wins:
 *
 *   1. a schedule for THIS restaurant covering now
 *   2. a platform-wide schedule covering now
 *   3. the restaurant's standing default
 *   4. nothing configured -> no commission
 *
 * Where two schedules of the same specificity overlap, the one that started most
 * recently wins. Overlaps are a mistake rather than a feature, but they happen
 * -- someone extends a festive rate over a promotion -- and silently picking the
 * newest intent beats picking whichever the database returned first.
 *
 * Pure, so the order path, the admin preview and the tests all get the same
 * answer without a database.
 */

export const COMMISSION_SOURCES = Object.freeze({
    SCHEDULE_RESTAURANT: 'schedule_restaurant',
    SCHEDULE_PLATFORM: 'schedule_platform',
    RESTAURANT_DEFAULT: 'restaurant_default',
    /**
     * No commission because the platform is billing restaurants a recurring
     * plan instead. Distinct from NONE, which means commission applies and
     * nobody configured a rate -- the two look identical on an invoice and are
     * opposite problems: NONE on a live order is usually a misconfiguration,
     * PLAN_MODE is the system working.
     */
    PLAN_MODE: 'plan_mode',
    NONE: 'none',
});

const toTime = (value) => {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : NaN;
};

/** Does a schedule cover this instant? Start inclusive, end exclusive. */
export const scheduleCoversInstant = (schedule, at) => {
    if (!schedule || schedule.status === false) return false;
    const start = toTime(schedule.startsAt);
    const end = toTime(schedule.endsAt);
    const now = toTime(at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(now)) return false;
    // End exclusive, so a schedule ending at midnight does not overlap the one
    // starting at the same midnight -- otherwise both match and the tiebreak
    // decides something the admin thought they had made unambiguous.
    return now >= start && now < end;
};

const pickLatest = (list) =>
    list.reduce((best, s) => (!best || toTime(s.startsAt) > toTime(best.startsAt) ? s : best), null);

/**
 * @param {object} params
 * @param {object|null} params.defaultRule   FoodRestaurantCommission for this restaurant
 * @param {Array} params.schedules           candidate schedules (any restaurant, any window)
 * @param {string} params.restaurantId
 * @param {Date}   params.at
 * @returns {{ type: string, value: number, source: string, scheduleId: string|null, label: string }}
 */
export function resolveCommissionRate({ defaultRule = null, schedules = [], restaurantId, at = new Date() } = {}) {
    const active = (Array.isArray(schedules) ? schedules : []).filter((s) => scheduleCoversInstant(s, at));

    const mine = active.filter((s) => s.restaurantId && String(s.restaurantId) === String(restaurantId));
    const platform = active.filter((s) => !s.restaurantId);

    const winner = pickLatest(mine) || pickLatest(platform);
    if (winner) {
        return {
            type: winner.commission?.type || 'percentage',
            value: Math.max(0, Number(winner.commission?.value) || 0),
            source: mine.includes(winner)
                ? COMMISSION_SOURCES.SCHEDULE_RESTAURANT
                : COMMISSION_SOURCES.SCHEDULE_PLATFORM,
            scheduleId: winner._id ? String(winner._id) : null,
            label: winner.label || '',
        };
    }

    if (defaultRule && defaultRule.status !== false) {
        return {
            type: defaultRule.defaultCommission?.type || 'percentage',
            value: Math.max(0, Number(defaultRule.defaultCommission?.value) || 0),
            source: COMMISSION_SOURCES.RESTAURANT_DEFAULT,
            scheduleId: null,
            label: '',
        };
    }

    return { type: 'percentage', value: 0, source: COMMISSION_SOURCES.NONE, scheduleId: null, label: '' };
}

/**
 * Money owed on one order, from a resolved rate.
 *
 * `baseAmount` must be the food subtotal, never the customer total. Clamped to
 * the base so a misconfigured flat amount cannot exceed the bill it is charged
 * against and leave the restaurant owing money on a sale.
 */
export function computeCommissionAmount(baseAmount, rate) {
    const base = Math.max(0, Number(baseAmount) || 0);
    const value = Math.max(0, Number(rate?.value) || 0);

    let amount = 0;
    if ((rate?.type || 'percentage') === 'percentage') {
        amount = base * (value / 100);
    } else {
        amount = value;
    }

    amount = Math.round((amount || 0) * 100) / 100;
    return Math.max(0, Math.min(amount, base));
}

/** Normalize an admin form into a storable schedule. Throws on anything unusable. */
export function normalizeScheduleInput(body = {}) {
    const type = body?.commission?.type === 'amount' ? 'amount' : 'percentage';
    const value = Number(body?.commission?.value ?? body?.value);
    if (!Number.isFinite(value) || value < 0) {
        throw new ValidationError('Commission value must be 0 or more');
    }
    if (type === 'percentage' && value > 100) {
        throw new ValidationError('A percentage commission cannot exceed 100');
    }

    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (Number.isNaN(startsAt.getTime())) throw new ValidationError('Start date is invalid');
    if (Number.isNaN(endsAt.getTime())) throw new ValidationError('End date is invalid');
    if (endsAt.getTime() <= startsAt.getTime()) {
        throw new ValidationError('The end date must be after the start date');
    }

    return {
        restaurantId: body.restaurantId ? String(body.restaurantId) : null,
        label: String(body.label || '').trim(),
        commission: { type, value },
        startsAt,
        endsAt,
        status: body.status !== false,
        notes: String(body.notes || '').trim(),
    };
}
