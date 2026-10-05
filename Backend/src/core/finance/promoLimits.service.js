import { logger } from '../../utils/logger.js';

/**
 * The platform ceiling on what a promo code may give away.
 *
 * Taxi and food run separate coupon systems -- `TaxiPromoCode` with
 * `uses_per_user` / `max_uses_total`, `FoodOffer` with `perUserLimit` /
 * `usageLimit` -- and nothing sat above either of them. "No code may be used
 * more than three times by one customer" was not a rule anyone could state; it
 * had to be enforced by remembering to type it into every code.
 *
 * Set once in Master > Promotions (core/config), globally or per module.
 *
 * TWO PROPERTIES THIS MUST HAVE, and the reason the arithmetic is not just
 * Math.min.
 *
 * It only ever TIGHTENS. A code allowing fewer uses than the ceiling keeps its
 * own number, so raising the ceiling can never quietly make a live promo more
 * generous than whoever created it intended.
 *
 * And ZERO MEANS UNLIMITED in both systems -- `max_uses_total: 0` is "no cap",
 * `perUserLimit: null` likewise. A plain Math.min against those reads unlimited
 * as the smallest possible limit and caps every promo at nothing. `tighten`
 * below is where that is handled, once, rather than at each call site.
 */

const PER_USER_KEY = 'promo.maxUsesPerUser';
const TOTAL_KEY = 'promo.maxUsesTotal';

/** A promo's own limit, where 0, null and undefined all mean "no limit". */
const ownLimit = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The limit actually in force: the promo's own, the ceiling, or the smaller.
 *
 * @param {number|null|undefined} own      what the code asks for (0/null = unlimited)
 * @param {number|null} ceiling            the platform ceiling (null = none)
 * @returns {number|null}                  null = still unlimited
 */
export function tighten(own, ceiling) {
    const mine = ownLimit(own);
    const cap = ownLimit(ceiling);
    if (cap === null) return mine;   // no ceiling: the code's own word stands
    if (mine === null) return cap;   // unlimited code: the ceiling becomes its limit
    return Math.min(mine, cap);
}

/**
 * The ceilings for a module.
 *
 * @param {object} args
 * @param {string} args.vertical  'taxi' | 'food' | 'quickCommerce' | 'medical'
 * @returns {Promise<{perUser: number|null, total: number|null, perUserLevel: string|null, totalLevel: string|null}>}
 */
export async function resolvePromoCeiling({ vertical } = {}) {
    let rows = null;
    try {
        const { getMany } = await import('../config/resolver.service.js');
        rows = await getMany([PER_USER_KEY, TOTAL_KEY], { vertical: vertical || undefined });
    } catch (err) {
        /*
         * A settings read must never change who gets a discount. Failing open --
         * no ceiling -- keeps today's behaviour rather than rejecting redemptions
         * during a database blip, which would look to a customer like a promo
         * that randomly stopped working.
         */
        logger.warn(`promoLimits: ceiling read failed, applying none: ${err.message}`);
        return { perUser: null, total: null, perUserLevel: null, totalLevel: null };
    }

    const perUserRow = rows[PER_USER_KEY];
    const totalRow = rows[TOTAL_KEY];
    return {
        perUser: perUserRow && !perUserRow.isDefault ? ownLimit(perUserRow.value) : null,
        total: totalRow && !totalRow.isDefault ? ownLimit(totalRow.value) : null,
        perUserLevel: perUserRow && !perUserRow.isDefault ? perUserRow.level : null,
        totalLevel: totalRow && !totalRow.isDefault ? totalRow.level : null,
    };
}

/**
 * Both limits for one promo, already tightened. What redemption should ask for.
 *
 * @returns {Promise<{perUser: number|null, total: number|null, ceiling: object}>}
 */
export async function effectivePromoLimits({ vertical, ownPerUser, ownTotal } = {}) {
    const ceiling = await resolvePromoCeiling({ vertical });
    return {
        perUser: tighten(ownPerUser, ceiling.perUser),
        total: tighten(ownTotal, ceiling.total),
        ceiling,
    };
}

export const __testables = { ownLimit };
