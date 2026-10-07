/**
 * Google Maps turn-by-turn links for the rider (SOW plan §4.10).
 *
 * The app used to open a SEARCH for the address (maps/search/?query=...),
 * which lands on a pin the rider then has to route to by hand -- and on the
 * wrong place when the address text is vague. A directions link starts
 * navigation from where the rider is, through any waypoints, to the exact
 * coordinates:
 *   https://www.google.com/maps/dir/?api=1&destination=LAT,LNG&waypoints=LAT,LNG|LAT,LNG&travelmode=driving
 */

const toLatLng = (point) => {
  if (!point) return null;
  if (Array.isArray(point) && point.length >= 2) {
    // [lng, lat], as GeoJSON stores it.
    return toLatLng({ lat: point[1], lng: point[0] });
  }
  if (Array.isArray(point.coordinates)) return toLatLng(point.coordinates);
  const lat = Number(point.lat ?? point.latitude);
  const lng = Number(point.lng ?? point.longitude ?? point.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return `${lat},${lng}`;
};

/**
 * `destination` and each waypoint: a {lat,lng} point (preferred), a [lng,lat]
 * pair, or an address string as a last resort. Returns '' when there is no
 * destination at all.
 */
export const buildDirectionsUrl = ({ destination, waypoints = [], travelMode = 'driving' } = {}) => {
  const target = toLatLng(destination) || (typeof destination === 'string' ? destination.trim() : '');
  if (!target) return '';
  const params = new URLSearchParams({ api: '1', destination: target, travelmode: travelMode });
  const stops = (Array.isArray(waypoints) ? waypoints : [])
    .map((point) => toLatLng(point) || (typeof point === 'string' ? point.trim() : ''))
    .filter(Boolean);
  if (stops.length) params.set('waypoints', stops.join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

export const openDirections = (options) => {
  const url = buildDirectionsUrl(options);
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
};
