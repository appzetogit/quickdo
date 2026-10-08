import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';
import { isUnifiedDispatchEnabled, isUnifiedDispatchActive } from './unifiedDispatch.js';

/**
 * The driver's one incoming-job feed (SOW plan §8.4).
 *
 * Every vertical keeps emitting its own events exactly as before (`rideRequest` to
 * driver:<id>, `new_order` to delivery:<partnerId>), so no shipped app changes behaviour.
 * In addition, while unified dispatch is active, the same offer is emitted to the driver's
 * taxi room as:
 *
 *   job:offer      { jobType: 'taxi'|'food'|'quick_commerce', jobId, ...normalised }
 *   job:cancelled  { jobType, jobId, reason }
 *
 * so an app for a person who drives AND delivers listens on one channel and gets one shape.
 * The contract is documented in docs/flutter-taxi-api.md, "Unified jobs".
 */

export const JOB_TYPES = Object.freeze({
    taxi: 'taxi',
    food: 'food',
    quickCommerce: 'quick_commerce',
});

const jobTypeOf = (vertical) => JOB_TYPES[vertical] || vertical;

/* -------------------------------------------------------------------------- */
/* Emitting                                                                    */
/* -------------------------------------------------------------------------- */

let testEmitter = null;
/** Tests capture emits here instead of needing a live Socket.IO server. */
export const __setJobFeedEmitterForTests = (fn) => { testEmitter = typeof fn === 'function' ? fn : null; };

const driverRoom = (driverId) => `driver:${String(driverId)}`;

async function emitToDriverRoom(driverId, event, payload) {
    if (!driverId) return false;
    if (testEmitter) {
        testEmitter({ room: driverRoom(driverId), driverId: String(driverId), event, payload });
        return true;
    }
    try {
        const { getIO } = await import('../../config/socket.js');
        const io = getIO?.();
        if (!io) return false;
        io.to(driverRoom(driverId)).emit(event, payload);
        return true;
    } catch (err) {
        logger.warn(`jobFeed: emit ${event} to driver ${driverId} failed: ${err.message}`);
        return false;
    }
}

export const emitJobOffer = (driverId, offer) => emitToDriverRoom(driverId, 'job:offer', offer);
export const emitJobCancelled = (driverId, { jobType, jobId, reason = 'closed' } = {}) =>
    emitToDriverRoom(driverId, 'job:cancelled', { jobType, jobId: String(jobId || ''), reason, at: new Date().toISOString() });

/* -------------------------------------------------------------------------- */
/* Normalising                                                                 */
/* -------------------------------------------------------------------------- */

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const pointOf = (geo) => {
    const [lng, lat] = Array.isArray(geo?.coordinates) ? geo.coordinates : [];
    return { lat: num(lat), lng: num(lng) };
};

const DELIVERY_ACCEPT_BASE = '/api/v1/food/delivery/orders';

/** A taxi `rideRequest` payload as a job offer. */
export function normaliseTaxiOffer(p = {}) {
    const rideId = String(p.rideId || '');
    const paymentMethod = String(p.paymentMethod || 'cash').toLowerCase();
    const fare = num(p.fare) ?? 0;
    const meters = num(p.estimatedDistanceMeters);
    return {
        jobType: JOB_TYPES.taxi,
        jobId: rideId,
        displayId: rideId,
        title: String(p.serviceType || p.type || 'ride') === 'intercity' ? 'Intercity ride' : 'Taxi ride',
        pickup: { name: '', address: p.pickupAddress || '', ...pointOf(p.pickupLocation) },
        drop: { name: '', address: p.dropAddress || '', ...pointOf(p.dropLocation) },
        stops: Array.isArray(p.stops) ? p.stops : [],
        customer: p.user ? { name: p.user.name || '', phone: p.user.phone || '' } : null,
        fare,
        earning: fare,
        currency: 'INR',
        paymentMethod,
        cashToCollect: paymentMethod === 'cash' ? fare : 0,
        tripDistanceKm: meters !== null ? Math.round(meters / 100) / 10 : null,
        tripDurationMins: num(p.estimatedDurationMinutes),
        pickupDistanceKm: null,
        scheduledAt: p.scheduledAt || null,
        expiresAt: p.requestExpiresAt || null,
        expiresInSeconds: num(p.expiresInSeconds ?? p.acceptRejectDurationSeconds),
        zoneId: p.zoneId || null,
        bidding: p.bidding || { enabled: false },
        accept: { transport: 'socket', event: 'acceptRide', payload: { rideId } },
        reject: { transport: 'socket', event: 'rejectRide', payload: { rideId } },
        legacyEvent: 'rideRequest',
        raw: p,
    };
}

/**
 * A food or quick-commerce offer (buildDeliverySocketPayload) as a job offer.
 * Accepted through the delivery endpoints, which serve food AND quick-commerce orders.
 */
export function normaliseDeliveryOffer(vertical, payload = {}, { pickupDistanceKm = null, expiresAt = null, zoneId = null } = {}) {
    const jobId = String(payload.orderMongoId || payload._id || payload.orderId || '');
    const paymentMethod = String(payload.paymentMethod || payload.payment?.method || '').toLowerCase();
    const total = num(payload.total ?? payload.pricing?.total) ?? 0;
    const expires = expiresAt || payload.acceptanceDeadlineAt || new Date(Date.now() + 60_000);
    const expiresIso = new Date(expires).toISOString();
    const dropPoint = pointOf(payload.deliveryAddress?.location);
    return {
        jobType: jobTypeOf(vertical),
        jobId,
        displayId: String(payload.orderId || jobId),
        title: vertical === 'quickCommerce' ? 'Grocery delivery' : 'Food delivery',
        pickup: {
            name: payload.restaurantName || '',
            address: payload.restaurantAddress || payload.restaurantLocation?.address || '',
            lat: num(payload.restaurantLocation?.latitude),
            lng: num(payload.restaurantLocation?.longitude),
        },
        drop: {
            name: payload.customerName || '',
            address: payload.customerAddress || '',
            ...dropPoint,
        },
        stops: [],
        customer: payload.customerName ? { name: payload.customerName, phone: '' } : null,
        fare: total,
        earning: num(payload.earningAmount ?? payload.riderEarning ?? payload.deliveryFee) ?? 0,
        currency: 'INR',
        paymentMethod,
        cashToCollect: ['cash', 'cod', 'razorpay_qr'].includes(paymentMethod) ? total : 0,
        tripDistanceKm: num(payload.tripDistanceKm),
        tripDurationMins: num(payload.tripDurationMins),
        pickupDistanceKm: num(pickupDistanceKm ?? payload.pickupDistanceKm),
        itemCount: Array.isArray(payload.items) ? payload.items.reduce((s, i) => s + (Number(i?.quantity) || 1), 0) : null,
        scheduledAt: null,
        expiresAt: expiresIso,
        expiresInSeconds: Math.max(0, Math.round((new Date(expiresIso).getTime() - Date.now()) / 1000)),
        zoneId: zoneId ? String(zoneId) : null,
        bidding: { enabled: false },
        // Delivery-partner token (see POST /api/v1/taxi/drivers/jobs/delivery-session).
        accept: { transport: 'http', method: 'PATCH', path: `${DELIVERY_ACCEPT_BASE}/${jobId}/accept`, auth: 'delivery' },
        reject: { transport: 'http', method: 'PATCH', path: `${DELIVERY_ACCEPT_BASE}/${jobId}/reject`, auth: 'delivery' },
        legacyEvent: 'new_order',
        raw: payload,
    };
}

/* -------------------------------------------------------------------------- */
/* Partner id -> driver id                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The taxi Driver behind each delivery partner id. Unlinked partners are absent.
 * @returns {Promise<Map<string, string>>}
 */
export async function driverIdsForPartners(vertical, partnerIds = []) {
    const ids = [...new Set(partnerIds.map((id) => String(id?._id || id || '')).filter((id) => mongoose.Types.ObjectId.isValid(id)))];
    const out = new Map();
    if (!ids.length) return out;

    const { FoodDeliveryPartner } = await import('../../modules/food/delivery/models/deliveryPartner.model.js');
    if (vertical === 'quickCommerce') {
        const { FoodDeliveryPartner: QcRider } = await import('../../modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js');
        const rows = await QcRider.find({ _id: { $in: ids } }).select('_id driverId').lean();
        for (const r of rows) if (r.driverId) out.set(String(r._id), String(r.driverId));
        const missing = ids.filter((id) => !out.has(id));
        if (missing.length) {
            const { foodRiderIdForQcRider } = await import('../delivery/qcRiderLink.js');
            for (const qcId of missing) {
                // eslint-disable-next-line no-await-in-loop
                const foodId = await foodRiderIdForQcRider(qcId).catch(() => null);
                if (!foodId) continue;
                // eslint-disable-next-line no-await-in-loop
                const food = await FoodDeliveryPartner.findById(foodId).select('driverId').lean();
                if (food?.driverId) out.set(qcId, String(food.driverId));
            }
        }
        // Last resort: the hub names the QC record itself.
        const still = ids.filter((id) => !out.has(id));
        if (still.length) {
            const { Driver } = await import('../../modules/taxi/driver/models/Driver.js');
            const drivers = await Driver.find({ legacyQcPartnerId: { $in: still } }).select('_id legacyQcPartnerId').lean();
            for (const d of drivers) out.set(String(d.legacyQcPartnerId), String(d._id));
        }
        return out;
    }

    const rows = await FoodDeliveryPartner.find({ _id: { $in: ids } }).select('_id driverId').lean();
    for (const r of rows) if (r.driverId) out.set(String(r._id), String(r.driverId));
    return out;
}

/* -------------------------------------------------------------------------- */
/* Vertical hooks                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Mirror a delivery broadcast into job:offer for every linked driver. Never throws.
 *
 * @param {{vertical: 'food'|'quickCommerce', payload: object, partners: Array<{partnerId, distanceKm?}>, zoneIds?: any[], expiresAt?: any}} args
 * @returns {Promise<number>} offers emitted
 */
export async function emitDeliveryJobOffers({ vertical, payload, partners = [], zoneIds = [], expiresAt = null }) {
    try {
        if (!partners.length || !(await isUnifiedDispatchActive(zoneIds))) return 0;
        const map = await driverIdsForPartners(vertical, partners.map((p) => p.partnerId));
        let sent = 0;
        const seen = new Set();
        for (const p of partners) {
            const driverId = map.get(String(p.partnerId));
            if (!driverId || seen.has(driverId)) continue;
            seen.add(driverId);
            const offer = normaliseDeliveryOffer(vertical, payload, {
                pickupDistanceKm: p.distanceKm,
                expiresAt,
                zoneId: (Array.isArray(zoneIds) ? zoneIds : [zoneIds]).find(Boolean) || null,
            });
            // eslint-disable-next-line no-await-in-loop
            if (await emitJobOffer(driverId, offer)) sent += 1;
        }
        return sent;
    } catch (err) {
        logger.warn(`jobFeed: ${vertical} job:offer mirror failed: ${err.message}`);
        return 0;
    }
}

/** Withdraw a delivery offer from these partners' drivers (taken by someone else, etc.). Never throws. */
export async function emitDeliveryJobCancelled({ vertical, orderId, partnerIds = [], reason = 'taken' }) {
    try {
        if (!isUnifiedDispatchEnabled() || !partnerIds.length) return 0;
        const map = await driverIdsForPartners(vertical, partnerIds);
        const drivers = [...new Set(map.values())];
        await Promise.all(drivers.map((d) => emitJobCancelled(d, { jobType: jobTypeOf(vertical), jobId: orderId, reason })));
        return drivers.length;
    } catch (err) {
        logger.warn(`jobFeed: ${vertical} job:cancelled mirror failed: ${err.message}`);
        return 0;
    }
}

/**
 * Taxi hook, called from the taxi dispatcher's room emitter for `rideRequest` and
 * `rideRequestClosed` on a driver:<id> room. Never throws.
 */
export async function mirrorTaxiEvent(room, event, payload = {}) {
    try {
        if (!isUnifiedDispatchEnabled()) return false;
        const driverId = String(room || '').startsWith('driver:') ? String(room).slice('driver:'.length) : null;
        if (!driverId) return false;
        if (event === 'rideRequest') {
            if (!(await isUnifiedDispatchActive([payload.zoneId]))) return false;
            return emitJobOffer(driverId, normaliseTaxiOffer(payload));
        }
        if (event === 'rideRequestClosed') {
            return emitJobCancelled(driverId, { jobType: JOB_TYPES.taxi, jobId: payload.rideId, reason: payload.reason || 'closed' });
        }
        return false;
    } catch (err) {
        logger.warn(`jobFeed: taxi mirror failed: ${err.message}`);
        return false;
    }
}

/* -------------------------------------------------------------------------- */
/* Held jobs                                                                   */
/* -------------------------------------------------------------------------- */

const ACTIVE_RIDE_STATUSES = ['accepted', 'ongoing'];
const DONE_ORDER = { $nin: ['delivered', 'completed', 'rejected'], $not: /^cancel/ };

const deliveryJob = (vertical, o, heldIds) => ({
    jobType: jobTypeOf(vertical),
    jobId: String(o._id),
    displayId: String(o.order_id || o._id),
    status: o.orderStatus,
    deliveryPhase: o.deliveryState?.currentPhase || o.deliveryState?.status || null,
    pickup: {
        name: o.restaurantName || '',
        address: o.restaurantAddress || '',
    },
    drop: {
        name: o.deliveryAddress?.fullName || o.deliveryAddress?.name || '',
        address: [o.deliveryAddress?.street, o.deliveryAddress?.area, o.deliveryAddress?.city].filter(Boolean).join(', '),
        ...pointOf(o.deliveryAddress?.location),
    },
    paymentMethod: o.payment?.method || null,
    total: num(o.pricing?.total),
    acceptedAt: o.dispatch?.acceptedAt || null,
    lockHeld: heldIds.has(String(o._id)),
    detail: { method: 'GET', path: `${DELIVERY_ACCEPT_BASE}/${o._id}`, auth: 'delivery' },
});

/**
 * Every job this driver holds right now, across taxi, food and quick commerce.
 *
 * Read from the jobs themselves (a ride with this driver; an order whose accepted rider is
 * one of the driver's partner records), not only from the busy-lock, so it is right while the
 * flag is off too and shows a lock that outlived its job (`orphanLocks`).
 */
export async function getDriverActiveJobs(driverId) {
    const { Driver } = await import('../../modules/taxi/driver/models/Driver.js');
    const driver = await Driver.findById(driverId)
        .select('_id workMode serviceCapabilities activeAssignments activeAssignment legacyDeliveryPartnerId legacyQcPartnerId')
        .lean();
    if (!driver) return null;

    const held = Array.isArray(driver.activeAssignments) ? driver.activeAssignments : [];
    const heldIds = new Set(held.map((a) => String(a.jobId)));
    if (driver.activeAssignment?.id) heldIds.add(String(driver.activeAssignment.id));

    const jobs = [];

    const { Ride } = await import('../../modules/taxi/user/models/Ride.js');
    const rides = await Ride.find({ driverId: driver._id, status: { $in: ACTIVE_RIDE_STATUSES } })
        .select('_id status liveStatus pickupAddress dropAddress pickupLocation dropLocation fare paymentMethod scheduledAt acceptedAt serviceType')
        .sort({ updatedAt: -1 })
        .lean();
    for (const r of rides) {
        jobs.push({
            jobType: JOB_TYPES.taxi,
            jobId: String(r._id),
            displayId: String(r._id),
            status: r.liveStatus || r.status,
            pickup: { name: '', address: r.pickupAddress || '', ...pointOf(r.pickupLocation) },
            drop: { name: '', address: r.dropAddress || '', ...pointOf(r.dropLocation) },
            paymentMethod: r.paymentMethod || null,
            total: num(r.fare),
            scheduledAt: r.scheduledAt || null,
            acceptedAt: r.acceptedAt || null,
            lockHeld: heldIds.has(String(r._id)),
            detail: { method: 'GET', path: '/api/v1/taxi/rides/active/me', auth: 'driver' },
        });
    }

    const foodPartnerId = driver.legacyDeliveryPartnerId ? String(driver.legacyDeliveryPartnerId) : null;
    let qcPartnerId = driver.legacyQcPartnerId ? String(driver.legacyQcPartnerId) : null;
    if (!qcPartnerId && foodPartnerId) {
        const { qcRiderIdForFoodRider } = await import('../delivery/qcRiderLink.js');
        qcPartnerId = await qcRiderIdForFoodRider(foodPartnerId).catch(() => null);
    }

    const orderFields = '_id order_id orderStatus deliveryState restaurantName restaurantAddress deliveryAddress payment pricing dispatch.acceptedAt';
    if (foodPartnerId) {
        const { FoodOrder } = await import('../../modules/food/orders/models/order.model.js');
        const rows = await FoodOrder.find({
            'dispatch.status': 'accepted',
            'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(foodPartnerId),
            orderStatus: DONE_ORDER,
        }).select(orderFields).lean();
        for (const o of rows) jobs.push(deliveryJob('food', o, heldIds));
    }
    if (qcPartnerId && mongoose.Types.ObjectId.isValid(qcPartnerId)) {
        const { FoodOrder: QcOrder } = await import('../../modules/quickCommerce/modules/food/orders/models/order.model.js');
        const rows = await QcOrder.find({
            'dispatch.status': 'accepted',
            'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(qcPartnerId),
            orderStatus: DONE_ORDER,
        }).select(orderFields).lean();
        for (const o of rows) jobs.push(deliveryJob('quickCommerce', o, heldIds));
    }

    const jobIds = new Set(jobs.map((j) => j.jobId));
    const orphanLocks = held
        .filter((a) => !jobIds.has(String(a.jobId)))
        .map((a) => ({ vertical: a.vertical, jobType: a.jobType, jobId: String(a.jobId), at: a.at }));

    return {
        driverId: String(driver._id),
        unifiedDispatchEnabled: isUnifiedDispatchEnabled(),
        workMode: driver.workMode || 'all',
        serviceCapabilities: driver.serviceCapabilities || [],
        busy: jobs.length > 0 || held.length > 0,
        jobs,
        locks: held.map((a) => ({ vertical: a.vertical, jobType: a.jobType, jobId: String(a.jobId), at: a.at })),
        orphanLocks,
        partnerIds: { food: foodPartnerId, quickCommerce: qcPartnerId },
    };
}
