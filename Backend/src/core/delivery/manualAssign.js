import mongoose from 'mongoose';
import { ValidationError, NotFoundError } from '../auth/errors.js';
import { logger } from '../../utils/logger.js';
import {
  qcRiderIdForFoodRider,
  foodRiderIdForQcRider,
  mirrorQcOfferToFoodRider,
} from './qcRiderLink.js';

/**
 * An admin hands an order to a rider of their choosing.
 *
 * One implementation for Food and for Quick & Medical (vertical 'food' |
 * 'quickCommerce'). The admin always picks a FOOD rider -- the identity the
 * delivery app signs in as -- and for a Quick / Medical order the assignment is
 * stored against the linked Quick rider record (qcRiderLink.js), exactly as the
 * app's own accept does.
 *
 * The life of a manual assignment:
 *
 *   assignRider        dispatch.status 'assigned', assignMode 'manual', and a
 *                      deadline (MANUAL_ACCEPT_WINDOW_MS). Auto-dispatch leaves
 *                      the order alone until then (see tryAutoAssign in both
 *                      order-dispatch services). The rider gets the same alert as
 *                      an offer, marked assignedByAdmin.
 *   rider accepts      the ordinary accept endpoint; nothing special.
 *   rider declines     the ordinary reject endpoint (noteManualDecline below):
 *                      back to the pool, the admins are told.
 *   nobody answers     expireManualAssignments (workers, every 30s): back to the
 *                      pool.
 *   admin unassigns    unassignRider: back to the pool.
 *
 * "Back to the pool" always means: unassigned, assignMode 'auto', and
 * tryAutoAssign started again.
 */

const envMs = (name, fallback, min) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? value : fallback;
};

/** How long the chosen rider has to accept before the order goes back to auto-dispatch. */
export const MANUAL_ACCEPT_WINDOW_MS = envMs('MANUAL_ASSIGN_ACCEPT_WINDOW_MS', 3 * 60 * 1000, 30 * 1000);
/** Beyond this straight-line distance to the pickup the admin is asked to confirm. */
export const MANUAL_ASSIGN_FAR_KM = 10;

const CANDIDATES_MAX = 50;
const CANDIDATES_DEFAULT = 20;
// Every approved rider is ranked in memory, so the read is capped. Only the
// fields needed to rank are fetched; the per-rider money lookups run for the
// returned page only.
const CANDIDATE_SCAN_MAX = 5000;
const EXPIRY_BATCH = 200;

/** The order states a rider can still be given (and can accept from). */
const ASSIGNABLE_STATUSES = ['confirmed', 'preparing', 'ready_for_pickup'];
const TERMINAL_STATUSES = ['delivered', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'];

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''))
  && /^[a-f0-9]{24}$/i.test(String(value));
const oid = (value) => new mongoose.Types.ObjectId(String(value));
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------------------------------------------------ */
/* Vertical plumbing                                                         */
/* ------------------------------------------------------------------------ */

const loaders = {
  food: async () => {
    const [{ FoodOrder }, { FoodRestaurant }, helpers, dispatch, socket] = await Promise.all([
      import('../../modules/food/orders/models/order.model.js'),
      import('../../modules/food/restaurant/models/restaurant.model.js'),
      import('../../modules/food/orders/services/order.helpers.js'),
      import('../../modules/food/orders/services/order-dispatch.service.js'),
      import('../../config/socket.js'),
    ]);
    return {
      vertical: 'food', isQc: false, Order: FoodOrder, Restaurant: FoodRestaurant,
      helpers, tryAutoAssign: dispatch.tryAutoAssign, socket,
      assertAssignable: () => {},
    };
  },
  quickCommerce: async () => {
    const [{ FoodOrder }, { FoodRestaurant }, helpers, dispatch, socket, rx] = await Promise.all([
      import('../../modules/quickCommerce/modules/food/orders/models/order.model.js'),
      import('../../modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js'),
      import('../../modules/quickCommerce/modules/food/orders/services/order.helpers.js'),
      import('../../modules/quickCommerce/modules/food/orders/services/order-dispatch.service.js'),
      import('../../modules/quickCommerce/config/socket.js'),
      import('../../modules/quickCommerce/modules/food/shared/prescriptionOrder.js'),
    ]);
    return {
      vertical: 'quickCommerce', isQc: true, Order: FoodOrder, Restaurant: FoodRestaurant,
      helpers, tryAutoAssign: dispatch.tryAutoAssign, socket,
      // A Medical order goes to a rider only once the customer has agreed to the bill.
      assertAssignable: rx.assertDeliveryPartnerAssignable,
    };
  },
};

const vertical = async (name) => {
  const load = loaders[name];
  if (!load) throw new ValidationError(`Unknown vertical: ${name}`);
  return load();
};

const foodRiderModel = async () =>
  (await import('../../modules/food/delivery/models/deliveryPartner.model.js')).FoodDeliveryPartner;
const qcRiderModel = async () =>
  (await import('../../modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js')).FoodDeliveryPartner;

/** [lat, lng] of a store, from GeoJSON or the latitude/longitude fields. */
const pointOf = (location) => {
  const c = location?.coordinates;
  if (Array.isArray(c) && c.length >= 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]))
    && !(Number(c[0]) === 0 && Number(c[1]) === 0)) {
    return { lat: Number(c[1]), lng: Number(c[0]) };
  }
  const lat = Number(location?.latitude);
  const lng = Number(location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

const riderPoint = (rider) => {
  const lat = Number(rider?.lastLat);
  const lng = Number(rider?.lastLng);
  return rider?.lastLat != null && rider?.lastLng != null && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng } : null;
};

const loadOrder = async (ctx, orderId, { populate = false } = {}) => {
  const identity = ctx.helpers.buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');
  const query = ctx.Order.findOne(identity);
  if (populate) query.populate(['restaurantId', 'userId']);
  const order = await query;
  if (!order) throw new NotFoundError('Order not found');
  return order;
};

const storePointForOrder = async (ctx, order) => {
  const r = order?.restaurantId;
  if (r && typeof r === 'object' && r.location) return pointOf(r.location);
  const id = r?._id || r;
  if (!id) return null;
  const doc = await ctx.Restaurant.findById(id).select('location').lean().catch(() => null);
  return pointOf(doc?.location);
};

const isCashOrder = (order) => {
  const method = String(order?.payment?.method || order?.paymentMethod || '').toLowerCase();
  return method === 'cash' || method === 'razorpay_qr';
};

/**
 * Food rider ids that are on a delivery right now, in either vertical.
 *
 * Bounded by the number of live trips, not riders. Quick trips are stored
 * against the Quick rider record and mapped back (cached in qcRiderLink).
 */
async function foodRidersOnTrip() {
  const [{ FoodOrder }, { FoodOrder: QcOrder }] = await Promise.all([
    import('../../modules/food/orders/models/order.model.js'),
    import('../../modules/quickCommerce/modules/food/orders/models/order.model.js'),
  ]);
  const live = {
    'dispatch.status': 'accepted',
    'dispatch.deliveryPartnerId': { $ne: null },
    orderStatus: { $nin: TERMINAL_STATUSES },
  };
  const [foodIds, qcIds] = await Promise.all([
    FoodOrder.distinct('dispatch.deliveryPartnerId', live),
    QcOrder.distinct('dispatch.deliveryPartnerId', live),
  ]);
  const mapped = await Promise.all(qcIds.map((id) => foodRiderIdForQcRider(id)));
  return new Set([...foodIds.map(String), ...mapped.filter(Boolean).map(String)]);
}

/** Cash in hand and the limit, from the one finance source. Never throws. */
async function riderCash(foodRiderId) {
  try {
    const { getRiderFinance } = await import('../finance/riderFinance.service.js');
    const f = await getRiderFinance(foodRiderId);
    return { cashInHand: round2(f?.cashInHand), cashLimit: round2(f?.cashLimit) };
  } catch (err) {
    logger.warn(`[manualAssign] finance lookup failed for rider ${foodRiderId}: ${err.message}`);
    return { cashInHand: null, cashLimit: null };
  }
}

/** The same test the rider's accept applies: limit 0 means no limit. */
const breachesCashLimit = ({ cashInHand, cashLimit }, orderCash) =>
  Number(cashLimit) > 0 && (Number(cashInHand) || 0) + orderCash > Number(cashLimit);

/* ------------------------------------------------------------------------ */
/* Notifications                                                             */
/* ------------------------------------------------------------------------ */

/** JSON round trip with every Quick rider id replaced by the Food one. */
const asFoodRider = (value, qcId, foodId) => (value == null || !qcId || !foodId
  ? value
  : JSON.parse(JSON.stringify(value).split(String(qcId)).join(String(foodId))));

/**
 * A socket event (and optionally a data-only push) to riders named by the id
 * the order stores. A Quick id also reaches the Food identity the app runs as.
 * Never throws.
 */
async function toRiders(ctx, partnerIds, event, payload, { push } = {}) {
  const ids = [...new Set((partnerIds || []).filter(Boolean).map(String))];
  if (!ids.length) return;
  try {
    const io = ctx.socket.getIO?.();
    const foodSocket = ctx.isQc ? await import('../../config/socket.js') : ctx.socket;
    const foodIo = foodSocket.getIO?.();
    const pushTargets = [];
    for (const id of ids) {
      if (io) io.to(ctx.socket.rooms.delivery(id)).emit(event, payload);
      pushTargets.push({ ownerType: 'DELIVERY_PARTNER', ownerId: id });
      if (ctx.isQc) {
        // eslint-disable-next-line no-await-in-loop
        const foodId = await foodRiderIdForQcRider(id);
        if (!foodId) continue;
        if (foodIo) foodIo.to(foodSocket.rooms.delivery(foodId)).emit(event, asFoodRider(payload, id, foodId));
        pushTargets.push({ ownerType: 'DELIVERY_PARTNER', ownerId: foodId });
      }
    }
    if (push) await ctx.helpers.notifyOwnersSafely(pushTargets, { ...push, dataOnly: true });
  } catch (err) {
    logger.warn(`[manualAssign] ${event} to riders failed: ${err.message}`);
  }
}

/**
 * The admin panels and the store hear about it: 'order_status_update' (what
 * they already refresh on) to the store and admin rooms, and a
 * 'manual_assignment_update' with the detail to the admin room. Never throws.
 */
function announce(ctx, order, { event, note = '', riderId = null, riderName = '' }) {
  try {
    const io = ctx.socket.getIO?.();
    if (!io) return;
    const payload = {
      orderMongoId: String(order._id),
      orderId: order.order_id || String(order._id),
      orderStatus: order.orderStatus,
      dispatchStatus: order.dispatch?.status,
      assignMode: order.dispatch?.assignMode || 'auto',
      manualDeadlineAt: order.dispatch?.manualDeadlineAt || null,
      vertical: ctx.vertical,
      event,
      riderId: riderId ? String(riderId) : null,
      riderName,
      note,
      at: new Date().toISOString(),
    };
    const restaurantId = order.restaurantId?._id || order.restaurantId;
    if (restaurantId) io.to(ctx.socket.rooms.restaurant(restaurantId)).emit('order_status_update', payload);
    if (ctx.socket.rooms.admin) {
      io.to(ctx.socket.rooms.admin()).emit('order_status_update', payload);
      io.to(ctx.socket.rooms.admin()).emit('manual_assignment_update', payload);
    }
  } catch (err) {
    logger.warn(`[manualAssign] announce ${event} failed: ${err.message}`);
  }
}

/** Tells a rider an assignment they were holding is no longer theirs. */
function tellRiderDeassigned(ctx, order, partnerId, reason, message) {
  const payload = {
    orderId: String(order._id),
    orderMongoId: String(order._id),
    orderDisplayId: order.order_id || String(order._id),
    reason,
    message,
  };
  // 'order_taken' is the push type the app already uses to dismiss an offer alert.
  return toRiders(ctx, [partnerId], 'order_deassigned', payload, {
    push: {
      title: 'Order unassigned',
      body: message,
      data: { type: 'order_taken', orderId: String(order._id), orderMongoId: String(order._id), deassigned: 'true', reason },
    },
  });
}

/** The rider id the admin panel and the app know: the Food one. */
const appRiderId = async (ctx, partnerId) =>
  (ctx.isQc ? (await foodRiderIdForQcRider(partnerId)) || String(partnerId) : String(partnerId));

const restartDispatch = (ctx, orderId) => {
  void Promise.resolve()
    .then(() => ctx.tryAutoAssign(orderId))
    .catch((err) => logger.error(`[manualAssign] auto-dispatch restart failed for ${orderId}: ${err.message}`));
};

/* ------------------------------------------------------------------------ */
/* Candidates                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Riders an admin can pick for this order, nearest to the store first.
 * Riders with no known position come last.
 */
export async function listRiderCandidates({ vertical: name, orderId, q = '', limit } = {}) {
  const ctx = await vertical(name);
  const order = await loadOrder(ctx, orderId);
  const store = await storePointForOrder(ctx, order);
  const pageSize = Math.min(CANDIDATES_MAX, Math.max(1, Number.parseInt(limit, 10) || CANDIDATES_DEFAULT));

  const filter = { status: 'approved' };
  const search = String(q || '').trim().slice(0, 60);
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    const digits = search.replace(/\D/g, '');
    filter.$or = [{ name: rx }, ...(digits.length >= 3 ? [{ phone: new RegExp(escapeRegex(digits)) }] : [{ phone: rx }])];
  }

  const FoodRider = await foodRiderModel();
  const rows = await FoodRider.find(filter)
    .select('_id name phone availabilityStatus lastLat lastLng lastLocationAt rating totalRatings updatedAt')
    .limit(CANDIDATE_SCAN_MAX)
    .lean();

  const { haversineKm } = ctx.helpers;
  const ranked = rows.map((r) => {
    const at = riderPoint(r);
    const d = store && at ? haversineKm(store.lat, store.lng, at.lat, at.lng) : null;
    return { r, distanceKm: Number.isFinite(d) ? round2(d) : null };
  }).sort((a, b) => {
    if (a.distanceKm == null && b.distanceKm == null) return 0;
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm;
  });

  const page = ranked.slice(0, pageSize);
  const orderCash = isCashOrder(order) ? Math.max(0, Number(order.pricing?.total) || 0) : 0;
  const [onTrip, money] = await Promise.all([
    foodRidersOnTrip(),
    Promise.all(page.map(({ r }) => riderCash(r._id))),
  ]);

  const assignedFoodId = order.dispatch?.deliveryPartnerId
    ? (ctx.isQc ? await foodRiderIdForQcRider(order.dispatch.deliveryPartnerId) : String(order.dispatch.deliveryPartnerId))
    : null;

  return {
    order: {
      id: String(order._id),
      orderId: order.order_id || String(order._id),
      vertical: ctx.vertical,
      orderStatus: order.orderStatus,
      dispatchStatus: order.dispatch?.status || 'unassigned',
      assignMode: order.dispatch?.assignMode || 'auto',
      assignedRiderId: assignedFoodId,
      manualDeadlineAt: order.dispatch?.manualDeadlineAt || null,
      paymentMethod: order.payment?.method || null,
      total: Number(order.pricing?.total) || 0,
      pickup: store,
    },
    riders: page.map(({ r, distanceKm }, i) => ({
      id: String(r._id),
      name: r.name || '',
      // Admin-only route: the admin may need to ring the rider.
      phone: r.phone || '',
      online: r.availabilityStatus === 'online',
      onTrip: onTrip.has(String(r._id)),
      cashInHand: money[i].cashInHand,
      cashLimit: money[i].cashLimit,
      overCashLimit: money[i].cashLimit != null && breachesCashLimit(money[i], orderCash),
      distanceKm,
      rating: Number(r.rating) || 0,
      totalRatings: Number(r.totalRatings) || 0,
      lastSeenAt: r.lastLocationAt || r.updatedAt || null,
      isAssigned: assignedFoodId === String(r._id),
    })),
    total: rows.length,
  };
}

/* ------------------------------------------------------------------------ */
/* Assign                                                                    */
/* ------------------------------------------------------------------------ */

function assertOrderAssignable(order) {
  const status = String(order.orderStatus || '');
  if (['picked_up', 'reached_drop', 'delivered'].includes(status)) {
    throw new ValidationError('This order has already been picked up, so its rider cannot be changed here.');
  }
  if (status.startsWith('cancelled')) throw new ValidationError('This order has been cancelled.');
  if (order.dispatch?.status === 'accepted') {
    throw new ValidationError('A rider has already accepted this order. Use Deassign & Resend to change the rider.');
  }
  if (!ASSIGNABLE_STATUSES.includes(status)) {
    throw new ValidationError('A rider can be assigned once the store has accepted the order.');
  }
}

async function warningsFor({ order, foodRider, store }) {
  const warnings = [];
  if (foodRider.availabilityStatus !== 'online') {
    warnings.push({ code: 'offline', message: `${foodRider.name || 'This rider'} is offline and may not see the order.` });
  }
  const [onTrip, money] = await Promise.all([foodRidersOnTrip(), riderCash(foodRider._id)]);
  if (onTrip.has(String(foodRider._id))) {
    warnings.push({ code: 'on_trip', message: `${foodRider.name || 'This rider'} is on another delivery and may not be able to accept until it is done.` });
  }
  if (isCashOrder(order) && breachesCashLimit(money, Math.max(0, Number(order.pricing?.total) || 0))) {
    warnings.push({
      code: 'over_cash_limit',
      message: `Cash order: ${foodRider.name || 'the rider'} holds Rs.${money.cashInHand} against a Rs.${money.cashLimit} limit and cannot accept it until they deposit cash.`,
    });
  }
  const at = riderPoint(foodRider);
  if (!at || !store) {
    warnings.push({ code: 'location_unknown', message: 'The rider\'s distance from the pickup is not known.' });
  } else {
    const { haversineKm } = await import('../../modules/food/orders/services/order.helpers.js');
    const d = haversineKm(store.lat, store.lng, at.lat, at.lng);
    if (Number.isFinite(d) && d > MANUAL_ASSIGN_FAR_KM) {
      warnings.push({ code: 'far', message: `The rider is ${round2(d)} km from the pickup.`, distanceKm: round2(d) });
    }
  }
  return warnings;
}

/** FCM data for the assignment alert: the offer's own map, marked as assigned. */
async function assignmentPushData(order, payload, deadline, earning) {
  const { buildIncomingOrderPushData } = await import(
    '../../modules/quickCommerce/modules/food/orders/services/order-dispatch.service.js'
  );
  const s = (v) => (v === undefined || v === null ? '' : String(v));
  const body = [
    payload?.restaurantName ? `Pickup: ${s(payload.restaurantName)}` : '',
    `Earning: Rs.${s(earning)}`,
  ].filter(Boolean).join('\n');
  return {
    title: 'Order assigned to you',
    body,
    data: {
      ...buildIncomingOrderPushData(order, payload, deadline),
      // Same type as an offer, so the alert the app already draws renders it.
      type: 'new_order',
      title: 'Order assigned to you',
      body,
      earningAmount: s(earning),
      assignedByAdmin: 'true',
      acceptanceDeadlineAt: deadline.toISOString(),
      acceptTimeoutSeconds: s(Math.round(MANUAL_ACCEPT_WINDOW_MS / 1000)),
    },
  };
}

/**
 * Give the order to this rider.
 *
 * With any warning (offline, on a trip, over the cash limit, far away) and no
 * `force`, nothing changes: { needsConfirmation: true, warnings } comes back
 * for the admin to confirm.
 */
export async function assignRider({ vertical: name, orderId, foodRiderId, admin = {}, force = false } = {}) {
  const ctx = await vertical(name);
  if (!isObjectId(foodRiderId)) throw new ValidationError('A valid deliveryPartnerId is required');

  const order = await loadOrder(ctx, orderId, { populate: true });
  assertOrderAssignable(order);
  ctx.assertAssignable(order);

  const FoodRider = await foodRiderModel();
  const foodRider = await FoodRider.findById(foodRiderId)
    .select('_id name phone status availabilityStatus lastLat lastLng lastLocationAt')
    .lean();
  if (!foodRider) throw new NotFoundError('Rider not found');
  if (foodRider.status !== 'approved') throw new ValidationError('This rider is not approved for deliveries.');

  const partnerId = ctx.isQc ? await qcRiderIdForFoodRider(foodRiderId) : String(foodRiderId);
  if (!partnerId) throw new ValidationError('This rider could not be linked for Quick & Medical deliveries.');

  const store = await storePointForOrder(ctx, order);
  const warnings = await warningsFor({ order, foodRider, store });
  if (warnings.length && !force) {
    return {
      needsConfirmation: true,
      warnings,
      rider: { id: String(foodRider._id), name: foodRider.name || '' },
    };
  }

  const now = new Date();
  const deadline = new Date(now.getTime() + MANUAL_ACCEPT_WINDOW_MS);
  const previous = {
    status: order.dispatch?.status || 'unassigned',
    partnerId: order.dispatch?.deliveryPartnerId ? String(order.dispatch.deliveryPartnerId) : null,
  };
  const adminId = isObjectId(admin.id) ? oid(admin.id) : null;
  const adminName = String(admin.name || '').trim() || 'Admin';

  /*
   * One conditional write: claims the order from auto-dispatch (dispatchingAt
   * cleared -- a broadcast already in flight finds the order assigned and leaves
   * it, see the guarded re-offer update in both dispatchers) and refuses if a
   * rider accepted or the order moved on since it was read.
   */
  const updated = await ctx.Order.findOneAndUpdate(
    {
      _id: order._id,
      orderStatus: { $in: ASSIGNABLE_STATUSES },
      'dispatch.status': { $ne: 'accepted' },
      'dispatch.acceptedAt': { $exists: false },
    },
    {
      $set: {
        'dispatch.status': 'assigned',
        'dispatch.deliveryPartnerId': oid(partnerId),
        'dispatch.assignedAt': now,
        'dispatch.assignMode': 'manual',
        'dispatch.assignedBy': { adminId, name: adminName, at: now },
        'dispatch.manualDeadlineAt': deadline,
      },
      $unset: { 'dispatch.dispatchingAt': '' },
      $push: {
        // Recorded as an offer, so a later auto round does not offer it straight
        // back to the rider who let it go.
        'dispatch.offeredTo': { partnerId: oid(partnerId), at: now, action: 'offered' },
        statusHistory: {
          at: now,
          byRole: 'ADMIN',
          byId: adminId || undefined,
          from: previous.status,
          to: 'assigned',
          note: `Rider ${foodRider.name || foodRiderId} assigned by ${adminName}`
            + (warnings.length ? ` (confirmed despite: ${warnings.map((w) => w.code).join(', ')})` : ''),
        },
      },
    },
    { new: true },
  ).populate(['restaurantId', 'userId']);

  if (!updated) {
    throw new ValidationError('This order was accepted by a rider or changed meanwhile. Refresh and try again.');
  }

  // Everyone else holding an offer for it: dismiss.
  const others = (updated.dispatch?.offeredTo || [])
    .map((o) => String(o.partnerId || ''))
    .filter((id) => id && id !== String(partnerId));
  const claimedPayload = { orderId: String(updated._id), orderMongoId: String(updated._id), claimedBy: String(partnerId) };
  void toRiders(ctx, others.filter((id) => id !== previous.partnerId), 'order_claimed', claimedPayload, {
    push: {
      title: 'Order taken',
      body: 'This order has been assigned to another partner.',
      data: { type: 'order_taken', orderId: String(updated._id), orderMongoId: String(updated._id) },
    },
  });
  // A rider the admin replaced is told the order is no longer theirs.
  if (previous.status === 'assigned' && previous.partnerId && previous.partnerId !== String(partnerId)) {
    void tellRiderDeassigned(ctx, updated, previous.partnerId, 'reassigned', 'This order was assigned to another partner.');
  }

  // The chosen rider: the offer's own payload, marked as an assignment.
  const base = ctx.helpers.buildDeliverySocketPayload(updated, updated.restaurantId);
  const at = riderPoint(foodRider);
  const pickupDistanceKm = store && at ? round2(ctx.helpers.haversineKm(store.lat, store.lng, at.lat, at.lng)) : null;
  const payload = {
    ...base,
    pickupDistanceKm,
    assignedByAdmin: true,
    acceptanceDeadlineAt: deadline.toISOString(),
    acceptTimeoutSeconds: Math.round(MANUAL_ACCEPT_WINDOW_MS / 1000),
  };
  const earning = base.earningAmount ?? base.riderEarning ?? base.earnings ?? 0;
  void (async () => {
    try {
      const pushData = await assignmentPushData(updated, payload, deadline, earning);
      const push = {
        ...pushData,
        androidTag: `order_${String(updated._id)}`,
        androidChannelId: 'new_orders_v2',
        data: { ...pushData.data, pickupDistanceKm: pickupDistanceKm == null ? '' : String(pickupDistanceKm) },
      };
      const { notifyOwnersActionableAlert } = await import('../notifications/firebase.service.js');
      if (ctx.isQc) {
        const io = ctx.socket.getIO?.();
        if (io) io.to(ctx.socket.rooms.delivery(partnerId)).emit('order_assigned', payload);
        await notifyOwnersActionableAlert([{ ownerType: 'DELIVERY_PARTNER', ownerId: partnerId }], push).catch(() => {});
        // The app runs as the Food rider: socket and push there, ids rewritten.
        await mirrorQcOfferToFoodRider(partnerId, { event: 'order_assigned', payload, push });
      } else {
        const io = ctx.socket.getIO?.();
        if (io) io.to(ctx.socket.rooms.delivery(partnerId)).emit('order_assigned', payload);
        await notifyOwnersActionableAlert([{ ownerType: 'DELIVERY_PARTNER', ownerId: partnerId }], push);
      }
    } catch (err) {
      logger.warn(`[manualAssign] assignment alert failed for order ${updated._id}: ${err.message}`);
    }
  })();

  announce(ctx, updated, {
    event: 'rider_assigned', riderId: foodRider._id, riderName: foodRider.name || '',
    note: `Assigned by ${adminName}`,
  });
  ctx.helpers.enqueueOrderEvent?.('delivery_partner_assigned', {
    orderMongoId: String(updated._id),
    orderId: String(updated._id),
    deliveryPartnerId: String(partnerId),
    adminId: adminId ? String(adminId) : null,
    manual: true,
  });

  // The admin's copy is read back with the same narrow populate the admin order
  // list uses: `updated` carries whole user and store documents for the rider
  // payload, which are not the admin panel's to receive.
  const forAdmin = await ctx.Order.findById(updated._id)
    .populate('userId', 'name phone email')
    .populate('restaurantId', 'restaurantName area city ownerPhone primaryContactNumber zoneId')
    .lean();

  return {
    needsConfirmation: false,
    warnings,
    order: ctx.helpers.normalizeOrderForClient(forAdmin || updated),
    assignedRider: {
      id: String(foodRider._id),
      partnerId: String(partnerId),
      name: foodRider.name || '',
      phone: foodRider.phone || '',
    },
    acceptanceDeadlineAt: deadline.toISOString(),
  };
}

/* ------------------------------------------------------------------------ */
/* Back to the pool                                                          */
/* ------------------------------------------------------------------------ */

/**
 * The one write that hands an assigned (not accepted) order back. Guarded on
 * the exact state it read, so two callers -- a decline and the expiry sweep,
 * two workers -- cannot both act on it. Returns the updated order or null.
 */
async function releaseAssignment(ctx, { orderId, partnerId, extraGuard = {}, history, offerAction }) {
  const update = {
    $set: {
      'dispatch.status': 'unassigned',
      'dispatch.deliveryPartnerId': null,
      'dispatch.assignMode': 'auto',
    },
    $unset: { 'dispatch.manualDeadlineAt': '', 'dispatch.assignedAt': '' },
    $push: { statusHistory: { at: new Date(), ...history } },
  };
  const options = { new: true };
  if (offerAction === 'remove') {
    update.$pull = { 'dispatch.offeredTo': { partnerId: oid(partnerId) } };
  } else if (offerAction) {
    update.$set['dispatch.offeredTo.$[mine].action'] = offerAction;
    options.arrayFilters = [{ 'mine.partnerId': oid(partnerId), 'mine.action': 'offered' }];
  }
  return ctx.Order.findOneAndUpdate(
    {
      _id: orderId,
      'dispatch.status': 'assigned',
      'dispatch.deliveryPartnerId': oid(partnerId),
      'dispatch.acceptedAt': { $exists: false },
      ...extraGuard,
    },
    update,
    options,
  );
}

/**
 * Take back an assignment the rider has not accepted yet. An accepted order is
 * refused: it is on the road, and the existing deassign flows handle that.
 */
export async function unassignRider({ vertical: name, orderId, admin = {} } = {}) {
  const ctx = await vertical(name);
  const order = await loadOrder(ctx, orderId);
  if (order.dispatch?.status === 'accepted') {
    throw new ValidationError('The rider has already accepted this order. Use Deassign & Resend to take it back.');
  }
  if (order.dispatch?.status !== 'assigned' || !order.dispatch?.deliveryPartnerId) {
    throw new ValidationError('No rider is assigned to this order.');
  }

  const partnerId = String(order.dispatch.deliveryPartnerId);
  const adminId = isObjectId(admin.id) ? oid(admin.id) : null;
  const adminName = String(admin.name || '').trim() || 'Admin';
  const riderName = await riderDisplayName(ctx.vertical, partnerId);

  const updated = await releaseAssignment(ctx, {
    orderId: order._id,
    partnerId,
    history: {
      byRole: 'ADMIN', byId: adminId || undefined, from: 'assigned', to: 'unassigned',
      note: `Rider ${riderName || partnerId} unassigned by ${adminName}`,
    },
    // Food has no 'deassigned' offer state; dropping the entry keeps the order off
    // that rider's list. Quick's 'deassigned' does the same and keeps the record.
    offerAction: ctx.isQc ? 'deassigned' : 'remove',
  });
  if (!updated) {
    throw new ValidationError('The rider accepted or the order changed meanwhile. Refresh and try again.');
  }

  void tellRiderDeassigned(ctx, updated, partnerId, 'admin_unassigned', 'This order has been taken off you by our team.');
  announce(ctx, updated, {
    event: 'rider_unassigned', riderId: await appRiderId(ctx, partnerId), riderName, note: `Unassigned by ${adminName}`,
  });
  restartDispatch(ctx, updated._id);
  return { order: ctx.helpers.normalizeOrderForClient(updated) };
}

let expiryRunning = false;

/**
 * Hand back every manual assignment whose rider did not answer in time.
 *
 * Safe to run twice at once, or in two processes: each order is released by a
 * write guarded on the state it was read in (same rider, same deadline), so
 * only one caller acts on it. The in-process flag only stops a slow run from
 * being stacked on by the next tick.
 */
export async function expireManualAssignments({ now = new Date() } = {}) {
  const result = { food: 0, quickCommerce: 0, skipped: false };
  if (expiryRunning) return { ...result, skipped: true };
  expiryRunning = true;
  try {
    for (const name of ['food', 'quickCommerce']) {
      // eslint-disable-next-line no-await-in-loop
      const ctx = await vertical(name);
      // eslint-disable-next-line no-await-in-loop
      const due = await ctx.Order.find({
        'dispatch.assignMode': 'manual',
        'dispatch.status': 'assigned',
        'dispatch.manualDeadlineAt': { $lt: now },
      })
        .select('_id dispatch.deliveryPartnerId dispatch.manualDeadlineAt')
        .limit(EXPIRY_BATCH)
        .lean();

      for (const row of due) {
        const partnerId = row.dispatch?.deliveryPartnerId ? String(row.dispatch.deliveryPartnerId) : null;
        if (!partnerId) continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          const riderName = await riderDisplayName(name, partnerId);
          // eslint-disable-next-line no-await-in-loop
          const updated = await releaseAssignment(ctx, {
            orderId: row._id,
            partnerId,
            extraGuard: { 'dispatch.assignMode': 'manual', 'dispatch.manualDeadlineAt': row.dispatch.manualDeadlineAt },
            history: {
              byRole: 'SYSTEM', from: 'assigned', to: 'unassigned',
              note: `Rider ${riderName || partnerId} didn't respond`,
            },
            offerAction: 'timeout',
          });
          if (!updated) continue; // accepted, declined or released by someone else first
          result[name] += 1;
          void tellRiderDeassigned(ctx, updated, partnerId, 'timeout', 'You did not accept this order in time, so it has gone to other partners.');
          // eslint-disable-next-line no-await-in-loop
          announce(ctx, updated, { event: 'rider_timeout', riderId: await appRiderId(ctx, partnerId), riderName, note: 'Rider didn\'t respond' });
          restartDispatch(ctx, updated._id);
        } catch (err) {
          logger.error(`[manualAssign] expiry failed for ${name} order ${row._id}: ${err.message}`);
        }
      }
    }
  } finally {
    expiryRunning = false;
  }
  if (result.food || result.quickCommerce) {
    logger.info(`[manualAssign] expired manual assignments: food=${result.food} quickCommerce=${result.quickCommerce}`);
  }
  return result;
}

/* ------------------------------------------------------------------------ */
/* Rider decline (called from both rejectOrderDelivery)                      */
/* ------------------------------------------------------------------------ */

/** The rider's name from the record the order stores (Quick or Food). */
export async function riderDisplayName(verticalName, partnerId) {
  try {
    const Model = verticalName === 'quickCommerce' ? await qcRiderModel() : await foodRiderModel();
    const row = await Model.findById(partnerId).select('name').lean();
    return row?.name || '';
  } catch {
    return '';
  }
}

/** Is this order an admin's pick for this rider, still waiting on them? */
export function isManualAssignmentTo(order, partnerId) {
  return order?.dispatch?.assignMode === 'manual'
    && order?.dispatch?.status === 'assigned'
    && String(order?.dispatch?.deliveryPartnerId || '') === String(partnerId || '');
}

/**
 * For a reject path about to save: when the order was the admin's pick for this
 * rider, turn it back into an auto order and return the history note
 * ("Declined by <rider>: <reason>"). Returns null for an ordinary reject, which
 * then goes on exactly as before.
 */
export async function noteManualDecline(verticalName, order, partnerId, reason) {
  if (!isManualAssignmentTo(order, partnerId)) return null;
  const name = await riderDisplayName(verticalName, partnerId);
  const why = String(reason || '').trim().slice(0, 200);
  order.dispatch.assignMode = 'auto';
  order.dispatch.manualDeadlineAt = undefined;
  return { riderName: name, note: `Declined by ${name || 'rider'}${why ? `: ${why}` : ''}` };
}

/** After the decline is saved: the admin panels and the store are told. */
export async function announceManualDecline(verticalName, order, partnerId, declined) {
  if (!declined) return;
  try {
    const ctx = await vertical(verticalName);
    announce(ctx, order, {
      event: 'rider_declined', riderId: await appRiderId(ctx, partnerId), riderName: declined.riderName, note: declined.note,
    });
  } catch (err) {
    logger.warn(`[manualAssign] decline announcement failed: ${err.message}`);
  }
}

export const __testables = { assertOrderAssignable, ASSIGNABLE_STATUSES };
