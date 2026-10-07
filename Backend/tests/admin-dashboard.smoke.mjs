/**
 * Master dashboard (plan §7.1), Services bookings in Master > Orders (§7.2) and
 * the Master subscriptions view + subscription income in Platform Earnings (§7.3).
 *
 * Run: node tests/admin-dashboard.smoke.mjs
 *
 *   - the dashboard adds up food, quick, taxi and services from their own records;
 *   - an admin sees only the verticals they may: a taxi-only sub-admin sees taxi
 *     alone, and the totals are taxi's;
 *   - Services bookings are a tab in Master > Orders, with names and a link to
 *     the Services admin;
 *   - subscriptions are listed as active / expiring / lapsed, and only the platform
 *     fee of a Services plan payment counts as income.
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
await mongoose.connect(mongod.getUri(), { dbName: 'admin_dashboard' });
const db = mongoose.connection.db;
const { masterDashboard } = await import('../src/core/admin/dashboard.service.js');
const { adminVerticals } = await import('../src/core/admin/adminVerticals.js');
const { clearCached } = await import('../src/core/admin/shortCache.js');
const { listMasterOrders, deleteMasterOrder } = await import('../src/core/orders/masterOrders.service.js');
const { listSubscriptions, subscriptionIncome } = await import('../src/core/analytics/subscriptions.service.js');
const { platformPnl } = await import('../src/core/finance/platformPnl.service.js');

const oid = () => new mongoose.Types.ObjectId();
const now = new Date();
const daysAgo = (n) => new Date(now.getTime() - n * 864e5);
const zone = oid();

// --- people
const [foodUser, qcUser, spUser] = [oid(), oid(), oid()];
await db.collection('users').insertMany([{ _id: foodUser, name: 'Asha', phone: '9000000001', role: 'USER', createdAt: daysAgo(2) }]);
await db.collection('qc_users').insertOne({ _id: qcUser, name: 'Ravi', phone: '9000000002', createdAt: daysAgo(40) });
await db.collection('sp_users').insertOne({ _id: spUser, name: 'Meera', phone: '9000000003', createdAt: daysAgo(3) });
const rest = oid();
await db.collection('food_restaurants').insertMany([
  { _id: rest, restaurantName: 'Rainbow', status: 'approved', createdAt: daysAgo(100) },
  { restaurantName: 'Pending Place', status: 'pending', createdAt: daysAgo(1) },
]);
await db.collection('food_delivery_partners').insertOne({ name: 'Rishi', status: 'approved', availabilityStatus: 'online', createdAt: daysAgo(50) });
const driver = oid();
await db.collection('taxidrivers').insertMany([
  { _id: driver, name: 'Dev', approve: true, isOnline: true, createdAt: daysAgo(10) },
  { name: 'New driver', approve: false, createdAt: daysAgo(1) },
]);
const [vendor, worker, worker2, worker3] = [oid(), oid(), oid(), oid()];
await db.collection('sp_vendors').insertOne({ _id: vendor, businessName: 'FixIt', name: 'Kiran', approvalStatus: 'approved', createdAt: daysAgo(20),
  subscription: { isActive: true, planName: 'Monthly', expiryDate: daysAgo(-20) } });
await db.collection('sp_workers').insertMany([
  { _id: worker, name: 'Sunil', phone: '9111111111', approvalStatus: 'approved', createdAt: daysAgo(20), subscription: { isActive: true, planName: 'Monthly', expiryDate: daysAgo(-3) } },
  { _id: worker2, name: 'Old plan', approvalStatus: 'approved', createdAt: daysAgo(90), subscription: { isActive: true, planName: 'Monthly', expiryDate: daysAgo(5) } },
  { _id: worker3, name: 'No plan', approvalStatus: 'pending', createdAt: daysAgo(1) },
]);

// --- work
await db.collection('food_orders').insertMany([
  { order_id: 'FOD-1', orderStatus: 'delivered', userId: foodUser, restaurantId: rest, zoneId: zone, pricing: { total: 500, restaurantCommission: 50, platformFee: 10 }, createdAt: daysAgo(0) },
  { order_id: 'FOD-2', orderStatus: 'cancelled_by_user', userId: foodUser, restaurantId: rest, zoneId: zone, pricing: { total: 200 }, createdAt: daysAgo(0) },
  { order_id: 'FOD-3', orderStatus: 'delivered', userId: foodUser, restaurantId: rest, pricing: { total: 300, restaurantCommission: 30, platformFee: 10 }, createdAt: daysAgo(5) },
]);
await db.collection('qc_orders').insertOne({ order_id: 'QC-1', orderStatus: 'delivered', userId: qcUser, pricing: { total: 150, restaurantCommission: 15, platformFee: 5 }, createdAt: daysAgo(1) });
await db.collection('taxirides').insertMany([
  { userId: foodUser, driverId: driver, status: 'completed', liveStatus: 'completed', fare: 120, commissionAmount: 24, createdAt: daysAgo(0), pickupLocation: { type: 'Point', coordinates: [73.8, 18.5] } },
  { userId: foodUser, driverId: driver, status: 'cancelled', liveStatus: 'cancelled', fare: 90, createdAt: daysAgo(2) },
  { userId: foodUser, status: 'completed', fare: 999, createdAt: daysAgo(1), adminHiddenAt: daysAgo(0) },
]);
const booking = oid();
await db.collection('sp_bookings').insertMany([
  { _id: booking, bookingNumber: 'BK-1001', userId: spUser, vendorId: vendor, workerId: worker, serviceName: 'AC repair', status: 'completed', finalAmount: 1500, commissionSnapshot: { amount: 150 }, address: { addressLine1: 'MG Road', city: 'Pune' }, createdAt: daysAgo(1) },
  { bookingNumber: 'BK-1002', userId: spUser, serviceName: 'Plumbing', status: 'searching', finalAmount: 400, address: { addressLine1: 'FC Road', city: 'Pune' }, createdAt: daysAgo(0) },
]);

// --- subscriptions: services fee 100 of a 1000 payment; quick seller paid 500; taxi plan 199
await db.collection('sp_settings').insertOne({ type: 'global', subscriptionPlatformFee: 100 });
await db.collection('sp_transactions').insertMany([
  { workerId: worker, type: 'subscription_platform_fee', amount: 100, status: 'completed', createdAt: daysAgo(2) },
  { workerId: worker, type: 'subscription_remainder', amount: 900, status: 'completed', createdAt: daysAgo(2) },
]);
const store = oid();
await db.collection('qc_restaurants').insertOne({ _id: store, restaurantName: 'Green Grocer', status: 'approved', subscriptionPlan: 'growth', subscriptionAmount: 500, subscriptionValidTill: daysAgo(-30), subscriptionDueAmount: 0, createdAt: daysAgo(60) });
await db.collection('qc_subscription_transactions').insertOne({ restaurantId: store, invoiceId: oid(), billingMonth: '2026-10', type: 'online_payment', amount: 500, outstandingAfter: 0, invoiceStatusAfter: 'settled', createdAt: daysAgo(3) });
await db.collection('taxiusersubscriptions').insertMany([
  { userId: foodUser, planId: oid(), name: 'Ride Pass', amount: 199, status: 'active', active: true, purchaseSource: 'wallet', purchasedAt: daysAgo(4), expiresAt: daysAgo(-26) },
  { userId: foodUser, planId: oid(), name: 'Gift Pass', amount: 99, status: 'active', active: true, purchaseSource: 'admin', purchasedAt: daysAgo(4), expiresAt: daysAgo(-2) },
]);

const owner = { _id: oid(), role: 'ADMIN', adminLevel: 'platform_superadmin' };
const taxiSub = { _id: oid(), role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', parentAdminId: owner._id, servicesAccess: ['taxi'], permissions: ['dashboard.read', 'reports.read'] };

console.log('\nAccess');
await check('who sees which verticals', async () => {
  assert.deepEqual(adminVerticals(owner), ['food', 'quickCommerce', 'taxi', 'serviceProvider']);
  assert.deepEqual(adminVerticals(taxiSub), ['taxi']);
  assert.deepEqual(adminVerticals({ ...taxiSub, permissions: ['orders.read'] }), []);
  // A taxi module superadmin owns taxi only.
  assert.deepEqual(adminVerticals({ _id: oid(), role: 'ADMIN', adminLevel: 'taxi_superadmin', module: 'taxi', servicesAccess: [] }), ['taxi']);
  // Services needs to be listed for a sub-admin.
  assert.deepEqual(adminVerticals({ ...taxiSub, servicesAccess: ['taxi', 'serviceProvider'] }), ['taxi', 'serviceProvider']);
});

console.log('\nDashboard');
const dash = await masterDashboard(owner, {});
const by = Object.fromEntries(dash.services.map((s) => [s.key, s]));
await check('every vertical, with orders today and over the period', async () => {
  assert.deepEqual(dash.verticals, ['food', 'quickCommerce', 'taxi', 'serviceProvider']);
  assert.equal(by.food.today.orders, 2);
  assert.equal(by.food.today.completed, 1);
  assert.equal(by.food.period.orders, 3);
  assert.equal(by.food.period.completed, 2);
  assert.equal(by.food.period.cancelled, 1);
  assert.equal(by.food.period.revenue, 800);
  assert.equal(by.food.period.commission, 80);
  assert.equal(by.food.period.platformFee, 20);
  // The hidden (admin-deleted) ride does not count.
  assert.equal(by.taxi.period.orders, 2);
  assert.equal(by.taxi.period.revenue, 120);
  assert.equal(by.serviceProvider.period.revenue, 1500);
  assert.equal(by.serviceProvider.period.commission, 150);
  assert.equal(by.quickCommerce.period.revenue, 150);
});
await check('partners and customers per vertical', async () => {
  const r = by.food.partners.find((p) => p.key === 'restaurants');
  assert.equal(r.total, 2); assert.equal(r.approved, 1); assert.equal(r.pending, 1);
  const d = by.taxi.partners.find((p) => p.key === 'drivers');
  assert.equal(d.approved, 1); assert.equal(d.online, 1); assert.equal(d.pending, 1);
  const w = by.serviceProvider.partners.find((p) => p.key === 'workers');
  assert.equal(w.total, 3); assert.equal(w.pending, 1);
  assert.equal(by.quickCommerce.customers.registered, 1);
  assert.equal(by.food.customers.active, 1);
  assert.ok(dash.pendingApprovals.some((p) => p.vertical === 'taxi' && p.count === 1));
});
await check('subscription income: services platform fee only, quick payments, taxi wallet plans', async () => {
  assert.equal(by.serviceProvider.subscriptions.platformIncome, 100);
  assert.equal(by.serviceProvider.subscriptions.collected, 1000);
  assert.equal(by.quickCommerce.subscriptions.platformIncome, 500);
  assert.equal(by.taxi.subscriptions.platformIncome, 199);
  assert.equal(by.food.subscriptions, null);
  assert.equal(dash.totals.subscriptionIncome, 799);
  assert.equal(dash.totals.revenue, 800 + 150 + 120 + 1500);
  assert.equal(dash.totals.platformEarnings, (80 + 20) + (15 + 5) + 24 + 150 + 799);
});
await check('daily series covers the period', async () => {
  assert.equal(dash.daily.length, 30);
  const today = dash.daily[dash.daily.length - 1];
  assert.equal(today.byService.food, 2);
});
await check('a taxi-only sub-admin sees taxi alone', async () => {
  const t = await masterDashboard(taxiSub, {});
  assert.deepEqual(t.services.map((s) => s.key), ['taxi']);
  assert.equal(t.totals.revenue, 120);
  assert.equal(t.totals.subscriptionIncome, 199);
  // Asking for food does not widen it.
  const f = await masterDashboard(taxiSub, { vertical: 'food' }).catch((e) => e);
  assert.match(String(f.message), /access to the dashboard/);
});
await check('no dashboard permission is refused', async () => {
  await assert.rejects(() => masterDashboard({ ...taxiSub, permissions: ['orders.read'] }, {}), /access to the dashboard/);
});
await check('results are cached briefly, per access', async () => {
  const a = await masterDashboard(owner, {});
  await db.collection('food_orders').insertOne({ order_id: 'FOD-4', orderStatus: 'delivered', userId: foodUser, restaurantId: rest, pricing: { total: 10 }, createdAt: daysAgo(0) });
  const b = await masterDashboard(owner, {});
  assert.equal(b.generatedAt, a.generatedAt);
  assert.equal(b.services[0].period.orders, 3);
  clearCached('dash:');
  const c = await masterDashboard(owner, {});
  assert.equal(c.services[0].period.orders, 4);
});

console.log('\nServices bookings in Master > Orders');
await check('a Services tab, and bookings in All', async () => {
  const s = await listMasterOrders({ tab: 'services' });
  assert.equal(s.total, 2);
  const bk = s.orders.find((o) => o.orderId === 'BK-1001');
  assert.equal(bk.source, 'services');
  assert.equal(bk.vertical, 'serviceProvider');
  assert.equal(bk.customerName, 'Meera');
  assert.equal(bk.storeName, 'FixIt');
  assert.equal(bk.riderName, 'Sunil');
  assert.equal(bk.total, 1500);
  assert.equal(bk.detailLink, `/admin/sp/bookings?booking=${booking}`);
  const all = await listMasterOrders({ tab: 'all', limit: 100 });
  assert.equal(all.counts.services, 2);
  assert.ok(all.orders.some((o) => o.orderId === 'BK-1002'));
});
await check('status filter and booking-number search', async () => {
  assert.deepEqual((await listMasterOrders({ tab: 'services', status: 'active' })).orders.map((o) => o.orderId), ['BK-1002']);
  assert.deepEqual((await listMasterOrders({ tab: 'services', status: 'delivered' })).orders.map((o) => o.orderId), ['BK-1001']);
  assert.deepEqual((await listMasterOrders({ tab: 'all', search: 'bk-1001' })).orders.map((o) => o.orderId), ['BK-1001']);
});
await check('bookings are not deleted from Master', async () => {
  await assert.rejects(() => deleteMasterOrder({ source: 'services', id: String(booking) }), /Services admin/);
});

console.log('\nSubscriptions');
await check('active, expiring and lapsed across services, quick and taxi', async () => {
  const r = await listSubscriptions({}, ['serviceProvider', 'quickCommerce', 'taxi'], { now });
  const find = (name) => r.rows.find((x) => x.name === name);
  assert.equal(find('Sunil').status, 'expiring');
  assert.equal(find('Old plan').status, 'lapsed');
  assert.equal(find('FixIt').status, 'active');
  assert.equal(find('Green Grocer').status, 'active');
  assert.equal(r.rows.filter((x) => x.vertical === 'taxi').length, 2);
  assert.equal(r.counts.serviceProvider.total, 3);
  assert.equal(r.rows[0].status, 'expiring');
  const lapsed = await listSubscriptions({ status: 'lapsed' }, ['serviceProvider', 'quickCommerce', 'taxi'], { now });
  assert.deepEqual(lapsed.rows.map((x) => x.name), ['Old plan']);
  const taxiOnly = await listSubscriptions({}, ['taxi'], { now });
  assert.ok(taxiOnly.rows.every((x) => x.vertical === 'taxi'));
});
await check('income counts only the platform fee of a services payment', async () => {
  const inc = await subscriptionIncome({ start: daysAgo(10), end: now }, ['serviceProvider', 'quickCommerce', 'taxi']);
  assert.equal(inc.serviceProvider.platformIncome, 100);
  assert.equal(inc.quickCommerce.platformIncome, 500);
  assert.equal(inc.taxi.platformIncome, 199);
});
await check('Platform Earnings includes subscription income, by Reports access', async () => {
  const pnl = await platformPnl(owner, {});
  assert.equal(pnl.subscriptions.net, 799);
  assert.ok(pnl.totals.net >= 799);
  assert.equal(Math.round(pnl.daily.reduce((a, d) => a + d.total, 0) * 100) / 100, pnl.totals.net);
  const t = await platformPnl(taxiSub, {});
  assert.deepEqual(t.subscriptions.lines.map((l) => l.key), ['taxi']);
});

console.log('\nGlobal settings');
await check('country, currency, phone code and time zone through the resolver', async () => {
  const { getGlobalPlatform } = await import('../src/core/config/globalPlatform.js');
  const resolver = await import('../src/core/config/resolver.service.js');
  const g = await getGlobalPlatform();
  assert.equal(g.countryCode, 'IN');
  assert.equal(g.currencyCode, 'INR');
  assert.equal(g.phoneCode, '+91');
  assert.equal(g.timezone, 'Asia/Kolkata');
  assert.equal(g.schedule.maxDaysAhead, null); // each service keeps its own until set
  await resolver.set('platform.timezone', { level: 'global', value: 'Asia/Dubai' });
  await resolver.set('platform.phoneCode', { level: 'global', value: '+971' });
  await resolver.set('schedule.maxDaysAhead', { level: 'global', value: 7 });
  const h = await getGlobalPlatform();
  assert.equal(h.timezone, 'Asia/Dubai');
  assert.equal(h.phoneCode, '+971');
  assert.equal(h.schedule.maxDaysAhead, 7);
  await assert.rejects(() => resolver.set('platform.timezone', { level: 'global', value: 'Mars/Base' }), /time zone/);
  await assert.rejects(() => resolver.set('platform.currencyCode', { level: 'zone', scopeId: 'z1', value: 'USD' }), /cannot be set at the zone level/);
});

console.log('\nHTTP: /v1/platform/master and /v1/platform/recommendations');
await check('routes are mounted, scoped per admin, and /insights reaches the analytics routes', async () => {
  const express = (await import('express')).default;
  const routes = (await import('../src/routes/index.js')).default;
  const { signAccessToken } = await import('../src/core/auth/token.util.js');
  const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const ownerDoc = await FoodAdmin.create({ email: 'own@x.in', password: 'secret1', name: 'Owner', adminLevel: 'platform_superadmin', admin_type: 'superadmin', permissions: ['*'] });
    const taxiDoc = await FoodAdmin.create({ email: 'tx@x.in', password: 'secret1', name: 'Taxi', parentAdminId: ownerDoc._id, adminLevel: 'subadmin', admin_type: 'subadmin', permissions: ['dashboard.read', 'reports.read'], servicesAccess: ['taxi'] });
    const get = async (doc, path) => {
      const res = await fetch(`${base}${path}`, { headers: doc ? { Authorization: `Bearer ${signAccessToken({ userId: String(doc._id), sub: String(doc._id), role: 'ADMIN' })}` } : {} });
      return { status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition'), text: await res.text() };
    };
    const d = await get(ownerDoc, '/v1/platform/master/dashboard?fresh=1');
    assert.equal(d.status, 200, d.text);
    assert.equal(JSON.parse(d.text).data.verticals.length, 4);
    const t = await get(taxiDoc, '/v1/platform/master/dashboard?fresh=1');
    assert.deepEqual(JSON.parse(t.text).data.verticals, ['taxi']);
    assert.equal((await get(null, '/v1/platform/master/dashboard')).status, 401);
    const s = await get(ownerDoc, '/v1/platform/master/insights/summary');
    assert.equal(s.status, 200, s.text);
    const csv = await get(ownerDoc, '/v1/platform/master/reports/sales/export?format=csv');
    assert.equal(csv.status, 200);
    assert.match(csv.type, /text\/csv/);
    assert.match(csv.disposition, /attachment; filename="sales-report-/);
    const gst = await get(taxiDoc, '/v1/platform/master/tax/gst');
    assert.deepEqual(JSON.parse(gst.text).data.verticals, ['taxi']);
    const subs = await get(taxiDoc, '/v1/platform/master/subscriptions');
    assert.deepEqual(JSON.parse(subs.text).data.verticals, ['taxi']);
    const pop = await get(null, '/v1/platform/recommendations/popular?vertical=food&lat=18.5&lng=73.8');
    assert.equal(pop.status, 200, pop.text);
    const glob = await get(null, '/v1/platform/global-settings');
    assert.equal(JSON.parse(glob.text).data.phoneCode, '+971');
  } finally {
    server.close();
  }
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll admin dashboard checks passed');
process.exit(failed ? 1 : 0);
