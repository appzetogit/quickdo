/**
 * Redis Service
 * High-performance caching for vendor online status, locations, and availability
 */

const Redis = require('ioredis');

let redis = null;
let isConnected = false;

/**
 * Initialize Redis connection
 */
const initRedis = () => {
  if (process.env.REDIS_ENABLED !== 'true') {
    console.log('[Redis] Disabled via REDIS_ENABLED env variable');
    return null;
  }

  try {
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
      redis = new Redis(redisUrl);
    } else {
      redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        retryStrategy: (times) => {
          if (times > 3) {
            console.log('[Redis] Max retries reached, giving up');
            return null;
          }
          return Math.min(times * 200, 2000);
        }
      });
    }

    redis.on('connect', () => {
      isConnected = true;
      console.log('[Redis] ✅ Connected successfully');
    });

    redis.on('error', (err) => {
      isConnected = false;
      console.error('[Redis] ❌ Error:', err.message);
    });

    redis.on('close', () => {
      isConnected = false;
      console.log('[Redis] Connection closed');
    });

    return redis;
  } catch (error) {
    console.error('[Redis] Init failed:', error);
    return null;
  }
};

/**
 * Get Redis instance
 */
const getRedis = () => redis;

/**
 * Check if Redis is connected
 */
const isRedisConnected = () => isConnected && redis !== null;

// ==========================================
// VENDOR ONLINE STATUS
// ==========================================

/**
 * Set vendor online/offline status
 */
const setVendorOnline = async (vendorId, isOnline) => {
  if (!isRedisConnected()) return false;
  try {
    const key = 'vendors:online';
    if (isOnline) {
      await redis.sadd(key, vendorId.toString());
      await redis.hset('vendors:lastSeen', vendorId.toString(), Date.now());
    } else {
      await redis.srem(key, vendorId.toString());
      await redis.hset('vendors:lastSeen', vendorId.toString(), Date.now());
    }
    return true;
  } catch (error) {
    console.error('[Redis] setVendorOnline error:', error);
    return false;
  }
};

/**
 * Get all online vendor IDs
 */
const getOnlineVendors = async () => {
  if (!isRedisConnected()) return [];
  try {
    return await redis.smembers('vendors:online');
  } catch (error) {
    console.error('[Redis] getOnlineVendors error:', error);
    return [];
  }
};

/**
 * Check if vendor is online
 */
const isVendorOnline = async (vendorId) => {
  if (!isRedisConnected()) return null; // null means unknown
  try {
    return await redis.sismember('vendors:online', vendorId.toString()) === 1;
  } catch (error) {
    console.error('[Redis] isVendorOnline error:', error);
    return null;
  }
};

// ==========================================
// VENDOR LOCATION (GEO)
// ==========================================

/**
 * Update vendor location in Redis geo index
 */
const setVendorLocation = async (vendorId, lat, lng) => {
  if (!isRedisConnected()) return false;
  try {
    // GEOADD expects: key longitude latitude member
    await redis.geoadd('vendors:locations', lng, lat, vendorId.toString());
    return true;
  } catch (error) {
    console.error('[Redis] setVendorLocation error:', error);
    return false;
  }
};

/**
 * Find vendors within radius using Redis geo
 * Returns array of { vendorId, distance }
 */
const getNearbyVendorsFromCache = async (lat, lng, radiusKm = 10) => {
  if (!isRedisConnected()) return null; // null means cache miss
  try {
    // GEORADIUS returns [member, distance] pairs
    const results = await redis.georadius(
      'vendors:locations',
      lng, lat,
      radiusKm, 'km',
      'WITHDIST', 'ASC', 'COUNT', 50
    );

    // Filter to only online vendors
    const onlineVendors = await getOnlineVendors();
    const onlineSet = new Set(onlineVendors);

    return results
      .filter(([vendorId]) => onlineSet.has(vendorId))
      .map(([vendorId, distance]) => ({
        vendorId,
        distance: parseFloat(distance)
      }));
  } catch (error) {
    console.error('[Redis] getNearbyVendorsFromCache error:', error);
    return null;
  }
};

// ==========================================
// VENDOR AVAILABILITY
// ==========================================

/**
 * Set vendor availability status
 */
const setVendorAvailability = async (vendorId, status) => {
  if (!isRedisConnected()) return false;
  try {
    await redis.hset('vendors:availability', vendorId.toString(), status);
    return true;
  } catch (error) {
    console.error('[Redis] setVendorAvailability error:', error);
    return false;
  }
};

/**
 * Get vendor availability
 */
const getVendorAvailability = async (vendorId) => {
  if (!isRedisConnected()) return null;
  try {
    return await redis.hget('vendors:availability', vendorId.toString());
  } catch (error) {
    console.error('[Redis] getVendorAvailability error:', error);
    return null;
  }
};

/**
 * Get available vendor IDs from a list
 */
const filterAvailableVendors = async (vendorIds) => {
  if (!isRedisConnected()) return vendorIds; // Return all if Redis unavailable
  try {
    const pipeline = redis.pipeline();
    vendorIds.forEach(id => {
      pipeline.hget('vendors:availability', id.toString());
    });
    const results = await pipeline.exec();

    return vendorIds.filter((id, index) => {
      const status = results[index]?.[1];
      return !status || status === 'AVAILABLE' || status === 'BUSY';
    });
  } catch (error) {
    console.error('[Redis] filterAvailableVendors error:', error);
    return vendorIds;
  }
};

// ==========================================
// BOOKING CACHE
// ==========================================

/**
 * Cache booking data temporarily (for fast access during search)
 */
const cacheBookingSearch = async (bookingId, data, ttlSeconds = 300) => {
  if (!isRedisConnected()) return false;
  try {
    await redis.setex(`booking:search:${bookingId}`, ttlSeconds, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('[Redis] cacheBookingSearch error:', error);
    return false;
  }
};

/**
 * Get cached booking search data
 */
const getBookingSearchCache = async (bookingId) => {
  if (!isRedisConnected()) return null;
  try {
    const data = await redis.get(`booking:search:${bookingId}`);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('[Redis] getBookingSearchCache error:', error);
    return null;
  }
};

/**
 * Clear booking search cache
 */
const clearBookingSearchCache = async (bookingId) => {
  if (!isRedisConnected()) return false;
  try {
    await redis.del(`booking:search:${bookingId}`);
    return true;
  } catch (error) {
    console.error('[Redis] clearBookingSearchCache error:', error);
    return false;
  }
};

// ==========================================
// LIVE LOCATION TRACKING (TTL-based)
// ==========================================

/**
 * Cache live location for a booking with TTL
 * Used for real-time tracking recovery on disconnect
 */
const setLiveLocation = async (bookingId, data, ttlSeconds = 30) => {
  if (!isRedisConnected()) return false;
  try {
    const key = `live:booking:${bookingId}`;
    await redis.setex(key, ttlSeconds, JSON.stringify({
      ...data,
      timestamp: Date.now()
    }));
    return true;
  } catch (error) {
    console.error('[Redis] setLiveLocation error:', error);
    return false;
  }
};

/**
 * Get cached live location for a booking
 */
const getLiveLocation = async (bookingId) => {
  if (!isRedisConnected()) return null;
  try {
    const key = `live:booking:${bookingId}`;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('[Redis] getLiveLocation error:', error);
    return null;
  }
};

module.exports = {
  initRedis,
  getRedis,
  isRedisConnected,
  // Vendor status
  setVendorOnline,
  getOnlineVendors,
  isVendorOnline,
  // Vendor location
  setVendorLocation,
  getNearbyVendorsFromCache,
  // Vendor availability
  setVendorAvailability,
  getVendorAvailability,
  filterAvailableVendors,
  // Booking cache
  cacheBookingSearch,
  getBookingSearchCache,
  clearBookingSearchCache,
  // Live tracking
  setLiveLocation,
  getLiveLocation
};
