import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';
import { qcRiderIdForFoodRider, foodRiderIdForQcRider } from './qcRiderLink.js';

/**
 * Order batching: a second order for a rider who is already on a trip.
 *
 * Food, Quick and Medical riders are one pool, and a rider used to get one
 * order at a time -- except that nothing stopped a rider on a Food trip being
 * offered (and accepting) any number of further Food orders, which the app
 * could not show. This is the one rule every dispatch and accept path asks:
 *
 *   A rider with no live order may take any order.
 *   A rider with live orders may take this one too only when batching is on
 *   (Master > Order Batching, per zone or service) and EVERY live order:
 *     - has not been picked up yet (the rider collects them together),
 *     - was accepted within the wait window (the first customer is not kept
 *       waiting on a long detour),
 *     - comes from a store within pickupRadiusM of this order's store,
 *     - goes to a drop within dropRadiusKm of this order's drop,
 *   and the trip stays within maxOrders.
 *
 * Anything uncertain (no coordinates, a read failing) answers "no": the order
 * then goes to another rider exactly as before.
 */

const KEYS = ['batching.enabled', 'batching.maxOrders', 'batching.pickupRadiusM', 'batching.dropRadiusKm', 'batching.maxWaitMinutes'];
const LIVE_EXCLUDED = ['delivered', 'completed', 'rejected'];
const PICKED_UP_STATUSES = new Set(['picked_up', 'reached_drop', 'delivered']);
const PICKED_UP_PHASES = new Set(['en_route_to_delivery', 'at_drop', 'delivered', 'completed']);

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));

const models = async () => {
    const [{ FoodOrder }, { FoodOrder: QcOrder }] = await Promise.all([
        import('../../modules/food/orders/models/order.model.js'),
        import('../../modules/quickCommerce/modules/food/orders/models/order.model.js'),
    ]);
    return { FoodOrder, QcOrder };
};

const liveFilter = (partnerId) => ({
    'dispatch.status': 'accepted',
    'dispatch.deliveryPartnerId': oid(partnerId),
    orderStatus: { $nin: LIVE_EXCLUDED, $not: /^cancel/ },
});

const FIELDS = 'orderStatus dispatch.acceptedAt deliveryState restaurantId deliveryAddress.location zoneId order_id createdAt';

/** The rider's live orders in both services, oldest first: [{ vertical, order }]. */
export async function liveJobsOfRider(foodRiderId) {
    if (!isId(foodRiderId)) return [];
    const { FoodOrder, QcOrder } = await models();
    const qcId = await qcRiderIdForFoodRider(foodRiderId).catch(() => null);
    const [food, qc] = await Promise.all([
        FoodOrder.find(liveFilter(foodRiderId)).select(FIELDS).lean(),
        qcId ? QcOrder.find(liveFilter(qcId)).select(FIELDS).lean() : [],
    ]);
    return [
        ...food.map((order) => ({ vertical: 'food', order })),
        ...qc.map((order) => ({ vertical: 'quickCommerce', order })),
    ].sort((a, b) => new Date(a.order.dispatch?.acceptedAt || a.order.createdAt) - new Date(b.order.dispatch?.acceptedAt || b.order.createdAt));
}

const storeCollection = (vertical) => (vertical === 'food' ? 'food_restaurants' : 'qc_restaurants');

async function storePoint(vertical, restaurantId) {
    if (!isId(restaurantId)) return null;
    const store = await mongoose.connection.db.collection(storeCollection(vertical))
        .findOne({ _id: oid(restaurantId) }, { projection: { location: 1 } });
    const c = store?.location?.coordinates;
    return Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) ? c : null;
}

const dropPoint = (order) => {
    const c = order?.deliveryAddress?.location?.coordinates;
    return Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) ? c : null;
};

/** Kilometres between two [lng, lat] points. */
export function distanceKm(a, b) {
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b[1] - a[1]);
    const dLng = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
}

async function settingsFor(order, vertical) {
    const { values } = await import('../config/resolver.service.js');
    const v = await values(KEYS, { zoneId: order?.zoneId ? String(order.zoneId) : undefined, vertical });
    return {
        enabled: v['batching.enabled'] === true,
        maxOrders: Number(v['batching.maxOrders']) || 2,
        pickupRadiusKm: Math.max(0, Number(v['batching.pickupRadiusM']) || 0) / 1000,
        dropRadiusKm: Number(v['batching.dropRadiusKm']) || 3,
        maxWaitMs: (Number(v['batching.maxWaitMinutes']) || 10) * 60 * 1000,
    };
}

const pickedUp = (order) => Boolean(order?.deliveryState?.pickedUpAt)
    || PICKED_UP_STATUSES.has(String(order?.orderStatus))
    || PICKED_UP_PHASES.has(String(order?.deliveryState?.currentPhase));

/**
 * May this Food rider take `order` (of `vertical`) on top of what they carry?
 *
 * @returns {Promise<{ ok: boolean, batched: boolean, reason?: string }>}
 *   batched: true when the rider already carries an order (an "add to trip").
 */
export async function canAddToTrip({ foodRiderId, order, vertical, now = new Date() }) {
    try {
        const jobs = (await liveJobsOfRider(foodRiderId))
            .filter((j) => String(j.order._id) !== String(order?._id));
        if (!jobs.length) return { ok: true, batched: false };

        const s = await settingsFor(order, vertical);
        if (!s.enabled) return { ok: false, batched: true, reason: 'one_order_at_a_time' };
        if (jobs.length + 1 > s.maxOrders) return { ok: false, batched: true, reason: 'trip_full' };

        const newStore = await storePoint(vertical, order?.restaurantId);
        const newDrop = dropPoint(order);
        if (!newStore || !newDrop) return { ok: false, batched: true, reason: 'no_location' };

        for (const { vertical: v, order: job } of jobs) {
            if (pickedUp(job)) return { ok: false, batched: true, reason: 'already_picked_up' };
            const acceptedAt = new Date(job.dispatch?.acceptedAt || job.createdAt || 0).getTime();
            if (now.getTime() - acceptedAt > s.maxWaitMs) return { ok: false, batched: true, reason: 'first_order_waiting' };
            // eslint-disable-next-line no-await-in-loop
            const store = await storePoint(v, job.restaurantId);
            const drop = dropPoint(job);
            if (!store || !drop) return { ok: false, batched: true, reason: 'no_location' };
            if (distanceKm(store, newStore) > s.pickupRadiusKm + 0.01) return { ok: false, batched: true, reason: 'stores_apart' };
            if (distanceKm(drop, newDrop) > s.dropRadiusKm) return { ok: false, batched: true, reason: 'drops_apart' };
        }
        return { ok: true, batched: true };
    } catch (err) {
        logger.warn(`[batching] check failed for rider ${foodRiderId}: ${err.message}`);
        return { ok: false, batched: true, reason: 'check_failed' };
    }
}

/**
 * Of these Food riders, the ones (string ids) who must NOT be offered `order`:
 * they carry a live order and it cannot be batched with this one.
 */
export async function foodRidersBlockedFor(foodRiderIds = [], order, vertical) {
    const ids = [...new Set(foodRiderIds.map(String))].filter(isId);
    if (!ids.length) return new Set();
    const busy = await busyFoodRiders(ids);
    const blocked = new Set();
    for (const id of busy) {
        // eslint-disable-next-line no-await-in-loop
        const verdict = await canAddToTrip({ foodRiderId: id, order, vertical });
        if (!verdict.ok) blocked.add(id);
    }
    return blocked;
}

/** Same, for Quick rider ids (mapped to their Food record and back). */
export async function qcRidersBlockedFor(qcRiderIds = [], order, vertical = 'quickCommerce') {
    const pairs = (await Promise.all(qcRiderIds.map(async (q) => [String(q), await foodRiderIdForQcRider(q).catch(() => null)])));
    const blockedFood = await foodRidersBlockedFor(pairs.map(([, f]) => f).filter(Boolean), order, vertical);
    // A Quick rider with no Food record: judge by their own Quick orders alone.
    const unlinked = pairs.filter(([, f]) => !f).map(([q]) => q);
    const out = new Set(pairs.filter(([, f]) => f && blockedFood.has(String(f))).map(([q]) => q));
    if (unlinked.length) {
        const { QcOrder } = await models();
        const busy = await QcOrder.distinct('dispatch.deliveryPartnerId', {
            'dispatch.status': 'accepted',
            'dispatch.deliveryPartnerId': { $in: unlinked.map(oid) },
            orderStatus: { $nin: LIVE_EXCLUDED, $not: /^cancel/ },
        });
        busy.forEach((id) => out.add(String(id)));
    }
    return out;
}

/** Of these Food riders, those carrying any live Food or Quick/Medical order. */
async function busyFoodRiders(foodRiderIds) {
    const { FoodOrder, QcOrder } = await models();
    const pairs = await Promise.all(foodRiderIds.map(async (f) => [f, await qcRiderIdForFoodRider(f).catch(() => null)]));
    const qcIds = pairs.map(([, q]) => q).filter(Boolean);
    const [foodBusy, qcBusy] = await Promise.all([
        FoodOrder.distinct('dispatch.deliveryPartnerId', {
            'dispatch.status': 'accepted',
            'dispatch.deliveryPartnerId': { $in: foodRiderIds.map(oid) },
            orderStatus: { $nin: LIVE_EXCLUDED, $not: /^cancel/ },
        }),
        qcIds.length ? QcOrder.distinct('dispatch.deliveryPartnerId', {
            'dispatch.status': 'accepted',
            'dispatch.deliveryPartnerId': { $in: qcIds.map(oid) },
            orderStatus: { $nin: LIVE_EXCLUDED, $not: /^cancel/ },
        }) : [],
    ]);
    const fb = new Set(foodBusy.map(String));
    const qb = new Set(qcBusy.map(String));
    return pairs.filter(([f, q]) => fb.has(String(f)) || (q && qb.has(String(q)))).map(([f]) => String(f));
}

/** Plain words for a refused accept. */
export function refusalMessage(reason) {
    switch (reason) {
        case 'trip_full': return 'Your trip already has as many orders as it can take. Deliver one first.';
        case 'already_picked_up': return 'You have already picked up your current order. Deliver it first.';
        case 'stores_apart': return 'This order is from a store too far from your current pickup.';
        case 'drops_apart': return 'This order goes too far from your current drop.';
        case 'first_order_waiting': return 'Your current customer has waited too long to add another order.';
        default: return 'You are already on another job';
    }
}
