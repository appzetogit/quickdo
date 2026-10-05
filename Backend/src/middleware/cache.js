import { getRedisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';

/**
 * Higher-order function to create a caching middleware.
 * @param {number} ttlInSeconds - Time to live for the cache in seconds.
 * @param {string} prefix - Optional key prefix for Redis (e.g. 'restaurants').
 * @returns {import('express').RequestHandler}
 */
export const cacheResponse = (ttlInSeconds = 300, prefix = 'api_cache') => {
    return async (req, res, next) => {
        // Skip caching if Redis is disabled or not a GET request
        if (!config.redisEnabled || req.method !== 'GET') return next();

        const redis = getRedisClient();
        if (!redis || !redis.isReady) return next();

        // Unique key for the current request (Method + URL + Query Params)
        // We include query params to distinguish between different filters/pagination
        const key = `${prefix}:${req.method}:${req.originalUrl || req.url}`;

        try {
            const cachedData = await redis.get(key);
            if (cachedData) {
                // logger.debug(`[Cache Hit] key=${key}`);
                return res.json(JSON.parse(cachedData));
            }

            // Capture the JSON response to store in Redis
            const originalJson = res.json.bind(res);
            res.json = (body) => {
                // If it's a success response (status < 400), cache it
                if (res.statusCode < 400) {
                    redis.set(key, JSON.stringify(body), { EX: ttlInSeconds })
                        .catch(err => logger.error(`Redis caching failed for ${key}: ${err.message}`));
                }
                return originalJson(body);
            };

            // logger.debug(`[Cache Miss] key=${key}`);
            next();
        } catch (err) {
            logger.warn(`Cache middleware error: ${err.message}`);
            next(); // fallback to normal flow if something fails
        }
    };
};

/**
 * Drop every cached response that carries a menu price.
 *
 * Keys are `${prefix}:${method}:${url}`, so a bare id never matches -- the
 * pattern has to end in `*`. Writing prices without calling this is why a bulk
 * adjustment appeared not to work: the new figures were in Mongo immediately,
 * and the public endpoints kept serving their cached copy for up to five
 * minutes, so the apps showed the old struck-through price and the admin
 * concluded the run had failed and ran it again.
 *
 * Deliberately broad. These are read-through caches that refill on the next
 * request, so over-clearing costs one uncached query; under-clearing shows
 * customers a stale price.
 */
export const invalidateMenuCaches = async () => {
    await Promise.all([
        invalidateCache('public_foods:*'),
        invalidateCache('restaurant_menu:*'),
        invalidateCache('restaurant_detail:*'),
        invalidateCache('restaurants:*'),
        invalidateCache('search_unified:*'),
        invalidateCache('search_products:*'),
        // The add-on picker's price list. Cached for ten minutes under its own
        // prefix and left out of this clear, so an add-on's new price showed in
        // the picker only after the bill had already started charging it.
        invalidateCache('restaurant_addons:*'),
    ]);
};

/**
 * The same clear, under the name the pricing code already calls it by.
 *
 * It was only ever about prices because prices were the first thing found to
 * go stale. Availability has the same problem and is worse: a restaurant
 * switches a dish off, the write lands in Mongo, and `restaurant_menu` keeps
 * serving the dish for its full ten minutes -- so the toggle looks broken, and
 * a customer can order something the kitchen has just run out of.
 */
export const invalidatePriceCaches = invalidateMenuCaches;

/**
 * Clear cache by pattern (e.g. 'api_cache:GET:/api/food/restaurants*')
 * WARNING: 'keys' is O(N), use with care or switch to SCAN for large datasets.
 * @param {string} pattern - Redis glob pattern for keys to delete.
 */
export const invalidateCache = async (pattern) => {
    if (!config.redisEnabled) return;
    const redis = getRedisClient();
    /*
     * Say so rather than returning quietly.
     *
     * A one-off script that connects to Mongo but never opens Redis gets a
     * null client here, and this used to return as though the clear had
     * happened. A bulk price reset then reported "menu caches cleared" while
     * every cached menu kept serving the old prices until its TTL ran out --
     * which is exactly how a change lands in the database and takes ten
     * minutes to reach a customer with nothing explaining the delay.
     */
    if (!redis || !redis.isReady) {
        logger.warn(
            `Cache NOT invalidated for "${pattern}": no Redis connection in this process. `
            + 'Cached responses will serve stale data until they expire.'
        );
        return;
    }

    try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
            await redis.del(keys);
            logger.info(`Invalidated ${keys.length} cache keys matching: ${pattern}`);
        }
    } catch (err) {
        logger.error(`Cache invalidation error: ${err.message}`);
    }
};
