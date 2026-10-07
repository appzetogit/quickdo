import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from '../../../../core/auth/errors.js';
import { buildPaginatedResult, buildPaginationOptions } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { config } from '../../../../config/env.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { getFirebaseDB } from '../../../../config/firebase.js';
import { fetchPolyline } from '../utils/googleMaps.js';

import * as foodTransactionService from './foodTransaction.service.js';
import * as dispatchService from './order-dispatch.service.js';
import * as paymentService from './order-payment.service.js';

import {
  buildOrderIdentityFilter,
  emitDeliveryDropOtpToUser,
  enqueueOrderEvent,
  generateFourDigitDeliveryOtp,
  notifyOwnerSafely,
  notifyOwnersSafely,
  pushStatusHistory,
  sanitizeOrderForExternal,
  isStatusAdvance,
} from './order.helpers.js';
import { sendFoodInvoiceEmail } from '../../../../services/email.service.js';
import { sendFoodInvoiceWhatsApp } from '../../../../services/whatsapp.service.js';

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
          dataOnly: true,
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
          dataOnly: true,
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
    .populate({
      path: 'restaurantId',
      select: 'restaurantName name phone location addressLine1 area city state profileImage',
    })
    .populate({ path: 'userId', select: 'name phone' })
    .sort({ updatedAt: -1 })
    .lean();

  if (!order) return null;
  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const out = sanitizeOrderForExternal(order);
  if (tx) {
    out.paymentMethod = tx.payment?.method || tx.paymentMethod || out.paymentMethod;
    out.payment = tx.payment || out.payment;
    out.pricing = tx.pricing || out.pricing;
    out.amounts = tx.amounts || out.amounts;
    out.transactionStatus = tx.status || out.transactionStatus;
  }
  return out;
}

/**
 * Every order the rider is carrying (a batched trip has more than one),
 * first accepted first. getCurrentTripDelivery stays as it was for app
 * builds that know only one order.
 */
export async function getCurrentTripsDelivery(deliveryPartnerId) {
  if (!deliveryPartnerId) throw new ValidationError('Delivery partner ID required');
  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const orders = await FoodOrder.find({
    'dispatch.deliveryPartnerId': partnerId,
    'dispatch.status': 'accepted',
    orderStatus: { $in: ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up'] },
  })
    .populate({
      path: 'restaurantId',
      select: 'restaurantName name phone location addressLine1 area city state profileImage',
    })
    .populate({ path: 'userId', select: 'name phone' })
    .sort({ 'dispatch.acceptedAt': 1, createdAt: 1 })
    .limit(5)
    .lean();
  const txs = await FoodTransaction.find({ orderId: { $in: orders.map((o) => o._id) } }).lean();
  const txOf = new Map(txs.map((t) => [String(t.orderId), t]));
  return orders.map((order) => {
    const out = sanitizeOrderForExternal(order);
    const tx = txOf.get(String(order._id));
    if (tx) {
      out.paymentMethod = tx.payment?.method || tx.paymentMethod || out.paymentMethod;
      out.payment = tx.payment || out.payment;
      out.pricing = tx.pricing || out.pricing;
      out.amounts = tx.amounts || out.amounts;
      out.transactionStatus = tx.status || out.transactionStatus;
    }
    return out;
  });
}

export async function listOrdersAvailableDelivery(deliveryPartnerId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);

  // Only orders dispatch actually offered to this rider. This listed every
  // unassigned order on the platform, in every zone, and any rider could
  // accept any of them (see acceptOrderDelivery).
  const unassignedOffers = {
    'dispatch.status': 'unassigned',
    orderStatus: { $in: ['confirmed', 'preparing', 'ready_for_pickup'] },
    'dispatch.offeredTo.partnerId': new mongoose.Types.ObjectId(deliveryPartnerId),
  };
  const ownOrders = {
    'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(deliveryPartnerId),
    orderStatus: {
      $nin: [
        'delivered',
        'cancelled_by_user',
        'cancelled_by_restaurant',
        'cancelled_by_admin',
      ],
    },
  };

  // A Taxi-only driver sees no new food offers. Their OWN in-progress order is
  // always included regardless of mode — switching the toggle mid-delivery must
  // not make the job they are currently doing disappear.
  const acceptsDeliveries = await partnerAcceptsDeliveries(deliveryPartnerId);
  const filter = acceptsDeliveries
    ? { $or: [unassignedOffers, ownOrders] }
    : ownOrders;

  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name phone email')
      .populate(
        'restaurantId',
        'restaurantName name address phone ownerPhone primaryContactNumber location profileImage',
      )
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);

  const orderIds = (docs || []).map((d) => d?._id).filter(Boolean);
  const txRows = orderIds.length
    ? await FoodTransaction.find({ orderId: { $in: orderIds } }).lean()
    : [];
  const txByOrderId = new Map(txRows.map((t) => [String(t.orderId), t]));

  /*
   * An OFFER -- an order not yet assigned to this rider -- carries no customer
   * contact details. Every rider could page through every open order on the
   * platform and collect customers' phones and emails, with nothing to stop it.
   * Name, address and the drop point stay (they decide whether to take the job);
   * once the rider accepts, the order is theirs and this list returns it in full.
   */
  const withoutContact = (doc) => {
    if (String(doc?.dispatch?.deliveryPartnerId || '') === String(deliveryPartnerId)) return doc;
    const out = { ...doc, customerPhone: undefined };
    if (doc?.userId && typeof doc.userId === 'object') {
      out.userId = { _id: doc.userId._id, name: doc.userId.name };
    }
    if (doc?.deliveryAddress) {
      out.deliveryAddress = { ...doc.deliveryAddress, phone: undefined };
    }
    return out;
  };

  const enriched = (docs || []).map((raw) => {
    const doc = withoutContact(raw);
    const tx = txByOrderId.get(String(doc?._id)) || null;
    if (!tx) return doc;
    return {
      ...doc,
      paymentMethod: tx.payment?.method || tx.paymentMethod || doc.paymentMethod,
      payment: tx.payment || doc.payment,
      pricing: tx.pricing || doc.pricing,
      amounts: tx.amounts || doc.amounts,
      transactionStatus: tx.status || doc.transactionStatus,
    };
  });

  return buildPaginatedResult({ docs: enriched, total, page, limit });
}

/**
 * Driver unification: resolve a legacy FoodDeliveryPartner to its unified Driver id.
 * Populated by scripts/migrate-unify-drivers.js. Returns null when unmapped.
 */
async function resolveUnifiedDriverId(deliveryPartnerId) {
  const p = await FoodDeliveryPartner.findById(deliveryPartnerId).select('driverId').lean();
  return p?.driverId || null;
}

/**
 * Does this partner's work mode currently accept food deliveries?
 *
 * Dispatch already refuses to *offer* a food job to a driver set to Taxi-only,
 * but the available-orders list is polled every 15s and had no such filter — so
 * the toggle looked broken: orders kept appearing that could never be assigned.
 * Flag-gated and fail-open, matching the rest of the unified-driver code.
 */
async function partnerAcceptsDeliveries(deliveryPartnerId) {
  if (!config.unifiedDispatchEnabled) return true;
  const driverId = await resolveUnifiedDriverId(deliveryPartnerId);
  if (!driverId) return true; // not migrated yet — don't hide their work
  const { Driver } = await import('../../../taxi/driver/models/Driver.js');
  const driver = await Driver.findById(driverId)
    .select('workMode serviceCapabilities')
    .lean();
  if (!driver) return true;
  const workMode = driver.workMode || 'all';
  const caps = Array.isArray(driver.serviceCapabilities) ? driver.serviceCapabilities : [];
  return ['all', 'delivery'].includes(workMode) && caps.includes('delivery');
}

/**
 * Claim the cross-service busy-lock for a delivery so this person can't also be given a taxi
 * ride. Flag-gated: a no-op until UNIFIED_DISPATCH_ENABLED is on. Returns true when free to go.
 */
async function acquireDeliveryLock(deliveryPartnerId, orderId) {
  if (!config.unifiedDispatchEnabled) return true;
  const driverId = await resolveUnifiedDriverId(deliveryPartnerId);
  if (!driverId) return true; // not migrated yet — don't block the legacy flow
  const { acquireDriverAssignment } = await import(
    '../../../taxi/driver/services/driverAssignmentService.js'
  );
  if (await acquireDriverAssignment(driverId, 'delivery', orderId)) return true;
  // Same as Quick: a hold on a job that already ended (deleted, or cancelled
  // without a release) is cleared and the claim tried once more. Live jobs stay.
  const { reconcileAssignments } = await import('../../../../core/assignment/assignment.service.js');
  if (!(await reconcileAssignments(driverId).catch(() => 0))) return false;
  return acquireDriverAssignment(driverId, 'delivery', orderId);
}

/** Release the busy-lock for a finished/cancelled delivery. Safe no-op when unmapped or flag off. */
async function releaseDeliveryLock(deliveryPartnerId, orderId) {
  if (!config.unifiedDispatchEnabled) return;
  const driverId = await resolveUnifiedDriverId(deliveryPartnerId);
  if (!driverId) return;
  const { releaseDriverAssignment } = await import(
    '../../../taxi/driver/services/driverAssignmentService.js'
  );
  await releaseDriverAssignment(driverId, orderId);
}

export async function acceptOrderDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const now = new Date();
  // ponytail: a rider must not lock an order the restaurant hasn't confirmed yet ('created' =
  // paid but not accepted). Accept only from 'confirmed' onwards.
  const acceptedStatuses = ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up'];
  const cancellableStatuses = [
    'cancelled_by_user',
    'cancelled_by_restaurant',
    'cancelled_by_admin',
  ];

  const statusHistoryEntry = {
    byRole: 'DELIVERY_PARTNER',
    byId: partnerId,
    from: 'dispatchable',
    to: 'accepted',
    note: 'Delivery partner accepted order',
    at: now,
  };

  // Claim the cross-service busy-lock BEFORE assigning, so a driver already on a taxi ride
  // cannot also take this order. No-op while the unified flag is off.
  const lockOrderId = await FoodOrder.findOne(identity)
    .select('_id payment pricing dispatch restaurantId deliveryAddress.location zoneId')
    .lean();
  const offeredToMe = Boolean(lockOrderId) && (
    (lockOrderId.dispatch?.offeredTo || []).some((o) => String(o?.partnerId) === String(partnerId))
    || String(lockOrderId.dispatch?.deliveryPartnerId || '') === String(partnerId)
  );

  // A cash order is refused to a rider already at their cash limit (all
  // verticals, per-rider limit). Only dispatch checked it, so a rider over the
  // limit could still take cash orders from the list. Quick commerce already
  // checks at accept.
  if (offeredToMe && String(lockOrderId.payment?.method || '').toLowerCase() === 'cash') {
    const { getRiderFinance } = await import('../../../../core/finance/riderFinance.service.js');
    const f = await getRiderFinance(partnerId).catch(() => null);
    const limit = Number(f?.cashLimit) || 0;
    const orderCash = Math.max(0, Number(lockOrderId.pricing?.total) || 0);
    // (Not f.isBlocked -- that is the taxi wallet rule, which blocks every
    // food-only rider; only the cash ceiling applies to a food order.)
    if (limit > 0 && (Number(f?.cashInHand) || 0) + orderCash > limit) {
      throw new ValidationError('You are holding too much cash to take a cash order. Deposit your cash first.');
    }
  }
  if (lockOrderId && offeredToMe) {
    // One order at a time, unless this one can join the rider's trip
    // (core/delivery/batching.js). Covers Food and Quick orders alike;
    // the lock below is a no-op for riders without a unified driver record.
    const { canAddToTrip, refusalMessage } = await import('../../../../core/delivery/batching.js');
    // An admin who hands this order to this rider by hand has decided; their
    // assign screen already warned that the rider is on a trip.
    const assignedByAdmin = lockOrderId.dispatch?.assignMode === 'manual'
      && String(lockOrderId.dispatch?.deliveryPartnerId || '') === String(partnerId);
    const verdict = assignedByAdmin
      ? { ok: true }
      : await canAddToTrip({ foodRiderId: partnerId, order: lockOrderId, vertical: 'food' });
    if (!verdict.ok) throw new ValidationError(refusalMessage(verdict.reason));
  }
  if (lockOrderId && !(await acquireDeliveryLock(partnerId, lockOrderId._id))) {
    throw new ValidationError('You are already on another job');
  }

  const order = await FoodOrder.findOneAndUpdate(
    {
      ...identity,
      orderStatus: { $in: acceptedStatuses },
      $or: [
        // Offered to this rider by dispatch.
        {
          'dispatch.status': 'unassigned',
          // (dispatch re-broadcasts to earlier recipients, so any past offer counts)
          'dispatch.offeredTo.partnerId': partnerId,
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
    // Accept did not land — give the busy-lock back so the driver isn't stuck.
    if (lockOrderId) await releaseDeliveryLock(partnerId, lockOrderId._id);
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
        ? sanitizeOrderForExternal(acceptedOrder)
        : null;
    }
    if (
      existing.dispatch?.status === 'accepted' &&
      String(existing.dispatch?.deliveryPartnerId || '') !== String(deliveryPartnerId)
    ) {
      throw new ForbiddenError('Order already accepted by another partner');
    }
    if (existing.dispatch?.status === 'unassigned') {
      throw new ForbiddenError('This order was not offered to you');
    }

    throw new ValidationError('Order is no longer available to accept');
  }

  const responseOrder = sanitizeOrderForExternal(order);

  void (async () => {
    try {
      const rest = order.restaurantId;
      const userLoc = order.deliveryAddress?.location?.coordinates;
      const restLoc = rest?.location?.coordinates;

      if (restLoc?.[0] && userLoc?.[0]) {
        const polyline = await fetchPolyline(
          { lat: restLoc[1], lng: restLoc[0] },
          { lat: userLoc[1], lng: userLoc[0] },
        );

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

        // Notify ALL other delivery partners who were offered this order to dismiss it
        const offeredPartners = order.dispatch?.offeredTo || [];
        const claimedPayload = {
          orderId: order._id.toString(),
          orderMongoId: order._id?.toString?.(),
          claimedBy: deliveryPartnerId.toString(),
        };
        for (const offer of offeredPartners) {
          const pid = offer.partnerId?.toString?.();
          if (pid && pid !== deliveryPartnerId.toString()) {
            io.to(rooms.delivery(pid)).emit('order_claimed', claimedPayload);
          }
        }
        logger.info(`[DeliveryDispatch] Broadcasted order_claimed to ${offeredPartners.length - 1} other partners for order ${order._id.toString()}`);
      }

      // order is populated by the time this runs, so order.userId /
      // order.restaurantId are full documents rather than ids. The token lookup
      // only survived that because mongoose casts a document to its _id; passing
      // the id explicitly is what was meant, and it keeps whole user records out
      // of the logs.
      const ownerIdOf = (value) => (value && value._id ? value._id : value);

      await notifyOwnersSafely(
        [
          { ownerType: 'USER', ownerId: ownerIdOf(order.userId) },
          { ownerType: 'RESTAURANT', ownerId: ownerIdOf(order.restaurantId) },
          { ownerType: 'DELIVERY_PARTNER', ownerId: ownerIdOf(deliveryPartnerId) },
        ],
        {
          // order_id is the human-readable reference (FOD-1234567) shown
          // everywhere else. This notification was showing the customer a raw
          // Mongo ObjectId.
          title: `Order ${order.order_id || order._id.toString()} accepted`,
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
  await releaseDeliveryLock(deliveryPartnerId, order._id);
  if (order.dispatch.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()) {
    throw new ForbiddenError('Not your order');
  }

  const offer = order.dispatch.offeredTo.find(
    (item) =>
      String(item.partnerId) === String(deliveryPartnerId) &&
      item.action === 'offered',
  );
  if (offer) offer.action = 'rejected';

  // An admin's pick declined: back to auto-dispatch, and the admins are told
  // (core/delivery/manualAssign.js). Null for an ordinary reject.
  const manualAssign = await import('../../../../core/delivery/manualAssign.js');
  const declined = await manualAssign.noteManualDecline('food', order, deliveryPartnerId, reason);

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
  if (declined) void manualAssign.announceManualDecline('food', order, deliveryPartnerId, declined);

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
    return sanitizeOrderForExternal(order);
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
        } to pick up Order #${order._id.toString()}.`,
        data: {
          type: 'rider_arrived',
          orderId: String(order._id.toString()),
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
  return sanitizeOrderForExternal(order);
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
  return sanitizeOrderForExternal(order);
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
    return sanitizeOrderForExternal(order);
  }

  const alreadyAtDrop =
    order.deliveryState?.currentPhase === 'at_drop' ||
    order.deliveryState?.status === 'reached_drop';
  const fromPhase =
    order.deliveryState?.status ||
    order.deliveryState?.currentPhase ||
    order.orderStatus ||
    '';

  const existingOtp = String(order.deliveryOtp || '').trim();
  // An order already at the drop with a code but the gate not armed (it was
  // moved there by hand, or by an older build) used to skip this block, so
  // Verify OTP was refused with "not active" and Complete with "tap Reached
  // drop first" -- an unfinishable order. Arm the gate without re-rolling a
  // code the customer may already have been shown.
  const gateArmed = order.deliveryVerification?.dropOtp?.required === true;
  if (!alreadyAtDrop || !existingOtp || !gateArmed) {
    if (!alreadyAtDrop || !existingOtp) {
      order.deliveryOtp = generateFourDigitDeliveryOtp();
    }
    order.deliveryVerification = {
      ...(order.deliveryVerification?.toObject?.() ||
        order.deliveryVerification ||
        {}),
      dropOtp: { required: true, verified: false },
    };
  }

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
  return sanitizeOrderForExternal(order);
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
    return { order: sanitizeOrderForExternal(order) };
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
  return { order: sanitizeOrderForExternal(order) };
}

export async function completeDelivery(orderId, deliveryPartnerId, body = {}) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp').populate('userId', 'name email');
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

  await order.save();

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

  // Delivery finished — free the driver for the next job (ride or delivery).
  await releaseDeliveryLock(deliveryPartnerId, order._id);

  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('delivery_completed', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    payMethod,
    prevPayStatus,
    paymentStatus: order.payment?.status,
  });

  // Trigger invoice email and WhatsApp asynchronously
  sendFoodInvoiceEmail(order, order.userId).catch(err => logger.error('Error triggering food invoice email', err));
  sendFoodInvoiceWhatsApp(order, order.userId).catch(err => logger.error('Error triggering food invoice WhatsApp', err));

  // Cashback is credited on delivery, never on payment: an order that is paid for
  // and then cancelled must not earn any. Fire-and-forget and idempotent by order
  // id — a cashback failure must never fail the delivery the driver just completed.
  // Inert until an admin turns cashback on; the settings document defaults to
  // isEnabled: false.
  import('../../user/services/cashback.service.js')
    .then(({ awardOrderCashback }) => awardOrderCashback(String(order._id)))
    .catch((err) => logger.warn(`Cashback award skipped for ${order._id}: ${err?.message || err}`));

  // The rider now works in this order's zone: what shows them to that zone's
  // sub-admin (core/zones/riderZones.js). Idempotent, never throws.
  import('../../../../core/zones/riderZones.js')
    .then(async ({ addRiderZone }) => {
      const { FoodDeliveryPartner } = await import('../../delivery/models/deliveryPartner.model.js');
      return addRiderZone(FoodDeliveryPartner, deliveryPartnerId, order.zoneId);
    })
    .catch(() => {});

  // Daily order-target incentive progress. Fire-and-forget and idempotent
  // per rider/rule/day — never fails the delivery the driver just completed.
  import('../../../../core/incentives/services/incentiveService.js')
    .then(({ onFoodOrQuickCommerceOrderCompleted }) =>
      onFoodOrQuickCommerceOrderCompleted({ deliveryPartnerId, vertical: 'food', zoneId: order.zoneId || null }))
    .catch((err) => logger.warn(`Incentive progress hook skipped for ${order._id}: ${err?.message || err}`));

  return sanitizeOrderForExternal(order);
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
