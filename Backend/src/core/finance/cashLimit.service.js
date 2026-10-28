import { logger } from '../../utils/logger.js';

/**
 * The cash limit, from one place.
 *
 * Before this, "how much platform cash may a partner hold" was three unrelated
 * numbers: the food admin's delivery cash limit (which riderFinance applied to
 * taxi, food and quick commerce alike), and service-provider's per-vendor
 * `wallet.cashLimit`, pushed onto every vendor document by SP's own settings
 * screen. Changing the rule meant knowing which screen owned which partner.
 *
 * Now every reader asks this module, which asks the platform settings
 * (core/config, Master > Platform settings) under the one precedence the whole
 * platform uses:
 *
 *     partner override  >  zone  >  vertical  >  global
 *
 * THE RULE THAT MAKES IT SAFE TO SHIP: an ADMINISTERED value -- a row somebody set,
 * at any level -- wins. When nobody has set one, the partner keeps today's number
 * (`legacy`: the food admin setting for riders, the vendor's own field for SP).
 * The registry default (0) is used only when there is no legacy figure either.
 * So the day this deploys nothing changes; from then on the settings screen is the
 * control, and every answer can say where it came from.
 *
 * `finance.enforceCashLimit` = false keeps the number visible but stops it blocking.
 */

const toLimit = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

const finish = ({ configured, enforce, source, level }) => ({
    // What to show and store: the configured ceiling (0 = no ceiling).
    configuredCashLimit: configured,
    // What to enforce with. 0 = no ceiling, matching riderFinance's convention.
    cashLimit: enforce ? configured : 0,
    enforce,
    source,
    level,
});

/**
 * @param {object} args
 * @param {string} [args.vertical]   omit for riders: their limit spans taxi, food and QC
 * @param {string} [args.partnerId]
 * @param {string} [args.zoneId]
 * @param {number|null} [args.legacy]  today's figure for this partner, if any
 */
export async function resolveCashLimit({ vertical, partnerId, zoneId, legacy = null } = {}) {
    let limitRow = null;
    let enforceRow = null;
    try {
        const { getMany } = await import('../config/resolver.service.js');
        const rows = await getMany(['finance.cashLimit', 'finance.enforceCashLimit'], {
            vertical: vertical || undefined,
            partnerId: partnerId ? String(partnerId) : undefined,
            zoneId: zoneId ? String(zoneId) : undefined,
        });
        limitRow = rows['finance.cashLimit'] || null;
        enforceRow = rows['finance.enforceCashLimit'] || null;
    } catch (err) {
        // Settings must never be the reason a partner is blocked or waved through
        // differently from today: fall back to the legacy figure.
        logger.warn(`cashLimit: settings read failed, using today's figure: ${err.message}`);
    }

    const enforce = enforceRow ? enforceRow.value !== false : true;
    const legacyLimit = toLimit(legacy);

    if (limitRow && !limitRow.isDefault) {
        return finish({ configured: toLimit(limitRow.value) ?? 0, enforce, source: limitRow.source, level: limitRow.level });
    }
    if (legacyLimit !== null) {
        return finish({ configured: legacyLimit, enforce, source: 'Existing setting (not yet set in Platform settings)', level: 'legacy' });
    }
    return finish({ configured: toLimit(limitRow?.value) ?? 0, enforce, source: 'Registered default', level: null });
}

/**
 * The same answer for many partners at once, for list and search paths.
 *
 * One settings read for the shared levels (vertical/global) plus ONE query for any
 * partner-level overrides, rather than a lookup per partner.
 *
 * @param {object} args
 * @param {string} args.vertical
 * @param {Array<{ id: any, legacy?: number|null }>} args.partners
 * @returns {Promise<Map<string, ReturnType<typeof finish>>>}
 */
export async function resolveCashLimitsForPartners({ vertical, partners = [] } = {}) {
    const shared = await resolveCashLimit({ vertical, legacy: null });
    const sharedAdministered = shared.level !== null && shared.level !== 'legacy'
        && shared.source !== 'Registered default';

    let overrides = new Map();
    const ids = partners.map((p) => String(p.id)).filter(Boolean);
    if (ids.length) {
        try {
            const { PlatformSetting } = await import('../config/setting.model.js');
            const rows = await PlatformSetting.find({
                key: 'finance.cashLimit', level: 'partner', scopeId: { $in: ids },
            }).select('scopeId value').lean();
            overrides = new Map(rows.map((r) => [String(r.scopeId), toLimit(r.value)]));
        } catch (err) {
            logger.warn(`cashLimit: partner override read failed: ${err.message}`);
        }
    }

    const out = new Map();
    for (const p of partners) {
        const id = String(p.id);
        const override = overrides.get(id);
        let result;
        if (override !== undefined && override !== null) {
            result = finish({ configured: override, enforce: shared.enforce, source: 'Partner override', level: 'partner' });
        } else if (sharedAdministered) {
            result = shared;
        } else {
            const legacyLimit = toLimit(p.legacy);
            result = legacyLimit !== null
                ? finish({ configured: legacyLimit, enforce: shared.enforce, source: 'Existing setting (not yet set in Platform settings)', level: 'legacy' })
                : shared;
        }
        out.set(id, result);
    }
    return out;
}

/**
 * Record an SP admin's limit change in the platform settings too, so the Master
 * screen and SP's own screens agree. Never throws: the SP write already happened.
 */
export async function recordCashLimitSetting({ level, scopeId, value, updatedBy = '', reason = '' }) {
    try {
        const { set } = await import('../config/resolver.service.js');
        await set('finance.cashLimit', { level, scopeId, value, updatedBy, reason });
        return true;
    } catch (err) {
        logger.warn(`cashLimit: could not mirror ${level} limit into platform settings: ${err.message}`);
        return false;
    }
}
