import { logger } from '../../utils/logger.js';

/**
 * The taxi zone a ride belongs to: the active zone containing its pickup.
 *
 * A ride stores no zone of its own (only a surge zone when surge priced it), so
 * zone-level settings for taxi -- Master's incentive and the daily ladder --
 * look it up from the pickup point, the same way the app decides which services
 * a customer sees (core/appServices). Null outside every zone.
 */
export async function taxiZoneIdAt(coordinates) {
    const [lng, lat] = Array.isArray(coordinates) ? coordinates.map(Number) : [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    try {
        const { Zone } = await import('../../modules/taxi/driver/models/Zone.js');
        const zone = await Zone.findOne({
            active: { $ne: false },
            geometry: { $geoIntersects: { $geometry: { type: 'Point', coordinates: [lng, lat] } } },
        })
            .select('_id')
            .lean();
        return zone?._id ? String(zone._id) : null;
    } catch (err) {
        logger.warn(`taxiZone: lookup failed: ${err.message}`);
        return null;
    }
}

/** The zone of a ride document (or anything with a GeoJSON pickupLocation). */
export const taxiZoneIdOfRide = (ride) => taxiZoneIdAt(ride?.pickupLocation?.coordinates);
