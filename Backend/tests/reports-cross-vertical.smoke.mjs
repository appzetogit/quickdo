/**
 * Master cross-vertical reports (plan §7.4) and the one GST report (§7.5).
 *
 * Run: node tests/reports-cross-vertical.smoke.mjs
 *
 *   - sales and revenue add up food, quick, taxi and services; vertical and zone
 *     filters narrow them;
 *   - customers: new vs returning by first order EVER, lifetime value, monthly
 *     retention cohort, and one person across services when linked;
 *   - vendor, driver and provider reports per partner, with names;
 *   - CSV (formula-safe) and XLSX export;
 *   - GST: food/quick from the order, taxi worked out from the fare at the rate
 *     frozen on the ride or, for older rides, the fare rule's rate (estimated);
 *   - a sub-admin sees only the verticals they hold Reports access for.
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

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: 'reports_cross' });
const db = mongoose.connection.db;
const { buildReport, exportReport, toCsv } = await import('../src/core/analytics/reports.service.js');
const { gstReport } = await import('../src/core/analytics/tax.service.js');

const oid = () => new mongoose.Types.ObjectId();
const ist = (day, hh = '12:00') => new Date(`${day}T${hh}:00+05:30`);
const RANGE = { from: '2026-09-01', to: '2026-09-30' };
const zoneA = oid();
const zoneB = oid();

// Customers: Asha orders food in July and September (returning), and Quick in
// September through a linked qc account. Ravi's first order is in September (new).
const asha = oid(); const ravi = oid(); const ashaQc = oid(); const sp = oid();
await db.collection('users').insertMany([{ _id: asha, name: 'Asha', phone: '9000000001' }, { _id: ravi, name: 'Ravi', phone: '9000000002' }]);
await db.collection('qc_users').insertOne({ _id: ashaQc, name: 'Asha Q', phone: '9000000001', platformUserId: asha });
await db.collection('sp_users').insertOne({ _id: sp, name: 'Meera', phone: '9000000003' });
const rest = oid(); const store = oid(); const rider = oid(); const driver = oid(); const vendor = oid(); const worker = oid();
await db.collection('food_restaurants').insertOne({ _id: rest, restaurantName: 'Rainbow' });
await db.collection('qc_restaurants').insertOne({ _id: store, restaurantName: 'Green Grocer' });
await db.collection('food_delivery_partners').insertOne({ _id: rider, name: 'Rishi', phone: '9222222222' });
await db.collection('taxidrivers').insertOne({ _id: driver, name: 'Dev', phone: '9333333333' });
await db.collection('sp_vendors').insertOne({ _id: vendor, businessName: 'FixIt' });
await db.collection('sp_workers').insertOne({ _id: worker, name: 'Sunil', phone: '9444444444' });

await db.collection('food_orders').insertMany([
  { orderStatus: 'delivered', userId: asha, restaurantId: rest, zoneId: zoneA, dispatch: { deliveryPartnerId: rider }, riderTotalPayout: 40, pricing: { total: 400, restaurantCommission: 40, platformFee: 10, tax: 18, platformFeeGst: 2 }, createdAt: ist('2026-07-10') },
  { orderStatus: 'delivered', userId: asha, restaurantId: rest, zoneId: zoneA, dispatch: { deliveryPartnerId: rider }, riderTotalPayout: 35, pricing: { total: 500, restaurantCommission: 50, platformFee: 10, tax: 22.5, platformFeeGst: 1.8 }, createdAt: ist('2026-09-02') },
  { orderStatus: 'delivered', userId: ravi, restaurantId: rest, zoneId: zoneB, dispatch: { deliveryPartnerId: rider }, riderTotalPayout: 30, pricing: { total: 300, restaurantCommission: 30, platformFee: 10, tax: 13.5, platformFeeGst: 1.8 }, createdAt: ist('2026-09-03') },
  { orderStatus: 'cancelled_by_restaurant', userId: ravi, restaurantId: rest, zoneId: zoneB, pricing: { total: 999 }, createdAt: ist('2026-09-04') },
]);
await db.collection('qc_orders').insertOne({ orderStatus: 'delivered', userId: ashaQc, restaurantId: store, pricing: { total: 200, restaurantCommission: 20, platformFee: 5, tax: 10 }, createdAt: ist('2026-09-05') });
const rule = oid();
await db.collection('taxisetprices').insertOne({ _id: rule, service_tax: 5 });
await db.collection('taxirides').insertMany([
  // Rate frozen on the ride: 5% inside a 210 fare = 10.
  { userId: ravi, driverId: driver, status: 'completed', fare: 210, commissionAmount: 21, driverEarnings: 189, pricingSnapshot: { setPriceId: rule, service_tax_percent: 5 }, createdAt: ist('2026-09-06') },
  // Older ride: no rate on it; the rule's current 5% is used (estimated). 105 -> 5.
  { userId: ravi, driverId: driver, status: 'completed', fare: 105, commissionAmount: 10, driverEarnings: 95, pricingSnapshot: { setPriceId: rule }, createdAt: ist('2026-09-07') },
  { userId: ravi, driverId: driver, status: 'cancelled', fare: 80, createdAt: ist('2026-09-07') },
]);
const booking = oid();
await db.collection('sp_bookings').insertOne({ _id: booking, bookingNumber: 'BK-1', userId: sp, vendorId: vendor, workerId: worker, status: 'completed', finalAmount: 1180, commissionSnapshot: { amount: 100 }, tax: 180, address: { city: 'Pune' }, createdAt: ist('2026-09-08') });
await db.collection('sp_vendor_bills').insertOne({ bookingId: booking, status: 'paid', paidAt: ist('2026-09-08'), grandTotal: 1180, totalGST: 180 });

const owner = { _id: oid(), role: 'ADMIN', adminLevel: 'platform_superadmin' };
const foodSub = { _id: oid(), role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', parentAdminId: owner._id, servicesAccess: ['food'], permissions: ['reports.read'] };

console.log('\nSales and revenue');
await check('sales per day and vertical, completed revenue only', async () => {
  const r = await buildReport(owner, 'sales', RANGE);
  const s = Object.fromEntries(r.summary.map((x) => [x.vertical, x]));
  assert.equal(s.food.orders, 3);
  assert.equal(s.food.completed, 2);
  assert.equal(s.food.cancelled, 1);
  assert.equal(s.food.revenue, 800);
  assert.equal(s.taxi.revenue, 315);
  assert.equal(s.serviceProvider.revenue, 1180);
  assert.ok(r.rows.some((row) => row.date === '2026-09-02' && row.vertical === 'Food' && row.revenue === 500));
});
await check('vertical and zone filters', async () => {
  const z = await buildReport(owner, 'sales', { ...RANGE, vertical: 'food', zoneId: String(zoneB) });
  assert.deepEqual(z.summary.map((x) => x.vertical), ['food']);
  assert.equal(z.summary[0].orders, 2);
  assert.equal(z.summary[0].revenue, 300);
});
await check('revenue: commission, platform fee and platform earnings per vertical', async () => {
  const r = await buildReport(owner, 'revenue', RANGE);
  const food = r.rows.find((x) => x.vertical === 'Food');
  assert.equal(food.commission, 80);
  assert.equal(food.platformFee, 20);
  assert.equal(food.partnerPayouts, 65);
  assert.equal(food.platformEarnings, 100);
  const taxi = r.rows.find((x) => x.vertical === 'Taxi');
  assert.equal(taxi.tax, null);
  assert.equal(taxi.commission, 31);
});

console.log('\nCustomers');
const cust = await buildReport(owner, 'customers', RANGE);
await check('new vs returning by first order ever; a linked Quick account is the same person', async () => {
  assert.equal(cust.summary.customers, 3); // Asha (food + quick, linked), Ravi, Meera
  assert.equal(cust.summary.newCustomers, 2); // Ravi, Meera
  assert.equal(cust.summary.returningCustomers, 1); // Asha
  const sep = cust.rows.find((m) => m.month === '2026-09');
  assert.equal(sep.activeCustomers, 3);
  assert.equal(sep.returningCustomers, 1);
});
await check('lifetime value includes history before the range and every service', async () => {
  const top = cust.tables.find((t) => t.key === 'topCustomers').rows;
  assert.equal(top[0].customer, 'Meera');
  assert.equal(top[0].lifetimeValue, 1180);
  const a = top.find((c) => c.customer === 'Asha');
  assert.equal(a.lifetimeValue, 400 + 500 + 200);
  assert.equal(a.orders, 3);
  assert.equal(a.phone, '******0001');
  assert.equal(cust.summary.averageLifetimeValue, Math.round(((1100 + 615 + 1180) / 3) * 100) / 100);
});
await check('monthly retention cohort', async () => {
  const wide = await buildReport(owner, 'customers', { from: '2026-07-01', to: '2026-09-30' });
  const cohorts = wide.tables.find((t) => t.key === 'cohorts').rows;
  const july = cohorts.find((c) => c.cohort === '2026-07');
  assert.equal(july.size, 1);
  assert.equal(july.m0, 100);
  assert.equal(july.m1, 0);
  assert.equal(july.m2, 100);
  const sept = cohorts.find((c) => c.cohort === '2026-09');
  assert.equal(sept.size, 2);
});

console.log('\nVendors, drivers, providers');
await check('vendor report per restaurant / store / services vendor', async () => {
  const r = await buildReport(owner, 'vendors', RANGE);
  const rainbow = r.rows.find((x) => x.vendor === 'Rainbow');
  assert.equal(rainbow.orders, 3);
  assert.equal(rainbow.cancelRate, 33.33);
  assert.equal(rainbow.revenue, 800);
  assert.ok(r.rows.some((x) => x.vendor === 'Green Grocer'));
  assert.ok(r.rows.some((x) => x.vendor === 'FixIt'));
});
await check('driver report per rider and taxi driver', async () => {
  const r = await buildReport(owner, 'drivers', RANGE);
  const dev = r.rows.find((x) => x.driver === 'Dev');
  assert.equal(dev.jobs, 3);
  assert.equal(dev.completed, 2);
  assert.equal(dev.earnings, 284);
  const rishi = r.rows.find((x) => x.driver === 'Rishi');
  assert.equal(rishi.earnings, 65);
});
await check('provider report: services vendors and workers', async () => {
  const r = await buildReport(owner, 'providers', RANGE);
  assert.deepEqual(r.rows.map((x) => `${x.providerType}:${x.provider}`).sort(), ['Vendor:FixIt', 'Worker:Sunil']);
  const none = await buildReport(foodSub, 'providers', RANGE);
  assert.equal(none.rows.length, 0);
});

console.log('\nExport');
await check('CSV: header, rows, and spreadsheet formulas neutralised', async () => {
  const f = await exportReport(owner, 'vendors', { ...RANGE, format: 'csv' });
  assert.equal(f.contentType, 'text/csv; charset=utf-8');
  assert.match(f.filename, /^vendors-report-2026-09-01-to-2026-09-30\.csv$/);
  const lines = f.body.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Service,Restaurant / store / vendor,Orders,Completed,Cancelled,Cancel %,Revenue,Commission,Avg order value');
  assert.ok(lines.some((l) => l.startsWith('Food,Rainbow,3,2,1,33.33,800,80,400')));
  const csv = toCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: '=HYPERLINK("x")', b: -5 }]);
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")",-5`));
});
await check('XLSX: a workbook, with extra sheets for the customer report', async () => {
  const f = await exportReport(owner, 'customers', { ...RANGE, format: 'xlsx' });
  assert.equal(f.body.slice(0, 2).toString(), 'PK');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(f.body);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Customers', 'Monthly retention cohort', 'Top customers by lifetime value']);
});

console.log('\nGST');
await check('one GST report across food, quick, taxi and services', async () => {
  const r = await gstReport(owner, RANGE);
  const s = Object.fromEntries(r.summary.map((x) => [x.vertical, x]));
  assert.equal(s.food.gst, 39.6);
  assert.equal(s.quickCommerce.gst, 10);
  assert.equal(s.taxi.gst, 15);
  assert.equal(s.taxi.estimated, 1);
  assert.equal(s.serviceProvider.gst, 180);
  assert.equal(s.serviceProvider.taxableValue, 1000);
  assert.equal(r.totals.gst, Math.round((39.6 + 10 + 15 + 180) * 100) / 100);
  const row = r.rows.find((x) => x.vertical === 'Taxi');
  assert.equal(row.period, '2026-09');
  assert.equal(row.cgst + row.sgst, row.gst);
  assert.ok(r.notes.some((n) => /1 taxi ride/.test(n)));
});

console.log('\nAccess');
await check('a food-only sub-admin sees food only; no reports permission is refused', async () => {
  const r = await buildReport(foodSub, 'sales', RANGE);
  assert.deepEqual(r.verticals, ['food']);
  const g = await gstReport(foodSub, { ...RANGE, vertical: 'taxi' }).catch((e) => e);
  assert.match(String(g.message), /access to reports/);
  await assert.rejects(() => buildReport({ ...foodSub, permissions: ['orders.read'] }, 'sales', RANGE), /access to reports/);
  await assert.rejects(() => buildReport(owner, 'nope', RANGE), /Unknown report/);
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll cross-vertical report checks passed');
process.exit(failed ? 1 : 0);
