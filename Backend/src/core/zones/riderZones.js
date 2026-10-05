import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';

/**
 * Which delivery partners belong to a zone, for zone-limited sub-admins.
 *
 * A rider has no home zone of their own, so a rider is "in" a zone when either
 *   - they have delivered there: rider.zoneIds, filled on every delivery
 *     (addRiderZone) and backfilled from past orders; or
 *   - their last known location is inside it: rider.lastLocation, which also
 *     places a new applicant who has never delivered.
 * A rider with neither is shown only to admins without a zone limit, who can
 * see every rider -- so no rider is lost, and none leaks to another zone's admin.
 *
 * Food riders are matched against Food zones; Quick riders against Quick and
 * Medical zones (a sub-admin's qc_zone_ids holds both).
 */

const asIds = (list) => (Array.isArray(list) ? list : [])
    .map(String)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

/** A zone's [{latitude, longitude}] ring as a closed GeoJSON polygon, or null. */
function polygonOf(zone) {
    const ring = (Array.isArray(zone?.coordinates) ? zone.coordinates : [])
        .map((p) => [Number(p?.longitude), Number(p?.latitude)])
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
    if (ring.length < 3) return null;
    const [first] = ring;
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
    return ring.length >= 4 ? { type: 'Polygon', coordinates: [ring] } : null;
}

async function zoneDocs(vertical, ids) {
    if (!ids.length) return [];
    if (vertical === 'food') {
        const { FoodZone } = await import('../../modules/food/admin/models/zone.model.js');
        return FoodZone.find({ _id: { $in: ids } }).select('coordinates').lean();
    }
    const { zoneModelFor } = await import('../../modules/quickCommerce/modules/food/shared/zoneServiceability.js');
    const [quick, medical] = await Promise.all([
        zoneModelFor('quick').find({ _id: { $in: ids } }).select('coordinates').lean(),
        zoneModelFor('medical').find({ _id: { $in: ids } }).select('coordinates').lean(),
    ]);
    return [...quick, ...medical];
}

/**
 * Mongo filter: riders a sub-admin limited to `scopeZoneIds` may see. Null when
 * there is no limit. `withLocation: false` drops the location test (a fallback
 * for a zone whose drawn shape Mongo rejects).
 */
export async function riderZoneFilter(vertical, scopeZoneIds, { withLocation = true } = {}) {
    const ids = asIds(scopeZoneIds);
    if (!ids.length) return null;
    const or = [{ zoneIds: { $in: ids } }];
    if (withLocation) {
        for (const zone of await zoneDocs(vertical, ids)) {
            const polygon = polygonOf(zone);
            if (polygon) or.push({ lastLocation: { $geoWithin: { $geometry: polygon } } });
        }
    }
    return { $or: or };
}

/**
 * Runs `query(filter)` with the zone filter, retrying without the location test
 * if Mongo rejects a zone's shape -- a badly drawn zone must not empty the list.
 */
export async function withRiderZoneFilter(vertical, scopeZoneIds, query) {
    const zone = await riderZoneFilter(vertical, scopeZoneIds);
    if (!zone) return query(null);
    try {
        return await query(zone);
    } catch (err) {
        if (!/geo|polygon|loop|edges|Bad|2dsphere/i.test(String(err?.message))) throw err;
        logger.warn(`riderZones: location test skipped (${err.message})`);
        return query(await riderZoneFilter(vertical, scopeZoneIds, { withLocation: false }));
    }
}

/**
 * The zone filter for a list query on `Model`, tested once so a zone whose shape
 * Mongo rejects falls back to delivered-in zones rather than failing the list.
 */
export async function safeRiderZoneFilter(vertical, scopeZoneIds, Model) {
    const zone = await riderZoneFilter(vertical, scopeZoneIds);
    if (!zone) return null;
    try {
        await Model.exists(zone);
        return zone;
    } catch (err) {
        logger.warn(`riderZones: location test skipped (${err.message})`);
        return riderZoneFilter(vertical, scopeZoneIds, { withLocation: false });
    }
}

/**
 * Route guard for /delivery/:id (and bonus by body.deliveryPartnerId): a
 * zone-limited sub-admin gets 404 for a rider outside their zones, the same
 * answer as a rider that does not exist.
 */
export function riderInZoneGuard(vertical, loadModel, { idFrom = (req) => req.params.id } = {}) {
    return async (req, res, next) => {
        try {
            const scope = req.query?.scopeZoneIds;
            if (!Array.isArray(scope) || !scope.length) return next();
            const id = String(idFrom(req) || '');
            if (!mongoose.Types.ObjectId.isValid(id)) return next();
            const Model = await loadModel();
            const found = await withRiderZoneFilter(vertical, scope, (zone) => Model.exists({
                _id: new mongoose.Types.ObjectId(id),
                ...(zone || {}),
            }));
            if (!found) return res.status(404).json({ success: false, message: 'Delivery partner not found' });
            return next();
        } catch (err) {
            return next(err);
        }
    };
}

/** Records that a rider delivered in a zone. Idempotent; never throws. */
export async function addRiderZone(Model, riderId, zoneId) {
    try {
        if (!riderId || !zoneId || !mongoose.Types.ObjectId.isValid(String(zoneId))) return;
        await Model.updateOne(
            { _id: riderId },
            { $addToSet: { zoneIds: new mongoose.Types.ObjectId(String(zoneId)) } },
        );
    } catch (err) {
        logger.warn(`riderZones: could not record zone for rider ${riderId}: ${err.message}`);
    }
}

export const __testables = { polygonOf };
