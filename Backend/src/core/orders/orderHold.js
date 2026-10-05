import { logger } from '../../utils/logger.js';

/**
 * A short hold before a new order reaches the restaurant or store.
 *
 * Master > Cancellation policy sets `orders.holdSeconds` (all services, or per
 * service). While an order is held the restaurant is not alerted and does not
 * see it in its list, and the customer can cancel it free -- a new order is
 * still 'created', which the cancel rules always allow. When the hold ends the
 * order is released: the restaurant gets the usual new-order alert, exactly
 * once, and everything proceeds as before. 0 (the default) sends it straight
 * away, which is how the platform behaved before this existed.
 *
 * Two fields on the order carry it:
 *   restaurantReleaseAt   when the hold ends (null = never held)
 *   restaurantReleasedAt  when it was released (null while held)
 * An order is visible to the restaurant when it was never held, or has been
 * released -- see RELEASED_TO_RESTAURANT.
 *
 * Release is claimed atomically (restaurantReleasedAt null -> now), so the timer
 * set at order time, the sweeper, and a second API process can never alert the
 * restaurant twice. The sweeper is what makes a restart safe: a timer lost with
 * the process is picked up within a few seconds.
 */

export const HOLD_KEY = 'orders.holdSeconds';
const SWEEP_MS = 5000;

/** Mongo filter: the restaurant may see this order. */
export const RELEASED_TO_RESTAURANT = Object.freeze({
    $or: [{ restaurantReleaseAt: null }, { restaurantReleasedAt: { $ne: null } }],
});

/** True while an order is on hold (the restaurant must not act on it yet). */
export const isHeld = (order) => Boolean(order?.restaurantReleaseAt) && !order?.restaurantReleasedAt;

export async function holdSecondsFor(vertical, zoneId) {
    try {
        const { get } = await import('../config/resolver.service.js');
        const row = await get(HOLD_KEY, { vertical: vertical || undefined, zoneId: zoneId ? String(zoneId) : undefined });
        const n = Number(row?.value);
        return Number.isFinite(n) && n > 0 ? Math.min(600, Math.round(n)) : 0;
    } catch (err) {
        // Never hold an order because a settings read failed: send it on.
        logger.warn(`orderHold: settings read failed, not holding: ${err.message}`);
        return 0;
    }
}

const targets = new Map(); // name -> { Model, notify }

/**
 * Registers a service's order model and its "tell the restaurant" function,
 * so the sweeper can release that service's orders.
 */
export function registerHoldTarget(name, Model, notify) {
    targets.set(name, { Model, notify });
}

/**
 * Called in place of alerting the restaurant. Returns true when the order was
 * put on hold (the caller must NOT alert now); false to alert straight away.
 *
 * @param {object} args
 * @param {string} args.name        the registered target
 * @param {object} args.order       the order document
 * @param {string} args.vertical    'food' | 'quickCommerce' | 'medical'
 * @param {boolean} [args.shiftAcceptanceDeadline]  move acceptanceDeadlineAt out by the hold
 */
export async function holdIfConfigured({ name, order, vertical, shiftAcceptanceDeadline = false }) {
    const target = targets.get(name);
    if (!target || !order?._id) return false;
    if (order.restaurantReleasedAt) return false; // already released: alert as usual
    const now = Date.now();
    let releaseAt = order.restaurantReleaseAt ? new Date(order.restaurantReleaseAt) : null;

    if (!releaseAt) {
        const seconds = await holdSecondsFor(vertical, order.zoneId);
        if (!(seconds > 0)) return false;
        releaseAt = new Date(now + seconds * 1000);
        const set = { restaurantReleaseAt: releaseAt };
        // The restaurant's acceptance clock starts when it can see the order.
        if (shiftAcceptanceDeadline && order.acceptanceDeadlineAt) {
            set.acceptanceDeadlineAt = new Date(new Date(order.acceptanceDeadlineAt).getTime() + seconds * 1000);
        }
        const res = await target.Model.updateOne({ _id: order._id, restaurantReleaseAt: null }, { $set: set });
        if (!res.modifiedCount) {
            // Someone else started the hold first; use theirs.
            const fresh = await target.Model.findById(order._id).select('restaurantReleaseAt restaurantReleasedAt').lean();
            if (fresh?.restaurantReleasedAt) return true; // already released by them
            releaseAt = fresh?.restaurantReleaseAt ? new Date(fresh.restaurantReleaseAt) : releaseAt;
        }
        try {
            order.restaurantReleaseAt = releaseAt;
            if (set.acceptanceDeadlineAt) order.acceptanceDeadlineAt = set.acceptanceDeadlineAt;
        } catch { /* a lean object or frozen doc: the database has it */ }
    }

    const wait = Math.max(0, releaseAt.getTime() - now) + 200;
    const timer = setTimeout(() => {
        releaseOne(name, order._id).catch((err) => logger.warn(`orderHold: release failed for ${order._id}: ${err.message}`));
    }, wait);
    timer.unref?.();
    return true;
}

/** Releases one due order, if nobody has yet and it was not cancelled. */
export async function releaseOne(name, orderId) {
    const target = targets.get(name);
    if (!target) return false;
    const claimed = await target.Model.findOneAndUpdate(
        {
            _id: orderId,
            restaurantReleaseAt: { $ne: null, $lte: new Date() },
            restaurantReleasedAt: null,
            orderStatus: { $not: /^cancel/ },
        },
        { $set: { restaurantReleasedAt: new Date() } },
        { new: true },
    );
    if (!claimed) return false;
    await target.notify(claimed);
    return true;
}

/** Releases every due order of every registered service. */
export async function sweepHeldOrders() {
    let released = 0;
    for (const [name, { Model }] of targets) {
        const due = await Model.find({
            restaurantReleaseAt: { $ne: null, $lte: new Date() },
            restaurantReleasedAt: null,
            orderStatus: { $not: /^cancel/ },
        })
            .select('_id')
            .limit(100)
            .lean();
        for (const { _id } of due) {
            // eslint-disable-next-line no-await-in-loop
            if (await releaseOne(name, _id).catch(() => false)) released += 1;
        }
    }
    return released;
}

let sweeper = null;
export function startOrderHoldSweeper() {
    if (sweeper) return sweeper;
    sweeper = setInterval(() => {
        sweepHeldOrders().catch((err) => logger.warn(`orderHold: sweep failed: ${err.message}`));
    }, SWEEP_MS);
    sweeper.unref?.();
    return sweeper;
}
export function stopOrderHoldSweeper() {
    if (sweeper) clearInterval(sweeper);
    sweeper = null;
}
