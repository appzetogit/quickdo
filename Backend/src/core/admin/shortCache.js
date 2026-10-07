import { getRedisClient } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';

/**
 * A short-lived cache for expensive read-only aggregates (the Master dashboard,
 * cross-vertical reports). Redis when it is connected, so every API instance
 * shares one copy; in-process otherwise.
 *
 * Values must be JSON: dates come back as strings, which is what the API sends
 * anyway. A cache failure is never an error -- the value is just computed.
 */
const memory = new Map();
const MAX_ENTRIES = 300;
const PREFIX = 'qd:cache:';

const redis = () => {
    const client = getRedisClient();
    return client && client.isReady ? client : null;
};

export async function cached(key, ttlSeconds, compute) {
    const client = redis();
    if (client) {
        try {
            const hit = await client.get(PREFIX + key);
            if (hit) return JSON.parse(hit);
        } catch (err) {
            logger.warn(`shortCache: redis read failed for ${key}: ${err.message}`);
        }
    } else {
        const hit = memory.get(key);
        if (hit && hit.expiresAt > Date.now()) return hit.value;
    }

    const value = await compute();
    const json = JSON.parse(JSON.stringify(value ?? null));
    if (client) {
        try {
            await client.set(PREFIX + key, JSON.stringify(json), { EX: Math.max(1, Math.round(ttlSeconds)) });
        } catch (err) {
            logger.warn(`shortCache: redis write failed for ${key}: ${err.message}`);
        }
    } else {
        if (memory.size >= MAX_ENTRIES) {
            const now = Date.now();
            for (const [k, v] of memory) if (v.expiresAt <= now) memory.delete(k);
            if (memory.size >= MAX_ENTRIES) memory.delete(memory.keys().next().value);
        }
        memory.set(key, { value: json, expiresAt: Date.now() + ttlSeconds * 1000 });
    }
    return json;
}

/** Drop every in-process entry whose key starts with `prefix` (tests, manual refresh). */
export function clearCached(prefix = '') {
    for (const k of [...memory.keys()]) if (k.startsWith(prefix)) memory.delete(k);
}
