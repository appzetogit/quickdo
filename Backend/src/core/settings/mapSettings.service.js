import { AdminThirdPartySetting } from '../../modules/taxi/admin/models/AdminThirdPartySetting.js';
import { logger } from '../../utils/logger.js';

/**
 * Google Maps browser key, resolved DATABASE-FIRST with environment fallback.
 *
 * Storage is the `map_apis` block on the third-party settings document — the same
 * one the admin panel already reads and writes through
 * GET/PATCH /api/v1/taxi/admin/integration-settings/map. Serving it from
 * /api/v1/env/public means every frontend (user, restaurant, delivery, admin)
 * picks up a key change on its next load, with no rebuild.
 *
 * Env stays the fallback, so an empty settings doc behaves exactly as before.
 */

const CACHE_MS = 30_000;
let cache = null;
let cachedAt = 0;

export const invalidateMapSettingsCache = () => {
    cache = null;
    cachedAt = 0;
};

const clean = (value) =>
    value === undefined || value === null ? '' : String(value).trim().replace(/^['"]|['"]$/g, '');

/** Browser-safe Maps JavaScript API key. Never throws. */
export const getGoogleMapsApiKey = async () => {
    if (cache !== null && Date.now() - cachedAt < CACHE_MS) return cache;

    let fromDb = '';
    try {
        const doc = await AdminThirdPartySetting.findOne({}).lean();
        fromDb = clean(doc?.map_apis?.google_map_key_for_web_apps);
    } catch (err) {
        // A settings lookup must never break a request that only needed a key.
        logger.error(`Map settings lookup failed, using env: ${err.message}`);
    }

    cache =
        fromDb ||
        clean(process.env.VITE_GOOGLE_MAPS_API_KEY) ||
        clean(process.env.GOOGLE_MAPS_API_KEY);
    cachedAt = Date.now();
    return cache;
};

/** Raw `map_apis` block, for admin panels that render the form. */
export const getMapApiSettings = async () => {
    try {
        const doc = await AdminThirdPartySetting.findOne({}).lean();
        const mapApis = doc?.map_apis || {};
        const fromDb = clean(mapApis.google_map_key_for_web_apps);
        const envFallback = clean(process.env.VITE_GOOGLE_MAPS_API_KEY) || clean(process.env.GOOGLE_MAPS_API_KEY);
        return {
            ...mapApis,
            google_map_key_for_web_apps: fromDb,
            source: fromDb ? 'database' : (envFallback ? 'environment' : 'none'),
            effectiveApiKey: fromDb || envFallback || '',
            hasEnvFallback: Boolean(envFallback)
        };
    } catch (err) {
        logger.error(`Map settings read failed: ${err.message}`);
        return {};
    }
};

/**
 * Save the browser Maps key from an admin panel.
 * Writes the same `map_apis` block the taxi integration-settings screen uses, so
 * both panels stay in sync, and drops the cache so /env/public serves it at once.
 */
export const saveGoogleMapsApiKey = async (apiKey, extra = {}) => {
    const value = clean(apiKey);
    const update = {
        'map_apis.google_map_key_for_web_apps': value
    };
    if (extra.distanceMatrixKey !== undefined) {
        update['map_apis.google_map_key_for_distance_matrix'] = clean(extra.distanceMatrixKey);
    }
    if (extra.mapType !== undefined) {
        update['map_apis.map_type'] = clean(extra.mapType);
    }
    const doc = await AdminThirdPartySetting.findOneAndUpdate(
        {},
        { $set: update },
        { new: true, upsert: true }
    ).lean();
    invalidateMapSettingsCache();
    return doc?.map_apis || {};
};
