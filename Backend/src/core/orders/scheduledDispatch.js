import mongoose from 'mongoose';
import { get as getSetting } from '../config/resolver.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Scheduled store orders (plan §5.3): rider search starts N minutes before the
 * delivery slot, not when the store accepts.
 *
 * Same shape as taxi's scheduled rides (modules/taxi/services/dispatchService.js):
 *  - with BULLMQ_ENABLED a delayed BullMQ job whose id is the order's, so
 *    arranging it twice keeps one job; consumed in the API process (server.js),
 *    where the socket server that sends the offers lives;
 *  - otherwise an in-memory timer, re-armed from the database on boot
 *    (restoreStoreScheduledDispatches);
 *  - either way the round fires through fireScheduledStoreDispatch, which claims
 *    `scheduledDispatch.firedAt` atomically, so a second server, a retry or the
 *    store accepting at the same moment cannot dispatch twice.
 *
 * Each vertical's dispatcher calls holdForSchedule() first thing; while it
 * returns true the order is not offered to riders.
 */

export const STORE_SCHEDULED_DISPATCH_QUEUE = 'store-scheduled-dispatch';
const jobIdFor = (vertical, orderId) => `store-scheduled-dispatch-${vertical}-${orderId}`;
const timers = new Map();

/** Where each vertical's orders live and how its rider search starts. Lazy, so core does not load a vertical at import. */
const SOURCES = {
    quickCommerce: async () => {
        const { FoodOrder } = await import('../../modules/quickCommerce/modules/food/orders/models/order.model.js');
        return {
            Model: FoodOrder,
            start: async (orderId) => {
                const dispatch = await import('../../modules/quickCommerce/modules/food/orders/services/order-dispatch.service.js');
                return dispatch.tryAutoAssign(orderId);
            },
        };
    },
};

let sourceOverride = null;
/** Tests only: stand in for a vertical's model and dispatcher. */
export const __setScheduledDispatchSourceForTests = (vertical, source) => {
    sourceOverride = source ? { vertical, source } : null;
};
const sourceFor = async (vertical) => {
    if (sourceOverride && sourceOverride.vertical === vertical) return sourceOverride.source;
    const load = SOURCES[vertical];
    if (!load) throw new Error(`No scheduled dispatcher for vertical "${vertical}"`);
    return load();
};

export async function leadMinutesFor(order, vertical = 'quickCommerce') {
    try {
        const { value } = await getSetting('orders.scheduledDispatchLeadMinutes', {
            vertical,
            zoneId: order?.zoneId ? String(order.zoneId) : undefined,
        });
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : 30;
    } catch {
        return 30;
    }
}

const DEAD = (status) => {
    const s = String(status || '');
    return s === 'delivered' || s.startsWith('cancelled') || s === 'pending_payment';
};

/** When rider search for this order should start, or null for an unscheduled order. */
export function dispatchAtFor(order, leadMinutes) {
    const at = order?.scheduledAt ? new Date(order.scheduledAt) : null;
    if (!at || Number.isNaN(at.getTime())) return null;
    return new Date(at.getTime() - Math.max(0, Number(leadMinutes) || 0) * 60000);
}

const getQueue = async () => {
    try {
        const { getQueue: get } = await import('../../queues/index.js');
        return get(STORE_SCHEDULED_DISPATCH_QUEUE);
    } catch (err) {
        logger.warn(`Store scheduled dispatch queue unavailable: ${err?.message || err}`);
        return null;
    }
};

const clearTimer = (key) => {
    const t = timers.get(key);
    if (t) {
        clearTimeout(t);
        timers.delete(key);
    }
};

export const hasStoreScheduledTimer = (vertical, orderId) => timers.has(`${vertical}:${orderId}`);

/**
 * Fire the scheduled round for an order, once. Returns { fired, reason }.
 */
export async function fireScheduledStoreDispatch(vertical, orderId) {
    const key = `${vertical}:${orderId}`;
    clearTimer(key);
    if (!mongoose.Types.ObjectId.isValid(String(orderId))) return { fired: false, reason: 'bad-id' };
    const { Model, start } = await sourceFor(vertical);
    const claimed = await Model.findOneAndUpdate(
        {
            _id: new mongoose.Types.ObjectId(String(orderId)),
            'scheduledDispatch.firedAt': null,
            orderStatus: { $nin: ['delivered', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin', 'pending_payment'] },
        },
        { $set: { 'scheduledDispatch.firedAt': new Date() } },
        { new: true },
    ).select('_id').lean();
    if (!claimed) return { fired: false, reason: 'already-fired-or-not-live' };
    try {
        await start(String(orderId));
    } catch (err) {
        logger.warn(`Scheduled dispatch for ${vertical} order ${orderId} failed to start: ${err?.message || err}`);
    }
    return { fired: true, reason: '' };
}

/** Arrange the round. Idempotent: one job (fixed id) or one timer per order. */
export async function scheduleStoreDispatch(vertical, order, dispatchAt) {
    const orderId = String(order._id);
    const key = `${vertical}:${orderId}`;
    const delay = Math.max(0, new Date(dispatchAt).getTime() - Date.now());
    const { Model } = await sourceFor(vertical);

    const queue = await getQueue();
    if (queue) {
        try {
            await queue.add(
                'dispatch',
                { vertical, orderId },
                { jobId: jobIdFor(vertical, orderId), delay, attempts: 3, removeOnComplete: true, removeOnFail: { age: 24 * 3600 } },
            );
            await Model.updateOne({ _id: order._id }, { $set: { 'scheduledDispatch.dispatchAt': dispatchAt, 'scheduledDispatch.via': 'bullmq' } });
            return { scheduled: true, via: 'bullmq', dispatchAt };
        } catch (err) {
            logger.warn(`Scheduled dispatch job failed for ${key}; using an in-memory timer: ${err?.message || err}`);
        }
    }

    clearTimer(key);
    // setTimeout caps at ~24.8 days; a later slot is re-armed by the boot restore.
    const t = setTimeout(() => {
        timers.delete(key);
        fireScheduledStoreDispatch(vertical, orderId).catch((err) =>
            logger.warn(`Scheduled dispatch failed for ${key}: ${err?.message || err}`));
    }, Math.min(delay, 2 ** 31 - 1));
    t.unref?.();
    timers.set(key, t);
    await Model.updateOne({ _id: order._id }, { $set: { 'scheduledDispatch.dispatchAt': dispatchAt, 'scheduledDispatch.via': 'timer' } });
    return { scheduled: true, via: 'timer', dispatchAt };
}

/**
 * Called by a vertical's dispatcher before it offers an order to riders.
 * Returns true while the order must wait for its slot (and makes sure the
 * round is arranged); false when dispatch may go ahead now.
 */
export async function holdForSchedule(vertical, order, { now = new Date() } = {}) {
    if (!order?.scheduledAt) return false;
    if (order.scheduledDispatch?.firedAt) return false;
    if (DEAD(order.orderStatus)) return false;
    const lead = await leadMinutesFor(order, vertical);
    const dispatchAt = dispatchAtFor(order, lead);
    if (!dispatchAt || dispatchAt.getTime() <= now.getTime()) {
        // Inside the window already: this round is the scheduled one.
        const { Model } = await sourceFor(vertical);
        await Model.updateOne(
            { _id: order._id, 'scheduledDispatch.firedAt': null },
            { $set: { 'scheduledDispatch.firedAt': new Date(), 'scheduledDispatch.via': 'immediate', 'scheduledDispatch.dispatchAt': dispatchAt } },
        );
        return false;
    }
    const known = order.scheduledDispatch?.dispatchAt ? new Date(order.scheduledDispatch.dispatchAt).getTime() : null;
    if (known !== dispatchAt.getTime() || !hasStoreScheduledTimer(vertical, String(order._id))) {
        await scheduleStoreDispatch(vertical, order, dispatchAt);
    }
    return true;
}

/** BullMQ consumer, started in the API process (server.js) when BullMQ is on. */
export async function startStoreScheduledDispatchWorker() {
    const queue = await getQueue();
    if (!queue) return null;
    const [{ Worker }, { getBullMQConnection }] = await Promise.all([
        import('bullmq'),
        import('../../queues/connection.js'),
    ]);
    const connection = getBullMQConnection();
    if (!connection) return null;
    const worker = new Worker(
        STORE_SCHEDULED_DISPATCH_QUEUE,
        async (job) => fireScheduledStoreDispatch(job?.data?.vertical || 'quickCommerce', job?.data?.orderId),
        { connection, concurrency: 5 },
    );
    worker.on('failed', (job, err) => logger.error(`Store scheduled dispatch job ${job?.id} failed: ${err?.message}`));
    return worker;
}

/** Re-arm every pending scheduled round (boot). Safe to run on every boot. */
export async function restoreStoreScheduledDispatches() {
    let count = 0;
    for (const vertical of Object.keys(SOURCES)) {
        try {
            const { Model } = await sourceFor(vertical);
            const rows = await Model.find({
                'scheduledDispatch.dispatchAt': { $ne: null },
                'scheduledDispatch.firedAt': null,
                orderStatus: { $nin: ['delivered', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin', 'pending_payment'] },
            }).select('_id scheduledDispatch').lean();
            for (const row of rows) {
                const at = new Date(row.scheduledDispatch.dispatchAt);
                if (at.getTime() <= Date.now()) await fireScheduledStoreDispatch(vertical, String(row._id));
                else await scheduleStoreDispatch(vertical, row, at);
                count += 1;
            }
        } catch (err) {
            logger.warn(`Restoring ${vertical} scheduled dispatches failed: ${err?.message || err}`);
        }
    }
    return count;
}
