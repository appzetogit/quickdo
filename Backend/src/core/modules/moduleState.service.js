import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';
import { ALL_MODULES, isKnownModule } from './moduleRegistry.js';

/**
 * Persisted enable/disable state for each vertical.
 *
 * One document, not one per module: the whole point is to read the platform's state
 * in a single cached lookup on every request, and a four-field document does that in
 * one hit.
 */
const moduleStateSchema = new mongoose.Schema(
    {
        // Fixed id so there is exactly one of these, and an upsert cannot race two
        // documents into existence.
        _id: { type: String, default: 'platform' },
        modules: {
            type: Map,
            of: new mongoose.Schema(
                {
                    enabled: { type: Boolean, default: true },
                    // Shown to the client, so write it for a human: "Card payments are
                    // down, we'll be back shortly" rather than "MODULE_DISABLED".
                    reason: { type: String, trim: true, default: '' },
                    disabledAt: { type: Date, default: null },
                    disabledBy: { type: String, default: '' },
                },
                { _id: false },
            ),
            default: () => new Map(),
        },
    },
    { collection: 'platform_module_state', timestamps: true },
);

const ModuleState = mongoose.models.PlatformModuleState
    || mongoose.model('PlatformModuleState', moduleStateSchema, 'platform_module_state');

/**
 * Cached state.
 *
 * This is read on every write request across four verticals, so it cannot be a
 * database round-trip each time. Writes through this service refresh the cache
 * immediately; the TTL only bounds how long another pm2 instance keeps serving the
 * old answer.
 *
 * Fails OPEN. If the collection is unreachable, every module is treated as enabled --
 * a monitoring problem must never become a platform-wide outage, and "enabled" is the
 * state the platform ran in before this switch existed.
 */
const CACHE_TTL_MS = 10_000;
let cache = { at: 0, value: null };

const defaults = () => Object.fromEntries(
    ALL_MODULES.map((m) => [m, { enabled: true, reason: '', disabledAt: null, disabledBy: '' }]),
);

const readState = async () => {
    if (cache.value && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

    try {
        const doc = await ModuleState.findById('platform').lean();
        const merged = defaults();
        // A module absent from the document has never been touched, so it keeps the
        // enabled default rather than being treated as missing/disabled.
        for (const [name, state] of Object.entries(doc?.modules || {})) {
            if (isKnownModule(name)) merged[name] = { ...merged[name], ...state };
        }
        cache = { at: Date.now(), value: merged };
        return merged;
    } catch (err) {
        logger.warn(`[modules] state read failed, treating all as enabled: ${err.message}`);
        const open = defaults();
        // Not cached: a transient failure should be retried on the next request
        // rather than pinned as truth for the TTL.
        return open;
    }
};

export const getModuleStates = () => readState();

export const isModuleEnabled = async (name) => {
    if (!isKnownModule(name)) return true; // unknown to the switch, so not its business
    const state = await readState();
    return state[name]?.enabled !== false;
};

export const getModuleState = async (name) => {
    const state = await readState();
    return state[name] || { enabled: true, reason: '' };
};

/**
 * Turn a vertical on or off.
 *
 * @param {string}  name    one of MODULES
 * @param {boolean} enabled
 * @param {object}  opts    { reason, actorId }
 */
export const setModuleEnabled = async (name, enabled, { reason = '', actorId = '' } = {}) => {
    if (!isKnownModule(name)) {
        throw new Error(`Unknown module: ${name}`);
    }

    const next = {
        enabled: Boolean(enabled),
        reason: enabled ? '' : String(reason || '').slice(0, 300),
        disabledAt: enabled ? null : new Date(),
        disabledBy: enabled ? '' : String(actorId || ''),
    };

    await ModuleState.findByIdAndUpdate(
        'platform',
        { $set: { [`modules.${name}`]: next } },
        { upsert: true, new: true },
    );

    // Refresh rather than merely invalidate, so the operator who flipped the switch
    // sees it take effect on their very next request.
    cache = { at: 0, value: null };
    await readState();

    // Deliberately loud and greppable: a disabled vertical is the first thing anyone
    // debugging "why is nothing working" needs to find.
    logger.warn(
        `[modules] ${name} ${enabled ? 'ENABLED' : 'DISABLED'} by=${actorId || 'unknown'}`
        + (enabled ? '' : ` reason="${next.reason}"`),
    );

    return next;
};

/** Drop the cache. For tests and for an out-of-band database edit. */
export const clearModuleStateCache = () => { cache = { at: 0, value: null }; };
