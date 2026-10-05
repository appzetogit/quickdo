import { logger } from '../../utils/logger.js';
import { PlatformSetting } from './setting.model.js';
import { pickWinner, explain, candidateScopes, SCOPE_LEVELS } from './scope.js';
import { definitionOf, isKnownKey, coerce, assertScopeAllowed, SETTINGS } from './registry.js';

/**
 * Read a setting once, wherever it was set.
 *
 * The single function that replaces "which of the four settings models holds this
 * vertical's copy of the cash limit". Everything about precedence lives in
 * scope.js and everything about validity lives in registry.js; this joins them to
 * the database and caches the result.
 *
 * ---------------------------------------------------------------------------
 * THE CACHE, and the rule about it.
 *
 * Settings are read on the dispatch hot path -- potentially once per candidate --
 * and a database round trip there is not affordable. So values are cached in
 * process. That creates the one hazard worth naming: a config change that does not
 * take effect until the cache expires, which during an incident is the difference
 * between a fix and a fix that appears not to work.
 *
 * Mitigated two ways. The TTL is short (30s), so "it didn't work" is never true
 * for longer than half a minute. And every write through `set()` invalidates
 * immediately in the process that made it -- so the admin who changed it sees the
 * change, which is who checks.
 *
 * NOT solved: other processes still wait out the TTL. A pub/sub invalidation is
 * the real answer and belongs with the Redis work; 30 seconds is the honest
 * interim, and it is stated rather than hidden.
 */

const CACHE_TTL_MS = 30_000;
const cache = new Map();

/*
 * How long a settings read may take before the defaults are used instead.
 *
 * mongoose buffers for 10s when the connection is down. This is read on the
 * dispatch hot path -- potentially once per candidate -- so a database blip would
 * stall dispatch for ten seconds per lookup while waiting to discover something it
 * already has a safe answer for. Measured, not theorised: the first run of this
 * module with no database took exactly that.
 *
 * 1.5s is far past a healthy indexed read and far short of stalling dispatch.
 */
const READ_TIMEOUT_MS = 1500;

const withTimeout = (promise, ms, what) =>
    Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms).unref?.(),
        ),
    ]);

const cacheKey = (key, ctx) =>
    `${key}|${ctx?.partnerId || ''}|${ctx?.zoneId || ''}|${ctx?.vertical || ''}`;

export const invalidateCache = () => cache.clear();

/**
 * Resolve one key.
 *
 * @returns {Promise<{value: any, level: string|null, source: string, isDefault: boolean}>}
 *
 * A key that no level has set returns its REGISTERED DEFAULT, not undefined and
 * not zero. That distinction matters: reading a missing cash limit as 0 is how
 * "no row" becomes "no ceiling" -- or, with the comparison the other way round,
 * how it becomes "block everyone".
 */
export async function get(key, context = {}) {
    if (!isKnownKey(key)) {
        const err = new Error(`Unknown setting "${key}"`);
        err.statusCode = 400;
        throw err;
    }

    const ck = cacheKey(key, context);
    const hit = cache.get(ck);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const def = definitionOf(key);
    let resolved;

    try {
        const scopes = candidateScopes(context);
        const rows = await withTimeout(
            PlatformSetting.find({
                key,
                $or: scopes.map(({ level, scopeId }) => ({ level, scopeId })),
            }).lean(),
            READ_TIMEOUT_MS,
            `config read "${key}"`,
        );

        const winner = pickWinner(rows, context);
        resolved = winner.found
            ? { value: winner.value, level: winner.level, source: winner.source, isDefault: false }
            : { value: def.default, level: null, source: 'Registered default', isDefault: true };
    } catch (err) {
        /*
         * A settings read that fails must not take dispatch with it. Falling back
         * to the registered default is the safe direction: defaults are chosen to
         * be the permissive-but-sane value, so a database blip degrades to
         * "platform behaves as shipped" rather than "nobody can work".
         */
        logger.error(`config: resolve failed for "${key}", using default: ${err.message}`);
        resolved = { value: def.default, level: null, source: 'Registered default (read failed)', isDefault: true };
    }

    cache.set(ck, { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
    return resolved;
}

/** Resolve several keys in ONE query. What callers on a hot path should use. */
export async function getMany(keys, context = {}) {
    const unknown = keys.filter((k) => !isKnownKey(k));
    if (unknown.length) {
        const err = new Error(`Unknown setting(s): ${unknown.join(', ')}`);
        err.statusCode = 400;
        throw err;
    }

    const out = {};
    const missing = [];
    for (const key of keys) {
        const hit = cache.get(cacheKey(key, context));
        if (hit && hit.expiresAt > Date.now()) out[key] = hit.value;
        else missing.push(key);
    }
    if (missing.length === 0) return out;

    const scopes = candidateScopes(context);
    let rows = [];
    try {
        rows = await withTimeout(
            PlatformSetting.find({
                key: { $in: missing },
                $or: scopes.map(({ level, scopeId }) => ({ level, scopeId })),
            }).lean(),
            READ_TIMEOUT_MS,
            'config bulk read',
        );
    } catch (err) {
        logger.error(`config: bulk resolve failed, using defaults: ${err.message}`);
    }

    const byKey = new Map();
    for (const row of rows) {
        if (!byKey.has(row.key)) byKey.set(row.key, []);
        byKey.get(row.key).push(row);
    }

    for (const key of missing) {
        const winner = pickWinner(byKey.get(key) || [], context);
        const resolved = winner.found
            ? { value: winner.value, level: winner.level, source: winner.source, isDefault: false }
            : { value: definitionOf(key).default, level: null, source: 'Registered default', isDefault: true };
        cache.set(cacheKey(key, context), { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
        out[key] = resolved;
    }

    return out;
}

/** Just the values, for callers that do not need provenance. */
export async function values(keys, context = {}) {
    const resolved = await getMany(keys, context);
    return Object.fromEntries(Object.entries(resolved).map(([k, v]) => [k, v.value]));
}

/**
 * The whole override chain for one key -- what the admin panel renders beneath
 * the effective value so an operator can see which level is in play rather than
 * guessing.
 */
export async function explainKey(key, context = {}) {
    if (!isKnownKey(key)) {
        const err = new Error(`Unknown setting "${key}"`);
        err.statusCode = 400;
        throw err;
    }
    const scopes = candidateScopes(context);
    const rows = await PlatformSetting.find({
        key,
        $or: scopes.map(({ level, scopeId }) => ({ level, scopeId })),
    }).lean();

    const detail = explain(rows, context);
    const def = definitionOf(key);
    return {
        key,
        label: def.label || key,
        help: def.help || '',
        registeredDefault: def.default,
        ...detail,
        effective: detail.effective === undefined ? def.default : detail.effective,
        source: detail.source || 'Registered default',
    };
}

/**
 * Write one override. Validated against the registry before it is stored.
 *
 * `value: null` CLEARS the override at that level rather than storing a null, so
 * the setting falls through to the next level up. Storing null would be a row
 * that exists, wins nothing, and confuses the chain display.
 */
export async function set(key, { level, scopeId, value, updatedBy = '', reason = '' }) {
    if (!SCOPE_LEVELS.includes(level)) {
        const err = new Error(`Unknown scope level "${level}"`);
        err.statusCode = 400;
        throw err;
    }
    assertScopeAllowed(key, level);
    const coerced = coerce(key, value);
    const id = level === 'global' ? '*' : String(scopeId || '');
    if (level !== 'global' && !id) {
        const err = new Error(`A ${level} override needs a ${level} id`);
        err.statusCode = 400;
        throw err;
    }

    if (coerced === null) {
        await PlatformSetting.deleteOne({ level, scopeId: id, key });
        invalidateCache();
        return { key, level, scopeId: id, cleared: true };
    }

    await PlatformSetting.findOneAndUpdate(
        { level, scopeId: id, key },
        { $set: { value: coerced, updatedBy, reason } },
        { upsert: true, new: true },
    );
    // The admin who made the change is the one who checks it took effect.
    invalidateCache();
    return { key, level, scopeId: id, value: coerced };
}

/** The catalogue, for building the settings screen. */
export const catalogue = () =>
    Object.entries(SETTINGS).map(([key, def]) => ({
        key,
        area: key.split('.')[0],
        label: def.label || key,
        help: def.help || '',
        type: def.type,
        default: def.default,
        scopes: def.scopes,
    }));
