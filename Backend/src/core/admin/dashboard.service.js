import { ApiError } from '../../utils/ApiError.js';
import { pickVerticals, VERTICAL_LABELS } from './adminVerticals.js';
import { cached } from './shortCache.js';
import {
    SOURCES, coll, aggregateFacts, parseRange, daysOf, dayExpr, round2, istToday, dayStart, dayEnd,
} from '../analytics/facts.js';
import { subscriptionIncome } from '../analytics/subscriptions.service.js';

/**
 * Master > Dashboard: one home screen over Food, Quick Commerce, Taxi and Services.
 *
 * Per vertical: customers, partners (restaurants, stores, riders, drivers, Services
 * vendors and workers), orders / rides / bookings today and over the period,
 * revenue (what customers paid on completed work), platform commission (+ platform
 * fee on food and quick), and subscription income (core/analytics/subscriptions).
 *
 * An admin sees only the verticals they may (core/admin/adminVerticals.js): a
 * taxi-only sub-admin's dashboard is taxi's alone, and the totals add up only what
 * they can see. Results are cached for a minute (Redis when connected,
 * in-process otherwise), keyed by the verticals shown, so two admins with
 * different access never share an entry.
 */

const CACHE_SECONDS = 60;

/** Who works on each vertical, and what "approved", "pending" and "online" mean there. */
const PEOPLE = {
    food: [
        { key: 'restaurants', label: 'Restaurants', collection: 'food_restaurants', approved: { status: 'approved' }, pending: { status: 'pending' } },
        { key: 'riders', label: 'Delivery partners', collection: 'food_delivery_partners', approved: { status: 'approved' }, pending: { status: 'pending' }, online: { availabilityStatus: 'online' } },
    ],
    quickCommerce: [
        { key: 'stores', label: 'Stores', collection: 'qc_restaurants', approved: { status: 'approved' }, pending: { status: 'pending' } },
        { key: 'riders', label: 'Delivery partners', collection: 'qc_delivery_partners', approved: { status: 'approved' }, pending: { status: 'pending' } },
    ],
    taxi: [
        { key: 'drivers', label: 'Drivers', collection: 'taxidrivers', approved: { approve: true }, pending: { approve: { $ne: true } }, online: { isOnline: true } },
    ],
    serviceProvider: [
        { key: 'vendors', label: 'Vendors', collection: 'sp_vendors', approved: { approvalStatus: 'approved' }, pending: { approvalStatus: 'pending' }, online: { isOnline: true } },
        { key: 'workers', label: 'Workers', collection: 'sp_workers', approved: { approvalStatus: 'approved' }, pending: { approvalStatus: 'pending' }, online: { isOnline: true } },
    ],
};

/** Where to manage each vertical in the panel. */
export const ADMIN_LINKS = {
    food: '/admin/food',
    quickCommerce: '/admin/quick-commerce',
    taxi: '/taxi/admin/dashboard',
    serviceProvider: '/admin/sp/dashboard',
};

async function people(vertical, range) {
    const groups = PEOPLE[vertical] || [];
    return Promise.all(groups.map(async (g) => {
        const c = coll(g.collection);
        const [total, approved, pending, online, joined] = await Promise.all([
            c.estimatedDocumentCount().catch(() => 0),
            c.countDocuments(g.approved),
            c.countDocuments(g.pending),
            g.online ? c.countDocuments({ ...g.online, ...g.approved }) : Promise.resolve(null),
            c.countDocuments({ createdAt: { $gte: range.start, $lte: range.end } }),
        ]);
        return { key: g.key, label: g.label, total, approved, pending, online, joined };
    }));
}

async function customers(vertical, range) {
    const space = SOURCES[vertical].customerSpace;
    const c = coll(space);
    const base = space === 'users' ? { role: { $nin: ['ADMIN', 'admin'] } } : {};
    const [registered, joined] = await Promise.all([
        c.countDocuments(base),
        c.countDocuments({ ...base, createdAt: { $gte: range.start, $lte: range.end } }),
    ]);
    return { registered, joined, sharedWith: space === 'users' ? 'food and taxi share one customer list' : null };
}

async function work(vertical, range, zoneId) {
    const rows = await aggregateFacts(vertical, { start: range.start, end: range.end, zoneId }, [
        {
            $group: {
                _id: { day: dayExpr(), status: '$status' },
                count: { $sum: 1 },
                amount: { $sum: '$amount' },
                commission: { $sum: '$commission' },
                platformFee: { $sum: '$platformFee' },
                users: { $addToSet: '$userId' },
            },
        },
    ]);
    const today = istToday();
    const out = {
        orders: 0, completed: 0, cancelled: 0, active: 0,
        revenue: 0, commission: 0, platformFee: 0,
        today: { orders: 0, completed: 0, cancelled: 0, revenue: 0 },
        daily: {},
    };
    const users = new Set();
    for (const r of rows) {
        const { day, status } = r._id;
        out.orders += r.count;
        out[status] += r.count;
        r.users.forEach((u) => users.add(String(u)));
        const d = (out.daily[day] ||= { orders: 0, revenue: 0 });
        d.orders += r.count;
        if (status === 'completed') {
            out.revenue += r.amount;
            out.commission += r.commission;
            out.platformFee += r.platformFee;
            d.revenue += r.amount;
        }
        if (day === today) {
            out.today.orders += r.count;
            if (status === 'completed') { out.today.completed += r.count; out.today.revenue += r.amount; }
            if (status === 'cancelled') out.today.cancelled += r.count;
        }
    }
    out.activeCustomers = users.size;
    out.revenue = round2(out.revenue);
    out.commission = round2(out.commission);
    out.platformFee = round2(out.platformFee);
    out.today.revenue = round2(out.today.revenue);
    out.averageOrderValue = out.completed ? round2(out.revenue / out.completed) : 0;
    return out;
}

async function todayAlways(vertical, zoneId) {
    // "Today" must be today even when the chosen period ends earlier.
    const d = istToday();
    const rows = await aggregateFacts(vertical, { start: dayStart(d), end: dayEnd(d), zoneId }, [
        { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]);
    const t = { orders: 0, completed: 0, cancelled: 0, active: 0, revenue: 0 };
    for (const r of rows) {
        t.orders += r.count;
        t[r._id] += r.count;
        if (r._id === 'completed') t.revenue += r.amount;
    }
    t.revenue = round2(t.revenue);
    return t;
}

async function build(verticals, range, zoneId) {
    const [perVertical, subs] = await Promise.all([
        Promise.all(verticals.map(async (v) => {
            const [w, today, ppl, cust] = await Promise.all([
                work(v, range, zoneId),
                todayAlways(v, zoneId),
                people(v, range),
                customers(v, range),
            ]);
            return { v, w, today, ppl, cust };
        })),
        subscriptionIncome(range, verticals.filter((v) => ['serviceProvider', 'quickCommerce', 'taxi'].includes(v))),
    ]);

    const days = daysOf(range);
    const services = perVertical.map(({ v, w, today, ppl, cust }) => ({
        key: v,
        label: VERTICAL_LABELS[v],
        unit: SOURCES[v].unit,
        link: ADMIN_LINKS[v],
        customers: { ...cust, active: w.activeCustomers },
        partners: ppl,
        today,
        period: {
            orders: w.orders,
            completed: w.completed,
            cancelled: w.cancelled,
            active: w.active,
            revenue: w.revenue,
            commission: w.commission,
            platformFee: w.platformFee,
            averageOrderValue: w.averageOrderValue,
            cancelRate: w.orders ? round2((w.cancelled / w.orders) * 100) : 0,
        },
        subscriptions: subs[v] ? { collected: subs[v].collected, platformIncome: subs[v].platformIncome, label: subs[v].label } : null,
        daily: days.map((date) => ({ date, orders: w.daily[date]?.orders || 0, revenue: round2(w.daily[date]?.revenue || 0) })),
    }));

    const sum = (fn) => round2(services.reduce((a, s) => a + (Number(fn(s)) || 0), 0));
    const pendingApprovals = services.flatMap((s) => s.partners.map((p) => ({ vertical: s.key, label: `${s.label} · ${p.label}`, count: p.pending })))
        .filter((p) => p.count > 0);

    return {
        range: { from: range.from, to: range.to },
        zoneId: zoneId || null,
        verticals,
        generatedAt: new Date().toISOString(),
        totals: {
            today: { orders: sum((s) => s.today.orders), completed: sum((s) => s.today.completed), revenue: sum((s) => s.today.revenue) },
            orders: sum((s) => s.period.orders),
            completed: sum((s) => s.period.completed),
            cancelled: sum((s) => s.period.cancelled),
            revenue: sum((s) => s.period.revenue),
            commission: sum((s) => s.period.commission),
            platformFee: sum((s) => s.period.platformFee),
            subscriptionIncome: sum((s) => s.subscriptions?.platformIncome),
            platformEarnings: sum((s) => s.period.commission + s.period.platformFee + (s.subscriptions?.platformIncome || 0)),
            partners: sum((s) => s.partners.reduce((a, p) => a + p.total, 0)),
        },
        services,
        daily: days.map((date) => ({
            date,
            orders: services.reduce((a, s) => a + (s.daily.find((d) => d.date === date)?.orders || 0), 0),
            revenue: round2(services.reduce((a, s) => a + (s.daily.find((d) => d.date === date)?.revenue || 0), 0)),
            byService: Object.fromEntries(services.map((s) => [s.key, s.daily.find((d) => d.date === date)?.orders || 0])),
        })),
        pendingApprovals,
    };
}

/**
 * @param {object} admin   the caller (loadAdminCached)
 * @param {{from?, to?, vertical?, zoneId?, fresh?}} query
 */
export async function masterDashboard(admin, query = {}) {
    const verticals = pickVerticals(admin, query.vertical, { resource: 'dashboard' });
    if (!verticals.length) throw new ApiError(403, 'You do not have access to the dashboard');
    const range = parseRange(query, { defaultDays: 30, maxDays: 366 });
    const zoneId = String(query.zoneId || '').trim().slice(0, 64) || '';
    const key = `dash:${verticals.join(',')}:${range.from}:${range.to}:${zoneId}`;
    if (query.fresh === '1' || query.fresh === true) return build(verticals, range, zoneId);
    return cached(key, CACHE_SECONDS, () => build(verticals, range, zoneId));
}
