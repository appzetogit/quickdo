import { FoodOrder } from '../models/order.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { buildOrderIdentityFilter } from './order.helpers.js';

/**
 * Road route for the leg the rider is currently on.
 *
 * Both apps have always called this — the customer's tracking map and the
 * rider's trip screen — but the endpoint did not exist, so every request 404'd
 * and neither ever drew a polyline.
 *
 * The key lives here rather than in the apps: a Directions key shipped in an
 * APK is world-readable, and it cannot be restricted to an Android package
 * because web-service calls carry no package signature.
 */

const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';

/** Phase decides the leg: to the restaurant before pickup, to the customer after. */
const targetForOrder = (order) => {
  const phase = order?.deliveryState?.currentPhase;
  const beforePickup = phase === 'en_route_to_pickup' || phase === 'at_pickup';
  return beforePickup ? 'restaurant' : 'customer';
};

const coordsOf = (order, target) => {
  if (target === 'restaurant') {
    const c = order.restaurantId?.location?.coordinates;
    if (Array.isArray(c) && c.length >= 2) {
      return { lat: Number(c[1]), lng: Number(c[0]) };
    }
    return null;
  }
  const addr = order.deliveryAddress || {};
  const c = addr.location?.coordinates;
  if (Array.isArray(c) && c.length >= 2) {
    return { lat: Number(c[1]), lng: Number(c[0]) };
  }
  // Older addresses stored flat lat/lng instead of GeoJSON.
  if (Number.isFinite(Number(addr.lat)) && Number.isFinite(Number(addr.lng))) {
    return { lat: Number(addr.lat), lng: Number(addr.lng) };
  }
  return null;
};

/** Rider's last known position, used when the caller sends none (the customer). */
const riderOrigin = async (order) => {
  const partnerId = order?.dispatch?.deliveryPartnerId;
  if (!partnerId) return null;
  const p = await FoodDeliveryPartner.findById(partnerId)
    .select('lastLat lastLng')
    .lean();
  if (!p || !Number.isFinite(Number(p.lastLat)) || !Number.isFinite(Number(p.lastLng))) {
    return null;
  }
  return { lat: Number(p.lastLat), lng: Number(p.lastLng) };
};

/**
 * @param {object} viewer  who is asking -- exactly one of:
 *   { userId }            the order's customer
 *   { deliveryPartnerId } the rider assigned to it
 *
 * Required. This returned any order's route to any logged-in customer or rider --
 * the rider's live coordinates and the customer's delivery point -- for an order id
 * that is a guessable FOD- plus seven digits. The quick-commerce twin already
 * scoped both callers; this matches it.
 */
export async function getOrderRoute(orderId, { lat, lng, target } = {}, viewer = {}) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).populate(
    'restaurantId',
    'restaurantName location',
  );
  if (!order) throw new NotFoundError('Order not found');

  const isCustomer = viewer.userId && String(order.userId || '') === String(viewer.userId);
  // dispatch.deliveryPartnerId is not populated here, so String() compares ids.
  const isRider = viewer.deliveryPartnerId
    && String(order.dispatch?.deliveryPartnerId || '') === String(viewer.deliveryPartnerId);
  if (!isCustomer && !isRider) {
    throw new ForbiddenError('Not your order');
  }

  const leg = target === 'restaurant' || target === 'customer'
    ? target
    : targetForOrder(order);

  const destination = coordsOf(order, leg);
  const origin =
    Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
      ? { lat: Number(lat), lng: Number(lng) }
      : await riderOrigin(order);

  // Always answer with the origin even when the geometry cannot be built: the
  // customer's map uses it to place the rider marker, and returning nothing
  // would blank a marker that was previously correct.
  const base = { target: leg, origin, polyline: '', durationMins: null, distanceKm: null };

  if (!origin || !destination) return base;

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    logger.warn('GOOGLE_MAPS_API_KEY missing — route endpoint cannot build a polyline');
    return base;
  }

  try {
    const url =
      `${DIRECTIONS_URL}?origin=${origin.lat},${origin.lng}` +
      `&destination=${destination.lat},${destination.lng}` +
      `&mode=driving&key=${key}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== 'OK' || !data.routes?.length) {
      logger.warn(`Directions returned ${data.status}: ${data.error_message || 'no routes'}`);
      return base;
    }

    const route = data.routes[0];
    const legInfo = route.legs?.[0];
    return {
      ...base,
      polyline: route.overview_polyline?.points || '',
      durationMins: legInfo ? Math.round((legInfo.duration?.value || 0) / 60) : null,
      distanceKm: legInfo
        ? Number(((legInfo.distance?.value || 0) / 1000).toFixed(2))
        : null,
      destination,
    };
  } catch (error) {
    // A missing line is cosmetic; never fail the tracking screen over it.
    logger.warn(`Route lookup failed for order ${orderId}: ${error.message}`);
    return base;
  }
}
