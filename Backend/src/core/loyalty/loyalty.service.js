import mongoose from 'mongoose';
import { LoyaltyLedger } from './loyaltyLedger.model.js';
import { getMany, set as setSetting } from '../config/resolver.service.js';
import { platformUserIdFor } from '../identity/platformUser.js';
import { ValidationError } from '../auth/errors.js';
import { logger } from '../../utils/logger.js';

/**
 * Loyalty points (plan §5.7), shared by every vertical.
 *
 *   earnForOrder     on delivery; idempotent per order
 *   quoteRedemption  what the customer may use on a basket (admin cap applied)
 *   burnPoints       at checkout; idempotent per order, all-or-nothing
 *   reverseBurn      when an order that used points is cancelled; idempotent
 *   balanceOf        unexpired points, after expiring what is due
 *
 * Rules are admin settings (core/config/registry.js `loyalty.*`), per vertical
 * with a global fallback. Off by default: nothing is earned or redeemed until an
 * admin turns it on, so today's checkout is unchanged.
 */

export const LOYALTY_KEYS = [
    'loyalty.enabled',
    'loyalty.pointsPerRupee',
    'loyalty.rupeesPerPoint',
    'loyalty.maxRedeemPercent',
    'loyalty.expiryDays',
];

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const oid = (v) => new mongoose.Types.ObjectId(String(v));

export async function loyaltySettings(vertical) {
    const resolved = await getMany(LOYALTY_KEYS, vertical ? { vertical } : {});
    const v = (k) => resolved[k]?.value;
    return {
        enabled: v('loyalty.enabled') === true,
        pointsPerRupee: Math.max(0, Number(v('loyalty.pointsPerRupee')) || 0),
        rupeesPerPoint: Math.max(0, Number(v('loyalty.rupeesPerPoint')) || 0),
        maxRedeemPercent: Math.min(100, Math.max(0, Number(v('loyalty.maxRedeemPercent')) || 0)),
        expiryDays: Math.max(0, Number(v('loyalty.expiryDays')) || 0),
    };
}

/** Save the rules at the global level or for one vertical. */
export async function saveLoyaltySettings(input = {}, { vertical = null, updatedBy = '' } = {}) {
    const level = vertical ? 'vertical' : 'global';
    const map = {
        enabled: 'loyalty.enabled',
        pointsPerRupee: 'loyalty.pointsPerRupee',
        rupeesPerPoint: 'loyalty.rupeesPerPoint',
        maxRedeemPercent: 'loyalty.maxRedeemPercent',
        expiryDays: 'loyalty.expiryDays',
    };
    for (const [field, key] of Object.entries(map)) {
        if (input[field] === undefined) continue;
        await setSetting(key, { level, scopeId: vertical || undefined, value: input[field], updatedBy, reason: 'Loyalty rules' });
    }
    return loyaltySettings(vertical);
}

/** The loyalty account for any service's customer id: the platform user where linked. */
export async function loyaltyAccountFor(customerId) {
    if (!isId(customerId)) return null;
    try {
        const linked = await platformUserIdFor(customerId);
        return linked?.platformId || String(customerId);
    } catch {
        return String(customerId);
    }
}

/** Zero the unspent part of every earn row that has expired, once each. */
export async function expireDuePoints(accountId, now = new Date()) {
    if (!isId(accountId)) return 0;
    const due = await LoyaltyLedger.find({
        userId: oid(accountId),
        type: { $in: ['earn', 'reverse_burn', 'adjust'] },
        remaining: { $gt: 0 },
        expiresAt: { $ne: null, $lte: now },
    }).select('_id remaining vertical').lean();
    let expired = 0;
    for (const row of due) {
        const taken = await LoyaltyLedger.findOneAndUpdate(
            { _id: row._id, remaining: row.remaining },
            { $set: { remaining: 0 } },
        );
        if (!taken) continue;
        try {
            await LoyaltyLedger.create({
                userId: oid(accountId),
                vertical: row.vertical,
                type: 'expire',
                points: row.remaining,
                idempotencyKey: `expire:${row._id}`,
                note: 'Points expired',
            });
        } catch (err) {
            if (err?.code !== 11000) throw err;
        }
        expired += row.remaining;
    }
    return expired;
}

export async function balanceOf(customerId, { now = new Date(), accountId } = {}) {
    const account = accountId || (await loyaltyAccountFor(customerId));
    if (!account) return 0;
    await expireDuePoints(account, now);
    const [row] = await LoyaltyLedger.aggregate([
        {
            $match: {
                userId: oid(account),
                type: { $in: ['earn', 'reverse_burn', 'adjust'] },
                remaining: { $gt: 0 },
                $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
            },
        },
        { $group: { _id: null, points: { $sum: '$remaining' } } },
    ]);
    return Math.max(0, Math.floor(row?.points || 0));
}

const expiryFrom = (settings, now = new Date()) =>
    settings.expiryDays > 0 ? new Date(now.getTime() + settings.expiryDays * 86400000) : null;

/**
 * Points for a delivered order. Idempotent per vertical + order: the second
 * call returns the first row. `amount` is the item value the customer paid for
 * (subtotal less discounts).
 */
export async function earnForOrder({ customerId, vertical, orderId, orderRef = '', amount, now = new Date() }) {
    const settings = await loyaltySettings(vertical);
    if (!settings.enabled || settings.pointsPerRupee <= 0) return { earned: 0, reason: 'disabled' };
    const points = Math.floor(Math.max(0, Number(amount) || 0) * settings.pointsPerRupee);
    if (points <= 0) return { earned: 0, reason: 'nothing-to-earn' };
    const account = await loyaltyAccountFor(customerId);
    if (!account) return { earned: 0, reason: 'no-account' };
    const key = `earn:${vertical}:${orderId}`;
    try {
        const row = await LoyaltyLedger.create({
            userId: oid(account),
            vertical,
            type: 'earn',
            points,
            remaining: points,
            expiresAt: expiryFrom(settings, now),
            orderId: isId(orderId) ? oid(orderId) : null,
            orderRef,
            amount: round2(amount),
            idempotencyKey: key,
            note: `Earned on order ${orderRef || orderId}`,
        });
        return { earned: points, row: row.toObject(), duplicate: false };
    } catch (err) {
        if (err?.code !== 11000) throw err;
        const row = await LoyaltyLedger.findOne({ idempotencyKey: key }).lean();
        return { earned: row?.points || 0, row, duplicate: true };
    }
}

/**
 * What the customer may redeem on a basket of `orderValue` (item value). The
 * request is clamped -- to the balance and to the admin's maximum share of the
 * order -- rather than refused, and the answer says so.
 */
export async function quoteRedemption({ customerId, vertical, points, orderValue }) {
    const requested = Math.max(0, Math.floor(Number(points) || 0));
    const settings = await loyaltySettings(vertical);
    const empty = { points: 0, discount: 0, requested, balance: 0, maxPoints: 0, capped: requested > 0, enabled: settings.enabled };
    if (!settings.enabled || settings.rupeesPerPoint <= 0) return empty;
    const account = await loyaltyAccountFor(customerId);
    if (!account) return empty;
    const balance = await balanceOf(null, { accountId: account });
    const maxDiscount = (Math.max(0, Number(orderValue) || 0) * settings.maxRedeemPercent) / 100;
    const maxPoints = Math.floor(maxDiscount / settings.rupeesPerPoint + 1e-9);
    const usable = Math.min(requested, balance, maxPoints);
    return {
        points: usable,
        discount: round2(usable * settings.rupeesPerPoint),
        requested,
        balance,
        maxPoints,
        capped: usable < requested,
        enabled: true,
        rupeesPerPoint: settings.rupeesPerPoint,
    };
}

/**
 * Spend points for an order, all or nothing. Idempotent per `key`: a retry
 * returns the first burn. Consumes the oldest unexpired points first.
 */
export async function burnPoints({ customerId, vertical, points, key, orderId = null, orderRef = '', amount = 0, now = new Date() }) {
    const want = Math.max(0, Math.floor(Number(points) || 0));
    if (want <= 0) return { burned: 0 };
    if (!key) throw new Error('burnPoints: key is required');
    const account = await loyaltyAccountFor(customerId);
    if (!account) throw new ValidationError('No loyalty account for this customer');
    const idempotencyKey = `burn:${key}`;

    let burnRow;
    try {
        burnRow = await LoyaltyLedger.create({
            userId: oid(account),
            vertical,
            type: 'burn',
            points: want,
            orderId: isId(orderId) ? oid(orderId) : null,
            orderRef,
            amount: round2(amount),
            idempotencyKey,
            note: `Redeemed on order ${orderRef || orderId || key}`,
        });
    } catch (err) {
        if (err?.code !== 11000) throw err;
        const existing = await LoyaltyLedger.findOne({ idempotencyKey }).lean();
        return { burned: existing?.points || 0, duplicate: true };
    }

    await expireDuePoints(account, now);
    const taken = [];
    let left = want;
    const sources = await LoyaltyLedger.find({
        userId: oid(account),
        type: { $in: ['earn', 'reverse_burn', 'adjust'] },
        remaining: { $gt: 0 },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    }).sort({ expiresAt: 1, createdAt: 1 }).select('_id remaining').lean();
    for (const src of sources) {
        if (left <= 0) break;
        const take = Math.min(left, src.remaining);
        const r = await LoyaltyLedger.updateOne(
            { _id: src._id, remaining: { $gte: take } },
            { $inc: { remaining: -take } },
        );
        if (r.modifiedCount === 1) {
            taken.push([src._id, take]);
            left -= take;
        }
    }
    if (left > 0) {
        // Not enough: put back what was taken and drop the burn.
        for (const [id, take] of taken) await LoyaltyLedger.updateOne({ _id: id }, { $inc: { remaining: take } });
        await LoyaltyLedger.deleteOne({ _id: burnRow._id });
        throw new ValidationError('Not enough loyalty points');
    }
    return { burned: want, row: burnRow.toObject() };
}

/** Give back points a cancelled order redeemed. Idempotent per `key`. */
export async function reverseBurn({ customerId, vertical, points, key, orderId = null, orderRef = '', now = new Date() }) {
    const back = Math.max(0, Math.floor(Number(points) || 0));
    if (back <= 0 || !key) return { returned: 0 };
    const account = await loyaltyAccountFor(customerId);
    if (!account) return { returned: 0 };
    const settings = await loyaltySettings(vertical);
    try {
        await LoyaltyLedger.create({
            userId: oid(account),
            vertical,
            type: 'reverse_burn',
            points: back,
            remaining: back,
            expiresAt: expiryFrom(settings, now),
            orderId: isId(orderId) ? oid(orderId) : null,
            orderRef,
            idempotencyKey: `reverse:${key}`,
            note: `Returned from cancelled order ${orderRef || orderId || key}`,
        });
        return { returned: back };
    } catch (err) {
        if (err?.code !== 11000) throw err;
        return { returned: 0, duplicate: true };
    }
}

export async function historyOf(customerId, { limit = 50 } = {}) {
    const account = await loyaltyAccountFor(customerId);
    if (!account) return [];
    return LoyaltyLedger.find({ userId: oid(account) })
        .sort({ createdAt: -1 })
        .limit(Math.min(Math.max(Number(limit) || 50, 1), 200))
        .select('-__v -idempotencyKey')
        .lean();
}

/** The customer's summary for the app. */
export async function summaryFor(customerId, vertical) {
    const [settings, balance, history] = await Promise.all([
        loyaltySettings(vertical),
        balanceOf(customerId),
        historyOf(customerId, { limit: 30 }),
    ]);
    const account = await loyaltyAccountFor(customerId);
    const soon = new Date(Date.now() + 30 * 86400000);
    let expiringSoon = 0;
    if (account) {
        const [row] = await LoyaltyLedger.aggregate([
            { $match: { userId: oid(account), remaining: { $gt: 0 }, expiresAt: { $gt: new Date(), $lte: soon } } },
            { $group: { _id: null, points: { $sum: '$remaining' } } },
        ]);
        expiringSoon = row?.points || 0;
    }
    return {
        enabled: settings.enabled,
        balance,
        worth: round2(balance * settings.rupeesPerPoint),
        expiringIn30Days: expiringSoon,
        rules: {
            pointsPerRupee: settings.pointsPerRupee,
            rupeesPerPoint: settings.rupeesPerPoint,
            maxRedeemPercent: settings.maxRedeemPercent,
            expiryDays: settings.expiryDays,
        },
        history,
    };
}

/** Admin: the ledger, newest first, optionally for one customer. */
export async function listLedgerAdmin({ userId, page = 1, limit = 50 } = {}) {
    const q = {};
    if (userId) {
        const account = await loyaltyAccountFor(userId);
        if (account) q.userId = oid(account);
    }
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * lim;
    const [rows, total] = await Promise.all([
        LoyaltyLedger.find(q).sort({ createdAt: -1 }).skip(skip).limit(lim).lean(),
        LoyaltyLedger.countDocuments(q),
    ]);
    return { rows, total, page: Math.max(Number(page) || 1, 1), limit: lim };
}

/** Best-effort wrapper for order hooks: never throws into an order flow. */
export async function safely(label, fn) {
    try {
        return await fn();
    } catch (err) {
        logger.warn(`loyalty ${label} failed: ${err?.message || err}`);
        return null;
    }
}
