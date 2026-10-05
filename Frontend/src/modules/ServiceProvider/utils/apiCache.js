/**
 * API Response Cache Utility
 * Provides in-memory caching for API responses to reduce network requests
 */

class ApiCache {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Get cached data if valid
   * @param {string} key - Cache key
   * @returns {any|null} - Cached data or null if expired/missing
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Store data in cache
   * @param {string} key - Cache key
   * @param {any} data - Data to cache
   * @param {number} ttlSeconds - Time to live in seconds (default: 60)
   */
  set(key, data, ttlSeconds = 60) {
    this.cache.set(key, {
      data,
      expiry: Date.now() + (ttlSeconds * 1000)
    });
  }

  /**
   * Invalidate a specific cache entry
   * @param {string} key - Cache key to invalidate
   */
  invalidate(key) {
    this.cache.delete(key);
  }

  /**
   * Invalidate all cache entries with a given prefix
   * @param {string} prefix - Key prefix to match
   */
  invalidatePrefix(prefix) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear entire cache
   */
  clear() {
    this.cache.clear();
  }
}

// Export singleton instance
export const apiCache = new ApiCache();
export default apiCache;

