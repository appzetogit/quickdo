import { getGoogleMapsApiKey } from '../../../../core/settings/mapSettings.service.js';
import { logger } from '../../../../utils/logger.js';
import { haversineKm } from './order.helpers.js';

/**
 * How far the rider actually has to travel, for delivery pricing.
 *
 * Pricing used the straight-line (haversine) distance between restaurant and
 * customer. Riders do not fly. On a real order out of Joy Restaurant the
 * straight line was 6.28 km while the road was 12.66 km -- a factor of 2.0,
 * because the hills above Palampur force the road to switchback. That order was
 * charged from the 6-8 km slab instead of the 12-15 km slab, so the customer
 * underpaid and the rider was underpaid for the same trip.
 *
 * Road distance comes from Google's Distance Matrix. Two things make that safe
 * to put in the pricing path:
 *
 *  - It is cached. calculateOrderPricing runs on every cart view and every cart
 *    edit, not just at checkout, so an uncached lookup would bill Google many
 *    times per order for an answer that cannot change.
 *  - It never hard-fails. If the key is missing, the request errors, or Google
 *    cannot find a route, it falls back to haversine scaled by ROAD_FACTOR
 *    rather than to raw haversine -- an estimate that is roughly right beats a
 *    number that is reliably ~40% low.
 *
 * The chosen source is returned so the fee breakdown can record which was used;
 * a fee is easier to defend when the order says how its distance was measured.
 */

const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';

/**
 * Typical road-winding multiplier, used only when Google is unreachable.
 * 1.4 is the usual flat-terrain figure; hill roads run higher, so this
 * under-estimates there rather than over-charging on a guess.
 */
const ROAD_FACTOR = Number(process.env.DELIVERY_ROAD_DISTANCE_FACTOR || 1.4);

/** Set to 'straight' to price on haversine again, without a redeploy. */
const DISTANCE_SOURCE = String(process.env.DELIVERY_DISTANCE_SOURCE || 'road').toLowerCase();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 5000;
const REQUEST_TIMEOUT_MS = 5000;

const cache = new Map();

/**
 * 4 decimal places is about 11 metres — finer than the accuracy of a pinned
 * address, and coarse enough that repeated cart views share one entry.
 */
const cacheKey = (origin, destination) =>
    `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}|${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;

const readCache = (key) => {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return hit.value;
};

const writeCache = (key, value) => {
    // Oldest-first eviction; insertion order is what Map iteration gives us.
    if (cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { at: Date.now(), value });
};

export const invalidateDeliveryDistanceCache = () => cache.clear();

const round2 = (n) => Math.round(Number(n) * 100) / 100;

const isPoint = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));

const fetchRoadDistanceKm = async (origin, destination) => {
    const apiKey = await getGoogleMapsApiKey();
    if (!apiKey) {
        logger.warn('[delivery-distance] no Google Maps key; using scaled straight-line distance');
        return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const params = new URLSearchParams({
            origins: `${origin.lat},${origin.lng}`,
            destinations: `${destination.lat},${destination.lng}`,
            mode: 'driving',
            units: 'metric',
            key: apiKey,
        });

        const response = await fetch(`${DISTANCE_MATRIX_URL}?${params}`, { signal: controller.signal });
        const data = await response.json();

        if (data.status !== 'OK') {
            logger.warn(`[delivery-distance] Distance Matrix status ${data.status}: ${data.error_message || ''}`);
            return null;
        }

        const element = data.rows?.[0]?.elements?.[0];
        if (element?.status !== 'OK' || !Number.isFinite(Number(element?.distance?.value))) {
            // ZERO_RESULTS is normal for an address across water or off-network.
            logger.warn(`[delivery-distance] no route: ${element?.status || 'unknown'}`);
            return null;
        }

        return Number(element.distance.value) / 1000;
    } catch (error) {
        logger.warn(`[delivery-distance] lookup failed: ${error?.message || error}`);
        return null;
    } finally {
        clearTimeout(timer);
    }
};

/**
 * @param {{lat:number,lng:number}} origin       restaurant
 * @param {{lat:number,lng:number}} destination  customer
 * @returns {Promise<{km:number, source:string}>}
 */
export const resolveDeliveryDistanceKm = async (origin, destination) => {
    if (!isPoint(origin) || !isPoint(destination)) {
        return { km: 0, source: 'unknown' };
    }

    const straightKm = haversineKm(origin.lat, origin.lng, destination.lat, destination.lng);

    if (DISTANCE_SOURCE === 'straight') {
        return { km: round2(straightKm), source: 'straight_line' };
    }

    const key = cacheKey(origin, destination);
    const cached = readCache(key);
    if (cached) return cached;

    const roadKm = await fetchRoadDistanceKm(origin, destination);

    const result = roadKm !== null
        ? { km: round2(roadKm), source: 'road' }
        // Never fall back to bare haversine: that is the bug being fixed.
        : { km: round2(straightKm * ROAD_FACTOR), source: 'straight_line_estimated' };

    writeCache(key, result);
    return result;
};
