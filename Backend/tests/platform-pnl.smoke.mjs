/**
 * Master > Platform Earnings: what the platform kept, per service and in total.
 *
 * Run: node tests/platform-pnl.smoke.mjs
 *
 * Every figure below is worked out by hand from the seeded records, so the
 * report is checked against arithmetic, not against itself:
 *   - Food and Quick use only DELIVERED orders placed in the range, and the
 *     platform's share each service already recorded (platformNetProfit);
 *   - Taxi: fare - driver credit - insurance, for rides completed in range;
 *   - Services: paid bills' company revenue less GST;
 *   - GST is reported beside income, never inside it;
 *   - the breakdown lines add up to the net;
 *   - a sub-admin sees only services they have Reports access for.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

let failed = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
  }
};

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection;
const { platformPnl } = await import('../src/core/finance/platformPnl.service.js');

const oid = () => new mongoose.Types.ObjectId();
const ist = (day, hh = '12:00') => new Date(`${day}T${hh}:00+05:30`);
const RANGE = { from: '2026-09-01', to: '2026-09-10' };

// --- Food: two delivered orders in range, one cancelled, one delivered outside.
const food = [
  { status: 'delivered', at: ist('2026-09-02'), gross: 500, gst: 20, commission: 60, platformFee: 10, deliveryFee: 40, surge: 0, rider: 35, rest: 380, net: 80 },
  { status: 'delivered', at: ist('2026-09-05', '23:30'), gross: 300, gst: 15, commission: 30, platformFee: 10, deliveryFee: 30, surge: 5, rider: 30, rest: 230, net: 40 },
  { status: 'cancelled_by_user', at: ist('2026-09-03'), gross: 999, gst: 9, commission: 99, platformFee: 9, deliveryFee: 9, surge: 0, rider: 9, rest: 9, net: 999 },
  { status: 'delivered', at: ist('2026-08-31', '23:00'), gross: 999, gst: 9, commission: 99, platformFee: 9, deliveryFee: 9, surge: 0, rider: 9, rest: 9, net: 999 },
];
const seedStore = async (orders, transactions, rows) => {
  for (const r of rows) {
    const orderId = oid();
    await db.collection(orders).insertOne({ _id: orderId, orderStatus: r.status, createdAt: r.at });
    await db.collection(transactions).insertOne({
      orderId,
      pricing: { platformFee: r.platformFee, deliveryFee: r.deliveryFee, surgeAmount: r.surge },
      amounts: {
        totalCustomerPaid: r.gross, taxAmount: r.gst, restaurantCommission: r.commission,
        riderShare: r.rider, restaurantShare: r.rest, platformNetProfit: r.net,
      },
      createdAt: r.at,
    });
  }
};
await seedStore('food_orders', 'food_transactions', food);
await seedStore('qc_orders', 'qc_transactions', [
  { status: 'delivered', at: ist('2026-09-05'), gross: 200, gst: 10, commission: 20, platformFee: 5, deliveryFee: 25, surge: 0, rider: 25, rest: 165, net: 22 },
]);

// --- Taxi: one completed in range, one cancelled, one completed outside.
await db.collection('taxirides').insertMany([
  { status: 'completed', completedAt: ist('2026-09-05'), fare: 300, driverEarnings: 250, insurance_fee: 5, commissionAmount: 60, driverIncentiveAmount: 10, pricingSnapshot: { promo_discount_applied: 5 } },
  { status: 'completed', completedAt: ist('2026-09-07'), fare: 100, driverEarnings: 80, commissionAmount: 15, recovered_cancellation_due: 5 },
  { status: 'cancelled', completedAt: ist('2026-09-05'), fare: 999, driverEarnings: 0 },
  { status: 'completed', completedAt: ist('2026-09-11', '00:30'), fare: 999, driverEarnings: 0 },
]);

// --- Services: one paid bill in range, one draft.
await db.collection('sp_vendor_bills').insertMany([
  { status: 'paid', paidAt: ist('2026-09-08'), grandTotal: 1180, totalGST: 180, vendorTotalEarning: 640, companyRevenue: 540, totalServiceBase: 900, vendorServiceEarning: 630, totalPartsBase: 100, vendorPartsEarning: 10 },
  { status: 'draft', paidAt: ist('2026-09-08'), grandTotal: 999, totalGST: 9, vendorTotalEarning: 9, companyRevenue: 999 },
]);

const owner = { _id: oid(), role: 'ADMIN', adminLevel: 'platform_superadmin' };
const report = await platformPnl(owner, RANGE);
const by = Object.fromEntries(report.services.map((s) => [s.key, s]));
const line = (s, key) => by[s].lines.find((l) => l.key === key).amount;

console.log('\nFood');
await check('only delivered orders placed in the range count', async () => {
  assert.equal(by.food.count, 2);
  assert.equal(by.food.gross, 800);
  assert.equal(by.food.net, 120);
});
await check('GST is beside the income, not in it', async () => {
  assert.equal(by.food.gst, 35);
});
await check('the breakdown adds up to the net', async () => {
  assert.equal(line('food', 'commission'), 90);
  assert.equal(line('food', 'platformFee'), 20);
  assert.equal(line('food', 'deliveryMargin'), (40 - 35) + (30 + 5 - 30));
  assert.equal(line('food', 'other'), 120 - 90 - 20 - 10);
  assert.equal(by.food.lines.reduce((a, l) => a + l.amount, 0), by.food.net);
  assert.equal(by.food.partners, 380 + 35 + 230 + 30);
});
await check('an order late on the last day of August (India time) is not in September', async () => {
  const aug = await platformPnl(owner, { from: '2026-08-31', to: '2026-08-31' });
  assert.equal(aug.services.find((s) => s.key === 'food').count, 1);
});

console.log('\nQuick & Medical');
await check('its own transactions and orders', async () => {
  assert.equal(by.quick.count, 1);
  assert.equal(by.quick.net, 22);
  assert.equal(by.quick.gst, 10);
});

console.log('\nTaxi');
await check('fare less driver credit less insurance, for completed rides', async () => {
  assert.equal(by.taxi.count, 2);
  assert.equal(by.taxi.gross, 400);
  assert.equal(by.taxi.net, (300 - 250 - 5) + (100 - 80));
  assert.equal(by.taxi.gst, null);
});
await check('commission, incentives and promos explain it; the rest is recovered fees', async () => {
  assert.equal(line('taxi', 'commission'), 75);
  assert.equal(line('taxi', 'incentive'), -10);
  assert.equal(line('taxi', 'promo'), -5);
  assert.equal(line('taxi', 'other'), 5);
  assert.equal(by.taxi.lines.reduce((a, l) => a + l.amount, 0), by.taxi.net);
});

console.log('\nServices');
await check('paid bills only, company revenue less GST', async () => {
  assert.equal(by.services.count, 1);
  assert.equal(by.services.net, 360);
  assert.equal(by.services.gst, 180);
  assert.equal(line('services', 'serviceShare'), 270);
  assert.equal(line('services', 'partsShare'), 90);
  assert.equal(line('services', 'other'), 0);
});

console.log('\nTotals and the chart');
await check('totals are the sum of the services', async () => {
  assert.equal(report.totals.net, 120 + 22 + 65 + 360);
  assert.equal(report.totals.gst, 35 + 10 + 180);
  assert.equal(report.totals.gross, 800 + 200 + 400 + 1180);
});
await check('every day in the range is present, with each service\'s share', async () => {
  assert.equal(report.daily.length, 10);
  assert.equal(report.daily[0].date, '2026-09-01');
  const sep5 = report.daily.find((d) => d.date === '2026-09-05');
  assert.deepEqual(sep5.byService, { food: 40, quick: 22, taxi: 45 });
  assert.equal(sep5.total, 107);
  assert.equal(report.daily.reduce((a, d) => a + d.total, 0), report.totals.net);
});
await check('a bad range is refused; no range means the last 30 days', async () => {
  await assert.rejects(() => platformPnl(owner, { from: '2026-09-10', to: '2026-09-01' }), /on or before/);
  const def = await platformPnl(owner, {});
  assert.equal(def.daily.length, 30);
});

console.log('\nWho sees what');
await check('a sub-admin with Food reports sees only Food', async () => {
  const sub = { _id: oid(), role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', parentAdminId: owner._id, servicesAccess: ['food'], permissions: ['reports.read'] };
  const r = await platformPnl(sub, RANGE);
  assert.deepEqual(r.services.map((s) => s.key), ['food']);
  assert.equal(r.totals.net, 120);
});
await check('no Reports access at all is refused', async () => {
  const sub = { _id: oid(), role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', parentAdminId: owner._id, servicesAccess: ['food'], permissions: ['orders.read'] };
  await assert.rejects(() => platformPnl(sub, RANGE), /access to reports/);
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll platform P&L checks passed');
process.exit(failed ? 1 : 0);
