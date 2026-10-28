import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { logger } from '../../../../utils/logger.js';
import { haversineKm as geoHaversineKm, parseGeoPoint } from '../../shared/geo.utils.js';
import {
  notifyOwnersActionableAlert,
  sendNotificationToOwner,
  sendNotificationToOwners,
} from "../../../../core/notifications/firebase.service.js";
import { getIO, rooms } from '../../../../config/socket.js';
import { holdIfConfigured, registerHoldTarget } from '../../../../../../core/orders/orderHold.js';
import { isMedicalStore } from '../../shared/storeType.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';

export function enqueueOrderEvent(action, payload = {}) {
  try {
    void addOrderJob({ action, ...payload }).catch((err) => {
      logger.warn(`BullMQ enqueue order event failed: ${action} - ${err?.message || err}`);
    });
  } catch (err) {
    logger.warn(`BullMQ enqueue order event failed (sync): ${action} - ${err?.message || err}`);
  }
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  return geoHaversineKm(lat1, lon1, lat2, lon2);
}

/**
 * Build a dialer URI the client can hand straight to url_launcher / Linking.
 * Strips spaces, dashes and brackets — a raw number with formatting won't dial.
 * Returns '' when there is no usable number, so the app can hide the call button.
 */
export function buildTelUri(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (digits.replace(/\D/g, '').length < 6) return '';
  return `tel:${digits}`;
}

export function generateFourDigitDeliveryOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function sanitizeOrderForExternal(orderDoc) {
  const o = orderDoc?.toObject ? orderDoc.toObject() : { ...(orderDoc || {}) };
  delete o.deliveryOtp;
  const dv = o.deliveryVerification;
  if (dv && dv.dropOtp != null) {
    const d = dv.dropOtp;
    o.deliveryVerification = {
      ...dv,
      dropOtp: {
        required: Boolean(d.required),
        verified: Boolean(d.verified),
      },
    };
  }
  o.orderMongoId = (o._id || orderDoc?._id || "").toString();
  // Ensure orderId field for UI always contains the pretty ID
  o.orderId = o.order_id || o.orderMongoId; 
  return o;
}

export function sanitizeOrderForDeliveryPartner(orderDoc) {
  const o = sanitizeOrderForExternal(orderDoc);
  const cookingNote = String(o.note || "").trim();
  const deliveryInstructions = String(o.deliveryInstructions || "").trim();
  return {
    ...o,
    cookingNote,
    deliveryInstructions,
    note: deliveryInstructions,
  };
}

export function emitDeliveryDropOtpToUser(order, plainOtp) {
  try {
    const io = getIO();
    if (!io || !plainOtp || !order?.userId) return;
    io.to(rooms.user(order.userId)).emit("delivery_drop_otp", {
      orderMongoId: order._id?.toString?.(),
      orderId: order.order_id || order._id?.toString?.(),
      otp: plainOtp,
      message:
        "Share this OTP with your delivery partner to hand over the order.",
    });
  } catch (e) {
    logger.warn(`emitDeliveryDropOtpToUser failed: ${e?.message || e}`);
  }
}

export async function notifyOwnersSafely(targets, payload) {
  try {
    await sendNotificationToOwners(targets, payload);
  } catch (error) {
    logger.warn(`FCM notification failed: ${error?.message || error}`);
  }
}

/** Re-exported so dispatch and the order helpers share one definition. */
export { notifyOwnersActionableAlert };

export async function notifyOwnerSafely(target, payload) {
  try {
    await sendNotificationToOwner({ ...target, payload });
  } catch (error) {
    logger.warn(`FCM notification failed: ${error?.message || error}`);
  }
}

export const TERMINAL_ORDER_STATUSES = [
  'delivered',
  'cancelled_by_user',
  'cancelled_by_restaurant',
  'cancelled_by_admin',
];

export async function partnerHasActiveDelivery(deliveryPartnerId) {
  if (!deliveryPartnerId) return false;

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const active = await FoodOrder.exists({
    'dispatch.deliveryPartnerId': partnerId,
    'dispatch.status': 'accepted',
    orderStatus: { $nin: TERMINAL_ORDER_STATUSES },
  });

  return Boolean(active);
}

export async function getBusyDeliveryPartnerIds() {
  const rows = await FoodOrder.find({
    'dispatch.status': 'accepted',
    'dispatch.deliveryPartnerId': { $exists: true, $ne: null },
    orderStatus: { $nin: TERMINAL_ORDER_STATUSES },
  })
    .select('dispatch.deliveryPartnerId')
    .lean();

  return new Set(rows.map((row) => String(row.dispatch.deliveryPartnerId)));
}

export function buildOrderIdentityFilter(orderIdOrMongoId) {
  const raw = String(orderIdOrMongoId || "").trim();
  if (!raw) return null;
  if (mongoose.isValidObjectId(raw))
    return { _id: new mongoose.Types.ObjectId(raw) };
  
  // Search BOTH underscore and camelCase variants for robust lookup
  return { 
    $or: [
        { order_id: raw },
        { orderId: raw },
        // A medical order renumbered FOD- -> MED- still answers to its old number.
        { previousOrderIds: raw }
    ]
  };
}

export function toGeoPoint(lat, lng) {
  if (lat == null || lng == null) return undefined;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return { type: "Point", coordinates: [b, a] };
}

export function pushStatusHistory(order, { byRole, byId, from, to, note = "" }) {
  order.statusHistory.push({
    at: new Date(),
    byRole,
    byId: byId || undefined,
    from,
    to,
    note,
  });
}

export function normalizeOrderForClient(orderDoc) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const mongoId = (order._id || orderDoc?._id || "").toString();
  const displayId = order.order_id || mongoId;
  const statusHistory = Array.isArray(order?.statusHistory)
    ? order.statusHistory
    : [];
  const cancellationEntry = [...statusHistory]
    .reverse()
    .find((entry) => String(entry?.to || "").toLowerCase().includes("cancel"));
  const cancellationReason =
    String(order?.cancellationReason || "").trim() ||
    String(cancellationEntry?.note || "").trim();
  const cancellationStatus = String(cancellationEntry?.to || "").toLowerCase();
  let cancelledBy = "";
  if (cancellationStatus === "cancelled_by_user") cancelledBy = "customer";
  else if (cancellationStatus === "cancelled_by_restaurant")
    cancelledBy = "restaurant";
  else if (cancellationStatus === "cancelled_by_admin") cancelledBy = "admin";
  else if (String(cancellationEntry?.byRole || "").toUpperCase() === "USER")
    cancelledBy = "customer";
  else if (
    String(cancellationEntry?.byRole || "").toUpperCase() === "RESTAURANT"
  )
    cancelledBy = "restaurant";
  else if (String(cancellationEntry?.byRole || "").toUpperCase() === "ADMIN")
    cancelledBy = "admin";

  // Present only when the caller populated restaurantId (e.g. the customer's
  // own getOrderById) -- ownerPhone/primaryContactNumber otherwise sit
  // unreachable inside a bare ObjectId string. Flattened here, the one place
  // every customer-facing order response passes through, so the app can call
  // the pharmacy/restaurant the same way it already calls the rider.
  const restaurant =
    order.restaurantId && typeof order.restaurantId === "object"
      ? order.restaurantId
      : null;
  const restaurantPhone =
    restaurant?.primaryContactNumber || restaurant?.ownerPhone || restaurant?.phone || "";

  return {
    ...order,
    orderMongoId: mongoId,
    orderId: displayId,
    ...(restaurantPhone ? { restaurantPhone } : {}),
    status: order?.orderStatus || order?.status || "",
    cancellationReason,
    cancelledBy,
    cancelledAt: cancellationEntry?.at || null,
    deliveredAt:
      order?.deliveryState?.deliveredAt || order?.deliveredAt || null,
    deliveryPartnerId:
      order?.dispatch?.deliveryPartnerId || order?.deliveryPartnerId || null,
    rating: order?.ratings?.restaurant?.rating ?? order?.rating ?? null,
    deliveryState: {
      ...(order?.deliveryState || {}),
      currentLocation: order?.lastRiderLocation?.coordinates?.length >= 2 ? {
        lat: order.lastRiderLocation.coordinates[1],
        lng: order.lastRiderLocation.coordinates[0]
      } : (order?.deliveryState?.currentLocation || null)
    },
    eta: buildLiveEta(order)
  };
}

/** Straight-line km inflated to approximate road distance for city driving. */
const ROAD_FACTOR = 1.3;
/** Average city delivery speed (km/h) — bikes in traffic. */
export const AVG_SPEED_KMPH = 22;
/**
 * Minutes the seller spends picking and packing before a rider can leave.
 *
 * The customer-facing countdown was pure rider travel time, which is only the
 * truth once the order is already in a bag. Quoting travel alone means every
 * order reads late from the moment it is placed.
 *
 * ponytail: one flat number for every seller. Derive it per seller from their
 * own accept-to-ready times once there is enough history to be worth trusting.
 */
export const PACKING_MINUTES = Number(process.env.PACKING_MINUTES) || 3;

/**
 * Live ETA derived from the rider's last known position, recomputed on every read.
 *
 * Deliberately NOT a Directions API call: this is read on every order fetch and poll, so a
 * paid call here would be billed per refresh. Accuracy is "good enough for a countdown";
 * `source` tells the client what it is looking at.
 */
export function buildLiveEta(order) {
  const status = String(order?.orderStatus || '');
  if (['delivered', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'].includes(status)) {
    return { minutes: null, distanceKm: null, source: 'completed', target: null };
  }

  const rider = order?.lastRiderLocation?.coordinates?.length >= 2
    ? { lat: order.lastRiderLocation.coordinates[1], lng: order.lastRiderLocation.coordinates[0] }
    : null;

  const pickedUp = Boolean(order?.deliveryState?.pickedUpAt) || ['picked_up', 'reached_drop'].includes(status);
  // Before pickup the rider is heading to the restaurant; after, to the customer.
  const dest = pickedUp ? parseGeoPoint(order?.deliveryAddress) : parseGeoPoint(order?.restaurantId);
  const target = pickedUp ? 'customer' : 'restaurant';

  if (rider && dest) {
    const straight = geoHaversineKm(rider.lat, rider.lng, dest.lat, dest.lng);
    if (Number.isFinite(straight)) {
      const km = Number((straight * ROAD_FACTOR).toFixed(2));
      const minutes = Math.max(1, Math.ceil((km / AVG_SPEED_KMPH) * 60));
      return {
        minutes,
        distanceKm: km,
        source: 'live',
        target,
        promiseMinutes: buildDeliveryPromise(order, { minutes, pickedUp, status })
      };
    }
  }

  // No rider fix yet — fall back to the trip estimate captured at order time.
  const fallback = Number(order?.tripDurationMins ?? order?.pricing?.roadDurationMins);
  if (Number.isFinite(fallback) && fallback > 0) {
    return {
      minutes: Math.ceil(fallback),
      distanceKm: Number(order?.tripDistanceKm ?? order?.pricing?.roadDistanceKm) || null,
      source: 'estimate',
      target,
      promiseMinutes: buildDeliveryPromise(order, { minutes: null, pickedUp, status })
    };
  }

  return {
    minutes: null,
    distanceKm: null,
    source: 'unavailable',
    target,
    promiseMinutes: buildDeliveryPromise(order, { minutes: null, pickedUp, status })
  };
}

/**
 * Minutes until the customer has the order, as opposed to minutes until the
 * rider reaches wherever they are currently heading.
 *
 * `minutes` above answers the rider's question and is what the map needs. It is
 * the wrong number to show a customer before pickup, because it counts a leg
 * that ends at the seller's counter. The promise is what is still to happen:
 * packing, the ride to the seller, then the ride to the door -- with the first
 * two overlapping, since a rider travelling while the order is packed costs
 * whichever of the two is longer, not both.
 */
function buildDeliveryPromise(order, { minutes, pickedUp, status }) {
  // Once the rider has the bag, the remaining wait is just their journey.
  if (pickedUp) return Number.isFinite(minutes) ? minutes : null;

  const legToCustomer = Number(order?.pricing?.roadDurationMins ?? order?.tripDurationMins);
  if (!Number.isFinite(legToCustomer) || legToCustomer <= 0) return null;

  const alreadyPacked = ['ready_for_pickup', 'reached_pickup'].includes(String(status));
  const packing = alreadyPacked ? 0 : PACKING_MINUTES;
  const legToSeller = Number.isFinite(minutes) ? minutes : 0;

  return Math.ceil(Math.max(packing, legToSeller) + legToCustomer);
}

export async function applyAggregateRating(model, entityId, newRating) {
  if (!entityId) return;
  const doc = await model.findById(entityId).select("rating totalRatings");
  if (!doc) return;

  const totalRatings = Number(doc.totalRatings || 0);
  const currentAverage = Number(doc.rating || 0);
  const nextTotal = totalRatings + 1;
  const nextAverage = Number(
    ((currentAverage * totalRatings + Number(newRating)) / nextTotal).toFixed(1),
  );

  doc.totalRatings = nextTotal;
  doc.rating = nextAverage;
  await doc.save();
}

export function buildDeliverySocketPayload(orderDoc, restaurantDoc = null) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const restaurant = restaurantDoc || order?.restaurantId || null;
  const restaurantLocation = restaurant?.location || {};
  const deliveryAddress = order?.deliveryAddress || {};
  const customerAddressParts = [
    deliveryAddress.street,
    deliveryAddress.additionalDetails,
    deliveryAddress.city,
    deliveryAddress.state,
    deliveryAddress.zipCode,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  // Prefer robust geo parse (GeoJSON [lng,lat], lat/lng, nested location)
  const restaurantPoint =
    parseGeoPoint(restaurant) ||
    parseGeoPoint(restaurantLocation) ||
    parseGeoPoint({
      lat: restaurantLocation?.latitude ?? restaurantLocation?.lat,
      lng: restaurantLocation?.longitude ?? restaurantLocation?.lng,
    });
  const customerPoint =
    parseGeoPoint(deliveryAddress) ||
    parseGeoPoint(order?.customerLocation) ||
    parseGeoPoint({
      lat: deliveryAddress?.latitude ?? deliveryAddress?.lat,
      lng: deliveryAddress?.longitude ?? deliveryAddress?.lng,
    });

  const restaurantLat = restaurantPoint?.lat;
  const restaurantLng = restaurantPoint?.lng;
  const customerLat = customerPoint?.lat;
  const customerLng = customerPoint?.lng;

  // Prefer road distance when already computed; fall back to pricing Haversine.
  // Never use pickupDistanceKm (rider → restaurant) here — this is restaurant ↔ customer.
  const tripDistanceKmRaw =
    order?.tripDistanceKm ??
    order?.pricing?.roadDistanceKm ??
    order?.pricing?.distanceKm;
  let tripDistanceKm = Number.isFinite(Number(tripDistanceKmRaw))
    ? Number(Number(tripDistanceKmRaw).toFixed(2))
    : null;

  // If still missing, compute Haversine restaurant → customer so UI never shows blank/wrong.
  if (
    tripDistanceKm == null &&
    Number.isFinite(restaurantLat) &&
    Number.isFinite(restaurantLng) &&
    Number.isFinite(customerLat) &&
    Number.isFinite(customerLng)
  ) {
    const hv = haversineKm(restaurantLat, restaurantLng, customerLat, customerLng);
    if (Number.isFinite(hv)) {
      tripDistanceKm = Number(Number(hv).toFixed(2));
    }
  }

  const tripDurationMinsRaw =
    order?.tripDurationMins ?? order?.pricing?.roadDurationMins;
  let tripDurationMins = Number.isFinite(Number(tripDurationMinsRaw))
    ? Math.ceil(Number(tripDurationMinsRaw))
    : null;
  if (tripDurationMins == null && tripDistanceKm != null) {
    // ~25 km/h urban delivery average → minutes
    tripDurationMins = Math.max(1, Math.ceil((tripDistanceKm * 60) / 25));
  }

  console.log(`[DEBUG] buildDeliverySocketPayload - Order: ${order?.orderId || order?._id}`);
  console.log(`[DEBUG] buildDeliverySocketPayload - riderEarning in doc: ${order?.riderEarning}`);
  console.log(`[DEBUG] buildDeliverySocketPayload - deliveryFee in doc: ${order?.pricing?.deliveryFee}`);

  return {
    orderMongoId:
      orderDoc?._id?.toString?.() || order?._id?.toString?.() || order?._id,
    orderId: order?.order_id || order?._id?.toString?.(),
    status: orderDoc?.orderStatus || order?.orderStatus,
    items: order?.items || [],
    pricing: order?.pricing,
    total: order?.pricing?.total,
    payment: order?.payment,
    paymentMethod: order?.payment?.method,
    restaurantId:
      order?.restaurantId?._id?.toString?.() ||
      order?.restaurantId?.toString?.() ||
      order?.restaurantId,
    restaurantName: restaurant?.restaurantName || order?.restaurantName,
    restaurantAddress:
      restaurantLocation?.address ||
      restaurantLocation?.formattedAddress ||
      restaurant?.addressLine1 ||
      "",
    // The store's contact number first; ownerPhone is the owner's login number.
    restaurantPhone: restaurant?.primaryContactNumber || restaurant?.phone || restaurant?.ownerPhone || "",
    // Ready-to-launch dialer URI — the app can pass this straight to url_launcher.
    restaurantCallUri: buildTelUri(restaurant?.primaryContactNumber || restaurant?.phone || restaurant?.ownerPhone),
    // Photos of the premises so the rider can recognise the shop on arrival.
    restaurantCoverImage:
      restaurant?.coverImage || (Array.isArray(restaurant?.coverImages) ? restaurant.coverImages[0] : '') || '',
    restaurantGalleryImages: Array.isArray(restaurant?.galleryImages) ? restaurant.galleryImages : [],
    restaurantLandmark: restaurant?.landmark || "",
    restaurantLocation: {
      latitude: Number.isFinite(restaurantLat) ? restaurantLat : undefined,
      longitude: Number.isFinite(restaurantLng) ? restaurantLng : undefined,
      lat: Number.isFinite(restaurantLat) ? restaurantLat : undefined,
      lng: Number.isFinite(restaurantLng) ? restaurantLng : undefined,
      coordinates:
        Number.isFinite(restaurantLat) && Number.isFinite(restaurantLng)
          ? [restaurantLng, restaurantLat]
          : undefined,
      address:
        restaurantLocation?.address ||
        restaurantLocation?.formattedAddress ||
        restaurant?.addressLine1 ||
        "",
      area: restaurantLocation?.area || restaurant?.area || "",
      city: restaurantLocation?.city || restaurant?.city || "",
      state: restaurantLocation?.state || restaurant?.state || "",
    },
    deliveryAddress: order?.deliveryAddress,
    customerLocation: {
      latitude: Number.isFinite(customerLat) ? customerLat : undefined,
      longitude: Number.isFinite(customerLng) ? customerLng : undefined,
      lat: Number.isFinite(customerLat) ? customerLat : undefined,
      lng: Number.isFinite(customerLng) ? customerLng : undefined,
      coordinates:
        Number.isFinite(customerLat) && Number.isFinite(customerLng)
          ? [customerLng, customerLat]
          : undefined,
    },
    // Restaurant ↔ customer trip distance (NOT rider pickup distance)
    tripDistanceKm,
    tripDurationMins,
    distanceKm: tripDistanceKm,
    customerAddress: customerAddressParts.length ? customerAddressParts.join(', ') : "",
    customerName: order?.customerName || order?.deliveryAddress?.fullName || order?.deliveryAddress?.name || order?.userId?.name || "",
    customerPhone: order?.customerPhone || order?.deliveryAddress?.phone || order?.userId?.phone || "",
    customerCallUri: buildTelUri(
      order?.customerPhone || order?.deliveryAddress?.phone || order?.userId?.phone,
    ),
    userName: order?.customerName || order?.deliveryAddress?.fullName || order?.deliveryAddress?.name || order?.userId?.name || "",
    userPhone: order?.customerPhone || order?.deliveryAddress?.phone || order?.userId?.phone || "",
    note: order?.deliveryInstructions || "",
    cookingNote: order?.note || "",
    deliveryInstructions: order?.deliveryInstructions || "",
    riderEarning: order?.riderEarning || 0,
    earnings: order?.riderEarning || order?.pricing?.deliveryFee || 0,
    deliveryFee: order?.pricing?.deliveryFee || 0,
    deliveryFleet: order?.deliveryFleet,
    dispatch: order?.dispatch,
    createdAt: order?.createdAt,
    updatedAt: order?.updatedAt,
  };
}

export function canExposeOrderToRestaurant(orderLike) {
  if (String(orderLike?.orderStatus || "").toLowerCase() === "pending_payment") return false;
  const method = String(orderLike?.payment?.method || "").toLowerCase();
  const status = String(orderLike?.payment?.status || "").toLowerCase();
  // razorpay_qr is a pay-at-delivery flow like cash: the rider collects via QR at the
  // door, so the restaurant must see and prepare it even though nothing is captured yet.
  // Omitting it hid those orders from the restaurant list while still dispatching them,
  // so they silently auto-cancelled at the acceptance deadline.
  if (["cash", "wallet", "razorpay_qr"].includes(method)) return true;
  return ["paid", "authorized", "captured", "settled"].includes(status);
}

export async function notifyRestaurantNewOrder(orderDoc, { released = false } = {}) {
  try {
    if (!orderDoc || !canExposeOrderToRestaurant(orderDoc)) return;
    // Master > Cancellation policy may hold new orders for a few seconds first;
    // the store is then alerted when the hold ends (core/orders/orderHold.js).
    if (!released && (await holdIfConfigured({
      name: 'quickCommerce',
      order: orderDoc,
      vertical: await verticalOfOrder(orderDoc),
      shiftAcceptanceDeadline: true,
    }))) return;

    const io = getIO();
    if (io) {
      const payload = {
        ...orderDoc.toObject(),
        orderMongoId: orderDoc._id?.toString?.() || undefined,
        orderId: orderDoc.order_id || orderDoc._id?.toString?.(),
      };
      logger.info(
        `[RestaurantOrders] Emitting new_order to ${rooms.restaurant(orderDoc.restaurantId)} for order ${orderDoc._id?.toString?.() || ''}`,
      );
      io.to(rooms.restaurant(orderDoc.restaurantId)).emit("new_order", payload);
    }

    // Atomic claim: only the caller that flips restaurantNotifiedAt from null actually
    // sends the push. Mongo guarantees a single winner even under a concurrent race, so a
    // retried webhook or duplicate code path can never ring the restaurant twice. The
    // socket emit above stays unguarded — it is just a UI refresh and is idempotent.
    const claimed = await FoodOrder.findOneAndUpdate(
      { _id: orderDoc._id, restaurantNotifiedAt: null },
      { $set: { restaurantNotifiedAt: new Date() } },
    );
    if (!claimed) return;

    const str = (v) => (v === undefined || v === null ? "" : String(v));
    const itemCount = Array.isArray(orderDoc.items)
      ? orderDoc.items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
      : 0;
    const itemsList = Array.isArray(orderDoc.items)
      ? orderDoc.items.map((it) => `${it.quantity}x ${it.name}`).join(", ")
      : "";
    // deliveryAddressSchema has street/additionalDetails/city — there is no `address`
    // or `area` field on it, so reading those yielded undefined and the restaurant
    // only ever saw the city.
    const addressStr = orderDoc.deliveryAddress
      ? [
          orderDoc.deliveryAddress.street,
          orderDoc.deliveryAddress.additionalDetails,
          orderDoc.deliveryAddress.city,
        ]
          .filter(Boolean)
          .join(", ")
      : "";
    const total = orderDoc.pricing?.total ?? 0;

    // Same app, same mechanism for every store type -- but the partner should
    // see at a glance which kind of order just came in, since a medical-store
    // owner glancing at "New order received" has no way to tell a grocery
    // order from a prescription one apart until they open it.
    const vertical = await verticalOfOrder(orderDoc);
    const orderKindTitle = vertical === 'medical' ? 'New Medical order received' : 'New Quick Commerce order received';

    // Construct rich body for the custom notification layout in Flutter
    let bodyText = `Order #${orderDoc.order_id || orderDoc._id} is waiting for review.`;
    if (itemsList) bodyText += `\nItems: ${itemsList}`;
    if (total > 0) bodyText += `\nTotal: ₹${total}`;
    if (orderDoc.customerName) bodyText += `\nCustomer: ${orderDoc.customerName}`;
    if (addressStr) bodyText += `\nAddress: ${addressStr}`;

    // Two messages, not one — see notifyOwnersActionableAlert.
    //
    // Accept/Reject can only be attached by the app itself, and the app is only
    // called for a data-only message. Blending both into a single message with a
    // notification block silently removed the buttons, because Android renders
    // such a message and never wakes the handler that would have added them.
    await notifyOwnersActionableAlert(
      [{ ownerType: "RESTAURANT", ownerId: orderDoc.restaurantId }],
      {
        title: orderKindTitle,
        body: bodyText,
        androidTag: `order_${orderDoc._id?.toString?.() || ""}`,
        // The channel the restaurant app actually creates. The service default
        // is the rider app's new-order channel, which does not exist here —
        // Android silently demotes an unknown channel to low importance, so the
        // alert would arrive without sound or a heads-up even once it displayed.
        // Must match local_notification_service.dart's _newOrderChannel id
        // exactly. Bumped again to "_v3": a medical-store test device was
        // still silent after this string was corrected to match "_v2",
        // because Android permanently locks a channel's sound/importance
        // the first time it is created on a device -- if that device had
        // already created "_v2" under any earlier, subtly different
        // settings (plausible given this id was sent wrong until the
        // previous fix), no later code change to "_v2" itself can ever
        // reach it. Only a new id forces a genuinely fresh channel.
        androidChannelId: "new_order_channel_v3",
        data: {
          type: "new_order",
          title: orderKindTitle,
          body: bodyText,
          orderId: orderDoc._id.toString(),
          orderMongoId: orderDoc._id?.toString?.() || "",
          orderDisplayId: str(orderDoc.order_id || orderDoc._id),
          link: `/restaurant/orders/${orderDoc._id?.toString?.() || ""}`,
          // Everything the notification needs to render without a follow-up API
          // call, which matters when the device is locked or the app was killed.
          customerName: str(orderDoc.customerName),
          itemCount: str(itemCount),
          itemsList: str(itemsList),
          address: str(addressStr),
          total: str(total),
          paymentMethod: str(orderDoc.payment?.method),
          acceptanceDeadlineAt: str(orderDoc.acceptanceDeadlineAt?.toISOString?.() || ""),
        },
      },
    );
  } catch {
    // Do not block order/payment flow if notification fails.
  }
}

export const CANCELLED_ORDER_STATUSES = [
  "cancelled_by_user",
  "cancelled_by_restaurant",
  "cancelled_by_admin",
];

export const normalizeOrderStatusValue = (value) => {
  const status = String(value || "").trim().toLowerCase();
  if (!status) return "";
  return status.replace(/^canceled/, "cancelled");
};

export const isCancelledOrderStatus = (value) => {
  const status = normalizeOrderStatusValue(value);
  if (!status) return false;
  if (CANCELLED_ORDER_STATUSES.includes(status)) return true;
  if (status === "cancelled" || status === "canceled") return true;
  return status.startsWith("cancelled_by_") || status.startsWith("canceled_by_");
};

export const isCancelledOrder = (order) => {
  if (
    isCancelledOrderStatus(order?.orderStatus) ||
    isCancelledOrderStatus(order?.status)
  ) {
    return true;
  }

  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  const cancellationEntry = [...history]
    .reverse()
    .find((entry) => String(entry?.to || "").toLowerCase().includes("cancel"));

  return Boolean(
    cancellationEntry && isCancelledOrderStatus(cancellationEntry.to),
  );
};

export const STATUS_PRIORITY = {
  created: 10,
  confirmed: 20,
  preparing: 30,
  ready_for_pickup: 40,
  reached_pickup: 50,
  picked_up: 60,
  reached_drop: 70,
  delivered: 80,
  cancelled_by_user: 100,
  cancelled_by_restaurant: 100,
  cancelled_by_admin: 100,
};

/**
 * Returns true if the next status is a valid forward progression from the current status.
 * Prevents "reversing" order status (e.g. from Preparing back to Created).
 */
export function isStatusAdvance(current, next) {
  // If current status is missing, it's effectively 'created' or start of flow
  if (!current) return true;
  
  const currentPrio = STATUS_PRIORITY[current] || 0;
  const nextPrio = STATUS_PRIORITY[next] || 0;

  // Terminal states (100) cannot transition to anything else
  if (currentPrio >= 100) return false;
  
  // Delivered (80) cannot transition to anything (except maybe cancellation if allowed, but here we say no)
  if (currentPrio === 80) return false;

  // Special case: Cancellation is almost always an advance unless already delivered
  if (nextPrio === 100 && currentPrio < 80) return true;

  return nextPrio > currentPrio;
}

/** 'medical' for a pharmacy's order, else 'quickCommerce' -- which hold setting applies. */
async function verticalOfOrder(order) {
  if (order?.prescriptionOnly === true) return 'medical';
  try {
    const { FoodRestaurant } = await import('../../restaurant/models/restaurant.model.js');
    const store = await FoodRestaurant.findById(order?.restaurantId).select('storeType').lean();
    return isMedicalStore(store?.storeType) ? 'medical' : 'quickCommerce';
  } catch {
    return 'quickCommerce';
  }
}

// Lets the hold sweeper (core/orders/orderHold.js) alert the store when a held order is due.
registerHoldTarget('quickCommerce', FoodOrder, (order) => notifyRestaurantNewOrder(order, { released: true }));
