import mongoose from 'mongoose';
import { coll, dayExpr, round2 } from './facts.js';

/**
 * Master > Subscriptions: every paid plan on the platform in one list, and the
 * subscription money the platform kept.
 *
 *   Services   worker and vendor plans (sp_workers / sp_vendors .subscription).
 *              Income is only the platform-fee part of each payment
 *              (modules/serviceProvider/services/subscriptionLedger.js); the
 *              remainder is recorded there, not counted as platform revenue.
 *   Quick      seller subscription billing (qc_restaurants.subscription*, with
 *              payments in qc_subscription_transactions: online, manual and
 *              wallet-deduction rows).
 *   Taxi       customer ride plans (taxiusersubscriptions, bought from the wallet;
 *              admin-granted plans earn nothing). Driver plans exist only as plan
 *              definitions: drivers do not buy them yet, so there is nothing to
 *              list or count.
 *
 * Status, for every holder: active, expiring (active and ending within
 * `expiringDays`, default 7), lapsed (ended, cancelled or used up).
 */

const DAY = 24 * 3600 * 1000;
const QC_PAYMENT_TYPES = ['online_payment', 'manual_payment', 'wallet_deduction'];

const statusOf = ({ active, expiresAt, now, expiringDays }) => {
    const exp = expiresAt ? new Date(expiresAt) : null;
    if (!active || (exp && exp < now)) return 'lapsed';
    if (exp && exp - now <= expiringDays * DAY) return 'expiring';
    return 'active';
};

/** Subscription income the platform kept in [start, end], per vertical. */
export async function subscriptionIncome({ start, end }, verticals = ['serviceProvider', 'quickCommerce', 'taxi'], { daily = false } = {}) {
    const out = {};
    const range = { $gte: start, $lte: end };

    if (verticals.includes('serviceProvider')) {
        let feeCap = 100;
        try {
            const s = await coll('sp_settings').findOne({ type: 'global' }, { projection: { subscriptionPlatformFee: 1 } });
            if (s && s.subscriptionPlatformFee !== undefined && s.subscriptionPlatformFee !== null) feeCap = Number(s.subscriptionPlatformFee) || 0;
        } catch { /* default */ }
        // Same arithmetic as subscriptionLedger.subscriptionRevenue, on the raw
        // collection so this ESM module does not pull in the CommonJS SP models.
        const rows = await coll('sp_transactions').aggregate([
            { $match: { status: 'completed', type: { $in: ['subscription_platform_fee', 'subscription_remainder', 'worker_subscription'] }, createdAt: range } },
            {
                $group: {
                    _id: daily ? dayExpr('$createdAt') : null,
                    gross: { $sum: '$amount' },
                    fee: {
                        $sum: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$type', 'subscription_platform_fee'] }, then: '$amount' },
                                    { case: { $eq: ['$type', 'worker_subscription'] }, then: { $min: ['$amount', feeCap] } },
                                ],
                                default: 0,
                            },
                        },
                    },
                },
            },
        ]).toArray();
        const t = rows.reduce((a, r) => ({ gross: a.gross + r.gross, fee: a.fee + r.fee }), { gross: 0, fee: 0 });
        out.serviceProvider = {
            label: 'Services worker & vendor plans',
            collected: round2(t.gross),
            platformIncome: round2(t.fee),
            note: 'Only the platform fee of each payment is platform income; the rest is recorded as the subscription remainder.',
            ...(daily ? { daily: rows.map((r) => ({ date: r._id, net: round2(r.fee) })) } : {}),
        };
    }

    if (verticals.includes('quickCommerce')) {
        const rows = await coll('qc_subscription_transactions').aggregate([
            { $match: { type: { $in: QC_PAYMENT_TYPES }, createdAt: range } },
            { $group: { _id: daily ? dayExpr('$createdAt') : null, amount: { $sum: '$amount' } } },
        ]).toArray();
        const total = rows.reduce((a, r) => a + (r.amount || 0), 0);
        out.quickCommerce = {
            label: 'Quick seller subscriptions',
            collected: round2(total),
            platformIncome: round2(total),
            ...(daily ? { daily: rows.map((r) => ({ date: r._id, net: round2(r.amount) })) } : {}),
        };
    }

    if (verticals.includes('taxi')) {
        const rows = await coll('taxiusersubscriptions').aggregate([
            { $match: { purchaseSource: { $ne: 'admin' }, purchasedAt: range } },
            { $group: { _id: daily ? dayExpr('$purchasedAt') : null, amount: { $sum: { $ifNull: ['$amount', 0] } } } },
        ]).toArray();
        const total = rows.reduce((a, r) => a + (r.amount || 0), 0);
        out.taxi = {
            label: 'Taxi customer ride plans',
            collected: round2(total),
            platformIncome: round2(total),
            ...(daily ? { daily: rows.map((r) => ({ date: r._id, net: round2(r.amount) })) } : {}),
        };
    }
    return out;
}

const MAX_PER_SOURCE = 5000;

async function spHolders(collection, holderType, now, expiringDays) {
    const rows = await coll(collection).find(
        { $or: [{ 'subscription.planId': { $ne: null } }, { 'subscription.expiryDate': { $ne: null } }] },
        { projection: { name: 1, businessName: 1, phone: 1, email: 1, subscription: 1 } },
    ).limit(MAX_PER_SOURCE).toArray();
    const planIds = [...new Set(rows.map((r) => r.subscription?.planId).filter(Boolean).map(String))];
    const plans = planIds.length
        ? await coll('sp_worker_subscription_plans').find({ _id: { $in: planIds.map((id) => new mongoose.Types.ObjectId(id)) } }, { projection: { title: 1, name: 1, price: 1 } }).toArray()
        : [];
    const planById = new Map(plans.map((p) => [String(p._id), p]));
    return rows.map((r) => {
        const s = r.subscription || {};
        const plan = planById.get(String(s.planId || ''));
        return {
            vertical: 'serviceProvider',
            holderType,
            holderId: String(r._id),
            name: String(r.businessName || r.name || '').trim(),
            phone: r.phone || '',
            plan: s.planName || plan?.title || plan?.name || '',
            amount: Number(plan?.price) || null,
            startedAt: s.startDate || null,
            expiresAt: s.expiryDate || null,
            status: statusOf({ active: s.isActive === true, expiresAt: s.expiryDate, now, expiringDays }),
        };
    });
}

async function qcSellers(now, expiringDays) {
    const rows = await coll('qc_restaurants').find(
        { subscriptionPlan: { $nin: [null, ''] } },
        {
            projection: {
                restaurantName: 1, ownerName: 1, ownerPhone: 1, phone: 1, subscriptionPlan: 1, subscriptionAmount: 1,
                subscriptionDueAmount: 1, subscriptionStatus: 1, subscriptionValidTill: 1, createdAt: 1,
            },
        },
    ).limit(MAX_PER_SOURCE).toArray();
    return rows.map((r) => {
        const due = Number(r.subscriptionDueAmount) || 0;
        // Postpaid: a seller stays live while it pays its monthly invoice. Past its
        // paid-up date with money due is lapsed.
        const active = !(r.subscriptionValidTill && new Date(r.subscriptionValidTill) < now && due > 0);
        return {
            vertical: 'quickCommerce',
            holderType: 'Quick seller',
            holderId: String(r._id),
            name: String(r.restaurantName || r.ownerName || '').trim(),
            phone: r.ownerPhone || r.phone || '',
            plan: r.subscriptionPlan || '',
            amount: Number(r.subscriptionAmount) || null,
            due: round2(due),
            startedAt: null,
            expiresAt: r.subscriptionValidTill || null,
            status: statusOf({ active, expiresAt: active ? r.subscriptionValidTill : null, now, expiringDays }),
        };
    });
}

async function taxiCustomers(now, expiringDays) {
    // Latest plan per customer and plan: one row each.
    const rows = await coll('taxiusersubscriptions').find({}, {
        projection: { userId: 1, name: 1, amount: 1, status: 1, active: 1, startedAt: 1, purchasedAt: 1, expiresAt: 1, rides_used: 1, ride_limit: 1 },
    }).sort({ purchasedAt: -1 }).limit(MAX_PER_SOURCE).toArray();
    const userIds = [...new Set(rows.map((r) => String(r.userId || '')).filter((id) => /^[0-9a-f]{24}$/i.test(id)))];
    const users = userIds.length
        ? await coll('users').find({ _id: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) } }, { projection: { name: 1, phone: 1 } }).toArray()
        : [];
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return rows.map((r) => {
        const u = byId.get(String(r.userId || ''));
        return {
            vertical: 'taxi',
            holderType: 'Taxi customer',
            holderId: String(r.userId || ''),
            subscriptionId: String(r._id),
            name: String(u?.name || '').trim(),
            phone: u?.phone || '',
            plan: r.name || '',
            amount: Number(r.amount) || 0,
            startedAt: r.startedAt || r.purchasedAt || null,
            expiresAt: r.expiresAt || null,
            status: statusOf({ active: r.status === 'active' && r.active !== false, expiresAt: r.expiresAt, now, expiringDays }),
        };
    });
}

/**
 * @param {{status?, vertical?, search?, page?, limit?, expiringDays?}} query
 * @param {string[]} verticals  what the admin may see
 */
export async function listSubscriptions(query = {}, verticals = [], { now = new Date() } = {}) {
    const expiringDays = Math.min(60, Math.max(1, parseInt(query.expiringDays, 10) || 7));
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 25));
    const status = ['active', 'expiring', 'lapsed'].includes(String(query.status)) ? String(query.status) : '';
    const want = String(query.vertical || '').trim();
    const vs = verticals.filter((v) => !want || want === 'all' || v === want);

    const loaders = [];
    if (vs.includes('serviceProvider')) {
        loaders.push(spHolders('sp_workers', 'Services worker', now, expiringDays));
        loaders.push(spHolders('sp_vendors', 'Services vendor', now, expiringDays));
    }
    if (vs.includes('quickCommerce')) loaders.push(qcSellers(now, expiringDays));
    if (vs.includes('taxi')) loaders.push(taxiCustomers(now, expiringDays));
    let all = (await Promise.all(loaders)).flat();

    const counts = {};
    for (const r of all) {
        counts[r.vertical] ||= { active: 0, expiring: 0, lapsed: 0, total: 0 };
        counts[r.vertical][r.status] += 1;
        counts[r.vertical].total += 1;
    }

    const term = String(query.search || '').trim().toLowerCase().slice(0, 40);
    if (status) all = all.filter((r) => r.status === status);
    if (term) all = all.filter((r) => `${r.name} ${r.phone} ${r.plan}`.toLowerCase().includes(term));
    const rank = { expiring: 0, active: 1, lapsed: 2 };
    all.sort((a, b) => rank[a.status] - rank[b.status]
        || new Date(a.expiresAt || 8.64e15) - new Date(b.expiresAt || 8.64e15));

    let driverPlans = null;
    if (vs.includes('taxi')) {
        driverPlans = await coll('taxisubscriptionplans').countDocuments({ audience: { $in: ['driver', null] }, active: { $ne: false } });
    }

    return {
        rows: all.slice((page - 1) * limit, page * limit),
        total: all.length,
        page,
        limit,
        expiringDays,
        counts,
        notes: driverPlans === null ? [] : [
            `Taxi driver plans: ${driverPlans} plan(s) defined. Drivers do not buy them yet, so none are listed.`,
        ],
    };
}

/** The daily series for platformPnl (subscription income per day). */
export async function subscriptionIncomeDaily(range, verticals) {
    return subscriptionIncome(range, verticals, { daily: true });
}

