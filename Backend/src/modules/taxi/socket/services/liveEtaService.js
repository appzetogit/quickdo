/**
 * Live ETA on a ride (SOW plan §4.6): the driver's time to the pickup until
 * the trip starts, then to the drop (through any stops not yet reached).
 *
 * Pushed to the ride room as `ride:eta:updated` from the driver's location
 * updates, which arrive every few seconds -- so it is rate-limited twice:
 *   - at most one push per ride every ETA_EMIT_INTERVAL_MS;
 *   - at most one Google lookup per ride every ETA_LOOKUP_INTERVAL_MS (sooner
 *     only if the driver has moved more than ETA_LOOKUP_MOVE_M since the last
 *     one). Between lookups the last road duration is scaled by how much of the
 *     straight-line distance is left -- a cached estimate, not a new call.
 * With no Maps key, or a failed lookup, it falls back to the straight line x
 * the road factor at the fare's 25 km/h.
 *
 * In memory and per process: losing it on a restart costs one extra lookup.
 */
import { getGoogleMapsApiKey } from '../../../../core/settings/mapSettings.service.js';
import { resolveDeliveryDistanceKm } from '../../../food/orders/services/deliveryDistance.service.js';
import { RIDE_LIVE_STATUS } from '../../constants/index.js';
import { Ride } from '../../user/models/Ride.js';
import { FARE_SPEED_KMPH, distanceBetweenMeters } from '../../common/tripMeasure.js';
import { getRideRoom } from '../../services/rideService.js';
import { SOCKET_EVENTS } from '../events.js';

const ETA_EMIT_INTERVAL_MS = Number(process.env.TAXI_ETA_EMIT_INTERVAL_MS || 15000);
const ETA_LOOKUP_INTERVAL_MS = Number(process.env.TAXI_ETA_LOOKUP_INTERVAL_MS || 60000);
const ETA_LOOKUP_MOVE_M = 1000;
const ROAD_FACTOR = Number(process.env.DELIVERY_ROAD_DISTANCE_FACTOR || 1.4);
const STALE_AFTER_MS = 60 * 60 * 1000;
const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';

const etaState = new Map();

const toPoint = (coordinates) => (Array.isArray(coordinates) && coordinates.length >= 2
  ? { lat: Number(coordinates[1]), lng: Number(coordinates[0]) }
  : null);

const estimateMinutes = (meters) => ((meters * ROAD_FACTOR) / 1000 / FARE_SPEED_KMPH) * 60;

/** One road lookup: { minutes, meters } or null. */
const fetchRoadDuration = async (origin, destination) => {
  const apiKey = await getGoogleMapsApiKey().catch(() => '');
  if (!apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const params = new URLSearchParams({
      origins: `${origin.lat},${origin.lng}`,
      destinations: `${destination.lat},${destination.lng}`,
      mode: 'driving',
      departure_time: 'now',
      key: apiKey,
    });
    const response = await fetch(`${DISTANCE_MATRIX_URL}?${params}`, { signal: controller.signal });
    const data = await response.json();
    const element = data?.rows?.[0]?.elements?.[0];
    const seconds = Number(element?.duration_in_traffic?.value ?? element?.duration?.value);
    const meters = Number(element?.distance?.value);
    if (data?.status !== 'OK' || element?.status !== 'OK' || !Number.isFinite(seconds)) return null;
    return { minutes: seconds / 60, meters: Number.isFinite(meters) ? meters : null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** Minutes and metres for the legs after the first: stop -> stop -> drop. Fixed points, so cached. */
const remainingLegs = async (points) => {
  let meters = 0;
  for (let i = 1; i < points.length; i += 1) {
    const leg = await resolveDeliveryDistanceKm(points[i - 1], points[i]).catch(() => null);
    meters += Number(leg?.km) > 0 ? Number(leg.km) * 1000 : distanceBetweenMeters(points[i - 1], points[i]) * ROAD_FACTOR;
  }
  return { meters, minutes: (meters / 1000 / FARE_SPEED_KMPH) * 60 };
};

/**
 * The ETA for a ride from the driver's position. Exported for tests and for a
 * caller that wants the figure without the push.
 */
export const computeLiveEta = async ({ ride, coordinates, now = Date.now(), lookup = fetchRoadDuration }) => {
  const here = toPoint(coordinates);
  if (!ride || !here) return null;

  const toPickup = [RIDE_LIVE_STATUS.ACCEPTED, RIDE_LIVE_STATUS.ARRIVING].includes(ride.liveStatus);
  const toDrop = [RIDE_LIVE_STATUS.STARTED].includes(ride.liveStatus);
  if (!toPickup && !toDrop) return null;

  const openStops = toDrop
    ? (ride.stops || []).filter((stop) => !stop.reachedAt).sort((a, b) => a.order - b.order)
    : [];
  const drop = toPoint(ride.dropLocation?.coordinates);
  const pickup = toPoint(ride.pickupLocation?.coordinates);
  const next = toPickup ? pickup : (openStops[0] ? { lat: openStops[0].lat, lng: openStops[0].lng } : drop);
  if (!next) return null;

  const key = String(ride._id);
  const target = toPickup ? 'pickup' : 'drop';
  const state = etaState.get(key) || {};
  const straightNow = distanceBetweenMeters(here, next);
  const sameLeg = state.target === target && state.nextKey === `${next.lat},${next.lng}`;
  const movedSinceLookup = state.lookupFrom ? distanceBetweenMeters(here, state.lookupFrom) : Infinity;

  let firstLeg;
  let source = 'estimate';
  if (!sameLeg || !state.lookupAt || now - state.lookupAt >= ETA_LOOKUP_INTERVAL_MS || movedSinceLookup > ETA_LOOKUP_MOVE_M) {
    const road = await lookup(here, next);
    state.lookupAt = now;
    state.lookupFrom = here;
    state.target = target;
    state.nextKey = `${next.lat},${next.lng}`;
    state.lookupStraight = straightNow;
    state.lookupMinutes = road ? road.minutes : null;
    state.lookupMeters = road?.meters ?? null;
    if (road) {
      firstLeg = { minutes: road.minutes, meters: road.meters ?? straightNow * ROAD_FACTOR };
      source = 'directions';
    }
  } else if (state.lookupMinutes !== null && state.lookupStraight > 0) {
    // The cached estimate: the last road duration, scaled to what is left.
    const share = Math.min(1.5, straightNow / state.lookupStraight);
    firstLeg = {
      minutes: state.lookupMinutes * share,
      meters: (state.lookupMeters ?? state.lookupStraight * ROAD_FACTOR) * share,
    };
    source = 'directions_cached';
  }
  if (!firstLeg) {
    firstLeg = { minutes: estimateMinutes(straightNow), meters: straightNow * ROAD_FACTOR };
  }
  state.touchedAt = now;
  etaState.set(key, state);

  let minutes = firstLeg.minutes;
  let meters = firstLeg.meters;
  if (toDrop && openStops.length && drop) {
    const rest = await remainingLegs([
      ...openStops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
      drop,
    ]);
    minutes += rest.minutes;
    meters += rest.meters;
  }

  return {
    rideId: key,
    target,
    etaMinutes: Math.max(0, Math.round(minutes)),
    distanceMeters: Math.max(0, Math.round(meters)),
    nextStopOrder: toDrop && openStops[0] ? Number(openStops[0].order) : null,
    source,
    updatedAt: new Date(now).toISOString(),
  };
};

const sweepStale = (now) => {
  for (const [key, state] of etaState) {
    if (now - (state.touchedAt || 0) > STALE_AFTER_MS) etaState.delete(key);
  }
};

export const publishLiveEta = async ({ io, rideId, coordinates }) => {
  const key = String(rideId || '');
  if (!key || !io) return null;
  const now = Date.now();
  const state = etaState.get(key);
  if (state?.emittedAt && now - state.emittedAt < ETA_EMIT_INTERVAL_MS) return null;
  // Claimed before the lookup, so a burst of updates cannot all start one.
  etaState.set(key, { ...(state || {}), emittedAt: now, touchedAt: now });

  const ride = await Ride.findById(key)
    .select('liveStatus pickupLocation dropLocation stops')
    .lean();
  const eta = await computeLiveEta({ ride, coordinates, now });
  if (eta) {
    io.to(getRideRoom(key)).emit(SOCKET_EVENTS.RIDE_ETA_UPDATED, eta);
  }
  if (Math.random() < 0.01) sweepStale(now);
  return eta;
};

export const clearLiveEta = (rideId) => etaState.delete(String(rideId));
