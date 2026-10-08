import { getRedisClient } from '../../../../config/redis.js';
import {
    findZoneForPoint,
    getActiveZones,
    toFiniteNumber as toFinite
} from '../../shared/zoneServiceability.js';

// The polygon test and the active-zone cache moved to shared/zoneServiceability
// so order placement can ask the same question this endpoint answers. Two
// copies would be two answers, and the one that matters is the one at checkout.

const ZONE_DETECT_CACHE_TTL_SECONDS = 180;

const roundCoordinate = (value, precision = 3) => {
    const numeric = toFinite(value);
    if (numeric === null) return null;
    return Number(numeric.toFixed(precision));
};

const buildZoneDetectCacheKey = (lat, lng) => {
    const roundedLat = roundCoordinate(lat, 3);
    const roundedLng = roundCoordinate(lng, 3);
    if (roundedLat === null || roundedLng === null) return null;
    return `zones:detect:${roundedLat}:${roundedLng}`;
};

const getCachedJson = async (key) => {
    const redis = getRedisClient();
    if (!redis || !redis.isReady || !key) return null;

    const raw = await redis.get(key);
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const setCachedJson = async (key, value, ttlSeconds) => {
    const redis = getRedisClient();
    if (!redis || !redis.isReady || !key) return;
    await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
};

/** GET /zones/detect?lat=..&lng=.. */
export const detectZonePublicController = async (req, res, next) => {
    try {
        const lat = toFinite(req.query.lat);
        const lng = toFinite(req.query.lng);
        if (lat === null || lng === null) {
            return res.status(400).json({ success: false, message: 'lat and lng are required' });
        }

        const cacheKey = buildZoneDetectCacheKey(lat, lng);
        const cached = await getCachedJson(cacheKey);
        if (cached) {
            return res.status(200).json(cached);
        }

        const zone = await findZoneForPoint(lat, lng);
        if (zone) {
            const response = {
                success: true,
                message: 'Zone detected',
                data: { status: 'IN_SERVICE', zoneId: zone._id, zone }
            };
            await setCachedJson(cacheKey, response, ZONE_DETECT_CACHE_TTL_SECONDS);
            return res.status(200).json(response);
        }

        const response = {
            success: true,
            message: 'Out of service',
            data: { status: 'OUT_OF_SERVICE', zoneId: null, zone: null }
        };
        await setCachedJson(cacheKey, response, ZONE_DETECT_CACHE_TTL_SECONDS);
        return res.status(200).json(response);
    } catch (error) {
        next(error);
    }
};

/** GET /zones/public - list active zones for onboarding/selects */
export const listZonesPublicController = async (_req, res, next) => {
    try {
        const zones = await getActiveZones();

        return res.status(200).json({
            success: true,
            message: 'Zones fetched successfully',
            data: { zones: zones.map((zone) => ({
                _id: zone._id,
                name: zone.name,
                zoneName: zone.zoneName,
                serviceLocation: zone.serviceLocation,
                country: zone.country,
                unit: zone.unit,
                isActive: zone.isActive,
                coordinates: zone.coordinates,
                createdAt: zone.createdAt
            })) }
        });
    } catch (error) {
        next(error);
    }
};

/** GET /zones/nearby - list zones for hotspot/nearby visualization */
export const listZonesNearbyPublicController = async (_req, res, next) => {
    try {
        const zones = await getActiveZones();

        return res.status(200).json({
            success: true,
            message: 'Nearby zones fetched',
            data: { zones: zones.map((zone) => ({
                _id: zone._id,
                name: zone.name,
                zoneName: zone.zoneName,
                serviceLocation: zone.serviceLocation,
                country: zone.country,
                unit: zone.unit,
                isActive: zone.isActive,
                coordinates: zone.coordinates,
                createdAt: zone.createdAt
            })) }
        });
    } catch (error) {
        next(error);
    }
};
