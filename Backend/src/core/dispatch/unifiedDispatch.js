import mongoose from 'mongoose';
import { config, env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * One driver for taxi rides, food deliveries and grocery runs (SOW plan §8).
 *
 * Two switches, on purpose:
 *
 *   UNIFIED_DISPATCH_ENABLED (env, default off)
 *       The master switch. While it is off nothing in this file changes behaviour and
 *       nothing extra is queried. When it is on, the cross-vertical busy-lock
 *       (core/assignment) is claimed by every vertical and every dispatcher honours the
 *       driver's work mode. Those two must be platform-wide: a lock that only some
 *       verticals claim is worse than none.
 *
 *   dispatch.unifiedZones (platform setting, default [])
 *       Where the NEW behaviour is piloted: food and quick-commerce candidates drawn from
 *       the taxi Driver pool, the riderFinance eligibility gate at dispatch time in every
 *       vertical, and the merged `job:offer` feed. [] means every zone. Each vertical has
 *       its own zone collection, so a pilot city lists the taxi, food and QC zone ids that
 *       cover it.
 */

export const isUnifiedDispatchEnabled = () => Boolean(config.unifiedDispatchEnabled || env.unifiedDispatchEnabled);

/** The pilot zone ids, as strings. [] = all zones. Never throws. */
export async function unifiedPilotZones() {
    try {
        const { get } = await import('../config/resolver.service.js');
        const resolved = await get('dispatch.unifiedZones');
        return Array.isArray(resolved?.value) ? resolved.value.map(String).filter(Boolean) : [];
    } catch (err) {
        logger.warn(`unifiedDispatch: pilot zones unavailable, treating as all zones: ${err.message}`);
        return [];
    }
}

/**
 * Whether the unified pool, the dispatch-time finance gate and the merged feed apply to a
 * job in this zone (or any of these zones).
 */
export async function isUnifiedDispatchActive(zoneIds = []) {
    if (!isUnifiedDispatchEnabled()) return false;
    const pilot = await unifiedPilotZones();
    if (!pilot.length) return true;
    const ids = (Array.isArray(zoneIds) ? zoneIds : [zoneIds])
        .filter(Boolean)
        .map((z) => String(z?._id || z));
    return ids.some((z) => pilot.includes(z));
}

const toObjectId = (value) => {
    const raw = String(value?._id || value || '');
    return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
};

const loadPartnerModel = async (vertical) => {
    if (vertical === 'quickCommerce') {
        return (await import('../../modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js')).FoodDeliveryPartner;
    }
    return (await import('../../modules/food/delivery/models/deliveryPartner.model.js')).FoodDeliveryPartner;
};

/**
 * Delivery candidates taken from the taxi Driver pool.
 *
 * Uses findEligibleUnifiedDrivers, so a candidate is online, approved, not deleted, holds the
 * capability for this vertical, has a work mode that accepts it, and is FREE (no
 * activeAssignment -- the busy-lock). Each driver is returned as the partner record the
 * delivery endpoints act on: the food partner for food, the QC rider for quick commerce.
 * A driver with no such record (never migrated) cannot accept through the delivery API and
 * is left out, with a log line.
 *
 * @param {'food'|'quickCommerce'} vertical
 * @param {[number, number]} coordinates  [lng, lat] of the pickup
 * @returns {Promise<Array<{partnerId, driverId, distanceKm, status, lat, lng, source}>>}
 */
export async function unifiedDeliveryCandidates(vertical, coordinates, { maxKm = 15, limit = 25 } = {}) {
    if (!Array.isArray(coordinates) || coordinates.length !== 2) return [];
    const { findEligibleUnifiedDrivers } = await import('../../modules/taxi/driver/services/unifiedDispatchService.js');
    const service = vertical === 'quickCommerce' ? 'quickCommerce' : 'delivery';

    let drivers = [];
    try {
        drivers = await findEligibleUnifiedDrivers(service, coordinates.map(Number), {
            maxDistanceMeters: Math.max(1, Number(maxKm) || 15) * 1000,
            limit,
        });
    } catch (err) {
        logger.warn(`unifiedDispatch: driver pool query failed (${vertical}): ${err.message}`);
        return [];
    }
    if (!drivers.length) return [];

    const partnerIdByDriver = new Map();
    let unlinked = 0;
    for (const d of drivers) {
        let partnerId = null;
        if (vertical === 'quickCommerce') {
            partnerId = d.legacyQcPartnerId || null;
            if (!partnerId && d.legacyDeliveryPartnerId) {
                const { qcRiderIdForFoodRider } = await import('../delivery/qcRiderLink.js');
                // eslint-disable-next-line no-await-in-loop
                partnerId = await qcRiderIdForFoodRider(d.legacyDeliveryPartnerId).catch(() => null);
            }
        } else {
            partnerId = d.legacyDeliveryPartnerId || null;
        }
        const oid = toObjectId(partnerId);
        if (oid) partnerIdByDriver.set(String(d._id), oid);
        else unlinked += 1;
    }
    if (unlinked) {
        logger.info(`unifiedDispatch: ${unlinked} ${vertical} driver(s) skipped, no linked partner record (run scripts/migrate-unify-drivers.js)`);
    }
    if (!partnerIdByDriver.size) return [];

    const Partner = await loadPartnerModel(vertical);
    const partners = await Partner.find({ _id: { $in: [...partnerIdByDriver.values()] } })
        .select('_id status')
        .lean();
    const statusById = new Map(partners.map((p) => [String(p._id), p.status]));

    const out = [];
    for (const d of drivers) {
        const partnerId = partnerIdByDriver.get(String(d._id));
        if (!partnerId || !statusById.has(String(partnerId))) continue;
        const [lng, lat] = d.location?.coordinates || [];
        out.push({
            partnerId,
            driverId: d._id,
            distanceKm: Number.isFinite(Number(d.distanceMeters)) ? Number(d.distanceMeters) / 1000 : null,
            status: statusById.get(String(partnerId)),
            lat,
            lng,
            source: 'driver',
        });
    }
    return out;
}

/**
 * Merge Driver-pool candidates into a legacy candidate list, one row per partner, nearest
 * distance kept. Legacy rows keep their own fields.
 */
export function mergeCandidates(legacy = [], fromDrivers = []) {
    const byId = new Map();
    for (const row of legacy) byId.set(String(row.partnerId), row);
    for (const row of fromDrivers) {
        const key = String(row.partnerId);
        const prev = byId.get(key);
        if (!prev) {
            byId.set(key, row);
        } else if (Number.isFinite(row.distanceKm) && (!Number.isFinite(prev.distanceKm) || row.distanceKm < prev.distanceKm)) {
            byId.set(key, { ...prev, distanceKm: row.distanceKm, lat: row.lat, lng: row.lng, driverId: row.driverId });
        }
    }
    return [...byId.values()];
}

/**
 * The money gate, applied at DISPATCH time with core/finance/riderFinance -- one figure across
 * taxi, food and quick commerce -- so an ineligible rider is never offered the job, rather
 * than being offered it and refused at accept.
 *
 *   taxi        any riderFinance block (minimum wallet balance, wallet disabled, shared cash
 *               ceiling, admin hold) -- the same rule ensureDriverWalletCanAcceptRide applies
 *               at accept.
 *   food / QC   the shared cash ceiling only: at or over it, no new delivery; and for an
 *               order that collects cash, cash in hand plus the order must stay within it.
 *               The taxi minimum-balance rule is not applied to deliveries: a delivery-only
 *               rider has no taxi wallet, and taxi cash owed is already inside cashInHand.
 *
 * Fails open per candidate (logged): a finance read error must not stop dispatch, and the
 * accept-time checks still run.
 *
 * @param {Array} candidates
 * @param {{vertical: 'taxi'|'food'|'quickCommerce', orderCash?: number, idOf?: (c) => any, walletOf?: (c) => any}} opts
 * @returns {Promise<{kept: Array, blocked: Map<string, string>}>}
 */
export async function filterByRiderFinance(candidates = [], {
    vertical,
    orderCash = 0,
    idOf = (c) => c?.partnerId,
    walletOf = () => null,
} = {}) {
    const blocked = new Map();
    if (!Array.isArray(candidates) || !candidates.length) return { kept: [], blocked };
    const { getRiderFinance } = await import('../finance/riderFinance.service.js');
    const cash = Math.max(0, Number(orderCash) || 0);

    const verdicts = await Promise.all(candidates.map(async (c) => {
        const id = idOf(c);
        try {
            const wallet = walletOf(c);
            const f = await getRiderFinance(id, wallet ? { driverWallet: wallet } : {});
            if (vertical === 'taxi') {
                return f.isBlocked ? (f.blockReason || 'blocked') : null;
            }
            if (f?.rules?.enforceCashLimit === false) return null;
            const limit = Number(f?.cashLimit) || 0;
            if (limit <= 0) return null;
            const inHand = Number(f?.cashInHand) || 0;
            if (inHand >= limit) return 'cash_limit_reached';
            if (cash > 0 && inHand + cash > limit) return 'cash_limit_would_exceed';
            return null;
        } catch (err) {
            logger.warn(`unifiedDispatch: riderFinance check failed for ${id} (${vertical}), kept: ${err.message}`);
            return null;
        }
    }));

    const kept = [];
    candidates.forEach((c, i) => {
        if (verdicts[i]) blocked.set(String(idOf(c)), verdicts[i]);
        else kept.push(c);
    });
    if (blocked.size) {
        logger.info(`unifiedDispatch: ${blocked.size} ${vertical} candidate(s) held back by riderFinance: ${[...new Set(blocked.values())].join(', ')}`);
    }
    return { kept, blocked };
}
