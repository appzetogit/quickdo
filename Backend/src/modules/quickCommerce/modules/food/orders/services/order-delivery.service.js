import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodDeliveryWallet } from '../../delivery/models/deliveryWallet.model.js';
import { FoodDeliveryCashLimit } from '../../admin/models/deliveryCashLimit.model.js';
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from '../../../../core/auth/errors.js';
import { buildPaginatedResult, buildPaginationOptions } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { getFirebaseDB } from '../../../../config/firebase.js';
import { fetchDrivingRoute } from '../utils/googleMaps.js';

import * as foodTransactionService from './foodTransaction.service.js';
import * as dispatchService from './order-dispatch.service.js';
import * as paymentService from './order-payment.service.js';

// The master busy-lock. Quick-commerce forked from food before the lock existed
// and never picked it up: `partnerHasActiveDelivery` below only ever looked at QC
// orders, so a rider on a grocery order still read as free to food and to taxi,
// and both would claim them. See core/assignment/assignment.service.js.
import { claimAssignment, releaseAssignment } from '../../../../../../core/assignment/assignment.service.js';
import { config } from '../../../../../../config/env.js';

import {
  buildOrderIdentityFilter,
  emitDeliveryDropOtpToUser,
  enqueueOrderEvent,
  generateFourDigitDeliveryOtp,
  haversineKm,
  notifyOwnerSafely,
  notifyOwnersSafely,
  partnerHasActiveDelivery,
  pushStatusHistory,
  sanitizeOrderForDeliveryPartner,
  TERMINAL_ORDER_STATUSES,
  isStatusAdvance,
  sanitizeOrderForExternal,
} from './order.helpers.js';
const DELIVERY_ORDER_BASE_SELECT = [
  '_id',
  'order_id',
  'orderId',
  'userId',
  'restaurantId',
  'deliveryAddress',
  'customerName',
  'customerPhone',
  'items',
  'pricing',
  'payment',
  'orderStatus',
  'dispatch',
  'deliveryState',
  'note',
  'deliveryInstructions',
  'createdAt',
  'updatedAt',
  'riderEarning',
  'tripDistanceKm',
  'tripDurationMins',
  'lastRiderLocation',
  'deliveryFleet',
  'ratings'
].join(' ');

const DELIVERY_USER_POPULATE = {
  path: 'userId',
  select: 'name phone email',
};

const DELIVERY_RESTAURANT_POPULATE = {
  path: 'restaurantId',
  // The image fields let the rider visually identify the premises at pickup. All four
  // are included because the restaurant model carries two separate pairs and onboarding
  // does not consistently fill the same one: coverImage is the single hero (documented
  // as falling back to coverImages[0]), and galleryImages/menuImages are distinct
  // arrays. Selecting only one pair returns empty for restaurants that filled the other.
  // phone/ownerPhone back the tap-to-call button; location gives the exact pin.
  select:
    'restaurantName name phone ownerPhone primaryContactNumber location addressLine1 area city state pincode landmark profileImage coverImage coverImages galleryImages menuImages',
};

/**
 * The order with its store (name, address, phone, pin) filled in, for the
 * rider app.
 *
 * The app replaces its current order with what each trip step returns. These
 * steps returned the store as a bare id, so after "Reached pickup" a Medical
 * order's card lost the pharmacy's name and address ("Pharmacy", no address).
 */
async function withStoreForRider(order) {
  try {
    const store = order?.restaurantId;
    if (order && typeof order.populate === 'function' && store && !store.restaurantName) {
      await order.populate(DELIVERY_RESTAURANT_POPULATE);
    }
  } catch (err) {
    logger.warn(`withStoreForRider: ${err.message}`);
  }
  return order;
}

const DELIVERY_TRANSACTION_SELECT = 'orderId payment paymentMethod pricing amounts status';

function mergeTransactionIntoOrder(orderDoc, txDoc) {
  if (!txDoc) return orderDoc;
  return {
    ...orderDoc,
    paymentMethod: txDoc.payment?.method || txDoc.paymentMethod || orderDoc.paymentMethod,
    payment: txDoc.payment || orderDoc.payment,
    pricing: txDoc.pricing || orderDoc.pricing,
    amounts: txDoc.amounts || orderDoc.amounts,
    transactionStatus: txDoc.status || orderDoc.transactionStatus,
  };
}

function emitOrderUpdate(order, deliveryPartnerId) {
  try {
    const io = getIO();
    if (io) {
      const dv =
        order.deliveryVerification?.toObject?.() || order.deliveryVerification;
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        deliveryState: order.deliveryState,
        deliveryVerification: dv,
      };
      io.to(rooms.delivery(deliveryPartnerId)).emit(
        'order_status_update',
        payload,
      );
      io.to(rooms.restaurant(order.restaurantId)).emit(
        'order_status_update',
        payload,
      );
      io.to(rooms.user(order.userId)).emit('order_status_update', payload);
    }

    // Only send push notifications for key delivery milestones
    const status = order.orderStatus;
    if (!['picked_up', 'reached_drop', 'delivered'].includes(status)) return;

    let userTitle = '';
    let userBody = '';
    let riderTitle = '';
    let riderBody = '';

    const orderId = order._id.toString();

    if (status === 'picked_up') {
      userTitle = 'Order on the way!';
      userBody = `Partner has picked up your order #${orderId} and is heading your way.`;
      riderTitle = 'Order picked up!';
      riderBody = `You have picked up order #${orderId}. Proceed to the customer location.`;
    } else if (status === 'reached_drop') {
      userTitle = 'Partner nearby!';
      userBody = `Your delivery partner has reached your location for order #${orderId}.`;
      riderTitle = 'Arrived at drop!';
      riderBody = `You have reached the customer location for order #${orderId}.`;
    } else if (status === 'delivered') {
      userTitle = `Order #${orderId} delivered!`;
      userBody = 'Hope you enjoyed your meal! Don\'t forget to rate your experience.';
      riderTitle = 'Delivery successful!';
      riderBody = `Order #${orderId} has been successfully delivered.`;

      if (order.payment?.method === 'cash' || order.paymentMethod === 'cash') {
        riderTitle = 'Payment collected!';
        const amt = order.pricing?.total || order.amounts?.totalCustomerPaid || 0;
        riderBody = `You have collected Rs ${amt} cash for Order #${orderId}.`;
      }
    }

    if (userTitle) {
      void notifyOwnersSafely(
        [
          { ownerType: 'RESTAURANT', ownerId: order.restaurantId },
          { ownerType: 'USER', ownerId: order.userId },
        ],
        {
          title: userTitle,
          body: userBody,
          // Visible banner (notification block) + data for deep-linking. Without the
          // notification block these key milestones stay silent when the app is backgrounded.
          data: {
            type: 'order_status_update',
            orderId,
            orderMongoId: order._id?.toString?.() || '',
            orderStatus: status,
          },
        },
      );
    }

    if (riderTitle) {
      void notifyOwnerSafely(
        { ownerType: 'DELIVERY_PARTNER', ownerId: deliveryPartnerId },
        {
          title: riderTitle,
          body: riderBody,
          data: {
            type: status === 'delivered' ? 'order_completed' : 'order_status_update',
            orderId,
            orderMongoId: order._id?.toString?.() || '',
            paymentMethod: order.payment?.method || order.paymentMethod,
            amountCollected: String(order.pricing?.total || order.amounts?.totalCustomerPaid || 0),
          },
        },
      );
    }
  } catch (error) {
    logger.error(`Error emitting delivery order update: ${error?.message || error}`);
  }
}



// Lazy wrapper to avoid circular ESM init race condition
async function syncRazorpayQrPayment(orderDoc) {
  return paymentService.syncRazorpayQrPayment(orderDoc);
}




export async function getCurrentTripDelivery(deliveryPartnerId) {
  if (!deliveryPartnerId) {
    throw new ValidationError('Delivery partner ID required');
  }

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const order = await FoodOrder.findOne({
    'dispatch.deliveryPartnerId': partnerId,
    'dispatch.status': 'accepted',
    orderStatus: {
      $in: ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up'],
    },
  })
    .select(DELIVERY_ORDER_BASE_SELECT)
    .populate(DELIVERY_RESTAURANT_POPULATE)
    .populate({ path: 'userId', select: 'name phone' })
    .sort({ updatedAt: -1 })
    .lean();

  if (!order) return null;

  const tx = await FoodTransaction.findOne({ orderId: order._id })
    .select(DELIVERY_TRANSACTION_SELECT)
    .lean();

  return sanitizeOrderForDeliveryPartner(mergeTransactionIntoOrder(order, tx));
}

/** Every order the rider is carrying, first accepted first (see the Food twin). */
export async function getCurrentTripsDelivery(deliveryPartnerId) {
  if (!deliveryPartnerId) throw new ValidationError('Delivery partner ID required');
  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const orders = await FoodOrder.find({
    'dispatch.deliveryPartnerId': partnerId,
    'dispatch.status': 'accepted',
    orderStatus: { $in: ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up'] },
  })
    .select(DELIVERY_ORDER_BASE_SELECT)
    .populate(DELIVERY_RESTAURANT_POPULATE)
    .populate({ path: 'userId', select: 'name phone' })
    .sort({ 'dispatch.acceptedAt': 1, createdAt: 1 })
    .limit(5)
    .lean();
  const txs = await FoodTransaction.find({ orderId: { $in: orders.map((o) => o._id) } })
    .select(DELIVERY_TRANSACTION_SELECT)
    .lean();
  const txOf = new Map(txs.map((t) => [String(t.orderId), t]));
  return orders.map((order) => sanitizeOrderForDeliveryPartner(mergeTransactionIntoOrder(order, txOf.get(String(order._id)))));
}

export async function listOrdersAvailableDelivery(deliveryPartnerId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const hasActiveDelivery = await partnerHasActiveDelivery(deliveryPartnerId);

  const filter = hasActiveDelivery
    ? {
        'dispatch.deliveryPartnerId': partnerId,
        'dispatch.status': 'accepted',
        orderStatus: { $nin: TERMINAL_ORDER_STATUSES },
      }
    : {
        $or: [
          {
            'dispatch.status': 'unassigned',
            'dispatch.offeredTo': {
              $not: {
                $elemMatch: {
                  partnerId,
                  action: 'deassigned',
                },
              },
            },
            orderStatus: { $in: ['confirmed', 'preparing', 'ready_for_pickup'] },
            // A prescription order is only for riders once the customer has
            // agreed to the pharmacy's bill (approved for cash, or paid online).
            $or: RIDER_READY_PRESCRIPTION,
          },
          {
            'dispatch.deliveryPartnerId': partnerId,
            'dispatch.status': { $in: ['assigned', 'accepted'] },
            orderStatus: { $nin: TERMINAL_ORDER_STATUSES },
          },
        ],
      };

  // For idle partners, pull a wider candidate set then proximity-filter in memory.
  // Avoids returning another city's orders that the poll hydrate could lock into the modal.
  const queryLimit = hasActiveDelivery ? limit : Math.max(limit * 5, 50);

  const docs = await FoodOrder.find(filter)
    .select(DELIVERY_ORDER_BASE_SELECT)
    .sort({ createdAt: -1 })
    .limit(queryLimit)
    .populate(DELIVERY_USER_POPULATE)
    .populate(DELIVERY_RESTAURANT_POPULATE)
    .lean();

  const orderIds = docs.map((doc) => doc?._id).filter(Boolean);
  const txRows = orderIds.length
    ? await FoodTransaction.find({ orderId: { $in: orderIds } })
        .select(DELIVERY_TRANSACTION_SELECT)
        .lean()
    : [];
  const txByOrderId = new Map(txRows.map((tx) => [String(tx.orderId), tx]));

  let enriched = docs.map((doc) =>
    sanitizeOrderForDeliveryPartner(
      mergeTransactionIntoOrder(doc, txByOrderId.get(String(doc._id)) || null),
    ),
  );

  if (!hasActiveDelivery) {
    const partner = await FoodDeliveryPartner.findById(partnerId)
      .select('lastLat lastLng lastLocationAt')
      .lean();

    const MAX_OFFER_KM = 20; // slightly wider than dispatch radius (15km)
    const partnerLat = partner?.lastLat;
    const partnerLng = partner?.lastLng;
    // A position older than dispatch's window (45 min) no longer says where the
    // rider is: a rider who drove to another city would otherwise still be
    // shown the old city's orders. Then only their own offers are listed.
    const STALE_GPS_MS = Number(process.env.DISPATCH_STALE_GPS_MS) || 45 * 60 * 1000;
    const hasPartnerGps =
      partnerLat != null &&
      partnerLng != null &&
      Number.isFinite(Number(partnerLat)) &&
      Number.isFinite(Number(partnerLng)) &&
      Boolean(partner?.lastLocationAt) &&
      Date.now() - new Date(partner.lastLocationAt).getTime() <= STALE_GPS_MS;

    const withMeta = enriched.map((order) => {
      const assignedToMe = Boolean(
        order?.dispatch?.deliveryPartnerId &&
          String(order.dispatch.deliveryPartnerId) === String(partnerId),
      );

      const offeredToMe = Array.isArray(order?.dispatch?.offeredTo)
        ? order.dispatch.offeredTo.some(
            (entry) => String(entry?.partnerId) === String(partnerId),
          )
        : false;

      let distanceKm = null;
      const coords = order?.restaurantId?.location?.coordinates;
      if (hasPartnerGps && Array.isArray(coords) && coords.length >= 2) {
        const [rLng, rLat] = coords;
        const d = haversineKm(
          Number(partnerLat),
          Number(partnerLng),
          Number(rLat),
          Number(rLng),
        );
        if (Number.isFinite(d)) distanceKm = d;
      }

      return { order, assignedToMe, offeredToMe, distanceKm };
    });

    const kept = withMeta.filter(({ assignedToMe, offeredToMe, distanceKm }) => {
      if (assignedToMe) return true;

      // No partner GPS: only show orders already offered to this rider (safe vs global leak).
      if (!hasPartnerGps) return offeredToMe;

      // Missing/unresolvable restaurant coords: same offered-only rule.
      if (distanceKm == null) return offeredToMe;

      if (distanceKm <= MAX_OFFER_KM) return true;

      // Already offered to this rider: allow a small GPS-drift buffer, else drop.
      return offeredToMe && distanceKm <= MAX_OFFER_KM * 1.5;
    });

    // Rank the list so consumers that take its head (reconnect recovery, poll
    // hydrate in the rider app) surface the order this rider was actually
    // offered — not just the newest order in range, which could sit at a
    // different location than the offer the rider is expecting.
    kept.sort((a, b) => {
      if (a.assignedToMe !== b.assignedToMe) return a.assignedToMe ? -1 : 1;
      if (a.offeredToMe !== b.offeredToMe) return a.offeredToMe ? -1 : 1;
      const da = a.distanceKm == null ? Infinity : a.distanceKm;
      const db = b.distanceKm == null ? Infinity : b.distanceKm;
      return da - db;
    });

    // Surface the rider → restaurant distance already computed for filtering. The socket
    // offer (new_order_available) carries pickupDistanceKm, so REST must too — otherwise a
    // rider polling (or opening the app fresh) sees the earning without the travel distance.
    enriched = kept.map(({ order, distanceKm }) => ({
      ...order,
      pickupDistanceKm:
        distanceKm == null ? null : Number(Number(distanceKm).toFixed(2)),
    }));
  }

  const total = enriched.length;
  const paged = hasActiveDelivery
    ? enriched.slice(0, limit)
    : enriched.slice(skip, skip + limit);

  return buildPaginatedResult({ docs: paged, total, page, limit });
}

/**
 * Rejects an accept when the rider is already at their cash ceiling.
 *
 * Dispatch skips over-limit riders, but an offer sent a moment BEFORE they crossed
 * the line is still sitting on their phone — and a client-side block would be
 * trivially bypassed anyway. This is the authoritative check.
 *
 * Prepaid orders are unaffected: they add nothing to the rider's float.
 *
 * A limit of 0 means no limit, matching the schema default, so installs that never
 * configured this are untouched.
 */
async function assertCashLimitAllows(deliveryPartnerId, order) {
  const method = String(order?.payment?.method || order?.paymentMethod || '').toLowerCase();
  if (method !== 'cash' && method !== 'razorpay_qr') return;

  // The rider's ONE cash figure (core/finance/riderFinance): cash from Food,
  // Quick & Medical and taxi together, against their own limit (0 = none). It
  // read qc_delivery_wallets.cashInHand, which nothing but an admin edit ever
  // updates, so a rider took unlimited Quick/Medical cash orders.
  const { getRiderFinance } = await import('../../../../../../core/finance/riderFinance.service.js');
  const finance = await getRiderFinance(deliveryPartnerId).catch(() => null);
  const limit = Number(finance?.cashLimit) || 0;
  if (limit <= 0) return;

  const inHand = Number(finance?.cashInHand) || 0;
  const orderCash = Math.max(0, Number(order?.pricing?.total) || 0);
  if (inHand + orderCash > limit) {
    throw new ValidationError(
      `You are holding Rs.${inHand} in cash; this order would take you past your Rs.${limit} limit. ` +
        'Deposit your cash to keep accepting cash orders.',
    );
  }
}

/**
 * The QC partner's unified driver id, or null when they were never linked.
 *
 * Capabilities and the busy-lock live on the unified Driver, so an unlinked
 * partner has nowhere for a claim to land. Those are waved through rather than
 * blocked -- the same choice food makes -- because refusing work to every
 * un-backfilled rider would be a worse outage than the race it prevents. The
 * waiver goes away with the backfill.
 */
async function resolveUnifiedDriverId(deliveryPartnerId) {
  const partner = await FoodDeliveryPartner.findById(deliveryPartnerId).select('driverId').lean();
  return partner?.driverId || null;
}

/**
 * Claim the cross-vertical busy-lock for this grocery order.
 *
 * Flag-gated on the same switch food and taxi use, so the three verticals turn on
 * together: a half-enabled lock (QC claiming while food does not) would be worse
 * than none, because QC riders would be blocked from food work that food would
 * still happily assign.
 */
async function acquireQcLock(deliveryPartnerId, orderId) {
  if (!config.unifiedDispatchEnabled) return true;
  const driverId = await resolveUnifiedDriverId(deliveryPartnerId);
  if (!driverId) return true;
  const { claimed } = await claimAssignment(driverId, { vertical: 'quickCommerce', jobId: orderId });
  if (claimed) return true;
  // The hold may be a job that ended without letting go (deleted, or cancelled
  // from a path that forgot to release). Clear holds on finished or missing jobs
  // and try once more; a live job is never cleared, so a busy rider stays refused.
  const { reconcileAssignments } = await import('../../../../../../core/assignment/assignment.service.js');
  if (!(await reconcileAssignments(driverId).catch(() => 0))) return false;
  return (await claimAssignment(driverId, { vertical: 'quickCommerce', jobId: orderId })).claimed;
}

/** Give the lock back. Only clears an entry that is still THIS order. */
async function releaseQcLock(deliveryPartnerId, orderId) {
  if (!config.unifiedDispatchEnabled) return;
  const driverId = await resolveUnifiedDriverId(deliveryPartnerId);
  if (!driverId) return;
  await releaseAssignment(driverId, orderId);
}

/** Unassigned orders a rider may be shown: not a prescription order still waiting on its bill. */
const RIDER_READY_PRESCRIPTION = Object.freeze([
  { prescriptionOnly: { $ne: true } },
  { 'prescription.bill.status': 'approved' },
  { 'payment.status': 'paid' },
  // Priced through the older fill path (no bill step): items and a total.
  { 'prescription.bill.status': { $in: [null, 'none'] }, 'items.0': { $exists: true }, 'pricing.total': { $gt: 0 } },
]);

export async function acceptOrderDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  // Not before the customer has agreed to a prescription order's bill: until
  // then there is no price, no rider pay, and possibly no order at all.
  {
    const rx = await FoodOrder.findOne(identity).select('prescriptionOnly prescription.bill.status payment.status items pricing.total').lean();
    const billStatus = String(rx?.prescription?.bill?.status || 'none');
    const filledTheOldWay = billStatus === 'none' && (rx?.items || []).length > 0 && Number(rx?.pricing?.total) > 0;
    if (rx?.prescriptionOnly === true
      && billStatus !== 'approved'
      && String(rx.payment?.status || '') !== 'paid'
      && !filledTheOldWay) {
      throw new ValidationError('This medical order is waiting for the customer to accept the pharmacy bill.');
    }
  }

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const now = new Date();
  const acceptedStatuses = ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up'];
  const cancellableStatuses = [
    'cancelled_by_user',
    'cancelled_by_restaurant',
    'cancelled_by_admin',
  ];

  const alreadyOnTrip = await partnerHasActiveDelivery(deliveryPartnerId);
  if (alreadyOnTrip) {
    const existingActive = await FoodOrder.findOne({
      'dispatch.deliveryPartnerId': partnerId,
      'dispatch.status': 'accepted',
      orderStatus: { $nin: TERMINAL_ORDER_STATUSES },
    })
      .select('_id order_id orderId')
      .lean();

    const activeOrderKey = String(existingActive?._id || '');
    const requestedOrder = await FoodOrder.findOne(identity).select('_id').lean();
    const requestedOrderKey = String(requestedOrder?._id || '');

    if (activeOrderKey && requestedOrderKey && activeOrderKey === requestedOrderKey) {
      const acceptedOrder = await FoodOrder.findOne(identity).populate('restaurantId userId');
      return acceptedOrder ? sanitizeOrderForDeliveryPartner(acceptedOrder) : null;
    }
    // Another live order: allowed only if this one can join the trip -- the
    // batching check below decides.
  }

  const statusHistoryEntry = {
    byRole: 'DELIVERY_PARTNER',
    byId: partnerId,
    from: 'dispatchable',
    to: 'accepted',
    note: 'Delivery partner accepted order',
    at: now,
  };

  /*
   * Only an order this rider could see: one offered to them, one assigned to
   * them, or one whose store is within the list's 20km of where they were in
   * the last 45 minutes. Accept used to take any unassigned order on the
   * platform, whatever city it was in.
   */
  {
    const target = await FoodOrder.findOne(identity)
      .select('dispatch restaurantId')
      .populate({ path: 'restaurantId', select: 'location' })
      .lean();
    if (target && target.dispatch?.status === 'unassigned') {
      const offered = (target.dispatch.offeredTo || []).some((o) => String(o?.partnerId) === String(partnerId));
      if (!offered) {
        const me = await FoodDeliveryPartner.findById(partnerId).select('lastLat lastLng lastLocationAt').lean();
        const STALE_GPS_MS = Number(process.env.DISPATCH_STALE_GPS_MS) || 45 * 60 * 1000;
        const fresh = me?.lastLat != null && me?.lastLng != null && me?.lastLocationAt
          && Date.now() - new Date(me.lastLocationAt).getTime() <= STALE_GPS_MS;
        const coords = target.restaurantId?.location?.coordinates;
        const d = fresh && Array.isArray(coords) && coords.length >= 2
          ? haversineKm(Number(me.lastLat), Number(me.lastLng), Number(coords[1]), Number(coords[0]))
          : Infinity;
        if (!(Number.isFinite(d) && d <= 20)) {
          throw new ValidationError('This order is not near you. Accept orders sent to you or close by.');
        }
      }
    }
  }

  // Refuse before claiming the order, not after: a rider who is already at their
  // cash ceiling must not end up holding a cash trip they cannot be given.
  {
    const pending = await FoodOrder.findOne(identity)
      .select('payment paymentMethod pricing.total')
      .lean();
    if (pending) await assertCashLimitAllows(partnerId, pending);
  }

  /*
   * Claim the cross-vertical lock BEFORE assigning the order.
   *
   * `partnerHasActiveDelivery` above is a quick-commerce-only check: it queries QC
   * orders, so it cannot see that this rider is already carrying a food order or
   * has a passenger in the car. This is the gate that can.
   *
   * Released again below if the order update does not land, so a rider who loses
   * the race for an order is not left holding a lock on it.
   */
  const lockOrder = await FoodOrder.findOne(identity)
    .select('_id restaurantId deliveryAddress.location zoneId dispatch.assignMode dispatch.deliveryPartnerId')
    .lean();
  // An order an admin handed to this rider by hand skips the trip rule (see Food).
  const assignedByAdmin = lockOrder?.dispatch?.assignMode === 'manual'
    && String(lockOrder?.dispatch?.deliveryPartnerId || '') === String(partnerId);
  if (lockOrder && !assignedByAdmin) {
    // One order at a time across Food and Quick/Medical, unless this one can
    // join the rider's trip (core/delivery/batching.js). The lock below is a
    // no-op for riders without a unified driver record; this isn't.
    const { foodRiderIdForQcRider } = await import('../../../../../../core/delivery/qcRiderLink.js');
    const foodId = await foodRiderIdForQcRider(partnerId).catch(() => null);
    if (foodId) {
      const { canAddToTrip, refusalMessage } = await import('../../../../../../core/delivery/batching.js');
      const verdict = await canAddToTrip({ foodRiderId: foodId, order: lockOrder, vertical: 'quickCommerce' });
      if (!verdict.ok) throw new ValidationError(refusalMessage(verdict.reason));
    } else if (alreadyOnTrip) {
      throw new ValidationError('You already have an active delivery. Complete it before accepting another order.');
    }
  }
  if (lockOrder && !(await acquireQcLock(partnerId, lockOrder._id))) {
    throw new ValidationError('You are already on another job');
  }

  const order = await FoodOrder.findOneAndUpdate(
    {
      ...identity,
      orderStatus: { $in: acceptedStatuses },
      $or: [
        {
          'dispatch.status': 'unassigned',
          'dispatch.offeredTo': {
            $not: {
              $elemMatch: {
                partnerId,
                action: 'deassigned',
              },
            },
          },
        },
        {
          'dispatch.status': 'assigned',
          'dispatch.deliveryPartnerId': partnerId,
        },
      ],
    },
    {
      $set: {
        'dispatch.deliveryPartnerId': partnerId,
        'dispatch.status': 'accepted',
        'dispatch.assignedAt': now,
        'dispatch.acceptedAt': now,
      },
      // An admin's pick, once accepted, has no deadline left to expire.
      $unset: { 'dispatch.manualDeadlineAt': '' },
      $push: {
        statusHistory: statusHistoryEntry,
      },
    },
    { new: true },
  ).populate('restaurantId userId');

  if (!order) {
    // Accept did not land -- give the busy-lock back, or this rider is stuck
    // holding a claim on an order somebody else took.
    if (lockOrder) await releaseQcLock(partnerId, lockOrder._id);

    const existing = await FoodOrder.findOne(identity)
      .select('orderStatus dispatch')
      .lean();

    if (!existing) throw new NotFoundError('Order not found');
    if (cancellableStatuses.includes(existing.orderStatus)) {
      throw new ValidationError('Order was cancelled');
    }
    if (existing.orderStatus === 'delivered') {
      throw new ValidationError('Order already delivered');
    }
    if (!acceptedStatuses.includes(existing.orderStatus)) {
      throw new ValidationError('Order not ready for delivery assignment');
    }
    if (
      existing.dispatch?.status === 'accepted' &&
      String(existing.dispatch?.deliveryPartnerId || '') === String(deliveryPartnerId)
    ) {
      const acceptedOrder = await FoodOrder.findOne(identity)
        .populate('restaurantId userId');
      return acceptedOrder
        ? sanitizeOrderForDeliveryPartner(acceptedOrder)
        : null;
    }
    if (
      existing.dispatch?.status === 'accepted' &&
      String(existing.dispatch?.deliveryPartnerId || '') !== String(deliveryPartnerId)
    ) {
      throw new ForbiddenError('Order already accepted by another partner');
    }

    throw new ValidationError('Order is no longer available to accept');
  }

  const responseOrder = sanitizeOrderForDeliveryPartner(order);

  void (async () => {
    try {
      const rest = order.restaurantId;
      const userLoc = order.deliveryAddress?.location?.coordinates;
      const restLoc = rest?.location?.coordinates;

      if (restLoc?.[0] && userLoc?.[0]) {
        const route = await fetchDrivingRoute(
          { lat: restLoc[1], lng: restLoc[0] },
          { lat: userLoc[1], lng: userLoc[0] },
        );
        const polyline = route.polyline || '';

        if (route.distanceKm != null) {
          const tripDurationMins =
            route.durationSeconds != null
              ? Math.ceil(route.durationSeconds / 60)
              : null;
          FoodOrder.updateOne(
            { _id: order._id },
            {
              $set: {
                tripDistanceKm: route.distanceKm,
                tripDurationMins,
                'pricing.roadDistanceKm': route.distanceKm,
                'pricing.roadDurationMins': tripDurationMins,
              },
            },
          ).catch(() => {});
        }

        const db = getFirebaseDB();
        if (db) {
          const orderRef = db.ref(`active_orders/${order._id.toString()}`);
          await orderRef
            .set({
              polyline,
              lat: restLoc[1],
              lng: restLoc[0],
              boy_lat: restLoc[1],
              boy_lng: restLoc[0],
              restaurant_lat: restLoc[1],
              restaurant_lng: restLoc[0],
              customer_lat: userLoc[1],
              customer_lng: userLoc[0],
              status: 'accepted',
              last_updated: Date.now(),
            })
            .catch((error) =>
              logger.error(`Firebase orderRef set error: ${error.message}`),
            );
        }
      }
    } catch (error) {
      logger.error(
        `Error initializing Firebase order tracking: ${error?.message || error}`,
      );
    }

    try {
      await foodTransactionService.updateTransactionRider(order._id, deliveryPartnerId);
    } catch (error) {
      logger.error(
        `Error updating delivery rider transaction for ${order._id}: ${
          error?.message || error
        }`,
      );
    }

    // Everyone who was offered this order and did not win it. Deduped: a partner
    // can appear once per re-offer round, and pushing the same withdrawal three
    // times is just noise.
    const winner = deliveryPartnerId.toString();
    const losingPartnerIds = [
      ...new Set(
        (order.dispatch?.offeredTo || [])
          .map((offer) => offer.partnerId?.toString?.())
          .filter((pid) => pid && pid !== winner),
      ),
    ];

    const claimedPayload = {
      orderId: order._id.toString(),
      orderMongoId: order._id?.toString?.(),
      claimedBy: winner,
    };

    try {
      const io = getIO();
      if (io) {
        const payload = {
          orderMongoId: order._id?.toString?.(),
          orderId: order._id.toString(),
          orderStatus: order.orderStatus,
          dispatchStatus: order.dispatch?.status,
        };
        io.to(rooms.delivery(deliveryPartnerId)).emit('order_status_update', payload);
        io.to(rooms.restaurant(order.restaurantId)).emit('order_status_update', payload);
        io.to(rooms.user(order.userId)).emit('order_status_update', payload);

        for (const pid of losingPartnerIds) {
          io.to(rooms.delivery(pid)).emit('order_claimed', claimedPayload);
        }
        logger.info(
          `[DeliveryDispatch] Broadcast order_claimed to ${losingPartnerIds.length} other partners for order ${order._id.toString()}`,
        );
      }

      // The socket emit above only reaches riders whose app is open and connected.
      // The offer itself is delivered by a data-only push that the app raises as a
      // full-screen alert from its background isolate, so the rider most likely to
      // still be staring at a dead offer is exactly the one the socket cannot reach.
      // Withdraw over the same transport the offer arrived on.
      if (losingPartnerIds.length > 0) {
        try {
          await notifyOwnersSafely(
            losingPartnerIds.map((pid) => ({
              ownerType: 'DELIVERY_PARTNER',
              ownerId: pid,
            })),
            {
              title: 'Order taken',
              body: 'Another partner accepted this order.',
              // Data-only, like the offer: this must dismiss a UI, never add one.
              dataOnly: true,
              data: {
                type: 'order_taken',
                orderId: order._id.toString(),
                orderMongoId: order._id?.toString?.() || '',
              },
            },
          );
        } catch (err) {
          logger.warn(
            `order_taken push failed for order ${order._id}: ${err.message}`,
          );
        }
      }

      await notifyOwnersSafely(
        [
          { ownerType: 'USER', ownerId: order.userId },
          { ownerType: 'RESTAURANT', ownerId: order.restaurantId },
          { ownerType: 'DELIVERY_PARTNER', ownerId: deliveryPartnerId },
        ],
        {
          title: `Order ${order._id.toString()} accepted`,
          body: 'A delivery partner has accepted your order.',
          data: {
            type: 'delivery_accepted',
            orderId: order._id.toString(),
            orderMongoId: order._id?.toString?.() || '',
            dispatchStatus: order.dispatch?.status,
            link: '/food/user/orders',
          },
        },
      );
    } catch (error) {
      logger.error(
        `Error notifying delivery acceptance for ${order._id}: ${
          error?.message || error
        }`,
      );
    }
  })();

  enqueueOrderEvent('delivery_accepted', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    dispatchStatus: order.dispatch?.status,
    orderStatus: order.orderStatus,
  });

  return responseOrder;
}

export async function rejectOrderDelivery(orderId, deliveryPartnerId, { reason } = {}) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (order.dispatch.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()) {
    throw new ForbiddenError('Not your order');
  }

  // Only an order that hasn't been collected may be rejected. Without this a rider could
  // pick the food up and then reject: the order was re-dispatched to someone else while
  // rider #1 still held it, and every earnings/cash aggregation keyed on
  // dispatch.deliveryPartnerId lost the order — including the COD cash he was carrying.
  if (Boolean(order.deliveryState?.pickedUpAt) ||
      ['picked_up', 'reached_drop', 'delivered'].includes(String(order.orderStatus || ''))) {
    throw new ValidationError(
      'This order has already been picked up and cannot be rejected. Use emergency reassignment instead.'
    );
  }
  if (TERMINAL_ORDER_STATUSES.includes(String(order.orderStatus || ''))) {
    throw new ValidationError('This order is already closed');
  }

  const offer = order.dispatch.offeredTo.find(
    (item) =>
      String(item.partnerId) === String(deliveryPartnerId) &&
      item.action === 'offered',
  );
  if (offer) offer.action = 'rejected';

  // An admin's pick declined: back to auto-dispatch, and the admins are told
  // (core/delivery/manualAssign.js). Null for an ordinary reject.
  const manualAssign = await import('../../../../../../core/delivery/manualAssign.js');
  const declined = await manualAssign.noteManualDecline('quickCommerce', order, deliveryPartnerId, reason);

  order.dispatch.status = 'unassigned';
  order.dispatch.deliveryPartnerId = undefined;
  order.dispatch.assignedAt = undefined;
  order.dispatch.acceptedAt = undefined;
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from: 'assigned',
    to: 'unassigned',
    note: declined ? declined.note : 'Rejected',
  });
  await order.save();
  if (declined) void manualAssign.announceManualDecline('quickCommerce', order, deliveryPartnerId, declined);

  // Free the rider before the order is re-offered. Releasing after tryAutoAssign
  // would leave a window where this order is dispatchable but the only rider who
  // could take it still reads as busy on it.
  await releaseQcLock(deliveryPartnerId, order._id);

  enqueueOrderEvent('delivery_rejected', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
  });

  void dispatchService
    .tryAutoAssign(order._id)
    .catch((error) =>
      logger.error(`SmartDispatch: Auto-assign after reject failed: ${error.message}`),
    );

  return sanitizeOrderForExternal(order);
}

export async function confirmReachedPickupDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }
  if (order.orderStatus === 'delivered') {
    throw new ValidationError('Order already delivered');
  }

  const currentPhase = order.deliveryState?.currentPhase || '';
  const currentStatus = order.deliveryState?.status || '';
  if (currentPhase === 'at_pickup' || currentStatus === 'reached_pickup') {
    return sanitizeOrderForExternal(await withStoreForRider(order));
  }

  const from = currentStatus || currentPhase || order.orderStatus;
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'at_pickup',
    status: 'reached_pickup',
    reachedPickupAt: order.deliveryState?.reachedPickupAt || new Date(),
  };
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'reached_pickup',
    note: 'Reached pickup location',
  });
  await order.save();

  emitOrderUpdate(order, deliveryPartnerId);

  try {
    const restaurant = await FoodRestaurant.findById(order.restaurantId)
      .select('restaurantName')
      .lean();
    const partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
      .select('name')
      .lean();

    await notifyOwnersSafely(
      [{ ownerType: 'RESTAURANT', ownerId: order.restaurantId }],
      {
        title: 'Rider arrived!',
        body: `${partner?.name || 'The delivery partner'} has arrived at ${
          restaurant?.restaurantName || 'your restaurant'
        } to pick up Order .`,
        // #${order._id.toString()}
        data: {
          type: 'rider_arrived',
          // orderId: String(order._id.toString()),
          orderMongoId: String(order._id),
          partnerName: partner?.name || '',
        },
      },
    );
  } catch (error) {
    logger.error(
      `Error notifying restaurant about rider arrival for ${order._id}: ${
        error?.message || error
      }`,
    );
  }

  enqueueOrderEvent('reached_pickup', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    orderStatus: order.orderStatus,
    deliveryPhase: order.deliveryState?.currentPhase,
    deliveryStatus: order.deliveryState?.status,
  });
  return sanitizeOrderForExternal(await withStoreForRider(order));
}

export async function confirmPickupDelivery(orderId, deliveryPartnerId, billImageUrl) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  const from = order.orderStatus;
  const nextStatus = 'picked_up';
  if (!isStatusAdvance(from, nextStatus)) {
      throw new ValidationError(`Order is already at status '${from}'. Cannot re-mark as '${nextStatus}'.`);
  }
  order.orderStatus = nextStatus;
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'en_route_to_delivery',
    status: 'picked_up',
    pickedUpAt: new Date(),
    billImageUrl,
  };

  // Pre-generate handover OTP so user can see it as soon as food is on the way
  const existingOtp = String(order.deliveryOtp || '').trim();
  if (!existingOtp) {
    order.deliveryOtp = generateFourDigitDeliveryOtp();
    order.deliveryVerification = {
      ...(order.deliveryVerification?.toObject?.() ||
        order.deliveryVerification ||
        {}),
      dropOtp: { required: true, verified: false },
    };
  }

  emitDeliveryDropOtpToUser(order, String(order.deliveryOtp || "").trim());

  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'picked_up',
    note: 'Order picked up',
  });
  await order.save();

  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('picked_up', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    billImageUrl: billImageUrl || null,
  });
  return sanitizeOrderForExternal(await withStoreForRider(order));
}

export async function confirmReachedDropDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  if (order.deliveryVerification?.dropOtp?.verified) {
    emitOrderUpdate(order, deliveryPartnerId);
    return sanitizeOrderForDeliveryPartner(await withStoreForRider(order));
  }

  const alreadyAtDrop =
    order.deliveryState?.currentPhase === 'at_drop' ||
    order.deliveryState?.status === 'reached_drop';
  const fromPhase =
    order.deliveryState?.status ||
    order.deliveryState?.currentPhase ||
    order.orderStatus ||
    '';

  // Never regenerate an OTP the customer may already be displaying. It is issued at
  // pickup (getDropOtpUser exposes it from 'picked_up' onwards), so re-rolling it here
  // invalidated the code the customer reads out — the rider then got "Invalid OTP".
  const existingOtp = String(order.deliveryOtp || '').trim();
  if (!existingOtp) {
    order.deliveryOtp = generateFourDigitDeliveryOtp();
  }
  // Arm the OTP gate at drop regardless (early-return above covers already-verified).
  order.deliveryVerification = {
    ...(order.deliveryVerification?.toObject?.() ||
      order.deliveryVerification ||
      {}),
    dropOtp: { required: true, verified: false },
  };

  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'at_drop',
    status: 'reached_drop',
    reachedDropAt: order.deliveryState?.reachedDropAt || new Date(),
  };

  if (!alreadyAtDrop) {
    pushStatusHistory(order, {
      byRole: 'DELIVERY_PARTNER',
      byId: deliveryPartnerId,
      from: fromPhase,
      to: 'reached_drop',
      note: 'Reached drop location',
    });
  }

  await order.save();

  emitDeliveryDropOtpToUser(order, String(order.deliveryOtp || '').trim());
  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('reached_drop', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    dropOtpRequired: order.deliveryVerification?.dropOtp?.required ?? true,
    dropOtpVerified: order.deliveryVerification?.dropOtp?.verified ?? false,
  });
  return sanitizeOrderForDeliveryPartner(await withStoreForRider(order));
}

/*
 * Wrong handover codes. The code is 4 digits and a wrong guess cost nothing,
 * so a rider could try all 10,000 and "deliver" without the customer. After 5
 * wrong tries the code is replaced and the new one sent to the customer, so
 * guessing starts over against a code the rider has never seen.
 */
const MAX_HANDOVER_ATTEMPTS = 5;
async function rejectWrongHandoverCode(order) {
  const res = await FoodOrder.collection.findOneAndUpdate(
    { _id: order._id },
    { $inc: { dropOtpAttempts: 1 } },
    { returnDocument: 'after', projection: { dropOtpAttempts: 1 } },
  );
  const attempts = Number((res?.value ?? res)?.dropOtpAttempts || 0);
  if (attempts >= MAX_HANDOVER_ATTEMPTS) {
    const fresh = generateFourDigitDeliveryOtp();
    await FoodOrder.collection.updateOne(
      { _id: order._id },
      { $set: { deliveryOtp: fresh, dropOtpAttempts: 0 } },
    );
    order.deliveryOtp = fresh;
    emitDeliveryDropOtpToUser(order, fresh);
    throw new ValidationError('Too many wrong codes. The customer has been sent a new code.');
  }
  const left = MAX_HANDOVER_ATTEMPTS - attempts;
  throw new ValidationError(`Invalid OTP. Ask the customer for the code shown in their app. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
}

export async function verifyDropOtpDelivery(orderId, deliveryPartnerId, otp) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  if (order.deliveryVerification?.dropOtp?.verified) {
    return { order: sanitizeOrderForDeliveryPartner(await withStoreForRider(order)) };
  }

  const otpStr = String(otp || '').trim();
  if (!otpStr) throw new ValidationError('OTP is required');

  if (!order.deliveryVerification?.dropOtp?.required) {
    throw new ValidationError(
      'OTP verification is not active for this order. Confirm reached drop first.',
    );
  }

  const expected = String(order.deliveryOtp || '').trim();
  if (!expected || expected !== otpStr) {
    await rejectWrongHandoverCode(order);
  }

  if (!order.deliveryVerification) order.deliveryVerification = { dropOtp: {} };
  order.deliveryVerification.dropOtp.verified = true;
  order.markModified('deliveryVerification.dropOtp.verified');
  await order.save();

  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('drop_otp_verified', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
  });
  return { order: sanitizeOrderForDeliveryPartner(await withStoreForRider(order)) };
}

export async function completeDelivery(orderId, deliveryPartnerId, body = {}) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  // The rider must have the food, and the customer's handover code must be
  // checked. Completion used to work straight from confirmed/preparing: accept,
  // then complete, and the order was delivered (and a cash order recorded as
  // paid) with no pickup and no code. The code is only created at "reached
  // drop", so that step is required first.
  const riderHasFood =
    ['picked_up', 'reached_drop'].includes(order.orderStatus) ||
    ['en_route_to_delivery', 'at_drop'].includes(order.deliveryState?.currentPhase);
  if (!riderHasFood) {
    throw new ValidationError('Pick up the order before completing the delivery.');
  }
  if (!order.deliveryVerification?.dropOtp?.required) {
    throw new ValidationError('Tap "Reached drop" first. The customer gets a handover code to share with you.');
  }

  const { otp, ratings } = body;
  logger.info(`[DeliveryComplete] Attempting to complete order ${order._id} for partner ${deliveryPartnerId}. Status: ${order.orderStatus}`);

  // Pickup must have happened. dropOtp.required is only set at pickup/reached-drop, so
  // completing straight after accept skipped BOTH OTP guards below and still paid the
  // rider, credited totalDeliveries and marked COD collected — for food never collected.
  const hasPickedUp =
    Boolean(order.deliveryState?.pickedUpAt) ||
    ['picked_up', 'reached_drop'].includes(String(order.orderStatus || ''));
  if (!hasPickedUp) {
    throw new ValidationError('Confirm pickup before completing this delivery.');
  }

  if (
    otp &&
    order.deliveryVerification?.dropOtp?.required &&
    !order.deliveryVerification?.dropOtp?.verified
  ) {
    const orderWithSecret = await FoodOrder.findById(order._id).select('+deliveryOtp');
    const expected = String(orderWithSecret?.deliveryOtp || '').trim();
    if (expected && expected === String(otp).trim()) {
      order.deliveryVerification.dropOtp.verified = true;
      order.markModified('deliveryVerification.dropOtp.verified');
      logger.info(`[DeliveryComplete] OTP verified during completion call for ${order._id}`);
    } else {
      await rejectWrongHandoverCode(order);
    }
  }

  if (
    order.deliveryVerification?.dropOtp?.required &&
    !order.deliveryVerification?.dropOtp?.verified &&
    !otp
  ) {
    throw new ValidationError(
      'Customer handover OTP is required. Verify the OTP from the customer before completing delivery.',
    );
  }

  const from = order.orderStatus;
  const nextStatus = 'delivered';
  if (!isStatusAdvance(from, nextStatus)) {
      logger.warn(`[DeliveryComplete] Status advance check failed for ${order._id}. Current: ${from}`);
      throw new ValidationError(`Order is already at status '${from}'. Cannot re-mark as '${nextStatus}'.`);
  }
  
  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const prevPayStatus = String(tx?.payment?.status || order?.payment?.status || 'unpaid').toLowerCase();
  const payMethod = String(tx?.payment?.method || order?.payment?.method || order?.paymentMethod || 'cash').toLowerCase();

  logger.info(`[DeliveryComplete] Order ${order._id} payment: ${payMethod}, status: ${prevPayStatus}`);

  if (payMethod === 'razorpay_qr') {
    const syncedPayment = await syncRazorpayQrPayment(order);
    if (String(syncedPayment?.status || '').toLowerCase() !== 'paid') {
      throw new ValidationError('QR payment not verified yet');
    }
  }

  order.orderStatus = 'delivered';
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'delivered',
    status: 'delivered',
    deliveredAt: new Date(),
  };

  if (ratings) {
    order.ratings = {
      ...(order.ratings?.toObject?.() || order.ratings || {}),
      ...ratings,
    };
  }

  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'delivered',
    note: 'Delivery completed successfully',
  });

  // Mark payment as paid for COD orders upon delivery
  if (payMethod === 'cash' && order.payment && order.payment.status === 'cod_pending') {
    order.payment.status = 'paid';
    logger.info(`[DeliveryComplete] COD order ${order._id} marked as paid upon delivery.`);
  }

  await order.save();

  // The delivery is done, so the rider is free for work in ANY vertical. Awaited
  // rather than fired-and-forgotten: a rider left locked after finishing is
  // invisible to every dispatcher until the reconcile sweep runs.
  await releaseQcLock(deliveryPartnerId, order._id);

  // Increment the rider's lifetime completed-delivery counter (best-effort).
  FoodDeliveryPartner.updateOne(
    { _id: deliveryPartnerId },
    { $inc: { totalDeliveries: 1 } }
  ).catch((e) => logger.warn(`totalDeliveries increment failed: ${e?.message || e}`));

  // Referral reward: pays the rider who referred THIS rider, once they complete their
  // first delivery. Idempotent (unique index on referral log), never throws.
  import('../../delivery/services/deliveryReferral.service.js')
    .then(({ creditDeliveryReferralOnFirstDelivery }) =>
      creditDeliveryReferralOnFirstDelivery(String(deliveryPartnerId)),
    )
    .catch((e) => logger.warn(`referral credit hook failed: ${e?.message || e}`));

  // Customer cashback on the delivered order. Idempotent per order, never throws.
  import('../../user/services/cashback.service.js')
    .then(({ awardOrderCashback }) => awardOrderCashback(String(order._id)))
    .catch((e) => logger.warn(`cashback award hook failed: ${e?.message || e}`));

  // The rider now works in this order's zone: what shows them to that zone's
  // sub-admin (core/zones/riderZones.js). Idempotent, never throws.
  import('../../../../../../core/zones/riderZones.js')
    .then(async ({ addRiderZone }) => {
      const { FoodDeliveryPartner } = await import('../../delivery/models/deliveryPartner.model.js');
      return addRiderZone(FoodDeliveryPartner, deliveryPartnerId, order.zoneId);
    })
    .catch(() => {});

  // Daily order-target incentive progress (shared with the food vertical —
  // both count toward the same foodAndQuick target). Fire-and-forget and
  // idempotent per rider/rule/day, never throws.
  import('../../../../../../core/incentives/services/incentiveService.js')
    .then(({ onFoodOrQuickCommerceOrderCompleted }) =>
      onFoodOrQuickCommerceOrderCompleted({ deliveryPartnerId, vertical: 'quickCommerce', zoneId: order.zoneId || null }))
    .catch((e) => logger.warn(`incentive progress hook failed: ${e?.message || e}`));

  const ledgerKind =
    payMethod === 'cash' && prevPayStatus === 'cod_pending'
      ? 'cod_marked_paid_on_delivery'
      : 'payment_snapshot_sync';

  await foodTransactionService.updateTransactionStatus(order._id, ledgerKind, {
    status: 'captured',
    recordedByRole: 'DELIVERY_PARTNER',
    recordedById: deliveryPartnerId,
    note: `Delivery completed. Prev status: ${prevPayStatus}`,
  });

  // Medical/pharmacy orders settle automatically on delivery rather than
  // waiting on an admin's manual reconciliation -- explicitly requested for
  // this vertical only. Grocery/quick-commerce orders through this same
  // completeDelivery are unaffected and still settle the existing manual
  // way (foodTransaction.service.js settleRestaurant, admin-triggered).
  // Fire-and-forget and best-effort: the delivery itself must not fail if
  // this does.
  if (order.prescriptionOnly === true) {
    foodTransactionService
      .updateTransactionStatus(order._id, 'settled', {
        status: 'captured',
        note: 'Medical store payout settled automatically on delivery',
        recordedByRole: 'SYSTEM',
        recordedById: null,
      })
      .catch((err) => {
        logger.warn(`Auto-settlement failed for medical order ${order._id}: ${err?.message || err}`);
      });
  }

  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('delivery_completed', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    payMethod,
    prevPayStatus,
    paymentStatus: order.payment?.status,
  });
  return sanitizeOrderForDeliveryPartner(order);
}

export async function updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus) {
  // Riders move an order through pickup here. Two moves are not theirs:
  // 'delivered' goes through completeDelivery (handover code, payment check,
  // ledger), and a rider can never cancel as the restaurant -- that skipped
  // the refund and released nothing.
  if (orderStatus === 'cancelled_by_restaurant' || String(orderStatus).startsWith('cancelled')) {
    throw new ForbiddenError('Riders cannot cancel orders. Contact support if the order cannot be delivered.');
  }
  if (orderStatus === 'delivered') {
    return completeDelivery(orderId, deliveryPartnerId, {});
  }
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (order.dispatch.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()) {
    throw new ForbiddenError('Not your order');
  }

  const from = order.orderStatus;
  if (!isStatusAdvance(from, orderStatus)) {
      throw new ValidationError(`Current order status '${from}' is further ahead than '${orderStatus}'. Order cannot be moved backwards.`);
  }
  order.orderStatus = orderStatus;
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: orderStatus,
  });
  await order.save();

  enqueueOrderEvent('delivery_status_updated', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    from,
    to: orderStatus,
  });
  return sanitizeOrderForExternal(order);
}


/**
 * Driving route from the rider's current position to the next stop, for the active-trip map.
 *
 * `target` picks the destination; when omitted it is inferred from the trip phase — the
 * restaurant before pickup, the customer after. `orderId` accepts either the display id or
 * the Mongo _id. Returns empty-but-valid fields rather than throwing when Directions has
 * nothing to give, so the client can degrade instead of erroring.
 */
async function loadOrderForRoute(orderId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity)
    .select('userId dispatch deliveryState deliveryAddress restaurantId lastRiderLocation orderStatus')
    .populate('restaurantId', 'location addressLine1 restaurantName')
    // Deliberately NOT populating dispatch.deliveryPartnerId: the rider ownership
    // check below compares it with String(), which a populated document would turn
    // into "[object Object]" and reject every rider. computeOrderRoute looks the
    // partner up separately, and only when it needs a fallback origin.
    .lean();
  if (!order) throw new NotFoundError('Order not found');
  return order;
}

export async function getOrderRouteForDelivery(orderId, deliveryPartnerId, query = {}) {
  const order = await loadOrderForRoute(orderId);

  if (String(order.dispatch?.deliveryPartnerId || '') !== String(deliveryPartnerId)) {
    throw new ForbiddenError('Not your order');
  }

  return computeOrderRoute(order, query);
}

/**
 * Customer-facing twin of the rider's route endpoint.
 *
 * The tracking map previously drew the RTDB polyline, which is computed ONCE at
 * accept time as restaurant→customer and never re-cut. So before pickup it drew a
 * route the rider isn't on, and after pickup it never followed them. The rider app
 * looks correct precisely because it calls the route endpoint with a live origin,
 * so this gives the customer the same thing.
 *
 * Unlike the rider's version this ignores any client lat/lng and always uses the
 * rider's server-side last known position. Letting the customer pass arbitrary
 * coordinates would make this an open Directions proxy billed to us, and would
 * leak nothing useful anyway — they want the rider's route, not their own.
 */
export async function getOrderRouteForUser(orderId, userId, query = {}) {
  const order = await loadOrderForRoute(orderId);

  if (String(order.userId || '') !== String(userId)) {
    throw new ForbiddenError('Not your order');
  }

  return computeOrderRoute(order, { target: query?.target });
}

async function computeOrderRoute(order, query = {}) {
  // Origin: the rider's live position from the query, else their last known ping.
  const qLat = Number(query.lat);
  const qLng = Number(query.lng);
  const hasQueryOrigin = Number.isFinite(qLat) && Number.isFinite(qLng);
  const lastCoords = order.lastRiderLocation?.coordinates;
  let origin = hasQueryOrigin
    ? { lat: qLat, lng: qLng }
    : Array.isArray(lastCoords) && lastCoords.length >= 2
      ? { lat: Number(lastCoords[1]), lng: Number(lastCoords[0]) }
      : null;

  // Fall back to the partner's own last known position.
  //
  // order.lastRiderLocation is only written when the rider emits a socket
  // location-update FOR THIS ORDER, which before pickup has usually not happened
  // yet. The rider app never noticed because it passes its live coordinates in the
  // query; the customer app cannot, so every pre-pickup call returned an empty
  // polyline in ~15ms without ever reaching Directions — no line on the map.
  // The partner's lastLat/lastLng is refreshed by the availability ping regardless
  // of any order, so it is the right fallback.
  if (!origin) {
    const partnerId = order.dispatch?.deliveryPartnerId;
    if (partnerId) {
      const partner = await FoodDeliveryPartner.findById(partnerId)
        .select('lastLat lastLng')
        .lean();
      const pLat = Number(partner?.lastLat);
      const pLng = Number(partner?.lastLng);
      if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
        origin = { lat: pLat, lng: pLng };
      }
    }
  }

  const pickedUp =
    Boolean(order.deliveryState?.pickedUpAt) ||
    ['picked_up', 'reached_drop'].includes(String(order.orderStatus || ''));
  const target = ['restaurant', 'customer'].includes(String(query.target || ''))
    ? String(query.target)
    : pickedUp
      ? 'customer'
      : 'restaurant';

  const restCoords = order.restaurantId?.location?.coordinates;
  const custCoords = order.deliveryAddress?.location?.coordinates;
  const pick = target === 'customer' ? custCoords : restCoords;
  const destination =
    Array.isArray(pick) && pick.length >= 2
      ? { lat: Number(pick[1]), lng: Number(pick[0]) }
      : null;

  const empty = {
    polyline: '',
    distanceMeters: null,
    distanceKm: null,
    durationSeconds: null,
    durationMins: null,
    target,
    origin,
    destination,
  };
  if (!origin || !destination) return empty;

  const route = await fetchDrivingRoute(origin, destination);
  const durationSeconds = Number.isFinite(Number(route?.durationSeconds))
    ? Number(route.durationSeconds)
    : null;

  return {
    polyline: route?.polyline || '',
    distanceMeters: route?.distanceMeters ?? null,
    distanceKm: route?.distanceKm ?? null,
    durationSeconds,
    durationMins: durationSeconds != null ? Math.max(1, Math.ceil(durationSeconds / 60)) : null,
    target,
    origin,
    destination,
  };
}
