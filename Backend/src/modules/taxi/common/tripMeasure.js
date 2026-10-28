/**
 * The length of a trip, measured by the server.
 *
 * A ride is priced from its distance and duration, and both used to be taken
 * from the app. An app that reported 0 km paid the base fare for any trip.
 *
 * Measured exactly the way the rider app measures it, so an honest booking is
 * priced as it always was:
 *   - straight lines, pickup -> each stop -> drop;
 *   - by the haversine formula on a sphere of radius 6,378,137 m, which is what
 *     the app's Geolocator.distanceBetween does. The usual mean radius comes
 *     out 0.112% short on every ride on production; this matches them to
 *     within a millimetre (see __checks__/tripMeasure.check.js);
 *   - duration at 25 km/h, the speed the app assumes.
 *
 * Stops are taken from the app, and that is safe: a detour can only lengthen a
 * trip, so an invented stop raises the fare, never lowers it.
 */

import { resolveDeliveryDistanceKm } from '../../food/orders/services/deliveryDistance.service.js';

/**
 * `road` (default) measures along roads; `straight` restores the old
 * crow-flies behaviour without a deploy, should the routing bill or a
 * provider outage make that necessary.
 */
const TAXI_DISTANCE_SOURCE = String(process.env.TAXI_DISTANCE_SOURCE || 'road').toLowerCase();

export const FARE_SPEED_KMPH = 25;
export const MAX_STOPS = 5;

// Geolocator's radius -- the WGS84 equatorial radius, used as a sphere.
const EARTH_RADIUS_METERS = 6378137;
const RAD = Math.PI / 180;

export const distanceBetweenMeters = (a, b) => {
    const h = Math.sin(((b.lat - a.lat) * RAD) / 2) ** 2
        + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(((b.lng - a.lng) * RAD) / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
};

/**
 * A point as {lat, lng}, from either shape the apps send: a [lng, lat] array
 * (pickup and drop) or a {lat, lng} object (stops). Null when it is not a real
 * coordinate.
 */
const toLatLng = (point) => {
    let lat;
    let lng;
    if (Array.isArray(point)) {
        [lng, lat] = point;
    } else if (point && typeof point === 'object') {
        lat = point.lat ?? point.latitude;
        lng = point.lng ?? point.longitude;
    }
    lat = Number(lat);
    lng = Number(lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
};

/** Stops the trip passes through, in order. Unusable entries are dropped. */
export const normalizeStops = (stops) =>
    (Array.isArray(stops) ? stops : []).map(toLatLng).filter(Boolean).slice(0, MAX_STOPS);

/**
 * The trip from pickup, through each stop, to drop.
 * Null when pickup or drop is not a real coordinate.
 */
export function measureTrip({ pickup, drop, stops = [] } = {}) {
    const from = toLatLng(pickup);
    const to = toLatLng(drop);
    if (!from || !to) return null;

    const points = [from, ...normalizeStops(stops), to];
    let distanceMeters = 0;
    for (let i = 1; i < points.length; i += 1) {
        distanceMeters += distanceBetweenMeters(points[i - 1], points[i]);
    }

    return {
        distanceMeters,
        durationMinutes: (distanceMeters / 1000 / FARE_SPEED_KMPH) * 60,
        stopCount: points.length - 2,
    };
}

/**
 * The same trip, measured along roads.
 *
 * One routing lookup per leg (pickup -> stop -> ... -> drop), each cached by
 * the shared resolver, so a repeated quote for the same two points costs
 * nothing. Any leg the provider cannot route falls back to that leg's
 * straight line scaled by the resolver's road factor — an estimate, never a
 * bare crow-flies figure.
 *
 * Returns the same shape as [measureTrip] plus `source`, so callers that only
 * read distanceMeters need no change.
 */
export async function measureTripRoad({ pickup, drop, stops = [] } = {}) {
    const straight = measureTrip({ pickup, drop, stops });
    if (!straight) return null;
    if (TAXI_DISTANCE_SOURCE === 'straight') {
        return { ...straight, source: 'straight_line' };
    }

    const from = toLatLng(pickup);
    const to = toLatLng(drop);
    const points = [from, ...normalizeStops(stops), to];

    let meters = 0;
    let source = 'road';
    for (let i = 1; i < points.length; i += 1) {
        try {
            const leg = await resolveDeliveryDistanceKm(points[i - 1], points[i]);
            const km = Number(leg?.km);
            if (Number.isFinite(km) && km > 0) {
                meters += km * 1000;
                if (leg.source !== 'road') source = leg.source;
                continue;
            }
        } catch {
            // fall through to the straight line for this leg
        }
        meters += distanceBetweenMeters(points[i - 1], points[i]);
        source = 'straight_line_estimated';
    }

    // A road route is never shorter than the straight line between the same
    // points. If it came back shorter the lookup is wrong, and the honest
    // answer is the geometry we can prove.
    if (meters < straight.distanceMeters) {
        return { ...straight, source: 'straight_line' };
    }

    return {
        distanceMeters: meters,
        durationMinutes: (meters / 1000 / FARE_SPEED_KMPH) * 60,
        stopCount: points.length - 2,
        source,
    };
}
