import { logger } from '../../utils/logger.js';

/**
 * The per-service settings that moved into the resolver (MASTER_PRODUCT_PLAN
 * Phase 6), and the one rule for reading them while both copies exist.
 *
 * Each entry names a registry key, the vertical whose old copy it replaces and
 * where that copy lives. Readers ask `resolveWithLegacy` (or the fee overlay)
 * instead of reading the old field directly, and get back the value AND where
 * it came from -- the provenance the Master screen shows.
 *
 * PRECEDENCE. Two flavours, chosen so that switching a reader over changes
 * nothing on the day it deploys, and running the migration changes nothing
 * either:
 *
 *   'vertical'  the old copy acts as the vertical's own override:
 *                 zone row > vertical row > OLD COPY > global row > default
 *               For keys that are new here: a global value set later reaches
 *               a service only once that service has no setting of its own,
 *               which is exactly what it will see after migration too.
 *
 *   'below'     the old copy sits under every resolver level:
 *                 zone > vertical > global > OLD COPY > default
 *               Only for fees.platformFee / fees.platformFeeGstRate, whose
 *               readers (core/finance/platformFees.service.js) already let
 *               Master's global value beat a service's own. Kept, not changed.
 *
 * MIGRATION (scripts/migrate-settings-to-resolver.mjs) copies an old value into
 * a vertical row only where the old value is what readers return today, so the
 * effective value is identical before and after. LEGACY WRITES: the old admin
 * screens keep working; `syncLegacyWrite` mirrors a save onto the vertical row
 * when (and only when) the migration created one, so the old screen is never a
 * dead control.
 */

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const nonNegative = (v) => {
    const n = num(v);
    return n !== null && Number.isFinite(n) && n >= 0 ? n : null;
};
const percent = (v) => {
    const n = nonNegative(v);
    return n !== null && n <= 100 ? n : null;
};
const positiveInt = (v) => {
    const n = num(v);
    return n !== null && Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

/** Where each old copy lives. `load()` returns the object the field is read from. */
export const LEGACY_SOURCES = Object.freeze({
    foodFeeSettings: {
        vertical: 'food',
        label: 'Food > Fee settings',
        async load() {
            const { FoodFeeSettings } = await import('../../modules/food/admin/models/feeSettings.model.js');
            return FoodFeeSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
        },
    },
    quickFeeSettings: {
        vertical: 'quickCommerce',
        label: 'Quick Commerce > Fee settings',
        async load() {
            const { FoodFeeSettings } = await import('../../modules/quickCommerce/modules/food/admin/models/feeSettings.model.js');
            return FoodFeeSettings.findOne({ isActive: { $ne: false } }).sort({ createdAt: -1 }).lean();
        },
    },
    foodServiceRadius: {
        vertical: 'food',
        label: 'Food > Delivery radius ceiling',
        async load() {
            const { FoodServiceRadiusSettings } = await import('../../modules/food/admin/models/serviceRadiusSettings.model.js');
            return FoodServiceRadiusSettings.findOne({ key: 'default' }).lean();
        },
    },
    taxiTransportRide: {
        vertical: 'taxi',
        label: 'Taxi > Transport ride settings',
        /*
         * The merged view (stored values over the shipped defaults) because that
         * is what taxi reads: an unsaved field is the default, not "unset".
         */
        async load() {
            const { getTransportRideSettings } = await import('../../modules/taxi/services/transportSettingsService.js');
            return getTransportRideSettings();
        },
    },
});

/*
 * The moved settings. `read` normalises the old field the same way its old
 * reader did, so the value copied is the value that was being used.
 */
export const LEGACY_SETTINGS = Object.freeze([
    { key: 'fees.platformFee', source: 'foodFeeSettings', field: 'platformFee', precedence: 'below', read: nonNegative },
    { key: 'fees.platformFee', source: 'quickFeeSettings', field: 'platformFee', precedence: 'below', read: nonNegative },
    { key: 'fees.platformFeeGstRate', source: 'foodFeeSettings', field: 'platformFeeGstRate', precedence: 'below', read: percent },
    { key: 'fees.itemGstRate', source: 'foodFeeSettings', field: 'gstRate', precedence: 'vertical', read: percent },
    { key: 'fees.itemGstRate', source: 'quickFeeSettings', field: 'gstRate', precedence: 'vertical', read: percent },
    { key: 'fees.flatDeliveryFee', source: 'quickFeeSettings', field: 'deliveryFee', precedence: 'vertical', read: nonNegative },
    { key: 'orders.maxQuantityPerItem', source: 'foodFeeSettings', field: 'maxOrderQuantityCeiling', precedence: 'vertical', read: positiveInt },
    {
        key: 'delivery.maxRadiusKm',
        source: 'foodServiceRadius',
        field: 'maxRadiusKm',
        precedence: 'vertical',
        // shared/serviceRadius.js normalizeServiceRadiusSettings: 1-100, else its default.
        read: (v) => {
            const n = num(v);
            return n !== null && Number.isFinite(n) && n >= 1 && n <= 100 ? Math.round(n * 100) / 100 : null;
        },
    },
    {
        key: 'orders.scheduledDispatchLeadMinutes',
        source: 'taxiTransportRide',
        field: 'minimum_time_for_starting_trip_drivers_for_schedule_ride',
        precedence: 'vertical',
        // Taxi's reader: a positive number of minutes, otherwise 15.
        read: (v) => {
            const n = num(v);
            return n !== null && Number.isFinite(n) && n > 0 ? n : 15;
        },
    },
].map((e) => Object.freeze({ ...e, vertical: LEGACY_SOURCES[e.source].vertical })));

export const legacyEntry = (key, vertical) =>
    LEGACY_SETTINGS.find((e) => e.key === key && e.vertical === vertical) || null;

export const LEVEL_LABELS = Object.freeze({
    partner: 'Partner override',
    zone: 'Zone override',
    vertical: 'Vertical override',
    global: 'Global',
    legacy: 'Service’s own setting (not migrated)',
    default: 'Registered default',
});

/**
 * The rule, kept pure. `resolved` is the resolver's answer for the reader's
 * context ({value, level, isDefault}); `legacyValue` the normalised old copy
 * (null when unset).
 *
 * @returns {{value: any, origin: 'partner'|'zone'|'vertical'|'global'|'legacy'|'default', label: string}}
 */
export function decide(entry, resolved, legacyValue) {
    const fromResolver = Boolean(resolved) && !resolved.isDefault && resolved.value !== null && resolved.value !== undefined;
    const out = (value, origin) => ({ value, origin, label: LEVEL_LABELS[origin] || origin });
    if (fromResolver && (entry.precedence === 'below' || resolved.level !== 'global')) {
        return out(resolved.value, resolved.level);
    }
    if (legacyValue !== null && legacyValue !== undefined) return out(legacyValue, 'legacy');
    if (fromResolver) return out(resolved.value, resolved.level);
    return out(resolved ? resolved.value : null, 'default');
}

/**
 * Resolve one moved setting for a reader, given the raw old field. Never throws: a settings read must
 * not fail a checkout, so a resolver error falls back to the old copy.
 */
export async function resolveWithLegacy(key, { vertical, zoneId } = {}, rawLegacy = null) {
    const entry = legacyEntry(key, vertical) || { key, vertical, precedence: 'vertical' };
    // Normalised exactly as the old reader did (idempotent, so a value that was
    // already normalised passes through unchanged).
    const legacyValue = entry.read ? entry.read(rawLegacy) : rawLegacy;
    let resolved = null;
    try {
        const { getMany } = await import('./resolver.service.js');
        resolved = (await getMany([key], { vertical, zoneId: zoneId ? String(zoneId) : undefined }))[key];
    } catch (err) {
        logger.warn(`legacySettings: resolver read failed for ${key}/${vertical}, using the service's own: ${err.message}`);
    }
    return decide(entry, resolved, legacyValue);
}

/**
 * A service's fee-settings object with the moved 'vertical'-precedence fee keys
 * applied (the platform fee keys stay with withMasterFees). The old copy only
 * counts when `settings` is a stored document (has an _id): the pricing code's
 * hard-coded fallback object is not a setting anybody made.
 */
export async function overlayFeeSettings(vertical, settings, { zoneId } = {}) {
    const source = vertical === 'food' ? 'foodFeeSettings' : vertical === 'quickCommerce' ? 'quickFeeSettings' : null;
    if (!source) return settings;
    const entries = LEGACY_SETTINGS.filter((e) => e.source === source && e.precedence === 'vertical');
    if (!entries.length) return settings;
    let rows = {};
    try {
        const { getMany } = await import('./resolver.service.js');
        rows = await getMany(entries.map((e) => e.key), { vertical, zoneId: zoneId ? String(zoneId) : undefined });
    } catch (err) {
        logger.warn(`legacySettings: fee overlay read failed for ${vertical}: ${err.message}`);
        return settings;
    }
    const stored = Boolean(settings && settings._id);
    let out = settings;
    for (const e of entries) {
        const legacy = stored ? e.read(settings[e.field]) : null;
        const d = decide(e, rows[e.key], legacy);
        if (d.origin === 'legacy' || d.origin === 'default') continue;
        if (out === settings) out = { ...(settings || {}) };
        out[e.field] = d.value;
    }
    return out;
}

/**
 * Mirror an old screen's save onto the vertical row the migration made.
 *
 * Only an EXISTING vertical row is touched. Creating one here would let the old
 * copy start beating a global value it is below today ('below' keys) -- the
 * migration is the one place that decides to create rows. Clearing the old
 * field clears the row, which lands where clearing the old field landed before.
 */
export async function syncLegacyWrite(sourceName, doc, { updatedBy = 'legacy-screen' } = {}) {
    const entries = LEGACY_SETTINGS.filter((e) => e.source === sourceName);
    if (!entries.length || !doc) return [];
    const out = [];
    try {
        const { PlatformSetting } = await import('./setting.model.js');
        const { set } = await import('./resolver.service.js');
        for (const e of entries) {
            // eslint-disable-next-line no-await-in-loop
            const row = await PlatformSetting.findOne({ key: e.key, level: 'vertical', scopeId: e.vertical }).lean();
            if (!row) continue;
            const value = e.read(doc[e.field]);
            if (value === row.value) continue;
            try {
                // eslint-disable-next-line no-await-in-loop
                await set(e.key, { level: 'vertical', scopeId: e.vertical, value, updatedBy, reason: `Saved on ${LEGACY_SOURCES[sourceName].label}` });
                out.push({ key: e.key, vertical: e.vertical, value });
            } catch (err) {
                logger.warn(`legacySettings: could not mirror ${e.key}/${e.vertical} (${value}): ${err.message}`);
            }
        }
    } catch (err) {
        logger.warn(`legacySettings: mirror after ${sourceName} save failed: ${err.message}`);
    }
    return out;
}

/* ------------------------------------------------------------ migration */

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What the migration would do (and, with apply, does). Idempotent: a second run
 * finds every copied value already in its vertical row.
 *
 * @returns {Promise<Array<{key, vertical, source, legacyValue, action, note, before, after}>>}
 *   action: 'copy' | 'copied' | 'in-sync' | 'skip'
 */
export async function migrateLegacySettings({ apply = false, updatedBy = 'migration:settings-to-resolver' } = {}) {
    const { PlatformSetting } = await import('./setting.model.js');
    const { set, invalidateCache } = await import('./resolver.service.js');
    const { coerce } = await import('./registry.js');

    const docs = {};
    for (const name of Object.keys(LEGACY_SOURCES)) {
        try {
            // eslint-disable-next-line no-await-in-loop
            docs[name] = await LEGACY_SOURCES[name].load();
        } catch (err) {
            docs[name] = null;
            logger.warn(`migrate-settings: could not load ${name}: ${err.message}`);
        }
    }

    const report = [];
    for (const e of LEGACY_SETTINGS) {
        const doc = docs[e.source];
        const legacyValue = doc ? e.read(doc[e.field]) : null;
        const row = { key: e.key, vertical: e.vertical, source: LEGACY_SOURCES[e.source].label, field: e.field, legacyValue };
        invalidateCache();
        // eslint-disable-next-line no-await-in-loop
        row.before = (await resolveWithLegacy(e.key, { vertical: e.vertical }, legacyValue));

        // eslint-disable-next-line no-await-in-loop
        const rows = await PlatformSetting.find({
            key: e.key,
            $or: [{ level: 'vertical', scopeId: e.vertical }, { level: 'global', scopeId: '*' }],
        }).lean();
        const verticalRow = rows.find((r) => r.level === 'vertical' && r.value !== null && r.value !== undefined);
        const globalRow = rows.find((r) => r.level === 'global' && r.value !== null && r.value !== undefined);

        let action = 'copy';
        let note = '';
        let value = legacyValue;
        if (legacyValue === null) {
            action = 'skip';
            note = 'not set on the service’s own screen';
        } else if (verticalRow) {
            action = sameValue(verticalRow.value, legacyValue) ? 'in-sync' : 'skip';
            note = action === 'in-sync' ? 'vertical override already holds this value' : `vertical override already set to ${JSON.stringify(verticalRow.value)} and is what readers use; left as is`;
        } else if (e.precedence === 'below' && globalRow) {
            action = 'skip';
            note = `the global value ${JSON.stringify(globalRow.value)} already wins over the service’s own; nothing to preserve`;
        } else {
            try {
                value = coerce(e.key, legacyValue);
            } catch (err) {
                action = 'skip';
                note = `not valid for the registry (${err.message}); readers keep using the service’s own`;
            }
        }

        if (action === 'copy' && apply) {
            // eslint-disable-next-line no-await-in-loop
            await set(e.key, { level: 'vertical', scopeId: e.vertical, value, updatedBy, reason: `Copied from ${row.source} (${e.field})` });
            action = 'copied';
        }
        row.action = action;
        row.note = note;
        invalidateCache();
        // eslint-disable-next-line no-await-in-loop
        row.after = (await resolveWithLegacy(e.key, { vertical: e.vertical }, legacyValue));
        report.push(row);
    }
    return report;
}

/* ------------------------------------------------------------ provenance */

/**
 * Where each moved value comes from, per service, for one optional zone: what
 * Master > Global platform shows under "Where each value comes from".
 */
export async function settingsProvenance({ vertical, zoneId } = {}) {
    const { explainKey } = await import('./resolver.service.js');
    const { definitionOf } = await import('./registry.js');
    const entries = LEGACY_SETTINGS.filter((e) => !vertical || e.vertical === vertical);
    const docs = {};
    const out = [];
    for (const e of entries) {
        if (!(e.source in docs)) {
            try {
                // eslint-disable-next-line no-await-in-loop
                docs[e.source] = await LEGACY_SOURCES[e.source].load();
            } catch {
                docs[e.source] = null;
            }
        }
        const doc = docs[e.source];
        const legacyValue = doc ? e.read(doc[e.field]) : null;
        const ctx = { vertical: e.vertical, zoneId: zoneId ? String(zoneId) : undefined };
        // eslint-disable-next-line no-await-in-loop
        const detail = await explainKey(e.key, ctx);
        const hit = detail.level ? { value: detail.effective, level: detail.level, isDefault: false } : { value: detail.registeredDefault, level: null, isDefault: true };
        const d = decide(e, hit, legacyValue);
        const verticalRow = detail.chain.find((c) => c.level === 'vertical');
        out.push({
            key: e.key,
            label: definitionOf(e.key)?.label || e.key,
            vertical: e.vertical,
            zoneId: ctx.zoneId || null,
            effective: d.value,
            origin: d.origin,
            originLabel: d.origin === 'legacy' ? `${LEGACY_SOURCES[e.source].label}` : d.label,
            precedence: e.precedence,
            legacy: { source: LEGACY_SOURCES[e.source].label, field: e.field, value: legacyValue },
            migrated: Boolean(verticalRow?.set),
            scopes: definitionOf(e.key)?.scopes || [],
            chain: detail.chain,
        });
    }
    return out;
}
