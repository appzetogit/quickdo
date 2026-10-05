import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';
import { FoodUser } from './user.model.js';
import { toTenDigits } from '../identity/phoneMatch.js';

/**
 * Every customer on the platform, in one list.
 *
 * Food and taxi customers are ALREADY the same documents: both
 * `core/users/user.model.js` and `modules/taxi/user/models/User.js` declare
 * `collection: 'users'`. So this is not a migration -- it is the read that was
 * never written. Quick commerce (`qc_users`) and service provider (`sp_users`)
 * still keep their own documents, linked by `platformUserId` where it has been
 * stamped and by phone where it has not (core/identity).
 *
 * STRICTLY READ ONLY, and deliberately so. Two mongoose schemas share the
 * `users` collection and they diverge additively -- food alone has
 * `isBlockedFromCOD`, taxi alone has `password`, `status`, `deletionRequest` and
 * six more. A write from here through either schema risks dropping the other's
 * fields, which is the one failure that would be invisible until a driver could
 * not log in. Blocking, deleting and editing stay on the screens whose schema
 * owns those fields. This module never writes.
 *
 * Enrichment is per PAGE, never per row: one `$in` aggregate for orders, one for
 * rides, one for wallets. A per-row lookup would be 25 round trips a page and
 * would make the export quadratic.
 */

const MAX_PAGE = 100;

const oid = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null);

/** Escape a value for a regex search box. */
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const lazy = async (path, name) => {
    try {
        const mod = await import(path);
        return mod[name] || mod.default || null;
    } catch (err) {
        logger.warn(`globalUsers: ${name} unavailable (${err.message})`);
        return null;
    }
};

/**
 * The query against `users`.
 *
 * `search` matches a name, an email, or a phone in any of the shapes the
 * platform stores -- +91XXXXXXXXXX, 91XXXXXXXXXX and XXXXXXXXXX are one person,
 * so a search for ten digits has to find all three.
 */
export function buildUserFilter({ search = '', status = '', from = '', to = '' } = {}) {
    // A deleted account is not a customer any more.
    const filter = { deletedAt: null };

    const term = String(search || '').trim();
    if (term) {
        const rx = new RegExp(escapeRx(term), 'i');
        const ors = [{ name: rx }, { email: rx }];
        const digits = toTenDigits(term);
        if (digits) ors.push({ phone: new RegExp(`${escapeRx(digits)}$`) });
        else ors.push({ phone: rx });
        filter.$or = ors;
    }

    if (status === 'active') filter.isActive = { $ne: false };
    if (status === 'blocked') filter.isActive = false;
    if (status === 'verified') filter.isVerified = true;
    if (status === 'unverified') filter.isVerified = { $ne: true };

    const since = from ? new Date(from) : null;
    const until = to ? new Date(to) : null;
    if ((since && !Number.isNaN(since.valueOf())) || (until && !Number.isNaN(until.valueOf()))) {
        filter.createdAt = {};
        if (since && !Number.isNaN(since.valueOf())) filter.createdAt.$gte = since;
        if (until && !Number.isNaN(until.valueOf())) {
            // An end date the operator typed means the whole of that day.
            until.setHours(23, 59, 59, 999);
            filter.createdAt.$lte = until;
        }
    }
    return filter;
}

/**
 * Everything the list shows beyond the user document itself, for one page of ids.
 *
 * @param {Array<{_id: any, phone?: string}>} users  this page's rows
 */
export async function enrichUsers(users = []) {
    const ids = users.map((u) => u._id).filter(Boolean);
    const out = new Map(ids.map((id) => [String(id), {
        orders: 0, orderValue: 0, foodOrders: 0, quickOrders: 0, rides: 0, walletBalance: 0, apps: [],
    }]));
    if (!ids.length) return out;

    // Ten-digit phone -> platform id, so a satellite document that predates the
    // `platformUserId` backfill can still be matched to its owner.
    const idByPhone = new Map();
    const phones = [];
    for (const u of users) {
        const ten = toTenDigits(u.phone);
        if (!ten) continue;
        idByPhone.set(ten, String(u._id));
        phones.push(ten);
    }

    const [FoodOrder, Ride, FoodUserWallet] = await Promise.all([
        lazy('../../modules/food/orders/models/order.model.js', 'FoodOrder'),
        lazy('../../modules/taxi/user/models/Ride.js', 'Ride'),
        lazy('../../modules/food/user/models/userWallet.model.js', 'FoodUserWallet'),
    ]);

    const jobs = [];

    /*
     * Food orders only. Quick commerce and medical write to `qc_orders` -- the
     * QC order model passes that as mongoose.model's third argument, which
     * overrides the `food_orders` its schema declares -- and are counted below.
     * This used to claim all three shared `food_orders`, and silently left out
     * every grocery and pharmacy order.
     */
    if (FoodOrder) {
        jobs.push(FoodOrder.aggregate([
            { $match: { userId: { $in: ids } } },
            { $group: { _id: '$userId', n: { $sum: 1 }, value: { $sum: { $ifNull: ['$pricing.total', 0] } } } },
        ]).then((rows) => {
            for (const r of rows) {
                const e = out.get(String(r._id));
                if (e) { e.foodOrders = r.n; e.orderValue += Math.round((r.value || 0) * 100) / 100; }
            }
        }).catch((err) => logger.warn(`globalUsers: order counts failed: ${err.message}`)));
    }

    if (Ride) {
        jobs.push(Ride.aggregate([
            { $match: { userId: { $in: ids } } },
            { $group: { _id: '$userId', n: { $sum: 1 } } },
        ]).then((rows) => {
            for (const r of rows) {
                const e = out.get(String(r._id));
                if (e) e.rides = r.n;
            }
        }).catch((err) => logger.warn(`globalUsers: ride counts failed: ${err.message}`)));
    }

    if (FoodUserWallet) {
        jobs.push(FoodUserWallet.find({ userId: { $in: ids } }).select('userId balance').lean()
            .then((rows) => {
                for (const r of rows) {
                    const e = out.get(String(r.userId));
                    if (e) e.walletBalance = Number(r.balance) || 0;
                }
            }).catch((err) => logger.warn(`globalUsers: wallets failed: ${err.message}`)));
    }

    /*
     * Quick commerce and service provider still hold their own customer
     * documents. Matched on the explicit link first, and on the last ten digits
     * of the phone for the ones the backfill has not reached -- the same
     * fallback core/activity/identityResolver.js uses.
     */
    const satellite = async (conn, name) => {
        try {
            const coll = mongoose.connection.collection(conn);
            const rows = await coll.find(
                {
                    $or: [
                        { platformUserId: { $in: ids } },
                        // Satellite phones are stored in several shapes, so match
                        // on the last ten digits rather than on equality.
                        ...(phones.length ? [{ phone: { $in: phones.flatMap((t) => [t, `+91${t}`, `91${t}`]) } }] : []),
                    ],
                },
                { projection: { platformUserId: 1, phone: 1 } },
            ).toArray();
            for (const r of rows) {
                let e = r.platformUserId ? out.get(String(r.platformUserId)) : null;
                if (!e && r.phone) {
                    const owner = idByPhone.get(toTenDigits(r.phone));
                    if (owner) e = out.get(owner);
                }
                if (e && !e.apps.includes(name)) e.apps.push(name);
            }
        } catch (err) {
            logger.warn(`globalUsers: ${name} lookup failed: ${err.message}`);
        }
    };

    /*
     * Quick commerce and medical orders. They are keyed by the customer's
     * `qc_users` id, not the platform one, so each qc_users row is first mapped
     * to its owner -- by `platformUserId`, or by phone where the backfill has
     * not reached -- and the orders summed onto that owner.
     */
    jobs.push((async () => {
        try {
            const qcUsers = await mongoose.connection.collection('qc_users').find(
                {
                    $or: [
                        { platformUserId: { $in: ids } },
                        ...(phones.length ? [{ phone: { $in: phones.flatMap((t) => [t, `+91${t}`, `91${t}`]) } }] : []),
                    ],
                },
                { projection: { platformUserId: 1, phone: 1 } },
            ).toArray();
            const ownerOf = new Map();
            for (const q of qcUsers) {
                let owner = q.platformUserId && out.has(String(q.platformUserId)) ? String(q.platformUserId) : null;
                if (!owner && q.phone) owner = idByPhone.get(toTenDigits(q.phone)) || null;
                if (owner) ownerOf.set(String(q._id), owner);
            }
            if (!ownerOf.size) return;
            const rows = await mongoose.connection.collection('qc_orders').aggregate([
                { $match: { userId: { $in: [...ownerOf.keys()].map((id) => new mongoose.Types.ObjectId(id)) } } },
                { $group: { _id: '$userId', n: { $sum: 1 }, value: { $sum: { $ifNull: ['$pricing.total', 0] } } } },
            ]).toArray();
            for (const r of rows) {
                const e = out.get(ownerOf.get(String(r._id)));
                if (!e) continue;
                e.quickOrders += r.n;
                e.orderValue += Math.round((r.value || 0) * 100) / 100;
            }
        } catch (err) {
            logger.warn(`globalUsers: quick-commerce order counts failed: ${err.message}`);
        }
    })());

    await Promise.all(jobs);
    await Promise.all([satellite('qc_users', 'quick'), satellite('sp_users', 'services')]);

    // Apps derived from what they actually did, plus the satellites above.
    for (const [, e] of out) {
        e.orders = e.foodOrders + e.quickOrders;
        e.orderValue = Math.round(e.orderValue * 100) / 100;
        if (e.foodOrders > 0 && !e.apps.includes('food')) e.apps.unshift('food');
        if (e.quickOrders > 0 && !e.apps.includes('quick')) e.apps.push('quick');
        if (e.rides > 0 && !e.apps.includes('taxi')) e.apps.push('taxi');
    }
    return out;
}

/** One page of the global customer list. */
export async function listGlobalUsers(query = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(MAX_PAGE, Math.max(1, Number(query.limit) || 25));
    const filter = buildUserFilter(query);

    const [rows, total] = await Promise.all([
        FoodUser.find(filter)
            .select('name phone countryCode email isActive isVerified createdAt referralCode referralCount addresses')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        FoodUser.countDocuments(filter),
    ]);

    const extra = await enrichUsers(rows);

    return {
        users: rows.map((u) => shape(u, extra.get(String(u._id)))),
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
}

const shape = (u, e = {}) => ({
    id: String(u._id),
    name: u.name || '',
    phone: `${u.countryCode || ''}${u.phone || ''}`.trim(),
    email: u.email || '',
    isActive: u.isActive !== false,
    isVerified: u.isVerified === true,
    joinedAt: u.createdAt || null,
    city: (u.addresses || []).find((a) => a.isDefault)?.city || (u.addresses || [])[0]?.city || '',
    referralCode: u.referralCode || '',
    referralCount: Number(u.referralCount) || 0,
    orders: e?.orders || 0,
    foodOrders: e?.foodOrders || 0,
    quickOrders: e?.quickOrders || 0,
    orderValue: e?.orderValue || 0,
    rides: e?.rides || 0,
    walletBalance: e?.walletBalance || 0,
    apps: e?.apps || [],
});

/*
 * CSV, written for a spreadsheet that will be opened by a person.
 *
 * A cell beginning =, +, - or @ is treated as a FORMULA by Excel and Sheets, so
 * a customer who sets their name to `=HYPERLINK(...)` gets that executed on the
 * machine of whoever opens the export. Prefixing with an apostrophe is the
 * standard defence and is what stops this export being a delivery mechanism.
 */
const csvCell = (value) => {
    if (value === null || value === undefined) return '';
    let s = String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
};

const CSV_COLUMNS = [
    ['Name', (u) => u.name],
    ['Phone', (u) => u.phone],
    ['Email', (u) => u.email],
    ['City', (u) => u.city],
    ['Status', (u) => (u.isActive ? 'Active' : 'Blocked')],
    ['Verified', (u) => (u.isVerified ? 'Yes' : 'No')],
    ['Apps used', (u) => (u.apps || []).join(' / ')],
    ['Food orders', (u) => u.foodOrders],
    ['Quick & medical orders', (u) => u.quickOrders],
    ['Order value', (u) => u.orderValue],
    ['Rides', (u) => u.rides],
    ['Wallet balance', (u) => u.walletBalance],
    ['Referral code', (u) => u.referralCode],
    ['Referrals', (u) => u.referralCount],
    ['Joined', (u) => (u.joinedAt ? new Date(u.joinedAt).toISOString().slice(0, 10) : '')],
];

/**
 * Stream the whole matching set as CSV.
 *
 * Streamed in batches rather than built in memory: this collection is every
 * customer the platform has, and materialising it to serialise it is how an
 * export takes the API process down with it. Enrichment runs per batch, so the
 * same one-query-per-page rule holds however large the export is.
 */
export async function streamGlobalUsersCsv(res, query = {}) {
    const filter = buildUserFilter(query);
    const stamp = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="customers-${stamp}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    // Excel opens UTF-8 as the system codepage without this, which mangles any
    // non-ASCII name in the file.
    res.write('﻿');
    res.write(`${CSV_COLUMNS.map(([h]) => csvCell(h)).join(',')}\n`);

    const cursor = FoodUser.find(filter)
        .select('name phone countryCode email isActive isVerified createdAt referralCode referralCount addresses')
        .sort({ createdAt: -1 })
        .lean()
        .cursor();

    let batch = [];
    const flush = async () => {
        if (!batch.length) return;
        const extra = await enrichUsers(batch);
        for (const u of batch) {
            const row = shape(u, extra.get(String(u._id)));
            res.write(`${CSV_COLUMNS.map(([, get]) => csvCell(get(row))).join(',')}\n`);
        }
        batch = [];
    };

    for await (const doc of cursor) {
        batch.push(doc);
        if (batch.length >= 200) await flush();
    }
    await flush();
    res.end();
}

/**
 * Block or unblock a customer in every app at once.
 *
 * The one write this module makes, kept to plain `$set`s on the flags so
 * neither schema that shares `users` can drop the other's fields: Food reads
 * `isActive`, Taxi refuses a user when `isActive` or `active` is false. The
 * customer's Quick record (`qc_users`, linked by platformUserId or phone) gets
 * the same flag. Blocking signs them out of Food and Quick (refresh tokens
 * gone); Taxi checks the flag on every request.
 */
export async function setCustomerBlocked(id, blocked) {
    const _id = oid(id);
    if (!_id) return null;
    const isActive = !blocked;
    const users = mongoose.connection.collection('users');
    const user = await users.findOne({ _id, deletedAt: null }, { projection: { phone: 1 } });
    if (!user) return null;
    await users.updateOne({ _id }, { $set: { isActive, active: isActive } });

    const ten = toTenDigits(user.phone);
    const qcMatch = {
        $or: [
            { platformUserId: _id },
            ...(ten ? [{ phone: { $in: [ten, `+91${ten}`, `91${ten}`] } }] : []),
        ],
    };
    const qcUsers = mongoose.connection.collection('qc_users');
    const qcIds = (await qcUsers.find(qcMatch, { projection: { _id: 1 } }).toArray()).map((q) => q._id);
    if (qcIds.length) await qcUsers.updateMany({ _id: { $in: qcIds } }, { $set: { isActive } });

    if (blocked) {
        const { FoodRefreshToken, QCRefreshToken } = await import('../refreshTokens/refreshToken.model.js');
        await Promise.all([
            FoodRefreshToken.deleteMany({ userId: _id }),
            QCRefreshToken.deleteMany({ userId: { $in: [_id, ...qcIds] } }),
        ]).catch((err) => logger.warn(`globalUsers: sign-out after block failed: ${err.message}`));
    }
    return { id: String(_id), isActive };
}

export const __testables = { csvCell, escapeRx, CSV_COLUMNS, shape };
