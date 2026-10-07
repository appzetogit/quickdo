import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import { ApiError } from '../../utils/ApiError.js';
import { pickVerticals, VERTICAL_LABELS } from '../admin/adminVerticals.js';
import { cached } from '../admin/shortCache.js';
import {
    SOURCES, coll, aggregateFacts, parseRange, daysOf, dayExpr, monthExpr, round2, namesFor,
} from './facts.js';
import { subscriptionIncome } from './subscriptions.service.js';

/**
 * Master > Reports: sales, revenue, customer, vendor, driver and provider reports
 * across Food, Quick Commerce, Taxi and Services, each filterable by vertical,
 * zone and date, and exportable as CSV or XLSX.
 *
 * Every report is built from the same per-vertical facts (core/analytics/facts.js),
 * so the numbers agree with the Master dashboard. Revenue is what customers paid
 * on COMPLETED work; commission and platform fee are what each vertical recorded
 * on the order. An admin sees only the verticals they hold Reports access for.
 *
 * Each report returns { columns, rows } for its main table (what CSV exports),
 * plus optional extra `tables` (what XLSX adds as further sheets) and `charts`.
 */

export const REPORT_KINDS = ['sales', 'revenue', 'customers', 'vendors', 'drivers', 'providers'];
const CACHE_SECONDS = 120;
const MAX_ROWS = 2000;

const col = (key, label, type = 'text') => ({ key, label, type });
const label = (v) => VERTICAL_LABELS[v] || v;
const pct = (a, b) => (b ? round2((a / b) * 100) : 0);
const maskPhone = (p) => {
    const d = String(p || '').replace(/\D/g, '');
    return d.length >= 4 ? `******${d.slice(-4)}` : '';
};

/* -------------------------------------------------------------- sales */

async function salesReport(verticals, range, zoneId) {
    const perV = await Promise.all(verticals.map(async (v) => {
        const rows = await aggregateFacts(v, { start: range.start, end: range.end, zoneId }, [
            { $group: { _id: { day: dayExpr(), status: '$status' }, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
        ]);
        return [v, rows];
    }));
    const days = daysOf(range);
    const rows = [];
    const summary = {};
    for (const [v, agg] of perV) {
        const byDay = {};
        for (const r of agg) {
            const d = (byDay[r._id.day] ||= { orders: 0, completed: 0, cancelled: 0, revenue: 0 });
            d.orders += r.count;
            if (r._id.status === 'completed') { d.completed += r.count; d.revenue += r.amount; }
            if (r._id.status === 'cancelled') d.cancelled += r.count;
        }
        const s = (summary[v] = { vertical: v, label: label(v), orders: 0, completed: 0, cancelled: 0, revenue: 0 });
        for (const date of days) {
            const d = byDay[date] || { orders: 0, completed: 0, cancelled: 0, revenue: 0 };
            s.orders += d.orders; s.completed += d.completed; s.cancelled += d.cancelled; s.revenue += d.revenue;
            if (!d.orders) continue;
            rows.push({
                date, vertical: label(v), orders: d.orders, completed: d.completed, cancelled: d.cancelled,
                revenue: round2(d.revenue), averageOrderValue: d.completed ? round2(d.revenue / d.completed) : 0,
            });
        }
        s.revenue = round2(s.revenue);
        s.averageOrderValue = s.completed ? round2(s.revenue / s.completed) : 0;
        s.cancelRate = pct(s.cancelled, s.orders);
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.vertical.localeCompare(b.vertical));
    return {
        title: 'Sales',
        columns: [col('date', 'Date', 'date'), col('vertical', 'Service'), col('orders', 'Orders', 'number'), col('completed', 'Completed', 'number'),
            col('cancelled', 'Cancelled', 'number'), col('revenue', 'Revenue', 'money'), col('averageOrderValue', 'Avg order value', 'money')],
        rows,
        summary: Object.values(summary),
        charts: {
            daily: days.map((date) => ({
                date,
                ...Object.fromEntries(verticals.map((v) => [v, rows.filter((r) => r.date === date && r.vertical === label(v)).reduce((a, r) => a + r.revenue, 0)])),
            })),
        },
    };
}

/* ------------------------------------------------------------ revenue */

async function revenueReport(verticals, range, zoneId) {
    const [perV, subs] = await Promise.all([
        Promise.all(verticals.map(async (v) => {
            const [t] = await aggregateFacts(v, { start: range.start, end: range.end, zoneId, status: 'completed' }, [
                { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' }, commission: { $sum: '$commission' }, platformFee: { $sum: '$platformFee' }, tax: { $sum: '$tax' }, driverPay: { $sum: '$driverPay' } } },
            ]);
            const daily = await aggregateFacts(v, { start: range.start, end: range.end, zoneId, status: 'completed' }, [
                { $group: { _id: dayExpr(), amount: { $sum: '$amount' }, earned: { $sum: { $add: ['$commission', '$platformFee'] } } } },
            ]);
            return { v, t: t || {}, daily };
        })),
        // Subscription income is not per zone; shown only for an all-zones report.
        zoneId ? Promise.resolve({}) : subscriptionIncome(range, verticals.filter((v) => v !== 'food')),
    ]);
    const rows = perV.map(({ v, t }) => {
        const subscription = subs[v]?.platformIncome || 0;
        return {
            vertical: label(v),
            completed: t.count || 0,
            revenue: round2(t.amount),
            commission: round2(t.commission),
            platformFee: round2(t.platformFee),
            tax: v === 'taxi' ? null : round2(t.tax),
            partnerPayouts: round2(t.driverPay),
            subscriptionIncome: round2(subscription),
            platformEarnings: round2((t.commission || 0) + (t.platformFee || 0) + subscription),
        };
    });
    const days = daysOf(range);
    return {
        title: 'Revenue',
        columns: [col('vertical', 'Service'), col('completed', 'Completed', 'number'), col('revenue', 'Revenue (customer paid)', 'money'),
            col('commission', 'Commission', 'money'), col('platformFee', 'Platform fee', 'money'), col('tax', 'GST on orders', 'money'),
            col('partnerPayouts', 'Rider / driver pay', 'money'), col('subscriptionIncome', 'Subscription income', 'money'),
            col('platformEarnings', 'Platform earnings', 'money')],
        rows,
        summary: {
            revenue: round2(rows.reduce((a, r) => a + r.revenue, 0)),
            platformEarnings: round2(rows.reduce((a, r) => a + r.platformEarnings, 0)),
            subscriptionIncome: round2(rows.reduce((a, r) => a + r.subscriptionIncome, 0)),
        },
        notes: [
            'Taxi GST is in the GST report (Master > Tax): it is inside the fare and worked out from the fare rule.',
            ...(zoneId ? ['Subscription income is platform-wide and is left out of a single-zone report.'] : []),
        ],
        charts: {
            daily: days.map((date) => ({
                date,
                ...Object.fromEntries(perV.map(({ v, daily }) => [v, round2(daily.find((d) => d._id === date)?.earned || 0)])),
            })),
        },
    };
}

/* ---------------------------------------------------------- customers */

/** Map each vertical's customer id to one platform identity where linked. */
async function customerKeys(space, ids) {
    const out = new Map();
    if (space === 'users') {
        ids.forEach((id) => out.set(id, `u:${id}`));
        return out;
    }
    const valid = ids.filter((id) => /^[0-9a-f]{24}$/i.test(id));
    for (let i = 0; i < valid.length; i += 1000) {
        const chunk = valid.slice(i, i + 1000).map((id) => new mongoose.Types.ObjectId(id));
        const rows = await coll(space).find({ _id: { $in: chunk } }, { projection: { platformUserId: 1 } }).toArray();
        rows.forEach((r) => out.set(String(r._id), r.platformUserId ? `u:${r.platformUserId}` : `${space}:${r._id}`));
    }
    ids.forEach((id) => { if (!out.has(id)) out.set(id, `${space}:${id}`); });
    return out;
}

const monthsBetween = (a, b) => {
    const [ya, ma] = a.split('-').map(Number);
    const [yb, mb] = b.split('-').map(Number);
    return (yb - ya) * 12 + (mb - ma);
};
const addMonths = (m, k) => {
    const [y, mo] = m.split('-').map(Number);
    const d = new Date(Date.UTC(y, mo - 1 + k, 1));
    return d.toISOString().slice(0, 7);
};

async function customersReport(verticals, range, zoneId) {
    const customers = new Map();
    const inRange = new Set();
    for (const v of verticals) {
        const space = SOURCES[v].customerSpace;
        // Whole history (completed only), so "new" means first order ever, not first in the range.
        const [history, recent] = await Promise.all([
            aggregateFacts(v, { end: range.end, zoneId, status: 'completed' }, [
                { $match: { userId: { $ne: null } } },
                {
                    $group: {
                        _id: '$userId',
                        first: { $min: '$at' },
                        last: { $max: '$at' },
                        orders: { $sum: 1 },
                        spend: { $sum: '$amount' },
                        months: { $addToSet: monthExpr() },
                    },
                },
            ]),
            aggregateFacts(v, { start: range.start, end: range.end, zoneId, status: 'completed' }, [
                { $match: { userId: { $ne: null } } },
                { $group: { _id: '$userId' } },
            ]),
        ]);
        const keys = await customerKeys(space, [...new Set([...history, ...recent].map((r) => String(r._id)))]);
        for (const r of history) {
            const key = keys.get(String(r._id));
            const c = customers.get(key) || { key, ids: [], verticals: new Set(), first: r.first, last: r.last, orders: 0, spend: 0, months: new Set() };
            c.ids.push({ space, id: String(r._id) });
            c.verticals.add(v);
            if (r.first < c.first) c.first = r.first;
            if (r.last > c.last) c.last = r.last;
            c.orders += r.orders;
            c.spend += r.spend;
            r.months.forEach((m) => c.months.add(m));
            customers.set(key, c);
        }
        recent.forEach((r) => inRange.add(keys.get(String(r._id))));
    }

    const fromMonth = range.from.slice(0, 7);
    const toMonth = range.to.slice(0, 7);
    const monthOf = (d) => new Date(new Date(d).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);

    // Monthly new vs returning, for every month in the range.
    const months = [];
    for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1)) months.push(m);
    const monthly = months.map((m) => {
        let active = 0;
        let fresh = 0;
        for (const c of customers.values()) {
            if (!c.months.has(m)) continue;
            active += 1;
            if (monthOf(c.first) === m) fresh += 1;
        }
        return { month: m, activeCustomers: active, newCustomers: fresh, returningCustomers: active - fresh, returningRate: pct(active - fresh, active) };
    });

    let fresh = 0;
    let ltvSum = 0;
    let ordersSum = 0;
    const active = [];
    for (const key of inRange) {
        const c = customers.get(key);
        if (!c) continue;
        active.push(c);
        if (c.first >= range.start) fresh += 1;
        ltvSum += c.spend;
        ordersSum += c.orders;
    }

    // Retention by first-order month: of each cohort, the share that ordered again k months later.
    const cohortStart = addMonths(toMonth, -11) > fromMonth ? addMonths(toMonth, -11) : fromMonth;
    const cohorts = [];
    for (let m = cohortStart; m <= toMonth; m = addMonths(m, 1)) {
        const members = [...customers.values()].filter((c) => monthOf(c.first) === m);
        const span = monthsBetween(m, toMonth);
        const retention = [];
        for (let k = 0; k <= span; k += 1) {
            const target = addMonths(m, k);
            retention.push(members.length ? pct(members.filter((c) => c.months.has(target)).length, members.length) : 0);
        }
        cohorts.push({ cohort: m, size: members.length, retention });
    }

    // Lifetime value: the top customers active in the range, with names.
    active.sort((a, b) => b.spend - a.spend);
    const top = active.slice(0, 50);
    const nameMaps = {};
    for (const space of ['users', 'qc_users', 'sp_users']) {
        nameMaps[space] = await namesFor(space, top.flatMap((c) => c.ids.filter((i) => i.space === space).map((i) => i.id)), ['name']);
    }
    const topCustomers = top.map((c) => {
        const named = c.ids.map((i) => nameMaps[i.space].get(i.id)).find((n) => n?.name) || {};
        return {
            customer: named.name || 'Customer',
            phone: maskPhone(named.phone),
            services: [...c.verticals].map(label).join(', '),
            orders: c.orders,
            lifetimeValue: round2(c.spend),
            firstOrder: c.first,
            lastOrder: c.last,
        };
    });

    const maxSpan = cohorts.reduce((a, c) => Math.max(a, c.retention.length), 0);
    return {
        title: 'Customers',
        columns: [col('month', 'Month'), col('activeCustomers', 'Active customers', 'number'), col('newCustomers', 'New', 'number'),
            col('returningCustomers', 'Returning', 'number'), col('returningRate', 'Returning %', 'percent')],
        rows: monthly,
        summary: {
            customers: active.length,
            newCustomers: fresh,
            returningCustomers: active.length - fresh,
            returningRate: pct(active.length - fresh, active.length),
            averageLifetimeValue: active.length ? round2(ltvSum / active.length) : 0,
            averageOrders: active.length ? round2(ordersSum / active.length) : 0,
        },
        tables: [
            {
                key: 'cohorts',
                title: 'Monthly retention cohort',
                columns: [col('cohort', 'First order month'), col('size', 'Customers', 'number'),
                    ...Array.from({ length: maxSpan }, (_, k) => col(`m${k}`, `Month ${k}`, 'percent'))],
                rows: cohorts.map((c) => ({ cohort: c.cohort, size: c.size, ...Object.fromEntries(c.retention.map((r, k) => [`m${k}`, r])) })),
            },
            {
                key: 'topCustomers',
                title: 'Top customers by lifetime value',
                columns: [col('customer', 'Customer'), col('phone', 'Phone'), col('services', 'Services'), col('orders', 'Orders', 'number'),
                    col('lifetimeValue', 'Lifetime value', 'money'), col('firstOrder', 'First order', 'date'), col('lastOrder', 'Last order', 'date')],
                rows: topCustomers,
            },
        ],
        notes: [
            'A customer is one person across services where their Quick or Services account is linked to the platform account; otherwise each account counts once.',
            'Lifetime value is everything the customer has paid on completed orders up to the end of the range.',
        ],
    };
}

/* ------------------------------------------- vendors / drivers / providers */

async function perPartner(verticals, range, zoneId, { by, collectionOf, nameFields }) {
    const out = [];
    for (const v of verticals) {
        const collection = collectionOf(v);
        if (!collection) continue;
        const rows = await aggregateFacts(v, { start: range.start, end: range.end, zoneId }, [
            { $match: { [by]: { $ne: null } } },
            {
                $group: {
                    _id: `$${by}`,
                    jobs: { $sum: 1 },
                    completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
                    cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
                    revenue: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] } },
                    commission: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$commission', 0] } },
                    pay: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$driverPay', 0] } },
                },
            },
            { $sort: { revenue: -1 } },
            { $limit: MAX_ROWS },
        ]);
        const names = await namesFor(collection, rows.map((r) => String(r._id)), nameFields(v));
        rows.forEach((r) => out.push({ v, r, n: names.get(String(r._id)) || {} }));
    }
    return out;
}

async function vendorsReport(verticals, range, zoneId) {
    const list = await perPartner(verticals.filter((v) => SOURCES[v].partnerCollection), range, zoneId, {
        by: 'partnerId',
        collectionOf: (v) => SOURCES[v].partnerCollection,
        nameFields: (v) => SOURCES[v].partnerName,
    });
    const rows = list.map(({ v, r, n }) => ({
        vertical: label(v),
        vendor: n.name || String(r._id),
        orders: r.jobs,
        completed: r.completed,
        cancelled: r.cancelled,
        cancelRate: pct(r.cancelled, r.jobs),
        revenue: round2(r.revenue),
        commission: round2(r.commission),
        averageOrderValue: r.completed ? round2(r.revenue / r.completed) : 0,
    })).sort((a, b) => b.revenue - a.revenue);
    return {
        title: 'Vendors',
        columns: [col('vertical', 'Service'), col('vendor', 'Restaurant / store / vendor'), col('orders', 'Orders', 'number'),
            col('completed', 'Completed', 'number'), col('cancelled', 'Cancelled', 'number'), col('cancelRate', 'Cancel %', 'percent'),
            col('revenue', 'Revenue', 'money'), col('commission', 'Commission', 'money'), col('averageOrderValue', 'Avg order value', 'money')],
        rows,
        summary: { vendors: rows.length, revenue: round2(rows.reduce((a, r) => a + r.revenue, 0)) },
    };
}

async function driversReport(verticals, range, zoneId) {
    const list = await perPartner(verticals.filter((v) => v !== 'serviceProvider'), range, zoneId, {
        by: 'driverId',
        collectionOf: (v) => SOURCES[v].driverCollection,
        nameFields: () => ['name'],
    });
    const rows = list.map(({ v, r, n }) => ({
        vertical: label(v),
        driver: n.name || String(r._id),
        phone: n.phone || '',
        jobs: r.jobs,
        completed: r.completed,
        cancelled: r.cancelled,
        completionRate: pct(r.completed, r.jobs),
        value: round2(r.revenue),
        earnings: round2(r.pay),
    })).sort((a, b) => b.completed - a.completed);
    return {
        title: 'Drivers & riders',
        columns: [col('vertical', 'Service'), col('driver', 'Rider / driver'), col('phone', 'Phone'), col('jobs', 'Jobs', 'number'),
            col('completed', 'Completed', 'number'), col('cancelled', 'Cancelled', 'number'), col('completionRate', 'Completion %', 'percent'),
            col('value', 'Order / fare value', 'money'), col('earnings', 'Earnings', 'money')],
        rows,
        summary: { drivers: rows.length, completed: rows.reduce((a, r) => a + r.completed, 0) },
        notes: ['Food and Quick riders are one pool: a rider who works both appears once per service.'],
    };
}

async function providersReport(verticals, range, zoneId) {
    if (!verticals.includes('serviceProvider')) {
        return { title: 'Service providers', columns: [], rows: [], summary: {}, notes: ['Only for admins with Services access.'] };
    }
    const [vendors, workers] = await Promise.all([
        perPartner(['serviceProvider'], range, zoneId, { by: 'partnerId', collectionOf: () => 'sp_vendors', nameFields: () => ['businessName', 'name'] }),
        perPartner(['serviceProvider'], range, zoneId, { by: 'driverId', collectionOf: () => 'sp_workers', nameFields: () => ['name'] }),
    ]);
    const shape = (type) => ({ r, n }) => ({
        providerType: type,
        provider: n.name || String(r._id),
        phone: n.phone || '',
        bookings: r.jobs,
        completed: r.completed,
        cancelled: r.cancelled,
        completionRate: pct(r.completed, r.jobs),
        revenue: round2(r.revenue),
        commission: round2(r.commission),
    });
    const rows = [...vendors.map(shape('Vendor')), ...workers.map(shape('Worker'))].sort((a, b) => b.revenue - a.revenue);
    return {
        title: 'Service providers',
        columns: [col('providerType', 'Type'), col('provider', 'Provider'), col('phone', 'Phone'), col('bookings', 'Bookings', 'number'),
            col('completed', 'Completed', 'number'), col('cancelled', 'Cancelled', 'number'), col('completionRate', 'Completion %', 'percent'),
            col('revenue', 'Revenue', 'money'), col('commission', 'Commission', 'money')],
        rows,
        summary: { providers: rows.length, revenue: round2(rows.reduce((a, r) => a + r.revenue, 0)) },
        notes: ['A booking done by a vendor\'s worker counts for both the vendor and the worker.'],
    };
}

const BUILDERS = {
    sales: salesReport,
    revenue: revenueReport,
    customers: customersReport,
    vendors: vendorsReport,
    drivers: driversReport,
    providers: providersReport,
};

/**
 * @param {object} admin
 * @param {string} kind     one of REPORT_KINDS
 * @param {{from?, to?, vertical?, zoneId?}} query
 */
export async function buildReport(admin, kind, query = {}) {
    if (!REPORT_KINDS.includes(kind)) throw new ApiError(400, `Unknown report: ${kind}`);
    const verticals = pickVerticals(admin, query.vertical, { resource: 'reports' });
    if (!verticals.length) throw new ApiError(403, 'You do not have access to reports');
    const range = parseRange(query, { defaultDays: kind === 'customers' ? 180 : 30, maxDays: 400 });
    const zoneId = String(query.zoneId || '').trim().slice(0, 64);
    const key = `report:${kind}:${verticals.join(',')}:${range.from}:${range.to}:${zoneId}`;
    const report = await cached(key, CACHE_SECONDS, () => BUILDERS[kind](verticals, range, zoneId));
    return { kind, range: { from: range.from, to: range.to }, verticals, zoneId: zoneId || null, ...report };
}

/* -------------------------------------------------------------- export */

const cell = (value, type) => {
    if (value === null || value === undefined) return '';
    if (type === 'date' && value) {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
    }
    return value;
};

export function toCsv(columns, rows) {
    const esc = (v) => {
        const s = String(v ?? '');
        // Leading = + - @ would run as a formula in a spreadsheet.
        const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
        return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [columns.map((c) => esc(c.label)).join(',')];
    for (const r of rows) lines.push(columns.map((c) => esc(cell(r[c.key], c.type))).join(','));
    return `﻿${lines.join('\r\n')}\r\n`;
}

async function toXlsx(report) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Master admin';
    const sheet = (title, columns, rows) => {
        const ws = wb.addWorksheet(String(title).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
        ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 2) }));
        rows.forEach((r) => ws.addRow(Object.fromEntries(columns.map((c) => [c.key, cell(r[c.key], c.type)]))));
        ws.getRow(1).font = { bold: true };
        columns.forEach((c, i) => {
            if (c.type === 'money') ws.getColumn(i + 1).numFmt = '#,##0.00';
        });
    };
    sheet(report.title || 'Report', report.columns, report.rows);
    for (const t of report.tables || []) sheet(t.title, t.columns, t.rows);
    return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function exportReport(admin, kind, query = {}) {
    const format = String(query.format || 'csv').toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
    const report = await buildReport(admin, kind, query);
    const base = `${kind}-report-${report.range.from}-to-${report.range.to}`;
    if (format === 'xlsx') {
        return { filename: `${base}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: await toXlsx(report) };
    }
    return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', body: toCsv(report.columns, report.rows) };
}

export { toXlsx };
