import { Activity, ACTIVITY_STATUS, ACTIVITY_VERTICALS } from './activity.model.js';
import { logger } from '../../utils/logger.js';

/**
 * Status normalisation, per vertical.
 *
 * The four verticals share almost no vocabulary: food ends at `delivered`, taxi at
 * `completed`, service-provider at `work_done`, and each has its own set of cancelled
 * variants. Mapping once here is the whole reason the feed is usable -- otherwise
 * every client reimplements this, and they drift.
 *
 * Anything unrecognised falls to ACTIVE rather than being dropped: a row in the feed
 * with a slightly wrong state is far better than a transaction the customer cannot see.
 */
const STATUS_MAP = {
    food: {
        pending_payment: ACTIVITY_STATUS.PENDING,
        created: ACTIVITY_STATUS.PENDING,
        confirmed: ACTIVITY_STATUS.ACTIVE,
        preparing: ACTIVITY_STATUS.ACTIVE,
        ready_for_pickup: ACTIVITY_STATUS.ACTIVE,
        reached_pickup: ACTIVITY_STATUS.ACTIVE,
        picked_up: ACTIVITY_STATUS.ACTIVE,
        reached_drop: ACTIVITY_STATUS.ACTIVE,
        delivered: ACTIVITY_STATUS.COMPLETED,
        cancelled_by_user: ACTIVITY_STATUS.CANCELLED,
        cancelled_by_restaurant: ACTIVITY_STATUS.CANCELLED,
        cancelled_by_admin: ACTIVITY_STATUS.CANCELLED,
    },
    taxi: {
        searching: ACTIVITY_STATUS.PENDING,
        accepted: ACTIVITY_STATUS.ACTIVE,
        arriving: ACTIVITY_STATUS.ACTIVE,
        started: ACTIVITY_STATUS.ACTIVE,
        arrived: ACTIVITY_STATUS.ACTIVE,
        ongoing: ACTIVITY_STATUS.ACTIVE,
        completed: ACTIVITY_STATUS.COMPLETED,
        cancelled: ACTIVITY_STATUS.CANCELLED,
    },
    serviceProvider: {
        searching: ACTIVITY_STATUS.PENDING,
        requested: ACTIVITY_STATUS.PENDING,
        awaiting_payment: ACTIVITY_STATUS.PENDING,
        pending: ACTIVITY_STATUS.PENDING,
        confirmed: ACTIVITY_STATUS.ACTIVE,
        accepted: ACTIVITY_STATUS.ACTIVE,
        assigned: ACTIVITY_STATUS.ACTIVE,
        journey_started: ACTIVITY_STATUS.ACTIVE,
        visited: ACTIVITY_STATUS.ACTIVE,
        in_progress: ACTIVITY_STATUS.ACTIVE,
        work_done: ACTIVITY_STATUS.ACTIVE,
        completed: ACTIVITY_STATUS.COMPLETED,
        no_vendors: ACTIVITY_STATUS.CANCELLED,
        cancelled: ACTIVITY_STATUS.CANCELLED,
        rejected: ACTIVITY_STATUS.CANCELLED,
    },
};
// quick-commerce is a fork of food and shares its status machine exactly.
STATUS_MAP.quickCommerce = STATUS_MAP.food;

export const normaliseStatus = (vertical, rawStatus) => {
    const key = String(rawStatus || '').trim().toLowerCase();
    return STATUS_MAP[vertical]?.[key] || ACTIVITY_STATUS.ACTIVE;
};

/**
 * Upsert one activity row for a source document.
 *
 * Keyed on (vertical, refId) with a unique index behind it, so a transaction that
 * changes state ten times still has exactly one feed row. NEVER THROWS -- a feed write
 * must not be able to fail the order, ride or booking that triggered it.
 */
export const recordActivity = async ({
    vertical, refModel, refId, userId, rawStatus,
    amount = 0, currency = 'INR', title = '', occurredAt, metadata,
}) => {
    try {
        if (!ACTIVITY_VERTICALS.includes(vertical)) return null;
        if (!userId || !refId || !refModel) return null;

        const status = normaliseStatus(vertical, rawStatus);

        return await Activity.findOneAndUpdate(
            { vertical, refId },
            {
                $set: {
                    userId, refModel, status,
                    rawStatus: String(rawStatus || ''),
                    amount: Number(amount) || 0,
                    currency,
                    ...(title ? { title } : {}),
                    occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
                    ...(metadata ? { metadata } : {}),
                },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true },
        );
    } catch (err) {
        logger.error(`[Activity] record failed for ${vertical}:${refId} — ${err.message}`);
        return null;
    }
};

/** The unified feed. One query, every vertical, newest first. */
export const getUserActivity = async (userId, { status, vertical, limit = 20, skip = 0 } = {}) => {
    const q = { userId };
    if (status) q.status = status;
    if (vertical) q.vertical = vertical;
    return Activity.find(q).sort({ occurredAt: -1 }).skip(skip).limit(Math.min(limit, 100)).lean();
};

/** Cross-vertical spend for one customer. */
export const getUserSpend = async (userId) => {
    const rows = await Activity.aggregate([
        { $match: { userId, status: ACTIVITY_STATUS.COMPLETED } },
        { $group: { _id: '$vertical', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    return {
        byVertical: rows.map((r) => ({ vertical: r._id, amount: r.amount, count: r.count })),
        total: rows.reduce((a, r) => a + r.amount, 0),
    };
};

export { ACTIVITY_STATUS, ACTIVITY_VERTICALS };
