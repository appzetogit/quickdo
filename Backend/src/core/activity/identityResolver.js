import { logger } from '../../utils/logger.js';

/**
 * Every id a single customer is known by, across the four verticals.
 *
 * The activity feed is keyed on the userId that each vertical stamped on its own
 * document, and those are NOT the same id:
 *
 *   food, taxi        -> `users`      (one shared collection, so one id)
 *   service-provider  -> `sp_users`   (its own document, linked by phone)
 *   quick-commerce    -> `qc_users`   (its own document, linked by phone)
 *
 * So querying activities by the caller's token id alone returns food and taxi and
 * silently omits the other two -- a "unified" feed that is quietly missing half the
 * customer's history. Phone is the only link that exists today: the service-provider
 * identity bridge matches on the last ten digits rather than storing a foreign key.
 *
 * This goes away once the identity merge in SUPERAPP_DATA_MODEL.md lands and all four
 * share `users`. Until then, resolving here keeps the feed honest.
 */

const toTenDigits = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : null;
};

/**
 * @param {string} masterUserId  `users._id` from the caller's token
 * @returns {Promise<{ids: string[], phone: string|null, resolved: string[]}>}
 */
export const resolveCustomerIdentities = async (masterUserId) => {
    const ids = [masterUserId];
    const resolved = ['food/taxi'];
    let phone = null;

    try {
        const { FoodUser } = await import('../users/user.model.js');
        const master = await FoodUser.findById(masterUserId).select('phone').lean();
        phone = toTenDigits(master?.phone);
    } catch (err) {
        logger.warn(`[Activity] could not read the caller's phone: ${err.message}`);
    }

    // Explicit links first (identity merge, phase 1): satellites stamped with
    // platformUserId are found by an indexed exact match -- deterministic,
    // format-proof, and it works even when the master user has NO phone (which used
    // to end resolution right here). The phone-suffix regex remains ONLY as a
    // fallback for satellite documents the backfill has not linked yet; it can be
    // deleted once scripts/link-user-identities.js has run everywhere.
    const bySatellite = phone
        ? { $or: [{ platformUserId: masterUserId }, { platformUserId: null, phone: new RegExp(`${phone}$`) }] }
        : { platformUserId: masterUserId };

    try {
        const { createRequire } = await import('node:module');
        const require = createRequire(import.meta.url);
        const SPUser = require('../../modules/serviceProvider/models/User.js');
        const sp = await SPUser.findOne(bySatellite).select('_id').lean();
        if (sp?._id) { ids.push(sp._id); resolved.push('serviceProvider'); }
    } catch (err) {
        logger.warn(`[Activity] service-provider identity unresolved: ${err.message}`);
    }

    try {
        const { FoodUser: QCUser } = await import('../../modules/quickCommerce/core/users/user.model.js');
        const qc = await QCUser.findOne(bySatellite).select('_id').lean();
        if (qc?._id) { ids.push(qc._id); resolved.push('quickCommerce'); }
    } catch (err) {
        logger.warn(`[Activity] quick-commerce identity unresolved: ${err.message}`);
    }

    return { ids, phone, resolved };
};
