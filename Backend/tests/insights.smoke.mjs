/**
 * AI insights (plan §7.7): forecasts, bought-together, popular near you, and
 * expected orders per zone per hour.
 *
 * Run: node tests/insights.smoke.mjs
 *
 *   - Holt-Winters on a synthetic weekly series with a trend forecasts the next
 *     two weeks closely and keeps the weekly shape; short series fall back;
 *   - co-occurrence ranks by how often items are bought together, then lift,
 *     and drops pairs seen once;
 *   - the nightly job stores forecasts, pairs, popular items per grid cell and an
 *     hour-of-week demand profile, claims each night once, and the app endpoints
 *     read them back.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); } catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`); }
};

const { forecastSeries, hourOfWeekProfile } = await import('../src/core/analytics/forecast.js');
const { cooccurrence, cellOf, neighbourCells } = await import('../src/core/analytics/cooccurrence.js');

console.log('\nForecast (pure)');
const WEEK = [80, 70, 72, 75, 90, 140, 160]; // a weekend-heavy week
const truth = (t) => WEEK[t % 7] + 0.5 * t;
await check('Holt-Winters follows a weekly season with a trend', async () => {
  const series = Array.from({ length: 84 }, (_, t) => truth(t) + ((t * 37) % 7) - 3); // small deterministic noise
  const f = forecastSeries(series, { horizon: 14 });
  assert.equal(f.method, 'holt_winters');
  const err = f.forecast.map((v, h) => Math.abs(v - truth(84 + h)) / truth(84 + h));
  const mape = (err.reduce((a, e) => a + e, 0) / err.length) * 100;
  assert.ok(mape < 8, `forecast MAPE ${mape.toFixed(2)}% should be under 8%`);
  // The busiest forecast day is a "weekend" day of the pattern.
  const peak = f.forecast.slice(0, 7).indexOf(Math.max(...f.forecast.slice(0, 7)));
  assert.equal((84 + peak) % 7, 6);
  assert.ok(f.low.every((v, i) => v <= f.forecast[i]) && f.high.every((v, i) => v >= f.forecast[i]));
});
await check('short history falls back to a seasonal average, then a mean', async () => {
  const s = forecastSeries([10, 20, 30, 40, 50, 60, 70, 12, 22], { horizon: 7 });
  assert.equal(s.method, 'seasonal_average');
  assert.equal(s.forecast[0], (30) / 1); // same weekday a week before: index 2
  assert.equal(forecastSeries([5, 7], { horizon: 3 }).method, 'mean');
  assert.equal(forecastSeries([], { horizon: 3 }).method, 'none');
  assert.ok(forecastSeries([3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { horizon: 7 }).forecast.every((v) => v >= 0));
});
await check('hour-of-week profile averages over weeks and bounds the trend factor', async () => {
  const counts = new Array(168).fill(0); counts[20] = 16;
  assert.equal(hourOfWeekProfile(counts, 8, 1)[20], 2);
  assert.equal(hourOfWeekProfile(counts, 8, 5)[20], 3); // capped at 1.5x
});

console.log('\nCo-occurrence (pure)');
await check('ranked by count, then lift; pairs seen once dropped', async () => {
  const B = (...ids) => ids.map((id) => ({ id, name: id.toUpperCase() }));
  const baskets = [
    B('burger', 'fries', 'coke'), B('burger', 'fries'), B('burger', 'fries', 'coke'), B('burger', 'coke'),
    B('pizza', 'coke'), B('pizza', 'garlic'), B('pizza', 'garlic'), B('burger', 'shake'), B('tea'),
  ];
  const r = cooccurrence(baskets, { minSupport: 2 });
  const burger = r.get('burger');
  // Both seen with burger 3 times; fries has the higher lift (coke is common anyway).
  assert.deepEqual(burger.together.map((t) => t.id), ['fries', 'coke']);
  assert.equal(burger.together.find((t) => t.id === 'fries').count, 3);
  assert.equal(burger.together.find((t) => t.id === 'coke').count, 3);
  // fries: 3 with burger out of 3 -> confidence 1; lift = 1 / (5/9)
  const fb = r.get('fries').together[0];
  assert.equal(fb.id, 'burger');
  assert.equal(fb.confidence, 1);
  assert.equal(fb.lift, 1.8);
  assert.deepEqual(r.get('pizza').together.map((t) => t.id), ['garlic']);
  assert.equal(r.has('shake'), false);
  assert.equal(r.has('tea'), false);
});
await check('grid cells for popular near you', async () => {
  assert.equal(cellOf(18.52, 73.85), '370:1477');
  assert.equal(cellOf(0, 0), null);
  assert.equal(cellOf('x', 1), null);
  assert.equal(neighbourCells('370:1477').length, 9);
});

console.log('\nNightly job and reads');
const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: 'insights' });
const db = mongoose.connection.db;
const insights = await import('../src/core/analytics/insights.service.js');
const { PlatformInsight, PlatformInsightRun } = await import('../src/core/analytics/insight.model.js');
await PlatformInsightRun.init();

const oid = () => new mongoose.Types.ObjectId();
const NOW = new Date('2026-10-07T03:00:00+05:30');
const zone = oid();
const rest = oid();
const user = oid();
const orders = [];
// 10 weeks of food orders with a weekly rhythm, at 13:00 and 20:00 India time.
for (let d = 70; d >= 1; d -= 1) {
  const day = new Date(NOW.getTime() - d * 864e5);
  const dateStr = new Date(day.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const dow = new Date(`${dateStr}T12:00:00+05:30`).getUTCDay();
  const n = dow === 0 || dow === 6 ? 6 : 3;
  for (let i = 0; i < n; i += 1) {
    const hour = i % 2 === 0 ? '20:00' : '13:00';
    const items = i % 3 === 0
      ? [{ itemId: 'burger', name: 'Burger', quantity: 1 }, { itemId: 'fries', name: 'Fries', quantity: 1 }]
      : [{ itemId: 'burger', name: 'Burger', quantity: 1 }, { itemId: 'coke', name: 'Coke', quantity: 2 }, { itemId: 'gift', name: 'Free gift', quantity: 1, isFreebie: true }];
    orders.push({
      orderStatus: 'delivered', userId: user, restaurantId: rest, zoneId: zone,
      items, pricing: { total: 200 + i * 10 },
      deliveryAddress: { location: { type: 'Point', coordinates: [73.85, 18.52] } },
      createdAt: new Date(`${dateStr}T${hour}:00+05:30`),
    });
  }
}
await db.collection('food_orders').insertMany(orders);

let run;
await check('the nightly run stores every kind, once per night', async () => {
  run = await insights.runInsightsNightlyIfDue({ now: NOW });
  assert.ok(run?.runId);
  assert.equal(await insights.runInsightsNightlyIfDue({ now: NOW }), null); // already claimed
  assert.equal(await insights.runInsightsNightlyIfDue({ now: new Date('2026-10-08T01:00:00+05:30') }), null); // not due before 02:00
  const kinds = await PlatformInsight.distinct('kind', { vertical: 'food' });
  assert.deepEqual(kinds.sort(), ['demand', 'forecast', 'popular', 'together']);
  const r = await PlatformInsightRun.findOne({ night: '2026-10-07' }).lean();
  assert.equal(r.status, 'done');
});
await check('forecast per vertical and zone, next 14 days, weekend-shaped', async () => {
  const f = await insights.getForecast('food', 'all');
  assert.equal(f.forecast.length, 14);
  assert.equal(f.forecast[0].date, '2026-10-07');
  assert.equal(f.method, 'holt_winters');
  const sat = f.forecast.find((x) => x.date === '2026-10-10');
  const tue = f.forecast.find((x) => x.date === '2026-10-13');
  assert.ok(sat.orders > tue.orders + 1, `Saturday ${sat.orders} should beat Tuesday ${tue.orders}`);
  assert.ok(Math.abs(f.next7.orders - (5 * 3 + 2 * 6)) < 3, `next 7 days ${f.next7.orders}`);
  const z = await insights.getForecast('food', String(zone));
  assert.equal(z.forecast.length, 14);
  assert.ok(f.zones.some((x) => x.id === String(zone)));
  await assert.rejects(() => insights.getForecast('food', 'all', ['taxi']), /access/);
});
await check('bought together for the app, freebies left out', async () => {
  const r = await insights.recommendTogether('food', 'burger');
  assert.deepEqual(r.items.map((i) => i.itemId), ['coke', 'fries']);
  const gift = await insights.recommendTogether('food', 'gift');
  assert.equal(gift.items.length, 0);
  const pairs = await insights.getTopPairs('food', 5);
  assert.equal(pairs.pairs[0].count >= pairs.pairs[1].count, true);
  await assert.rejects(() => insights.recommendTogether('taxi', 'x'), /food and quick/);
});
await check('popular near you, and the vertical-wide fallback far away', async () => {
  const near = await insights.recommendPopular('food', { lat: 18.53, lng: 73.86 });
  assert.equal(near.scope, 'nearby');
  assert.equal(near.items[0].itemId, 'burger');
  assert.equal(near.partners[0].partnerId, String(rest));
  const far = await insights.recommendPopular('food', { lat: 28.6, lng: 77.2 });
  assert.equal(far.scope, 'all');
  assert.equal(far.items[0].itemId, 'burger');
});
await check('expected orders per zone per hour for rider positioning', async () => {
  // 20:00 India time on a Saturday (2026-10-10).
  const d = await insights.getDemand('food', { hours: 3, now: new Date('2026-10-10T20:05:00+05:30') });
  const z = d.zones.find((x) => x.zoneId === String(zone));
  assert.ok(z, 'zone present');
  assert.equal(z.hours.length, 3);
  assert.ok(z.hours[0].expected >= 2.5 && z.hours[0].expected <= 3.5, `expected ${z.hours[0].expected}`);
  assert.equal(z.hours[1].expected, 0);
});
await check('a recompute replaces the stored set without duplicates', async () => {
  const before = await PlatformInsight.countDocuments({});
  await insights.recomputeInsightsNow({ now: NOW });
  assert.equal(await PlatformInsight.countDocuments({}), before);
  await assert.rejects(() => insights.recomputeInsightsNow({ now: NOW }), /already being recomputed/);
  const summary = await insights.insightsSummary(['food', 'taxi']);
  assert.ok(summary.lastRun);
  assert.ok(summary.verticals.find((v) => v.key === 'food').next7.orders > 0);
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll insights checks passed');
process.exit(failed ? 1 : 0);
