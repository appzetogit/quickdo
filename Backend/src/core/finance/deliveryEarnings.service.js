import { logger } from '../../utils/logger.js';

/**
 * What a rider is paid, from one place.
 *
 * Before this, the earning formula was a `food_delivery_commission_rules`
 * collection that food and quick commerce BOTH pointed at -- one shared table
 * neither panel said was shared, so changing food's rates silently changed quick
 * commerce's -- and an incentive rule that existed only in food's fee settings,
 * so a quick-commerce rider earned no incentive on the same order.
 *
 * Now both come from Master > Delivery earnings (core/config) under the one
 * precedence the platform uses:
 *
 *     zone  >  vertical  >  global
 *
 * Not per partner: this is the pay structure, not one rider's deal. A per-rider
 * rate is a different feature and would belong on the rider's own page.
 *
 * THE RULE THAT MAKES IT SAFE TO SHIP, the same one cashLimit.service.js uses: an
 * ADMINISTERED value -- a table somebody saved, at any level -- wins. When nobody
 * has saved one, the module keeps reading its own rows exactly as today. So the
 * day this deploys nothing changes; from then on Master is the control, and every
 * answer can say which level it came from.
 */

const SLAB_KEY = 'earnings.distanceSlabs';
const INCENTIVE_KEY = 'earnings.incentive';

const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

/** The module's own rows, in the shape the engine stores. */
const fromLegacyRows = (rows) =>
    (Array.isArray(rows) ? rows : []).map((r) => ({
        distanceRuleId: r?._id ? String(r._id) : null,
        name: String(r?.name || '').trim(),
        minDistance: num(r?.minDistance, 0),
        maxDistance: r?.maxDistance == null ? null : num(r.maxDistance, null),
        userDeliveryFee: num(r?.userDeliveryFee, 0),
        commissionPerKm: num(r?.commissionPerKm, 0),
        basePayout: num(r?.basePayout, 0),
    }));

/**
 * Which band a distance falls in.
 *
 * Deliberately identical to the `resolveDistanceRule` it replaces, fallbacks and
 * all: an exact match, else the highest band whose floor the distance clears,
 * else the lowest band. Those fallbacks are what stop a trip beyond the last
 * band pricing at zero, so they are reproduced rather than tidied up.
 */
export function pickSlab(slabs, distanceKm) {
    const d = Number(distanceKm);
    if (!Number.isFinite(d) || d < 0) return null;
    const list = Array.isArray(slabs) ? slabs : [];
    if (!list.length) return null;

    const sorted = [...list].sort((a, b) => num(a.minDistance) - num(b.minDistance));
    const matched = sorted.find((r) => {
        const min = num(r.minDistance, 0);
        const max = r.maxDistance == null ? null : num(r.maxDistance, null);
        return d >= min && (max == null || d < max);
    });
    if (matched) return matched;

    const lower = [...sorted].reverse().find((r) => d >= num(r.minDistance, 0));
    return lower || sorted[0] || null;
}

/**
 * What a band charges for a trip of this length.
 *
 * The band's own fee -- a flat customer fee where one is set, otherwise the
 * per-km rate over the whole trip -- plus `extraPerKm` for every kilometre
 * ABOVE the band's start.
 *
 * The extra is what makes an open-ended final band work. Band matching falls
 * back to the widest band for anything past the last one, so without it a 45km
 * delivery is charged the 5-6km band's flat fee, identical to a 5.5km trip, and
 * the rider is paid from that same figure. `extraPerKm` of 0 leaves the band
 * exactly as flat as it was, which is why this is safe to apply everywhere.
 *
 * @returns {{fee: number, base: number, extraKm: number, extra: number}}
 */
export function bandFee(band, distanceKm) {
    const d = Number(distanceKm);
    const km = Number.isFinite(d) && d > 0 ? d : 0;
    if (!band) return { fee: 0, base: 0, extraKm: 0, extra: 0 };

    const flat = num(band.userDeliveryFee, 0);
    const perKm = num(band.commissionPerKm, 0);
    const base = flat > 0 ? flat : Math.max(0, perKm * km);

    const extraRate = num(band.extraPerKm, 0);
    const extraKm = extraRate > 0 ? Math.max(0, km - num(band.minDistance, 0)) : 0;
    const extra = Math.round(extraRate * extraKm * 100) / 100;

    return {
        fee: Math.round((base + extra) * 100) / 100,
        base: Math.round(base * 100) / 100,
        extraKm: Math.round(extraKm * 100) / 100,
        extra,
    };
}

/**
 * The earning table for a vertical.
 *
 * @param {object} args
 * @param {string} args.vertical          'food' | 'quickCommerce' | 'medical' | 'taxi'
 * @param {string} [args.zoneId]
 * @param {Function} [args.loadLegacy]    async () => module's own rows, used when nothing is set here
 * @returns {Promise<{slabs: Array, source: string, level: string|null}>}
 */
export async function resolveEarningSlabs({ vertical, zoneId, loadLegacy } = {}) {
    let row = null;
    try {
        const { get } = await import('../config/resolver.service.js');
        row = await get(SLAB_KEY, {
            vertical: vertical || undefined,
            zoneId: zoneId ? String(zoneId) : undefined,
        });
    } catch (err) {
        // A settings read must never be the reason an order cannot be priced.
        logger.warn(`deliveryEarnings: settings read failed, using the module's own table: ${err.message}`);
    }

    if (row && !row.isDefault && Array.isArray(row.value) && row.value.length) {
        return { slabs: row.value, source: row.source, level: row.level };
    }

    let legacy = [];
    if (typeof loadLegacy === 'function') {
        try {
            legacy = fromLegacyRows(await loadLegacy());
        } catch (err) {
            logger.error(`deliveryEarnings: could not read the module's own table: ${err.message}`);
        }
    }
    return {
        slabs: legacy,
        source: legacy.length ? 'Module table (not yet set in Master)' : 'No table configured',
        level: legacy.length ? 'legacy' : null,
    };
}

/**
 * The incentive rule for a vertical.
 *
 * @param {object} args
 * @param {string} args.vertical
 * @param {string} [args.zoneId]
 * @param {object|null} [args.legacy]  the module's own rule, if it has one
 * @returns {Promise<{isEnabled: boolean, minOrderAmount: number, incentivePercent: number, source: string, level: string|null}>}
 */
export async function resolveIncentive({ vertical, zoneId, legacy = null } = {}) {
    let row = null;
    try {
        const { get } = await import('../config/resolver.service.js');
        row = await get(INCENTIVE_KEY, {
            vertical: vertical || undefined,
            zoneId: zoneId ? String(zoneId) : undefined,
        });
    } catch (err) {
        logger.warn(`deliveryEarnings: incentive read failed, using the module's own rule: ${err.message}`);
    }

    const shape = (v, source, level) => ({
        isEnabled: v?.isEnabled === true,
        minOrderAmount: Math.max(0, num(v?.minOrderAmount, 0)),
        incentivePercent: Math.min(100, Math.max(0, num(v?.incentivePercent, 0))),
        source,
        level,
    });

    if (row && !row.isDefault && row.value && typeof row.value === 'object') {
        return shape(row.value, row.source, row.level);
    }
    if (legacy && typeof legacy === 'object') {
        return shape(legacy, 'Module rule (not yet set in Master)', 'legacy');
    }
    // No rule anywhere is "no incentive", which is what both modules do today
    // when the rule is missing -- not an error, and not a free payout.
    return shape(null, 'No incentive configured', null);
}

export const __testables = { fromLegacyRows };
