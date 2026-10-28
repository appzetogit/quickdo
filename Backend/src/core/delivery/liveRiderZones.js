/**
 * Zones for the Live Drivers filter: every active taxi, food and quick zone,
 * and which of them a position falls inside.
 *
 * A rider has no home zone, so "in Palampur" means their current position is
 * inside the Palampur zone. The test runs here in plain JS rather than as one
 * $geoIntersects query per zone: there are a handful of zones and a few dozen
 * riders, and the three zone families store their shapes differently (taxi as
 * GeoJSON `geometry`, food and quick as a [{latitude, longitude}] ring or a
 * circle).
 */
import { logger } from '../../utils/logger.js';

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/** Ray casting over one ring of [lng, lat] points. */
function inRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/** A polygon is its outer ring minus its holes. */
const inPolygon = (lng, lat, rings) =>
    rings.length > 0 && inRing(lng, lat, rings[0]) && !rings.slice(1).some((hole) => inRing(lng, lat, hole));

function metresBetween(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
        + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * One zone as { polygons: [[[lng, lat], ...rings]], circle }, or null when it
 * has no usable shape.
 */
function shapeOf(zone) {
    const g = zone?.geometry;
    if (g?.type === 'Polygon' && Array.isArray(g.coordinates)) return { polygons: [g.coordinates] };
    if (g?.type === 'MultiPolygon' && Array.isArray(g.coordinates)) return { polygons: g.coordinates };

    if (zone?.boundary_mode === 'circle') {
        const lat = num(zone.circle_center?.lat);
        const lng = num(zone.circle_center?.lng);
        const r = num(zone.circle_radius_meters);
        return lat !== null && lng !== null && r > 0 ? { circle: { lat, lng, r } } : null;
    }
    const ring = (Array.isArray(zone?.coordinates) ? zone.coordinates : [])
        .map((p) => [num(p?.longitude ?? p?.lng), num(p?.latitude ?? p?.lat)])
        .filter(([lng, lat]) => lng !== null && lat !== null);
    return ring.length >= 3 ? { polygons: [[ring]] } : null;
}

export function shapeContains(shape, lat, lng) {
    if (!shape || lat === null || lng === null || lat === undefined || lng === undefined) return false;
    if (shape.circle) return metresBetween(shape.circle.lat, shape.circle.lng, lat, lng) <= shape.circle.r;
    return shape.polygons.some((rings) => inPolygon(lng, lat, rings));
}

/**
 * Outline for the map: [[lat, lng], ...] per polygon (outer ring only), or the
 * circle itself.
 */
function outlineOf(shape) {
    if (shape.circle) return { circle: shape.circle };
    return { paths: shape.polygons.map((rings) => rings[0].map(([lng, lat]) => [lat, lng])) };
}

/** Every active zone with a usable shape: { id, name, kind, shape, outline }. */
export async function loadLiveRiderZones() {
    const families = [
        ['taxi', 'Taxi', async () => {
            const { Zone } = await import('../../modules/taxi/driver/models/Zone.js');
            return Zone.find({ active: { $ne: false } }).select('name geometry').lean();
        }],
        ['food', 'Food', async () => {
            const { FoodZone } = await import('../../modules/food/admin/models/zone.model.js');
            return FoodZone.find({ isActive: { $ne: false } })
                .select('name zoneName boundary_mode circle_center circle_radius_meters coordinates')
                .lean();
        }],
        ['quick', 'Quick', async () => {
            const { zoneModelFor } = await import('../../modules/quickCommerce/modules/food/shared/zoneServiceability.js');
            return zoneModelFor('quick').find({ isActive: { $ne: false } })
                .select('name zoneName boundary_mode circle_center circle_radius_meters coordinates')
                .lean();
        }],
    ];

    const zones = [];
    await Promise.all(families.map(async ([key, kind, load]) => {
        try {
            for (const z of await load()) {
                const shape = shapeOf(z);
                if (!shape) continue;
                zones.push({
                    id: `${key}:${z._id}`,
                    name: z.name || z.zoneName || 'Unnamed zone',
                    kind,
                    shape,
                    outline: outlineOf(shape),
                });
            }
        } catch (err) {
            // One family failing to load should not take the page down.
            logger.warn(`liveRiderZones: ${key} zones failed to load: ${err.message}`);
        }
    }));
    const order = { Taxi: 0, Food: 1, Quick: 2 };
    return zones.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}
