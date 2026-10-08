import mongoose from 'mongoose';
import { FoodOrder, FoodSettings } from '../models/order.model.js';
import { holdForSchedule } from '../../../../../../core/orders/scheduledDispatch.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodDeliveryWallet } from '../../delivery/models/deliveryWallet.model.js';
import { FoodDeliveryCashLimit } from '../../admin/models/deliveryCashLimit.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { config } from '../../../../config/env.js';
// Master's, not a fork's: the whole point is that the three verticals measure
// themselves against ONE engine.
import { compareInBackground } from '../../../../../../core/finance/eligibilityShadow.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { mirrorQcOfferToFoodRider } from '../../../../../../core/delivery/qcRiderLink.js';
import {
  isUnifiedDispatchEnabled,
  isUnifiedDispatchActive,
  unifiedDeliveryCandidates,
  mergeCandidates,
  filterByRiderFinance,
} from '../../../../../../core/dispatch/unifiedDispatch.js';
import { emitDeliveryJobOffers } from '../../../../../../core/dispatch/jobFeed.js';
/*
 * Zone matching, shared with food so the two verticals cannot drift apart on what
 * "same zone" means. The zone MAP is not shared: quick commerce keys off
 * qc_zones and food off food_zones, and none of the ids overlap -- hence
 * passing the right model in explicitly (see listNearbyOnlineDeliveryPartners).
 *
 * The worldwide fallback was already removed here. What was still missing is the
 * zone test itself: distance alone lets an order cross into a neighbouring zone
 * whenever the two sit within the search radius.
 */
import { loadActiveZones, filterCandidatesToZone, resolveZoneIdForPoint } from '../../../../../food/shared/zoneMatching.js';
import { FoodZone as QCZone } from '../../admin/models/zone.model.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';
import {
  buildDeliverySocketPayload,
  buildOrderIdentityFilter,
  getBusyDeliveryPartnerIds,
  haversineKm,
  notifyOwnerSafely,
  notifyOwnersActionableAlert,
  notifyOwnersSafely,
  legacyPrescriptionAwaitingCustomer,
} from './order.helpers.js';
import { fetchDrivingRoute } from '../utils/googleMaps.js';
import { parseGeoPoint } from '../../shared/geo.utils.js';

/**
 * Resolve restaurant â†’ customer road distance once per dispatch broadcast.
 * Falls back to pricing Haversine when Directions is unavailable.
 */
async function enrichPayloadWithTripRoadDistance(order, payload) {
  const existingRoadKm = order?.tripDistanceKm ?? order?.pricing?.roadDistanceKm;
  if (Number.isFinite(Number(existingRoadKm))) {
    const km = Number(Number(existingRoadKm).toFixed(2));
    const minsRaw = order?.tripDurationMins ?? order?.pricing?.roadDurationMins;
    const tripDurationMins = Number.isFinite(Number(minsRaw))
      ? Math.ceil(Number(minsRaw))
      : payload.tripDurationMins;
    return {
      ...payload,
      tripDistanceKm: km,
      tripDurationMins: tripDurationMins ?? null,
      distanceKm: km,
    };
  }

  const restaurantPoint =
    parseGeoPoint(order?.restaurantId) ||
    parseGeoPoint(order?.restaurantId?.location);
  const customerPoint = parseGeoPoint(order?.deliveryAddress);

  if (!restaurantPoint || !customerPoint) {
    return payload;
  }

  try {
    const route = await fetchDrivingRoute(restaurantPoint, customerPoint);
    if (route.distanceKm != null) {
      const tripDurationMins =
        route.durationSeconds != null
          ? Math.ceil(route.durationSeconds / 60)
          : null;

      // Persist so subsequent offers / reconnects reuse road distance.
      if (order?._id) {
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

      return {
        ...payload,
        tripDistanceKm: route.distanceKm,
        tripDurationMins,
        distanceKm: route.distanceKm,
      };
    }
  } catch (err) {
    logger.warn(`Trip road distance enrichment failed: ${err?.message || err}`);
  }

  return payload;
}

/**
 * Driver acceptance window. Single source of truth â€” the client countdown, the re-queue
 * delay and acceptanceDeadlineAt all derive from this, so they can't drift apart.
 */
const DRIVER_ACCEPT_WINDOW_MS = 45000;

/**
 * Flat, string-only data map for the incoming-order push.
 *
 * FCM data values must be strings. Everything the full-screen alert needs is included so
 * the app can render it with no follow-up API call â€” important when the device is locked
 * or the app was killed.
 */
/** FCM data values must be strings; null/undefined become '' rather than "null". */
const s = (v) => (v === undefined || v === null ? '' : String(v));

// Exported so the payload can be inspected against a real order without
// dispatching one; nothing outside this module calls it in production.
export function buildIncomingOrderPushData(order, payload, acceptanceDeadlineAt) {
  const earning = s(payload?.riderEarning ?? 0);
  const distance = s(payload?.tripDistanceKm ?? '');
  const bodyLines = [
    payload?.restaurantName ? `Pickup: ${s(payload.restaurantName)}` : '',
    payload?.customerAddress ? `Drop: ${s(payload.customerAddress)}` : '',
    distance ? `${distance} km` : '',
    `Earning: Rs.${earning}`,
  ].filter(Boolean);

  return {
    type: 'new_order',
    // One explicit label the native incoming-order card's heading switches on.
    // Always quick commerce now ('medical' went with the Medical vertical).
    jobType: 'quick_commerce',
    // Carried INSIDE data on purpose.
    //
    // This push is data-only, so FCM omits the notification block and
    // message.notification is null on the device. An app reading
    // message.notification.title therefore renders a blank notification â€” which
    // reads as a broken push rather than a missing field. The restaurant app hit
    // exactly this. These give the rider app ready-made strings straight from
    // message.data.
    title: 'New order available!',
    body: bodyLines.join('\n'),
    orderId: s(order?._id),
    orderMongoId: s(order?._id),
    orderDisplayId: s(order?.order_id || order?._id),
    restaurantName: s(payload?.restaurantName),
    restaurantAddress: s(payload?.restaurantAddress),
    customerAddress: s(payload?.customerAddress),
    tripDistanceKm: s(payload?.tripDistanceKm ?? ''),
    tripDurationMins: s(payload?.tripDurationMins ?? ''),
    riderEarning: s(payload?.riderEarning ?? 0),
    earnings: s(payload?.earnings ?? payload?.riderEarning ?? 0),
    paymentMethod: s(payload?.paymentMethod || order?.payment?.method),
    total: s(payload?.total ?? order?.pricing?.total ?? 0),
    acceptanceDeadlineAt: s(acceptanceDeadlineAt?.toISOString?.() || acceptanceDeadlineAt),
    // The offer window, so the client countdown is driven by the server rather
    // than a constant compiled into the app.
    //
    // The absolute deadline above is the more accurate of the two — it cannot
    // drift with delivery latency — but a message delayed in Doze arrives with
    // an already-expired deadline, and a card that opens at 0 seconds is worse
    // than one that opens short. Sending both lets the app prefer the deadline
    // and fall back to this when the deadline is already in the past.
    acceptTimeoutSeconds: s(Math.round(DRIVER_ACCEPT_WINDOW_MS / 1000)),
    pickupAddress: s(payload?.restaurantAddress),
    dropAddress: s(payload?.customerAddress),
    price: s(payload?.earnings ?? payload?.riderEarning ?? 0),
    distance: s(payload?.tripDistanceKm ?? ''),

    // Everything below exists so the alert can be drawn with ZERO network
    // calls.
    //
    // The background isolate that renders this alert often runs while the
    // device is in Doze or the app has just been woken to handle the push —
    // conditions where an HTTP request is deferred or refused outright. An
    // alert that has to fetch anything is an alert that sometimes never
    // appears, and the rider is given 45 seconds to decide.
    //
    // The coordinates in particular let the app draw the pickup/drop pins and
    // a straight-line preview before the app is even opened.
    orderNumber: s(order?.order_id || ''),
    restaurantImage: s(payload?.restaurantCoverImage || ''),
    pickupLat: s(payload?.restaurantLocation?.latitude ?? ''),
    pickupLng: s(payload?.restaurantLocation?.longitude ?? ''),
    dropLat: s(payload?.customerLocation?.latitude ?? ''),
    dropLng: s(payload?.customerLocation?.longitude ?? ''),
    customerName: s(payload?.customerName || order?.customerName || ''),
    customerPhone: s(payload?.customerPhone || order?.customerPhone || ''),
    itemsCount: s(Array.isArray(order?.items) ? order.items.length : ''),
    // paymentMethod alone cannot distinguish a prepaid order that is paid from
    // one still awaiting payment, so the card had to assume. Sending the status
    // makes the chip say what is actually true.
    paymentStatus: s(payload?.paymentStatus || order?.payment?.status || ''),
    items: buildPushItems(order?.items),
  };
}

/**
 * Product thumbnails for the alert card, as a JSON string.
 *
 * FCM data values must be strings and the whole map has a hard 4 KB ceiling, so
 * this is the one field that has to be actively kept small:
 *
 *  - Capped at 4 entries. The card draws 3 and derives its "+N" pill from
 *    `itemsCount`, which stays the true total -- so trimming here never changes
 *    the number the rider sees.
 *  - Only name/quantity/image. Nothing else is rendered, and image URLs are
 *    already the largest thing on the wire.
 *  - If it still exceeds 1 KB the images are dropped and names sent alone,
 *    rather than truncating the string into JSON the app cannot parse. A card
 *    with no thumbnails degrades; a card with broken JSON does not render.
 */
function buildPushItems(items) {
  const list = Array.isArray(items) ? items.slice(0, 4) : [];
  if (list.length === 0) return '[]';

  const withImages = list.map((i) => ({
    name: String(i?.name || ''),
    quantity: Number(i?.quantity || 1),
    image: String(i?.image || ''),
  }));

  const encoded = JSON.stringify(withImages);
  if (Buffer.byteLength(encoded, 'utf8') <= 1024) return encoded;

  return JSON.stringify(withImages.map(({ image, ...rest }) => rest));
}

/**
 * Riders who are already holding as much cash as they are allowed to.
 *
 * The limit existed as an admin setting and was shown to riders in their wallet, but
 * nothing enforced it: an over-limit rider kept being offered cash orders and could
 * keep accepting them, so the cap was advisory only.
 *
 * Only applied to orders the rider will physically collect money for. A prepaid
 * order adds nothing to their float, so blocking those would idle riders for no
 * reason.
 *
 * A limit of 0 means "no limit" â€” that is the schema default, so an install that has
 * never configured this must not have every rider silently excluded.
 *
 * @returns {Promise<Set<string>>} partner ids to skip
 */
async function getCashBlockedPartnerIds(partnerIds, orderCash = 0) {
  if (!partnerIds.length) return new Set();

  // The shared figure (core/finance/riderFinance), same as accept: cash across
  // Food, Quick Commerce and taxi against the rider's own limit (0 = none).
  // qc_delivery_wallets.cashInHand, read before, is never updated by deliveries.
  const { getRiderFinance } = await import('../../../../../../core/finance/riderFinance.service.js');
  const results = await Promise.all(partnerIds.map(async (id) => {
    const finance = await getRiderFinance(id).catch(() => null);
    const limit = Number(finance?.cashLimit) || 0;
    if (limit <= 0) return null;
    return (Number(finance?.cashInHand) || 0) + Math.max(0, Number(orderCash) || 0) > limit ? String(id) : null;
  }));
  return new Set(results.filter(Boolean));
}

/** Cash the rider has to physically collect, so it counts against their float. */
function orderCollectsCash(order) {
  const method = String(order?.payment?.method || order?.paymentMethod || '').toLowerCase();
  return method === 'cash' || method === 'razorpay_qr';
}

/**
 * Driver unification for quick-commerce.
 *
 * Keeps only partners whose linked unified Driver is free of the cross-service
 * busy-lock and whose work mode accepts grocery jobs. Without this a driver
 * already on a taxi ride or a food delivery would still be offered a QC order,
 * because this vertical forked from food before unification existed and had no
 * link back to the shared identity.
 *
 * Partners with no driverId are kept, so the pool keeps working for anyone not
 * yet linked. No-op, and no extra query, while UNIFIED_DISPATCH_ENABLED is off.
 */
async function filterByUnifiedWorkMode(partners) {
  // The ROOT flag: quickCommerce/config/env.js never declared this key, so reading
  // it there made this filter a permanent no-op.
  if (!isUnifiedDispatchEnabled() || !partners?.length) return partners || [];

  const ids = partners.map((p) => p._id);
  const rows = await FoodDeliveryPartner.find({ _id: { $in: ids } }).select('_id driverId').lean();
  const driverIdByPartner = new Map(rows.filter((r) => r.driverId).map((r) => [String(r._id), r.driverId]));
  if (driverIdByPartner.size === 0) return partners;

  // Five levels: services -> orders -> food -> modules -> quickCommerce, then
  // back down into the taxi module that owns the unified driver.
  const { Driver } = await import('../../../../../taxi/driver/models/Driver.js');
  const freeDrivers = await Driver.find({
    _id: { $in: [...driverIdByPartner.values()] },
    activeAssignment: null,
    // One "Delivery" toggle covers both delivery verticals: a driver who turns
    // deliveries on is offered food and grocery alike, rather than having to
    // know which app a job came from. 'quickCommerce' is still accepted so a
    // driver who stored that mode before the toggle was collapsed keeps working.
    workMode: { $in: ['all', 'delivery', 'quickCommerce'] },
    // Grocery orders stay exclusive to riders actually set up for
    // quick-commerce (a driver can be approved for one vertical and not the
    // other).
    serviceCapabilities: 'quickCommerce',
  })
    .select('_id')
    .lean();
  const freeIds = new Set(freeDrivers.map((d) => String(d._id)));

  return partners.filter((p) => {
    const linked = driverIdByPartner.get(String(p._id));
    if (!linked) return true;           // not linked yet — don't block
    return freeIds.has(String(linked)); // linked — must be free + accepting this order's vertical
  });
}

async function listNearbyOnlineDeliveryPartners(
  restaurantId,
  { maxKm = 15, limit = 25 } = {},
) {
  const rId = (restaurantId?._id || restaurantId).toString();
  const restaurant = await FoodRestaurant.findById(rId)
    .select("location zoneId")
    .lean();

  if (!restaurant?.location?.coordinates?.length) {
    // Without restaurant coords we cannot safely match riders by zone/proximity.
    return { restaurant: null, partners: [], zoneId: restaurant?.zoneId ? String(restaurant.zoneId) : null };
  }

  const zones = await loadActiveZones({ model: QCZone });
  // A store saved without a zone is placed by its own location.
  const orderZoneId = restaurant?.zoneId
    ? String(restaurant.zoneId)
    : resolveZoneIdForPoint(restaurant.location.coordinates[1], restaurant.location.coordinates[0], zones);

  const [rLng, rLat] = restaurant.location.coordinates;
  const quickOnline = await FoodDeliveryPartner.find({
    availabilityStatus: "online",
  })
    .select("_id status lastLat lastLng lastLocationAt name")
    .lean();
  /*
   * Riders online on the FOOD side count too, as their linked Quick rider
   * record: the delivery app only goes online (and reports GPS) through Food,
   * so the Quick pool on its own was always empty and no Quick
   * order was ever offered to anyone. Freshest position wins per rider.
   */
  const { onlineFoodRidersAsQcCandidates } = await import('../../../../../../core/delivery/qcRiderLink.js');
  const byRider = new Map(quickOnline.map((p) => [String(p._id), p]));
  for (const p of await onlineFoodRidersAsQcCandidates()) {
    const prev = byRider.get(String(p._id));
    const fresher = !prev || new Date(p.lastLocationAt || 0) > new Date(prev.lastLocationAt || 0);
    if (fresher) byRider.set(String(p._id), p);
  }
  const allOnline = [...byRider.values()];

  const scored = [];
  const allowedStatuses = process.env.NODE_ENV === 'production' ? ['approved'] : ['approved', 'pending'];

  // A rider is only dropped for staleness after this long WITHOUT any GPS ping.
  //
  // This was 10 minutes, which silently starved the whole offer path: Android Doze
  // suppresses the app's background location upload, the rider's GPS goes stale, so
  // they're excluded from the offer, so no push is sent to wake the app, so the GPS
  // stays stale. A rider sitting outside the restaurant with the app backgrounded
  // would never be told about a new order.
  //
  // Excluding them was never what stopped cross-city offers â€” the distanceKm <= maxKm
  // gate below does that. The original bug was that missing-GPS riders were being
  // scored as distanceKm: 999, which BYPASSED the gate. Coordinates that are half an
  // hour old and 3 km from the restaurant are still a far better candidate than
  // offering the order to nobody.
  const STALE_GPS_MS = Number(process.env.DISPATCH_STALE_GPS_MS) || 45 * 60 * 1000;

  let droppedStale = 0;
  for (const p of allOnline) {
    if (!allowedStatuses.includes(p.status)) continue;

    // No coordinates at all â†’ genuinely unplaceable, must skip (never score as 999).
    if (p.lastLat == null || p.lastLng == null) {
      droppedStale += 1;
      continue;
    }
    if (!p.lastLocationAt || Date.now() - new Date(p.lastLocationAt).getTime() > STALE_GPS_MS) {
      droppedStale += 1;
      continue;
    }

    const d = haversineKm(rLat, rLng, p.lastLat, p.lastLng);
    if (Number.isFinite(d) && d <= maxKm) {
      scored.push({ partnerId: p._id, distanceKm: d, status: p.status, lat: p.lastLat, lng: p.lastLng });
    }
  }

  /*
   * Unified dispatch (plan §8): drivers online in the driver app, from the taxi
   * Driver pool (free, work mode accepting deliveries, holding the
   * quickCommerce capability), offered as their linked Quick rider record.
   */
  if (await isUnifiedDispatchActive([orderZoneId])) {
    const fromDrivers = (await unifiedDeliveryCandidates('quickCommerce', [rLng, rLat], { maxKm, limit: Math.max(limit, 25) }))
      .filter((c) => allowedStatuses.includes(c.status) && Number.isFinite(c.distanceKm) && c.distanceKm <= maxKm);
    const merged = mergeCandidates(scored, fromDrivers);
    scored.length = 0;
    scored.push(...merged);
  }

  /*
   * Within range is not the same as within the zone: two zones can sit inside
   * the search radius of each other, and an order must stay in its own.
   */
  const zoneScoped = filterCandidatesToZone(scored, orderZoneId, zones);
  if (zoneScoped.enforced && zoneScoped.dropped.length) {
    logger.info(
      `[Dispatch] restaurant ${rId}: ${zoneScoped.dropped.length} nearby rider(s) skipped, outside zone ${orderZoneId}`,
    );
  }
  // Copied first: with no zone enforced, `kept` IS `scored`, and clearing
  // `scored` emptied it too -- so a store with no zone found nobody, ever. The
  // same bug food fixed in its own copy of this function.
  const keptInZone = zoneScoped.kept.slice();
  scored.length = 0;
  scored.push(...keptInZone);

  // Without this, a starved dispatch is indistinguishable from "no riders online".
  if (droppedStale > 0) {
    logger.warn(
      `[Dispatch] ${droppedStale}/${allOnline.length} online riders skipped for missing/stale GPS ` +
        `(restaurant ${rId}, maxKm ${maxKm}). ${scored.length} eligible.`,
    );
  }

  scored.sort((a, b) => a.distanceKm - b.distanceKm);
  const picked = scored.slice(0, Math.max(1, limit));

  if (picked.length === 0) {
    // Do NOT fall back to any online partner worldwide (cross-zone bug).
    // Caller will retry later when nearby GPS updates.
    return { partners: [], zoneId: orderZoneId };
  }

  const approved = (config.nodeEnv === 'production')
    ? picked.filter(p => p.status === 'approved')
    : picked;

  // Applied last, on the short list, so the cross-service busy-lock costs one
  // query over a handful of candidates rather than the whole online pool.
  const final = await filterByUnifiedWorkMode(
    approved.map((p) => ({ ...p, _id: p.partnerId })),
  );

  return { partners: final, zoneId: orderZoneId };
}

export async function getDispatchSettings() {
  return { dispatchMode: "auto" };
}

export async function updateDispatchSettings(dispatchMode, adminId) {
  // Always set to auto
  await FoodSettings.findOneAndUpdate(
    { key: "dispatch" },
    {
      $set: {
        dispatchMode: "auto",
        updatedBy: { role: "ADMIN", adminId, at: new Date() },
      },
    },
    { upsert: true, new: true },
  );
  return getDispatchSettings();
}

export async function tryAutoAssign(orderId, options = {}) {
  // Self-pickup orders never go to riders (plan §5.2); scheduled ones wait for
  // their slot's rider search (plan §5.3, core/orders/scheduledDispatch.js).
  {
    const pre = mongoose.Types.ObjectId.isValid(String(orderId))
      ? await FoodOrder.findById(orderId).select('fulfilmentType scheduledAt scheduledDispatch orderStatus zoneId').lean()
      : null;
    if (pre?.fulfilmentType === 'pickup') {
      logger.info(`tryAutoAssign: Skip for ${orderId} (self-pickup).`);
      return null;
    }
    if (pre && (await holdForSchedule('quickCommerce', pre))) {
      logger.info(`tryAutoAssign: ${orderId} is scheduled; rider search starts before its slot.`);
      return null;
    }
  }
  const attempt = options.attempt || 1;
  // Small buffer above the accept window so an in-flight offer isn't reclaimed early.
  const lockTimeout = DRIVER_ACCEPT_WINDOW_MS + 5000; // 50s

  const order = await FoodOrder.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(orderId),
      $or: [
        { 'dispatch.status': 'unassigned' },
        {
          'dispatch.status': 'assigned',
          'dispatch.acceptedAt': { $exists: false },
          'dispatch.assignedAt': { $lt: new Date(Date.now() - lockTimeout) },
          // An admin's pick is not a stale offer: it is the assigned rider's for
          // the whole manual window (core/delivery/manualAssign.js), and the
          // expiry sweep -- which tells the rider -- hands it back afterwards.
          $or: [
            { 'dispatch.assignMode': { $ne: 'manual' } },
            { 'dispatch.manualDeadlineAt': { $not: { $gt: new Date() } } },
          ],
        }
      ],
      'dispatch.dispatchingAt': { $exists: false }
    },
    {
      $set: { 'dispatch.dispatchingAt': new Date() }
    },
    { new: true }
  ).populate(['restaurantId', 'userId']);

  if (!order) {
    logger.info(`tryAutoAssign: Skip for ${orderId} (already dispatching, accepted, or multi-attempt lock active).`);
    return null;
  }

  // Decoupling: Ensure order is accepted by restaurant before dispatching to delivery boys
  const DISPATCHABLE_STATUSES = ['confirmed', 'preparing', 'ready_for_pickup', 'ready', 'reached_pickup', 'picked_up', 'reached_drop'];
  if (!DISPATCHABLE_STATUSES.includes(order.orderStatus)) {
    logger.info(`tryAutoAssign: Skip for ${orderId} (status ${order.orderStatus} not dispatchable yet).`);
    // The findOneAndUpdate above already set dispatch.dispatchingAt to claim the
    // lock before this status check ran. Leaving it set here would permanently
    // block every future call for this order: the lock filter above requires
    // dispatchingAt to NOT exist, so once set here it can never be re-claimed
    // once the order actually becomes dispatchable. Clear it so a later call
    // (e.g. right after the restaurant accepts) can proceed normally.
    await FoodOrder.updateOne(
      { _id: order._id },
      { $unset: { 'dispatch.dispatchingAt': '' } }
    ).catch((err) => logger.warn(`tryAutoAssign: Failed to release premature lock for ${orderId}: ${err.message}`));
    return order;
  }

  // A legacy prescription order (removed Medical vertical) still in flight is
  // offered to riders only once the customer has agreed its bill.
  if (order.prescriptionOnly === true) {
    if (legacyPrescriptionAwaitingCustomer(order)) {
      logger.info(`tryAutoAssign: Skip for ${orderId} (legacy prescription bill not yet agreed by the customer).`);
      await FoodOrder.updateOne(
        { _id: order._id },
        { $unset: { 'dispatch.dispatchingAt': '' } }
      ).catch((err) => logger.warn(`tryAutoAssign: Failed to release lock for ${orderId}: ${err.message}`));
      return order;
    }
  }

  try {
    const offeredIds = (order.dispatch?.offeredTo || []).map(o => o.partnerId.toString());
    const permanentlyExcludedIds = new Set(
      (order.dispatch?.offeredTo || [])
        .filter((offer) => offer.action === 'deassigned')
        .map((offer) => offer.partnerId.toString())
    );
    
    // RADIUS EXPANSION LOGIC
    //
    // Bands are much tighter than the food-delivery ones they replace (15 → 25
    // → 40 → 60 km). A rider 40 km from the seller cannot serve a promise
    // measured in minutes: by the time they arrive the order is late whatever
    // happens next, and offering it to them mostly delays the escalation that
    // would have got it delivered. Expanding to a few km buys a real second
    // chance; expanding past that buys a worse outcome than admitting failure.
    //
    // Overridable without a deploy, because the honest radius depends on rider
    // density in a way only live data shows.
    const bands = String(process.env.DISPATCH_RADIUS_BANDS_KM || '3,5,8,12')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);
    const radiusBands = bands.length > 0 ? bands : [3, 5, 8, 12];
    const maxKm = radiusBands[Math.min(Math.max(attempt, 1), radiusBands.length) - 1];

    const searchOptions = { maxKm, limit: 15 };
    const { partners, zoneId: orderZoneId } = await listNearbyOnlineDeliveryPartners(order.restaurantId, searchOptions);
    const unifiedActive = await isUnifiedDispatchActive([orderZoneId || order.zoneId]);
    const busyPartnerIds = await getBusyDeliveryPartnerIds();
    // Riders carrying a Food order are busy here too (see qcRiderLink).
    {
      const { qcRidersOnFoodJobs } = await import('../../../../../../core/delivery/qcRiderLink.js');
      const onFood = await qcRidersOnFoodJobs((partners || []).map((p) => p.partnerId)).catch(() => new Set());
      for (const id of onFood) busyPartnerIds.add(id);
    }
    // A busy rider stays in only if this order can join their trip (batching).
    {
      const { qcRidersBlockedFor } = await import('../../../../../../core/delivery/batching.js');
      const busyHere = (partners || []).map((p) => String(p.partnerId)).filter((id) => busyPartnerIds.has(id));
      if (busyHere.length) {
        const blocked = await qcRidersBlockedFor(busyHere, order).catch(() => new Set(busyHere));
        for (const id of busyHere) if (!blocked.has(id)) busyPartnerIds.delete(id);
      }
    }

    // TIERED ALERT LOGIC
    // Phase 2: Broadcast to all (Attempt 3+)
    // Phase 3: Admin Alert (Attempt 5+ or roughly 5 mins)
    const isPhase3 = attempt >= 6; // ~6 minutes (60s * 6)

    if (isPhase3) {
      logger.error(`[CRITICAL] Order ${order._id} unassigned for ${attempt} mins. Triggering Admin Alert (Phase 3).`);
      // Notify Admin via Push (Web/Mobile)
      try {
        await notifyOwnersSafely(
          [{ ownerType: 'ADMIN', ownerId: 'GLOBAL' }], // Use GLOBAL or specific admin group if defined
          {
            title: 'Unassigned Order Crisis!',
            body: `Order #${order.order_id || order._id} has not been picked up for 5+ minutes. Manual intervention required!`,
            data: { type: 'admin_alert_unassigned', orderId: order._id.toString() }
          }
        );
      } catch (err) {
        logger.warn(`Admin notification failed: ${err.message}`);
      }
    }

    // Riders at their cash ceiling are skipped for cash-collect orders only.
    const cashBlockedIds = orderCollectsCash(order)
      ? await getCashBlockedPartnerIds(partners.map((p) => p.partnerId), Number(order?.pricing?.total) || 0)
      : new Set();
    // Unified dispatch: the shared riderFinance gate for every order, not only
    // cash ones -- a rider at the cash ceiling gets no new work anywhere.
    if (unifiedActive) {
      const { blocked } = await filterByRiderFinance(
        partners.filter((p) => !cashBlockedIds.has(String(p.partnerId))),
        { vertical: 'quickCommerce', orderCash: orderCollectsCash(order) ? Number(order?.pricing?.total) || 0 : 0 },
      );
      for (const id of blocked.keys()) cashBlockedIds.add(id);
    }

    const eligible = partners.filter((partner) => {
      const partnerKey = partner.partnerId.toString();
      if (offeredIds.includes(partnerKey)) return false;
      if (busyPartnerIds.has(partnerKey)) return false;
      if (cashBlockedIds.has(partnerKey)) return false;
      return true;
    });

    // Without this, a cash order finding nobody looks identical to no riders being
    // online, and the real reason â€” everyone is holding too much cash to deposit â€”
    // stays invisible.
    if (cashBlockedIds.size > 0) {
      logger.warn(
        `[Dispatch] ${cashBlockedIds.size} rider(s) skipped for order ${order._id}: ` +
          `cash-in-hand at or above the configured limit.`,
      );
    }

    /*
     * Measure the master eligibility engine against this gate. Decides nothing.
     *
     * This vertical reads a STORED `qc_delivery_wallets.cashInHand` field while
     * food recomputes the same concept from its own orders and taxi checks neither
     * -- three answers to one question. The engine asks riderFinance, which is the
     * combined figure across all three. No-op unless ELIGIBILITY_SHADOW_ENABLED.
     */
    compareInBackground({
      vertical: 'quickCommerce',
      candidates: partners,
      legacyEligible: eligible,
      jobId: order._id,
      jobCashExposure: orderCollectsCash(order) ? Math.max(0, Number(order?.pricing?.total) || 0) : 0,
    });

    if (eligible.length === 0) {
      logger.info(`tryAutoAssign: No NEW eligible partners in ${maxKm}km for order ${order._id}. Restarting hunt...`);
      
      // If we ran out of new eligible partners, we might want to re-offer to everyone (Phase 2 style)
      const io = getIO();
      const reofferEligible = partners.filter((partner) => {
        const partnerKey = partner.partnerId.toString();
        if (permanentlyExcludedIds.has(partnerKey)) return false;
        if (busyPartnerIds.has(partnerKey)) return false;
        // Over the cash limit is over the limit on a re-offer too.
        if (cashBlockedIds.has(partnerKey)) return false;
        return true;
      });
      if (reofferEligible.length > 0) {
        const basePayload = buildDeliverySocketPayload(order, order.restaurantId);
        const payload = await enrichPayloadWithTripRoadDistance(order, basePayload);
        const acceptanceDeadlineAt = new Date(Date.now() + DRIVER_ACCEPT_WINDOW_MS);

        if (io) {
          for (const p of reofferEligible) {
            const roomName = rooms.delivery(p.partnerId);
            io.to(roomName).emit('new_order_available', {
              ...payload,
              pickupDistanceKm: p.distanceKm,
              acceptanceDeadlineAt,
            });
            void mirrorQcOfferToFoodRider(p.partnerId, {
              event: 'new_order_available',
              payload: { ...payload, pickupDistanceKm: p.distanceKm, acceptanceDeadlineAt },
            });
          }
        }
        if (unifiedActive) {
          await emitDeliveryJobOffers({
            vertical: 'quickCommerce', payload, partners: reofferEligible,
            zoneIds: [orderZoneId || order.zoneId], expiresAt: acceptanceDeadlineAt,
          });
        }

        // This branch previously emitted a socket event only, so a backgrounded or locked
        // driver was never woken on a re-offer round â€” the order could sit unassigned while
        // every nearby rider was simply not looking at the app. Push on every round.
        try {
          // One call per partner, because pickupDistanceKm is rider-specific.
          // This costs nothing extra: sendNotificationToOwners already loops
          // over its targets sequentially, so a batched call was never one
          // request anyway.
          const basePush = buildIncomingOrderPushData(order, payload, acceptanceDeadlineAt);
          for (const p of reofferEligible) {
            const reofferPush = {
                title: 'New order available!',
                body: `Order #${order.order_id || order._id} is still available. Tap to accept.`,
                androidTag: `order_${order._id.toString()}`,
                androidChannelId: 'new_orders_v2',
                data: { ...basePush, pickupDistanceKm: s(p.distanceKm ?? '') },
              };
            await notifyOwnersActionableAlert(
              [{ ownerType: 'DELIVERY_PARTNER', ownerId: p.partnerId }],
              reofferPush,
            );
            // The delivery app signs in as the Food rider: reach it there too.
            await mirrorQcOfferToFoodRider(p.partnerId, { push: reofferPush });
          }
        } catch (err) {
          logger.warn(`Re-offer push failed for order ${order._id}: ${err.message}`);
        }
      }

      // Re-queue itself to keep trying, aligned to the client countdown.
      await addOrderJob({
        action: 'DISPATCH_TIMEOUT_CHECK',
        orderMongoId: order._id.toString(),
        orderId: order._id.toString(),
        attempt: attempt + 1
      }, { delay: DRIVER_ACCEPT_WINDOW_MS });

      return order;
    }

    const io = getIO();
    const basePayload = buildDeliverySocketPayload(order, order.restaurantId);
    const payload = await enrichPayloadWithTripRoadDistance(order, basePayload);

    // BROADCAST: Notify all eligible riders
    // tripDistanceKm = restaurant â†” customer (road); pickupDistanceKm = rider â†’ restaurant (ranking only)
    logger.info(`Broadcasting order ${order._id} to ${eligible.length} riders. tripDistanceKm=${payload.tripDistanceKm}`);
    const acceptanceDeadlineAt = new Date(Date.now() + DRIVER_ACCEPT_WINDOW_MS);
    for (const p of eligible) {
      const roomName = rooms.delivery(p.partnerId);
      if (io) {
        io.to(roomName).emit('new_order', {
          ...payload,
          pickupDistanceKm: p.distanceKm,
          acceptanceDeadlineAt,
        });
      }
      void mirrorQcOfferToFoodRider(p.partnerId, {
        event: 'new_order',
        payload: { ...payload, pickupDistanceKm: p.distanceKm, acceptanceDeadlineAt },
      });
    }
    // The same offer on the driver's one job feed (job:offer). In addition to
    // new_order, never instead of it.
    if (unifiedActive) {
      await emitDeliveryJobOffers({
        vertical: 'quickCommerce', payload, partners: eligible,
        zoneIds: [orderZoneId || order.zoneId], expiresAt: acceptanceDeadlineAt,
      });
    }

    if (eligible.length > 0) {
      try {
        // Sent per partner rather than as one batch, because pickupDistanceKm
        // is the rider's own distance to the store. No extra requests: the
        // fan-out inside sendNotificationToOwners was already a sequential loop
        // over targets.
        const basePush = buildIncomingOrderPushData(order, payload, acceptanceDeadlineAt);
        for (const p of eligible) {
          await notifyOwnersActionableAlert(
            [{ ownerType: 'DELIVERY_PARTNER', ownerId: p.partnerId }],
            {
              title: 'New order available!',
              body: `Order #${order.order_id || order._id} is available. You have ${Math.round(DRIVER_ACCEPT_WINDOW_MS / 1000)} seconds to accept!`,
              // Two messages â€” see notifyOwnersActionableAlert.
              //
              // This alert needs the app's own full-screen UI (which only a
              // data-only message can trigger) AND delivery on ROMs that refuse
              // to start the app (which only a notification block achieves).
              // Blending them into one message quietly lost the first: Android
              // renders a message that has a notification block and never calls
              // the handler that would have raised the overlay.
              //
              // The tag is the contract with the app (cancel(0, tag:) in
              // fcm_service.dart) â€” change one and you must change the other.
              androidTag: `order_${order._id.toString()}`,
              // Must match a channel the delivery app actually creates: Android
              // silently demotes an unknown channel id to low importance, which
              // on the device looks exactly like the push never arriving.
              androidChannelId: 'new_orders_v2',
              data: { ...basePush, pickupDistanceKm: s(p.distanceKm ?? '') },
            }
          );
          // The delivery app signs in as the Food rider: reach it there too.
          await mirrorQcOfferToFoodRider(p.partnerId, {
            push: {
              title: 'New order available!',
              body: `Order #${order.order_id || order._id} is available. You have ${Math.round(DRIVER_ACCEPT_WINDOW_MS / 1000)} seconds to accept!`,
              androidTag: `order_${order._id.toString()}`,
              androidChannelId: 'new_orders_v2',
              data: { ...basePush, pickupDistanceKm: s(p.distanceKm ?? '') },
            },
          });
        }
      } catch (err) {
        logger.warn(`Push notifications failed for broadcast on order ${order._id}: ${err.message}`);
      }
    }

    const offeredToEntries = eligible.map(p => ({
      partnerId: p.partnerId,
      at: new Date(),
      action: 'offered'
    }));

    // Conditional update, NOT order.save(). This doc was loaded before several awaits
    // (rider lookup, Directions fetch, FCM batch) â€” seconds of wall time during which a
    // rider may have accepted. A blind save reverted that accept to unassigned/null, so
    // the order was re-broadcast and a second rider could claim the same trip.
    const reoffer = await FoodOrder.updateOne(
      {
        _id: order._id,
        'dispatch.status': { $ne: 'accepted' },
        'dispatch.acceptedAt': { $exists: false },
        // Nor over an admin's pick made during the broadcast (core/delivery/manualAssign.js).
        $nor: [{
          'dispatch.assignMode': 'manual',
          'dispatch.status': 'assigned',
          'dispatch.manualDeadlineAt': { $gt: new Date() },
        }],
      },
      {
        $set: { 'dispatch.status': 'unassigned', 'dispatch.deliveryPartnerId': null, 'dispatch.assignMode': 'auto' },
        $unset: { 'dispatch.manualDeadlineAt': '' },
        $push: { 'dispatch.offeredTo': { $each: offeredToEntries } },
      },
    );

    if (reoffer.modifiedCount === 0) {
      logger.info(
        `tryAutoAssign: order ${order._id} was accepted or assigned during broadcast â€” leaving assignment intact.`,
      );
      return order;
    }

    // Re-check when the offer window closes, so the next round starts exactly as the
    // client countdown hits zero.
    await addOrderJob({
      action: 'DISPATCH_TIMEOUT_CHECK',
      orderMongoId: order._id.toString(),
      orderId: order._id.toString(),
      attempt: attempt + 1
    }, { delay: DRIVER_ACCEPT_WINDOW_MS });

    return order;
  } finally {
    await FoodOrder.findByIdAndUpdate(orderId, {
      $unset: { 'dispatch.dispatchingAt': '' },
    });
  }
}


export async function processDispatchTimeout(orderId, partnerId) {
  const order = await FoodOrder.findById(orderId);
  if (!order) return;

  const stillAssigned = order.dispatch?.status === 'assigned' &&
    String(order.dispatch?.deliveryPartnerId) === String(partnerId) &&
    !order.dispatch?.acceptedAt;

  if (stillAssigned) {
    logger.info(`Dispatch timeout for partner ${partnerId} on order ${orderId}. Re-trying hunt...`);
    const offer = order.dispatch.offeredTo.find(
      o => String(o.partnerId) === String(partnerId) && o.action === 'offered'
    );
    if (offer) offer.action = 'timeout';

    order.dispatch.status = 'unassigned';
    order.dispatch.deliveryPartnerId = null;
    await order.save();
    
    const attempt = (order.dispatch?.offeredTo?.length || 0) + 1;
    await tryAutoAssign(orderId, { attempt });
  } else if (order.dispatch?.status === 'unassigned') {
    // If it's already unassigned (e.g. from a previous timeout), just keep hunting
    const attempt = (order.dispatch?.offeredTo?.length || 0) + 1;
    await tryAutoAssign(orderId, { attempt });
  }
}


export async function resendDeliveryNotificationRestaurant(orderId, restaurantId) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne({
    ...identity,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  });

  if (!order) throw new NotFoundError('Order not found');

  const activeStatuses = ['confirmed', 'preparing', 'ready_for_pickup', 'ready'];
  if (!activeStatuses.includes(order.orderStatus)) {
    throw new ValidationError(`Cannot resend notification for order in status: ${order.orderStatus}`);
  }

  if (order.dispatch?.status === 'accepted') {
    throw new ValidationError('A delivery partner has already accepted this order.');
  }
  // An admin picked a rider and they are still inside their window to answer.
  if (order.dispatch?.assignMode === 'manual' && order.dispatch?.status === 'assigned'
    && order.dispatch?.manualDeadlineAt && new Date(order.dispatch.manualDeadlineAt) > new Date()) {
    throw new ValidationError('Our team has assigned a rider to this order and is waiting for them to accept.');
  }

  order.dispatch.status = 'unassigned';
  order.dispatch.deliveryPartnerId = null;
  order.dispatch.offeredTo = [];
  order.dispatch.assignMode = 'auto';
  order.dispatch.manualDeadlineAt = undefined;
  await order.save();

  await tryAutoAssign(order._id);
  return { success: true };
}

export async function resendDeliveryNotificationAdmin(orderId) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity);

  if (!order) throw new NotFoundError('Order not found');

  const activeStatuses = ['confirmed', 'preparing', 'ready_for_pickup', 'ready', 'reached_pickup'];
  if (!activeStatuses.includes(order.orderStatus)) {
    throw new ValidationError(`Cannot resend notification for order in status: ${order.orderStatus}`);
  }

  if (order.dispatch?.status === 'accepted') {
    throw new ValidationError('A delivery partner has already accepted this order. Please use Deassign & Resend instead.');
  }

  order.dispatch.status = 'unassigned';
  order.dispatch.deliveryPartnerId = null;
  order.dispatch.offeredTo = [];
  order.dispatch.assignMode = 'auto';
  order.dispatch.manualDeadlineAt = undefined;
  await order.save();

  await tryAutoAssign(order._id);
  return { success: true };
}

/** For tests only: which riders an order at this store would be offered to. */
export const __testables = { listNearbyOnlineDeliveryPartners };
