/**
 * Which zone a point belongs to when zones overlap: the most specific one.
 *
 * Zones were drawn per city and never overlapped, so every lookup simply took
 * the first zone containing the point. A country-wide zone ("India", one per
 * service) overlaps all of them -- and the first-match order is whatever the
 * database returns (by name, insertion or index order), so it could beat
 * Palampur or Indore and switch off their fees, incentives, service switches
 * and rider matching. Smallest first keeps every city zone winning inside its
 * own boundary; the country-wide zone only answers where no city zone does.
 *
 * Food, Quick and Medical rings are [{ latitude, longitude }]. Taxi stores
 * GeoJSON and lets Mongo match, so its lookups sort on `isCountryWide`
 * instead (see TAXI_SPECIFIC_FIRST).
 */

/** Bounding-box area in square degrees; Infinity when the ring is unusable. */
export function zoneSpan(zone) {
    const ring = Array.isArray(zone?.coordinates) ? zone.coordinates : [];
    if (ring.length < 3) return Infinity;
    let minLat = Infinity; let maxLat = -Infinity; let minLng = Infinity; let maxLng = -Infinity;
    for (const p of ring) {
        const lat = Number(p?.latitude);
        const lng = Number(p?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
    }
    if (!Number.isFinite(minLat)) return Infinity;
    return (maxLat - minLat) * (maxLng - minLng);
}

/** A copy of `zones`, smallest (most specific) first. */
export const mostSpecificFirst = (zones = []) =>
    [...(Array.isArray(zones) ? zones : [])].sort((a, b) => zoneSpan(a) - zoneSpan(b));

/** Mongo sort for taxi zone lookups: city zones before the country-wide one. */
export const TAXI_SPECIFIC_FIRST = Object.freeze({ isCountryWide: 1 });
