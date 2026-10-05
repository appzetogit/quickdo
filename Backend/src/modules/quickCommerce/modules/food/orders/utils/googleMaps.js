import { config } from '../../../../config/env.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Fetches driving route metrics from Google Directions API.
 * Call sparingly (e.g. once per order) — billed per request.
 * @param {Object} origin - { lat, lng }
 * @param {Object} destination - { lat, lng }
 * @returns {Promise<{ polyline: string, distanceMeters: number|null, durationSeconds: number|null, distanceKm: number|null }>}
 */

/* ── Encoded-polyline codec (Google's algorithm) ──────────────────────────────
   Kept inline rather than adding a dependency; it is ~30 lines and stable.      */

/** Decode an encoded polyline into [[lat, lng], ...]. */
export function decodePolyline(encoded) {
  const str = String(encoded || '');
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

const encodeSigned = (value) => {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  out += String.fromCharCode(v + 63);
  return out;
};

/** Encode [[lat, lng], ...] back into an encoded polyline. */
export function encodePolyline(points) {
  let lastLat = 0;
  let lastLng = 0;
  let out = '';
  for (const [lat, lng] of points) {
    const iLat = Math.round(lat * 1e5);
    const iLng = Math.round(lng * 1e5);
    out += encodeSigned(iLat - lastLat) + encodeSigned(iLng - lastLng);
    lastLat = iLat;
    lastLng = iLng;
  }
  return out;
}

/**
 * Stitch every step's polyline into one full-detail route.
 * Consecutive steps share an endpoint, so the duplicate is dropped at each join.
 * Returns '' when there are no usable steps, so the caller can fall back.
 */
export function buildDetailedPolyline(legs = []) {
  const points = [];
  for (const leg of legs) {
    for (const step of leg?.steps || []) {
      const encoded = step?.polyline?.points;
      if (!encoded) continue;
      const decoded = decodePolyline(encoded);
      if (decoded.length === 0) continue;
      const last = points[points.length - 1];
      const start = last && last[0] === decoded[0][0] && last[1] === decoded[0][1] ? 1 : 0;
      for (let i = start; i < decoded.length; i += 1) points.push(decoded[i]);
    }
  }
  return points.length >= 2 ? encodePolyline(points) : '';
}

export async function fetchDrivingRoute(origin, destination) {
  const empty = {
    polyline: '',
    distanceMeters: null,
    durationSeconds: null,
    distanceKm: null,
  };

  const apiKey = config.googleMapsApiKey;
  if (!apiKey) {
    logger.warn('Google Maps API key missing. Driving route fetch skipped.');
    return empty;
  }

  if (
    !origin ||
    !destination ||
    !Number.isFinite(Number(origin.lat)) ||
    !Number.isFinite(Number(origin.lng)) ||
    !Number.isFinite(Number(destination.lat)) ||
    !Number.isFinite(Number(destination.lng))
  ) {
    return empty;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const originStr = `${origin.lat},${origin.lng}`;
    const destStr = `${destination.lat},${destination.lng}`;
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originStr}&destination=${destStr}&mode=driving&key=${apiKey}`;

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();

    if (data.status === 'OK' && data.routes?.length > 0) {
      const route = data.routes[0];
      const legs = route.legs || [];
      let distanceMeters = 0;
      let durationSeconds = 0;
      for (const leg of legs) {
        distanceMeters += leg.distance?.value || 0;
        durationSeconds += leg.duration?.value || 0;
      }

      // overview_polyline is Google's SIMPLIFIED geometry — decimated for drawing a whole
      // route zoomed out. On a street-level tracking map it visibly cuts corners and drifts
      // off the road. Stitching the per-step polylines gives full road-following detail,
      // which is what makes the line look right while following a rider.
      const detailed = buildDetailedPolyline(legs);

      return {
        polyline: detailed || route.overview_polyline?.points || '',
        distanceMeters: distanceMeters > 0 ? distanceMeters : null,
        durationSeconds: durationSeconds > 0 ? durationSeconds : null,
        distanceKm:
          distanceMeters > 0 ? Number((distanceMeters / 1000).toFixed(2)) : null,
      };
    }

    logger.warn(
      `Google Directions API returned status: ${data.status}. Message: ${data.error_message || 'No routes found'}`,
    );
  } catch (err) {
    logger.error(`Error fetching driving route from Google: ${err.message}`);
  }

  return empty;
}

/**
 * Fetches an encoded polyline from Google Directions API.
 * This should be called ONLY ONCE per order assignment to save costs.
 * @param {Object} origin - { lat, lng }
 * @param {Object} destination - { lat, lng }
 * @returns {Promise<string>} - Encoded polyline points
 */
export async function fetchPolyline(origin, destination) {
  const { polyline } = await fetchDrivingRoute(origin, destination);
  return polyline;
}
