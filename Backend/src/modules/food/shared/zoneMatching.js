import { FoodZone } from '../admin/models/zone.model.js';

/**
 * Which service zone a point falls in.
 *
 * One implementation, shared by dispatch and by /zones/detect. They answer the
 * same question and a second copy would eventually disagree with the first --
 * the failure mode being an order offered to a rider the detect endpoint would
 * have said was in another city.
 *
 * Delivery partners carry no zone of their own. The unified driver has a
 * `zoneId`, but it points at a TAXI zone: on production the two riders hold
 * 6aa047b1... and 6a9bebc1..., while every restaurant's zoneId is one of the two
 * food zones. Comparing them directly would never match. So a rider's zone is
 * resolved the only way that is actually true -- from where they are.
 */

/** Ray casting. Polygon points are {latitude, longitude}, as stored. */
export const isPointInPolygon = (lat, lng, polygon) => {
    if (!Array.isArray(polygon) || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].longitude;
        const yi = polygon[i].latitude;
        const xj = polygon[j].longitude;
        const yj = polygon[j].latitude;
        const intersect =
            yi > lat !== yj > lat &&
            lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
};

/*
 * Every active zone, with its polygon. Cached briefly -- zones change rarely and
 * dispatch asks on every order.
 *
 * Cached PER MODEL, because the verticals do not share a zone map: food
 * restaurants key off food_zones, quick commerce off qc_zones, and taxi off
 * taxizones. They hold different ids, so one cache would answer a QC order with
 * food polygons and match nothing.
 */
const ZONE_TTL_MS = 60 * 1000;
const zoneCaches = new Map();

export const loadActiveZones = async ({ force = false, model = FoodZone } = {}) => {
    const key = model?.modelName || 'FoodZone';
    const hit = zoneCaches.get(key);
    if (!force && hit && Date.now() - hit.at < ZONE_TTL_MS) return hit.zones;
    const zones = await model.find({ isActive: true })
        .select('_id name zoneName coordinates')
        .lean();
    zoneCaches.set(key, { at: Date.now(), zones });
    return zones;
};

/** Clears the caches. For tests and for an admin editing a zone boundary. */
export const clearZoneCache = () => { zoneCaches.clear(); };

/**
 * The id of the zone containing this point, or null.
 *
 * null means "outside every zone", which is different from "zones are not
 * configured" -- callers have to tell those apart, because refusing to dispatch
 * on a platform with no zones set up would stop every order.
 */
export const resolveZoneIdForPoint = (lat, lng, zones = []) => {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
    for (const zone of zones) {
        const coords = Array.isArray(zone.coordinates) ? zone.coordinates : [];
        if (coords.length < 3) continue;
        if (isPointInPolygon(Number(lat), Number(lng), coords)) return String(zone._id);
    }
    return null;
};

/**
 * Keep only the riders in the same zone as the order.
 *
 * @param {Array} candidates            each needs { partnerId, lat, lng }
 * @param {string|null} orderZoneId     the restaurant's zone
 * @param {Array} zones                 from loadActiveZones()
 * @returns {{ kept: Array, dropped: Array, enforced: boolean }}
 *
 * `enforced` is false when there is nothing to enforce -- no zones configured, or
 * the restaurant has no zone. Dispatch then behaves exactly as it did before
 * rather than refusing to hand out work.
 *
 * A rider whose position is unknown is DROPPED when the zone is being enforced.
 * Their zone cannot be confirmed, and the whole point is not to send an Indore
 * rider a Palampur order.
 */
export const filterCandidatesToZone = (candidates = [], orderZoneId = null, zones = []) => {
    const hasZones = Array.isArray(zones) && zones.some(
        (z) => Array.isArray(z.coordinates) && z.coordinates.length >= 3,
    );
    if (!hasZones || !orderZoneId) {
        return { kept: candidates, dropped: [], enforced: false };
    }

    const kept = [];
    const dropped = [];
    for (const c of candidates) {
        const zoneId = resolveZoneIdForPoint(c?.lat, c?.lng, zones);
        if (zoneId && zoneId === String(orderZoneId)) kept.push(c);
        else dropped.push({ ...c, resolvedZoneId: zoneId });
    }
    return { kept, dropped, enforced: true };
};

export const __testables = { isPointInPolygon };
