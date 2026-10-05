/**
 * Shared geo parsing for food ordering (user fees, rider pay, distance display).
 * Handles inconsistent coordinate shapes across DB/API/client:
 * - location.coordinates as [lng, lat] (GeoJSON), possibly strings
 * - latitude/longitude, lat/lng, latitudes/longitudes
 * - comma-separated coordinate strings
 * - swapped [lat, lng] arrays
 */

export function toFiniteCoord(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const str = String(value).trim();
  if (!str) return null;
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

export function isValidLatitude(lat) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLongitude(lng) {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function normalizeLatLng(lat, lng) {
  const a = toFiniteCoord(lat);
  const b = toFiniteCoord(lng);
  if (a === null || b === null) return null;

  const looksLikeIndiaLat = (value) => value >= 6 && value <= 38;
  const looksLikeIndiaLng = (value) => value >= 68 && value <= 98;

  if (looksLikeIndiaLat(a) && looksLikeIndiaLng(b)) {
    return { lat: a, lng: b };
  }

  if (looksLikeIndiaLat(b) && looksLikeIndiaLng(a)) {
    return { lat: b, lng: a };
  }

  if (isValidLatitude(a) && isValidLongitude(b)) {
    return { lat: a, lng: b };
  }

  if (isValidLatitude(b) && isValidLongitude(a)) {
    return { lat: b, lng: a };
  }

  return null;
}

export function pairFromCoordinatesArray(coords) {
  if (coords === null || coords === undefined) return null;

  let arr = coords;
  if (typeof coords === 'string') {
    arr = coords.split(',').map((part) => part.trim()).filter(Boolean);
  }

  if (!Array.isArray(arr) || arr.length < 2) return null;

  const first = toFiniteCoord(arr[0]);
  const second = toFiniteCoord(arr[1]);
  if (first === null || second === null) return null;

  // GeoJSON convention: [lng, lat]
  const asGeoJson = normalizeLatLng(second, first);
  if (asGeoJson) return asGeoJson;

  // Fallback: [lat, lng]
  return normalizeLatLng(first, second);
}

function collectGeoSources(entity) {
  if (!entity || typeof entity !== 'object') return [];

  const sources = [entity];
  const nestedKeys = ['location', 'deliveryAddress', 'address', 'lastLocation', 'lastRiderLocation'];

  for (const key of nestedKeys) {
    const nested = entity[key];
    if (nested && typeof nested === 'object' && !sources.includes(nested)) {
      sources.push(nested);
    }
  }

  return sources;
}

export function parseGeoPoint(entity) {
  const sources = collectGeoSources(entity);
  if (sources.length === 0) return null;

  // Pass 1: GeoJSON coordinates anywhere (Mongo 2dsphere source of truth).
  // Top-level latitude/longitude can be stale while nested location.coordinates is correct.
  for (const source of sources) {
    const fromCoords = pairFromCoordinatesArray(source.coordinates);
    if (fromCoords) return fromCoords;
  }

  // Pass 2: flat lat/lng fields
  for (const source of sources) {
    const direct = normalizeLatLng(
      source.latitude ?? source.latitudes ?? source.lat,
      source.longitude ?? source.longitudes ?? source.lng ?? source.long,
    );
    if (direct) return direct;
  }

  return null;
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const a = toFiniteCoord(lat1);
  const b = toFiniteCoord(lon1);
  const c = toFiniteCoord(lat2);
  const d = toFiniteCoord(lon2);
  if (a === null || b === null || c === null || d === null) return null;

  const R = 6371;
  const dLat = ((c - a) * Math.PI) / 180;
  const dLon = ((d - b) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const haversine =
    sinDLat * sinDLat +
    Math.cos((a * Math.PI) / 180) *
      Math.cos((c * Math.PI) / 180) *
      sinDLon *
      sinDLon;
  const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return R * centralAngle;
}

export function calculateDistanceKm(fromEntity, toEntity) {
  const from = parseGeoPoint(fromEntity);
  const to = parseGeoPoint(toEntity);
  if (!from || !to) return null;

  const km = haversineKm(from.lat, from.lng, to.lat, to.lng);
  return Number.isFinite(km) ? km : null;
}

export function normalizeDeliveryAddress(address) {
  if (!address || typeof address !== 'object') return address;

  const point = parseGeoPoint(address);
  if (!point) return address;

  return {
    ...address,
    latitude: point.lat,
    longitude: point.lng,
    lat: point.lat,
    lng: point.lng,
    location: {
      type: 'Point',
      coordinates: [point.lng, point.lat],
    },
  };
}

/**
 * The order address requires a city and state, and the app does not always send
 * them (an address picked on the map, or saved before those fields existed).
 * Taken from the address's own fields first, then the store's -- it only
 * delivers locally -- so the order is placed instead of failing with a 500.
 */
export function fillAddressLocality(address, restaurant) {
  if (!address || typeof address !== 'object') return address;
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  const loc = restaurant?.location || {};
  const city = text(address.city)
    || text(address.area) || text(address.locality) || text(address.district)
    || text(loc.city) || text(restaurant?.city) || text(loc.area) || text(restaurant?.area);
  const state = text(address.state)
    || text(loc.state) || text(restaurant?.state);
  return { ...address, city: city || 'NA', state: state || 'NA' };
}

export function normalizeRestaurantLocation(location) {
  if (!location || typeof location !== 'object') return location;

  const point = parseGeoPoint(location);
  if (!point) {
    const coords = Array.isArray(location.coordinates) ? location.coordinates : undefined;
    return {
      ...location,
      coordinates: coords,
      latitude: toFiniteCoord(location.latitude ?? location.lat),
      longitude: toFiniteCoord(location.longitude ?? location.lng),
    };
  }

  return {
    ...location,
    type: location.type || 'Point',
    coordinates: [point.lng, point.lat],
    latitude: point.lat,
    longitude: point.lng,
  };
}
