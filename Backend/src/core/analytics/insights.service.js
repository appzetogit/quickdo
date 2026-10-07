import os from 'node:os';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { ApiError } from '../../utils/ApiError.js';
import { VERTICALS, VERTICAL_LABELS } from '../admin/adminVerticals.js';
import { SOURCES, coll, factsPipeline, dayExpr, istToday, shiftDay, dayStart, dayEnd, round2, TZ } from './facts.js';
import { forecastSeries, hourOfWeekProfile } from './forecast.js';
import { cooccurrence, cellOf, neighbourCells } from './cooccurrence.js';
import { PlatformInsight, PlatformInsightRun } from './insight.model.js';

/**
 * AI insights without an external model (plan §7.7). A nightly job computes,
 * from order history, and stores in platform_insights:
 *
 *   (a) forecast   daily orders and revenue for the next 14 days, per vertical and
 *                  per busy zone (Holt-Winters with a weekly season, forecast.js)
 *   (b) together   "frequently bought together" per item, from co-occurrence in
 *                  completed food and quick orders over 90 days (cooccurrence.js)
 *       popular    "popular near you": most-ordered items and sellers per ~5 km
 *                  grid cell over 30 days, and per vertical
 *   (c) demand     expected orders per zone per hour of the week, from the last 8
 *                  weeks scaled by the last 2 -- for positioning riders and drivers
 *
 * The admin Insights page and the app recommendation endpoints only READ what the
 * job stored, so neither ever runs these aggregations on a request.
 */

const HISTORY_DAYS = 120;
const FORECAST_DAYS = 14;
const MAX_ZONES = 15;
const BASKET_DAYS = 90;
const POPULAR_DAYS = 30;
const DEMAND_WEEKS = 8;
const STORE_VERTICALS = ['food', 'quickCommerce'];
const DEMAND_VERTICALS = ['food', 'quickCommerce', 'taxi'];

const newRunId = () => `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

async function replaceKind(kind, vertical, runId, docs) {
    if (docs.length) {
        for (let i = 0; i < docs.length; i += 500) {
            await PlatformInsight.insertMany(docs.slice(i, i + 500).map((d) => ({ ...d, kind, vertical, runId, computedAt: new Date() })), { ordered: false });
        }
    }
    await PlatformInsight.deleteMany({ kind, vertical, runId: { $ne: runId } });
    return docs.length;
}

/* ------------------------------------------------------------- forecast */

async function computeForecasts(vertical, now, runId) {
    const today = istToday(now.getTime());
    const lastDay = shiftDay(today, -1); // today is not over yet
    const firstDay = shiftDay(lastDay, -(HISTORY_DAYS - 1));
    const rows = await coll(SOURCES[vertical].collection).aggregate([
        ...factsPipeline(vertical, { start: dayStart(firstDay), end: dayEnd(lastDay) }),
        { $match: { status: { $ne: 'cancelled' } } },
        {
            $group: {
                _id: { zone: { $toString: { $ifNull: ['$zoneId', 'none'] } }, day: dayExpr() },
                orders: { $sum: 1 },
                revenue: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] } },
            },
        },
    ], { allowDiskUse: true }).toArray();

    const days = [];
    for (let d = firstDay; d <= lastDay; d = shiftDay(d, 1)) days.push(d);
    const series = new Map(); // zone -> day -> {orders, revenue}
    const add = (zone, day, o, r) => {
        if (!series.has(zone)) series.set(zone, new Map());
        const m = series.get(zone);
        const cur = m.get(day) || { orders: 0, revenue: 0 };
        cur.orders += o;
        cur.revenue += r;
        m.set(day, cur);
    };
    for (const r of rows) {
        add('all', r._id.day, r.orders, r.revenue);
        if (r._id.zone !== 'none') add(r._id.zone, r._id.day, r.orders, r.revenue);
    }
    const volume = (m) => [...m.values()].reduce((a, v) => a + v.orders, 0);
    const zones = [...series.keys()].filter((z) => z !== 'all')
        .sort((a, b) => volume(series.get(b)) - volume(series.get(a)))
        .slice(0, MAX_ZONES);

    const docs = [];
    for (const zone of ['all', ...zones]) {
        const m = series.get(zone) || new Map();
        // Start each series at its first day with any order, so a zone opened last
        // month is not forecast from three months of zeros.
        const firstActive = days.findIndex((d) => m.has(d));
        const span = firstActive === -1 ? [] : days.slice(firstActive);
        const orders = span.map((d) => m.get(d)?.orders || 0);
        const revenue = span.map((d) => m.get(d)?.revenue || 0);
        const fo = forecastSeries(orders, { horizon: FORECAST_DAYS });
        const fr = forecastSeries(revenue, { horizon: FORECAST_DAYS });
        const forecast = Array.from({ length: FORECAST_DAYS }, (_, i) => ({
            date: shiftDay(lastDay, i + 1),
            orders: fo.forecast[i],
            ordersLow: fo.low[i],
            ordersHigh: fo.high[i],
            revenue: fr.forecast[i],
            revenueLow: fr.low[i],
            revenueHigh: fr.high[i],
        }));
        docs.push({
            zoneId: zone,
            key: zone,
            data: {
                history: span.slice(-28).map((date) => ({ date, orders: m.get(date)?.orders || 0, revenue: round2(m.get(date)?.revenue || 0) })),
                forecast,
                method: fo.method,
                mape: fo.mape,
                historyDays: span.length,
                next7: {
                    orders: round2(forecast.slice(0, 7).reduce((a, f) => a + f.orders, 0)),
                    revenue: round2(forecast.slice(0, 7).reduce((a, f) => a + f.revenue, 0)),
                },
                last7: {
                    orders: orders.slice(-7).reduce((a, v) => a + v, 0),
                    revenue: round2(revenue.slice(-7).reduce((a, v) => a + v, 0)),
                },
            },
        });
    }
    return replaceKind('forecast', vertical, runId, docs);
}

/* ------------------------------------------------- together and popular */

async function storeBaskets(vertical, start, end) {
    const cursor = coll(SOURCES[vertical].collection).aggregate([
        ...factsPipeline(vertical, { start, end, status: 'completed', extraProject: { items: '$items' } }),
        {
            $project: {
                at: 1, lat: 1, lng: 1, partnerId: 1,
                items: {
                    $map: {
                        input: {
                            $filter: {
                                input: { $ifNull: ['$items', []] },
                                as: 'i',
                                cond: { $and: [{ $ne: ['$$i.isFreebie', true] }, { $ne: ['$$i.isBogoFree', true] }] },
                            },
                        },
                        as: 'i',
                        in: { id: { $toString: { $ifNull: ['$$i.itemId', '$$i.productId'] } }, name: '$$i.name', qty: '$$i.quantity' },
                    },
                },
            },
        },
    ], { allowDiskUse: true });
    const out = [];
    for await (const doc of cursor) out.push(doc);
    return out;
}

async function computeTogetherAndPopular(vertical, now, runId) {
    const end = now;
    const orders = await storeBaskets(vertical, new Date(now.getTime() - BASKET_DAYS * 864e5), end);
    const baskets = orders.map((o) => (o.items || []).filter((i) => i.id && i.id !== 'null').map((i) => ({ ...i, partnerId: o.partnerId })));
    const together = cooccurrence(baskets, { minSupport: 2, topK: 10 });
    const togetherDocs = [...together.values()]
        .sort((a, b) => b.orders - a.orders)
        .slice(0, 5000)
        .map((t) => ({ zoneId: 'all', key: t.id, data: t }));

    // Popular near you: last 30 days, per grid cell and for the whole vertical.
    const since = now.getTime() - POPULAR_DAYS * 864e5;
    const cells = new Map();
    const bump = (cell, o) => {
        if (!cells.has(cell)) cells.set(cell, { items: new Map(), partners: new Map(), orders: 0 });
        const c = cells.get(cell);
        c.orders += 1;
        const p = String(o.partnerId || '');
        if (p) c.partners.set(p, (c.partners.get(p) || 0) + 1);
        const seen = new Set();
        for (const i of o.items || []) {
            if (!i.id || seen.has(i.id)) continue;
            seen.add(i.id);
            const cur = c.items.get(i.id) || { id: i.id, name: i.name || '', partnerId: p, orders: 0 };
            cur.orders += 1;
            c.items.set(i.id, cur);
        }
    };
    for (const o of orders) {
        if (new Date(o.at).getTime() < since) continue;
        bump('all', o);
        const cell = cellOf(o.lat, o.lng);
        if (cell) bump(cell, o);
    }
    const popularDocs = [...cells.entries()].map(([cell, c]) => ({
        zoneId: 'all',
        key: cell,
        data: {
            orders: c.orders,
            items: [...c.items.values()].sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name)).slice(0, 30),
            partners: [...c.partners.entries()].map(([id, n]) => ({ id, orders: n })).sort((a, b) => b.orders - a.orders).slice(0, 15),
        },
    }));
    const t = await replaceKind('together', vertical, runId, togetherDocs);
    const p = await replaceKind('popular', vertical, runId, popularDocs);
    return { together: t, popularCells: p, baskets: baskets.length };
}

/* --------------------------------------------------------------- demand */

async function computeDemand(vertical, now, runId) {
    const end = now;
    const start = new Date(now.getTime() - DEMAND_WEEKS * 7 * 864e5);
    const recentStart = new Date(now.getTime() - 14 * 864e5);
    const rows = await coll(SOURCES[vertical].collection).aggregate([
        ...factsPipeline(vertical, { start, end }),
        {
            $group: {
                _id: {
                    zone: { $toString: { $ifNull: ['$zoneId', 'none'] } },
                    how: { $add: [{ $multiply: [{ $subtract: [{ $dayOfWeek: { date: '$at', timezone: TZ } }, 1] }, 24] }, { $hour: { date: '$at', timezone: TZ } }] },
                },
                count: { $sum: 1 },
                recent: { $sum: { $cond: [{ $gte: ['$at', recentStart] }, 1, 0] } },
            },
        },
    ], { allowDiskUse: true }).toArray();
    const zones = new Map();
    const add = (zone, how, count, recent) => {
        if (!zones.has(zone)) zones.set(zone, { counts: new Array(168).fill(0), total: 0, recent: 0 });
        const z = zones.get(zone);
        z.counts[how] += count;
        z.total += count;
        z.recent += recent;
    };
    for (const r of rows) {
        add('all', r._id.how, r.count, r.recent);
        if (r._id.zone !== 'none') add(r._id.zone, r._id.how, r.count, r.recent);
    }
    const docs = [...zones.entries()].map(([zone, z]) => {
        const weekly = z.total / DEMAND_WEEKS;
        const recentWeekly = z.recent / 2;
        const factor = weekly > 0 ? recentWeekly / weekly : 1;
        return {
            zoneId: zone,
            key: zone,
            data: { weeks: DEMAND_WEEKS, factor: round2(factor), weeklyOrders: round2(weekly), profile: hourOfWeekProfile(z.counts, DEMAND_WEEKS, factor) },
        };
    });
    return replaceKind('demand', vertical, runId, docs);
}

/* ------------------------------------------------------------------ run */

export async function computeInsights({ now = new Date(), verticals = VERTICALS } = {}) {
    const runId = newRunId();
    const summary = {};
    const step = async (label, fn) => {
        try {
            summary[label] = await fn();
        } catch (err) {
            summary[label] = { error: err.message };
            logger.error(`[Insights] ${label} failed: ${err.message}`);
        }
    };
    for (const v of verticals) {
        await step(`forecast.${v}`, () => computeForecasts(v, now, runId));
        if (STORE_VERTICALS.includes(v)) await step(`baskets.${v}`, () => computeTogetherAndPopular(v, now, runId));
        if (DEMAND_VERTICALS.includes(v)) await step(`demand.${v}`, () => computeDemand(v, now, runId));
    }
    return { runId, summary };
}

const nightKey = (now) => istToday(now.getTime());
const isDue = (now) => new Date(now.getTime() + 5.5 * 3600 * 1000).getUTCHours() >= 2;

async function runClaimed(night, now) {
    let claim;
    try {
        claim = await PlatformInsightRun.create({ night, host: os.hostname(), startedAt: now });
    } catch (err) {
        if (err?.code === 11000) return null; // another instance has tonight
        throw err;
    }
    try {
        const { runId, summary } = await computeInsights({ now });
        await PlatformInsightRun.updateOne({ _id: claim._id }, { $set: { status: 'done', finishedAt: new Date(), summary: { runId, ...summary } } });
        logger.info(`[Insights] ${night} done (run ${runId})`);
        return { night, runId, summary };
    } catch (err) {
        await PlatformInsightRun.updateOne({ _id: claim._id }, { $set: { status: 'failed', finishedAt: new Date(), error: err.message } });
        throw err;
    }
}

/** Run tonight's insights if due and not already run. Safe to call often. */
export async function runInsightsNightlyIfDue({ now = new Date(), force = false } = {}) {
    if (!force && !isDue(now)) return null;
    return runClaimed(nightKey(now), now);
}

/** Admin "recompute now". One at a time per minute. */
export async function recomputeInsightsNow({ now = new Date() } = {}) {
    const result = await runClaimed(`manual-${now.toISOString().slice(0, 16)}`, now);
    if (!result) throw new ApiError(409, 'Insights are already being recomputed. Try again in a minute.');
    return result;
}

/** Every 30 minutes; runs once per night after 02:00 India time. Off with INSIGHTS_NIGHTLY_ENABLED=false. */
export const startInsightsNightly = () => {
    if (process.env.INSIGHTS_NIGHTLY_ENABLED === 'false') return null;
    let busy = false;
    const tick = async () => {
        if (busy) return;
        busy = true;
        try {
            await runInsightsNightlyIfDue();
        } catch (err) {
            logger.error(`[Insights] nightly tick failed: ${err.message}`);
        } finally {
            busy = false;
        }
    };
    setTimeout(tick, 60 * 1000).unref?.();
    logger.info('Insights nightly scheduled (after 02:00 IST, once per night across instances)');
    const handle = setInterval(tick, 30 * 60 * 1000);
    handle.unref?.();
    return handle;
};

/* ---------------------------------------------------------------- reads */

const zoneNames = async (vertical) => {
    try {
        const { listZonesFor } = await import('../appServices/appServices.service.js');
        const zones = (await listZonesFor(vertical)) || [];
        return new Map(zones.map((z) => [z.id, z.name]));
    } catch {
        return new Map();
    }
};

const assertVertical = (vertical, allowed) => {
    if (!VERTICALS.includes(vertical)) throw new ApiError(400, `Unknown vertical: ${vertical}`);
    if (allowed && !allowed.includes(vertical)) throw new ApiError(403, 'You do not have access to this service');
};

export async function lastRun() {
    return PlatformInsightRun.findOne({ status: 'done' }).sort({ finishedAt: -1 }).lean();
}

export async function insightsSummary(verticals) {
    const [run, forecasts] = await Promise.all([
        lastRun(),
        PlatformInsight.find({ kind: 'forecast', zoneId: 'all', vertical: { $in: verticals } }).lean(),
    ]);
    return {
        lastRun: run ? { night: run.night, finishedAt: run.finishedAt } : null,
        verticals: verticals.map((v) => {
            const f = forecasts.find((d) => d.vertical === v);
            return {
                key: v,
                label: VERTICAL_LABELS[v],
                computedAt: f?.computedAt || null,
                next7: f?.data?.next7 || null,
                last7: f?.data?.last7 || null,
                method: f?.data?.method || null,
                mape: f?.data?.mape ?? null,
            };
        }),
    };
}

export async function getForecast(vertical, zoneId = 'all', allowed) {
    assertVertical(vertical, allowed);
    const [doc, zoneDocs, names] = await Promise.all([
        PlatformInsight.findOne({ kind: 'forecast', vertical, zoneId: String(zoneId || 'all') }).lean(),
        PlatformInsight.find({ kind: 'forecast', vertical, zoneId: { $ne: 'all' } }).select('zoneId data.next7').lean(),
        zoneNames(vertical),
    ]);
    return {
        vertical,
        zoneId: String(zoneId || 'all'),
        computedAt: doc?.computedAt || null,
        ...(doc?.data || { history: [], forecast: [], method: null }),
        zones: zoneDocs.map((z) => ({ id: z.zoneId, name: names.get(z.zoneId) || (vertical === 'serviceProvider' ? z.zoneId : 'Zone'), next7: z.data?.next7 || null })),
    };
}

/** Expected orders per zone for the next `hours` hours, busiest zones first. */
export async function getDemand(vertical, { zoneId, hours = 24, now = new Date() } = {}, allowed) {
    assertVertical(vertical, allowed);
    if (!DEMAND_VERTICALS.includes(vertical)) return { vertical, zones: [] };
    const h = Math.min(168, Math.max(1, parseInt(hours, 10) || 24));
    const query = { kind: 'demand', vertical, ...(zoneId ? { zoneId: String(zoneId) } : { zoneId: { $ne: 'all' } }) };
    const [docs, names] = await Promise.all([PlatformInsight.find(query).lean(), zoneNames(vertical)]);
    const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
    const startHow = ist.getUTCDay() * 24 + ist.getUTCHours();
    const hourStart = new Date(Math.floor(now.getTime() / 3600000) * 3600000);
    const zones = docs.map((d) => {
        const profile = d.data?.profile || [];
        const next = Array.from({ length: h }, (_, i) => ({
            at: new Date(hourStart.getTime() + i * 3600000).toISOString(),
            expected: round2(profile[(startHow + i) % 168] || 0),
        }));
        return {
            zoneId: d.zoneId,
            name: names.get(d.zoneId) || 'Zone',
            weeklyOrders: d.data?.weeklyOrders || 0,
            trendFactor: d.data?.factor || 1,
            nextHour: next[0]?.expected || 0,
            total: round2(next.reduce((a, x) => a + x.expected, 0)),
            hours: next,
        };
    }).sort((a, b) => b.total - a.total);
    return { vertical, computedAt: docs[0]?.computedAt || null, hours: h, zones };
}

export async function getTopPairs(vertical, limit = 25, allowed) {
    assertVertical(vertical, allowed);
    const docs = await PlatformInsight.find({ kind: 'together', vertical }).sort({ 'data.orders': -1 }).limit(400).lean();
    const seen = new Set();
    const pairs = [];
    for (const d of docs) {
        for (const t of d.data?.together || []) {
            const key = [d.key, t.id].sort().join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            pairs.push({ a: { id: d.key, name: d.data?.name || '' }, b: { id: t.id, name: t.name }, count: t.count, confidence: t.confidence, lift: t.lift });
        }
    }
    pairs.sort((p, q) => q.count - p.count || q.lift - p.lift);
    return { vertical, pairs: pairs.slice(0, Math.min(100, Math.max(1, Number(limit) || 25))) };
}

/* ---------------------------------------------------- app recommendations */

export async function recommendTogether(vertical, itemId, limit = 10) {
    if (!STORE_VERTICALS.includes(vertical)) throw new ApiError(400, 'Recommendations exist for food and quick commerce');
    const id = String(itemId || '').trim().slice(0, 64);
    if (!id) throw new ApiError(400, 'itemId is required');
    const doc = await PlatformInsight.findOne({ kind: 'together', vertical, key: id }).lean();
    return {
        vertical,
        itemId: id,
        items: (doc?.data?.together || []).slice(0, Math.min(20, Math.max(1, Number(limit) || 10)))
            .map((t) => ({ itemId: t.id, name: t.name, orders: t.count, confidence: t.confidence, lift: t.lift })),
        computedAt: doc?.computedAt || null,
    };
}

export async function recommendPopular(vertical, { lat, lng, limit = 10 } = {}) {
    if (!STORE_VERTICALS.includes(vertical)) throw new ApiError(400, 'Recommendations exist for food and quick commerce');
    const n = Math.min(30, Math.max(1, Number(limit) || 10));
    const cell = cellOf(lat, lng);
    let scope = 'all';
    let items = [];
    let partners = [];
    if (cell) {
        const docs = await PlatformInsight.find({ kind: 'popular', vertical, key: { $in: neighbourCells(cell) } }).lean();
        const im = new Map();
        const pm = new Map();
        for (const d of docs) {
            for (const i of d.data?.items || []) {
                const cur = im.get(i.id) || { ...i, orders: 0 };
                cur.orders += i.orders;
                im.set(i.id, cur);
            }
            for (const p of d.data?.partners || []) pm.set(p.id, (pm.get(p.id) || 0) + p.orders);
        }
        items = [...im.values()].sort((a, b) => b.orders - a.orders).slice(0, n);
        partners = [...pm.entries()].map(([id, orders]) => ({ id, orders })).sort((a, b) => b.orders - a.orders).slice(0, n);
        if (items.length) scope = 'nearby';
    }
    if (!items.length) {
        const all = await PlatformInsight.findOne({ kind: 'popular', vertical, key: 'all' }).lean();
        items = (all?.data?.items || []).slice(0, n);
        partners = (all?.data?.partners || []).slice(0, n);
    }
    return {
        vertical,
        scope,
        items: items.map((i) => ({ itemId: i.id, name: i.name, partnerId: i.partnerId || null, orders: i.orders })),
        partners: partners.map((p) => ({ partnerId: p.id, orders: p.orders })),
    };
}
