import { sendResponse, sendError } from '../../utils/response.js';
import { logger } from '../../utils/logger.js';
import { catalogue, explainKey, set, invalidateCache } from './resolver.service.js';
import { SCOPE_LEVELS } from './scope.js';
import { SETTINGS } from './registry.js';

/**
 * The Master / Global Settings screen's API.
 *
 * Without this the resolver is unreachable -- which is precisely the failure the
 * audit found in unifiedDispatchService: a correct implementation that nothing
 * calls. A setting an operator cannot change is not configuration, it is a
 * constant with extra steps.
 */

/** Every setting that exists, grouped by area, for rendering the screen. */
export const getCatalogueController = async (_req, res) => {
    try {
        const items = catalogue();
        const areas = [...new Set(items.map((i) => i.area))].map((area) => ({
            area,
            settings: items.filter((i) => i.area === area),
        }));
        return sendResponse(res, 200, 'Settings catalogue', { areas, levels: SCOPE_LEVELS });
    } catch (err) {
        logger.error(`config catalogue failed: ${err.message}`);
        return sendError(res, 500, 'Could not load the settings catalogue');
    }
};

/**
 * One setting's effective value AND the whole chain beneath it.
 *
 * The chain is the point. "Effective 1500" on its own is a number an operator has
 * to go hunting to explain; "Effective 1500, from the partner override, with the
 * zone at 2200 and global at 2000 underneath" is an answer. Context comes from the
 * query string, so the same screen can ask "what does this resolve to for THIS
 * partner in THIS city" without a second endpoint.
 */
export const explainSettingController = async (req, res) => {
    try {
        const { key } = req.params;
        const { partnerId, zoneId, vertical } = req.query || {};
        const detail = await explainKey(key, { partnerId, zoneId, vertical });
        return sendResponse(res, 200, 'Setting resolved', detail);
    } catch (err) {
        return sendError(res, err.statusCode || 500, err.message || 'Could not resolve that setting');
    }
};

/** Every setting at once, resolved for one context. What the screen loads with. */
export const resolveAllController = async (req, res) => {
    try {
        const { partnerId, zoneId, vertical } = req.query || {};
        const keys = Object.keys(SETTINGS);
        const resolved = await Promise.all(
            keys.map((key) => explainKey(key, { partnerId, zoneId, vertical })),
        );
        return sendResponse(res, 200, 'Settings resolved', {
            context: { partnerId: partnerId || null, zoneId: zoneId || null, vertical: vertical || null },
            settings: resolved,
        });
    } catch (err) {
        return sendError(res, err.statusCode || 500, err.message || 'Could not resolve settings');
    }
};

/**
 * Write one override.
 *
 * `value: null` clears the override at that level rather than storing a null, so
 * the setting falls back to whatever is underneath. The registry refuses unknown
 * keys, wrong types, out-of-range numbers and levels a key may not be set at --
 * all of which surface here as a 400 with a message an operator can act on.
 */
export const setSettingController = async (req, res) => {
    try {
        const { key } = req.params;
        const { level, scopeId, value, reason } = req.body || {};
        const actor = req.financeActor?.adminId || req.user?.userId || '';

        const result = await set(key, {
            level,
            scopeId,
            value,
            updatedBy: String(actor || ''),
            reason: String(reason || ''),
        });

        // Return the resolved chain, not just an acknowledgement: the operator's
        // next question is always "so what is it now?", and a settings screen that
        // makes them refresh to find out invites them to save twice.
        const detail = await explainKey(key, {
            partnerId: level === 'partner' ? scopeId : undefined,
            zoneId: level === 'zone' ? scopeId : undefined,
            vertical: level === 'vertical' ? scopeId : undefined,
        });

        logger.info(
            `config: ${actor || 'unknown admin'} set ${key} at ${level}:${result.scopeId} `
            + `-> ${result.cleared ? '(cleared)' : JSON.stringify(result.value)}`,
        );

        return sendResponse(res, 200, result.cleared ? 'Override cleared' : 'Setting saved', detail);
    } catch (err) {
        return sendError(res, err.statusCode || 500, err.message || 'Could not save that setting');
    }
};

/**
 * Drop this process's cache.
 *
 * Values are cached for 30s and a write invalidates the process that made it, but
 * other instances wait out the TTL. During an incident that half-minute is the
 * difference between "the fix worked" and "the fix did nothing" -- so there is a
 * button for it. Redis pub/sub is the real answer and is not here yet.
 */
export const invalidateCacheController = async (_req, res) => {
    invalidateCache();
    return sendResponse(res, 200, 'Settings cache cleared for this instance', {});
};
