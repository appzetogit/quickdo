/**
 * Quick-commerce store analytics, reports and settlement statements: the food
 * pipeline (core/reports/storeReports.service.js) bound to the qc_* collections.
 *
 * Run: node tests/qc-store-reports.smoke.mjs
 *
 * Isolated in-memory MongoDB. The seeded month (IST), store "Corner Kirana" (S):
 *
 *   C1 16 Sep  delivered  child of multi-store MSO-1; items 200, GST 10 (pricing.tax),
 *                         commission 20, delivery share 15          ledger 180  customer A
 *   C2 16 Sep  delivered  the OTHER store's child of MSO-1; items 300, GST 15,
 *                         commission 30                             ledger 270 (store T)
 *   O2 17 Sep  delivered  self-pickup; items 100, GST 5, commission 10,
 *                         delivery fee 0                           ledger  90  customer B
 *   O3 18 Sep  cancelled  items 50                                               customer C
 *   O4 19 Sep  unpaid (pending_payment) -- never counted
 *   O5 22 Sep  delivered  items 150, GST 18 (12% slab), commission 15  ledger 135  customer A
 *
 * Store S, Sep 15-30: 4 orders, 3 delivered, gross 450, GST 33, commission 45,
 * payout 405. Store T: its one child only (payout 270).
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.BULLMQ_ENABLED = 'false';
process.env.REDIS_ENABLED = 'false';
process.env.JWT_ACCESS_SECRET ||= 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET ||= 'b'.repeat(48);
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
const rejects = async (promise, status) => {
    let error;
    try { await promise; } catch (err) { error = err; }
    assert.ok(error, 'expected a rejection');
    if (status) assert.equal(error.statusCode, status, `status ${error.statusCode} (${error.message})`);
    return error;
};
const near = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 0.005, `${msg || ''} expected ${b}, got ${a}`);
const ist = (s) => new Date(`${s}+05:30`);
/** Minimal RFC 4180 reader for the reports' own output (BOM stripped). */
const parseCsv = (text) => {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const src = text.replace(/^﻿/, '');
    for (let i = 0; i < src.length; i += 1) {
        const ch = src[i];
        if (quoted) {
            if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
};

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'qc_store_reports' });

const BASE = '../src/modules/quickCommerce/modules/food';
const { FoodRestaurant } = await import(`${BASE}/restaurant/models/restaurant.model.js`);
const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);
const { FoodTransaction } = await import(`${BASE}/orders/models/foodTransaction.model.js`);
const { FoodRestaurantWithdrawal } = await import(`${BASE}/restaurant/models/foodRestaurantWithdrawal.model.js`);
const { FoodUser } = await import('../src/modules/quickCommerce/core/users/user.model.js');
const reports = await import(`${BASE}/restaurant/services/storeReports.service.js`);
const foodReports = await import('../src/modules/food/restaurant/services/restaurantReports.service.js');

const oid = () => new mongoose.Types.ObjectId();
const S = oid();
const T = oid();
const [custA, custB, custC] = [oid(), oid(), oid()];
const parent = oid();

await FoodUser.collection.insertMany([
    { _id: custA, name: 'Asha', phone: '9876500021', isActive: true },
    { _id: custB, name: 'Bala', phone: '9876500022', isActive: true },
    { _id: custC, name: 'Chitra', phone: '9876500023', isActive: true },
]);
await FoodRestaurant.collection.insertMany([
    { _id: S, restaurantName: 'Corner Kirana', ownerName: 'Ravi', ownerPhone: '9876500031', status: 'approved', isActive: true, gstNumber: '27AAPFU0939F1ZV', location: { formattedAddress: '4 Market Rd, Pune' }, createdAt: new Date() },
    { _id: T, restaurantName: 'Bake House', ownerName: 'Tara', ownerPhone: '9876500032', status: 'approved', isActive: true, createdAt: new Date() },
]);

const order = (id, { store = S, at, user, status = 'delivered', subtotal, tax, commission, deliveryFee = 25, pickup = false, child = false, total }) => ({
    _id: id,
    order_id: `QC-${String(id).slice(-6)}`,
    orderId: `QC-${String(id).slice(-6)}`,
    restaurantId: store,
    userId: user,
    orderStatus: status,
    fulfilmentType: pickup ? 'pickup' : 'delivery',
    parentOrderId: child ? parent : null,
    createdAt: ist(at),
    updatedAt: ist(at),
    items: [{ itemId: 'i1', name: 'Rice', price: subtotal, quantity: 1 }],
    payment: { method: 'razorpay', status: status === 'pending_payment' ? 'created' : 'paid' },
    pricing: {
        subtotal,
        tax,
        packagingFee: 0,
        deliveryFee: pickup ? 0 : deliveryFee,
        platformFee: 0,
        restaurantCommission: commission,
        discount: 0,
        total: total ?? subtotal + tax + (pickup ? 0 : deliveryFee),
    },
});
const [C1, C2, O2, O3, O4, O5] = [oid(), oid(), oid(), oid(), oid(), oid()];
await FoodOrder.collection.insertMany([
    order(C1, { at: '2026-09-16T12:00:00', user: custA, subtotal: 200, tax: 10, commission: 20, deliveryFee: 15, child: true }),
    order(C2, { store: T, at: '2026-09-16T12:00:00', user: custA, subtotal: 300, tax: 15, commission: 30, deliveryFee: 15, child: true }),
    order(O2, { at: '2026-09-17T10:00:00', user: custB, subtotal: 100, tax: 5, commission: 10, pickup: true }),
    order(O3, { status: 'cancelled_by_user', at: '2026-09-18T10:00:00', user: custC, subtotal: 50, tax: 0, commission: 5 }),
    order(O4, { status: 'pending_payment', at: '2026-09-19T10:00:00', user: oid(), subtotal: 999, tax: 0, commission: 99 }),
    order(O5, { at: '2026-09-22T10:00:00', user: custA, subtotal: 150, tax: 18, commission: 15 }),
]);
await mongoose.connection.collection('parent_orders').insertOne({
    _id: parent, vertical: 'quickCommerce', orderNumber: 'MSO-0000000001', userId: custA, status: 'placed',
    childOrderIds: [C1, C2], storeIds: [S, T], pricing: { total: 555 }, createdAt: ist('2026-09-16T12:00:00'),
});
const tx = (orderId, at, share, commission, restaurant = S, status = 'captured') => ({
    orderId, userId: custA, restaurantId: restaurant, paymentMethod: 'razorpay', status,
    createdAt: ist(at), updatedAt: ist(at),
    amounts: { totalCustomerPaid: 0, restaurantShare: share, restaurantCommission: commission, riderShare: 0, platformNetProfit: 0 },
    settlement: { isRestaurantSettled: false },
});
await FoodTransaction.collection.insertMany([
    tx(C1, '2026-09-16T12:00:00', 180, 20),
    tx(C2, '2026-09-16T12:00:00', 270, 30, T),
    tx(O2, '2026-09-17T10:00:00', 90, 10),
    tx(O5, '2026-09-22T10:00:00', 135, 15),
]);
await FoodRestaurantWithdrawal.collection.insertOne({
    restaurantId: S, amount: 100, status: 'approved', processedAt: ist('2026-09-25T10:00:00'), transactionId: 'UTR9',
    createdAt: ist('2026-09-24T10:00:00'), updatedAt: ist('2026-09-25T10:00:00'),
});

const RANGE = { from: '2026-09-15', to: '2026-09-30' };

console.log('\nanalytics (qc)');
await check('per store: unpaid excluded, a multi-store child counts for its own store only', async () => {
    const a = await reports.getSalesAnalytics(S, { ...RANGE, groupBy: 'day' });
    const t = a.totals;
    assert.equal(t.orders, 4);
    assert.equal(t.delivered, 3);
    assert.equal(t.cancelled, 1);
    near(t.grossSales, 450, 'gross');
    near(t.gst, 33, 'GST as stored (pricing.tax)');
    near(t.commission, 45, 'commission');
    near(t.payout, 405, 'payout from the ledger');
    assert.equal(t.uniqueCustomers, 3);
    assert.equal(t.repeatCustomers, 1);
    assert.equal(a.series.length, 16);
    assert.equal(a.range.groupBy, 'day');
    const other = await reports.getSalesAnalytics(T, RANGE);
    assert.equal(other.totals.orders, 1);
    near(other.totals.payout, 270);
});
await check('same response shape as food, plus customerInsights (repeat rate, top customers)', async () => {
    const qc = await reports.getSalesAnalytics(S, RANGE);
    const food = await foodReports.getSalesAnalytics(oid(), RANGE);
    assert.deepEqual(Object.keys(qc).filter((k) => k !== 'customerInsights').sort(), Object.keys(food).sort());
    assert.deepEqual(Object.keys(qc.totals).sort(), Object.keys(food.totals).sort());
    assert.equal(food.customerInsights, undefined, 'food is unchanged');
    const ci = qc.customerInsights;
    assert.equal(ci.totalCustomers, 2, 'delivered orders only');
    assert.equal(ci.repeatCustomers, 1);
    near(ci.repeatRatePercent, 50);
    assert.equal(ci.topCustomers[0].name, 'Asha');
    assert.equal(ci.topCustomers[0].orders, 2);
    assert.equal(ci.topCustomers[0].phone, '******0021');
});
await check('a bad groupBy is a 400; a bad store id is a 401', async () => {
    await rejects(reports.getSalesAnalytics(S, { groupBy: 'year' }), 400);
    await rejects(reports.getSalesAnalytics('nope', RANGE), 401);
});

console.log('\nreports (qc)');
await check('orders CSV: the store\'s orders only, pickup included, GST from pricing.tax', async () => {
    const r = await reports.buildRestaurantReport(S, { type: 'orders', format: 'csv', ...RANGE });
    assert.equal(r.filename, 'orders-report_2026-09-15_to_2026-09-30.csv');
    const lines = parseCsv(r.body.toString('utf8'));
    assert.equal(lines.length, 5, 'header + 4 orders');
    const ids = lines.slice(1).map((l) => l[0]);
    assert.ok(!ids.includes(`QC-${String(C2).slice(-6)}`), 'the other store\'s child is not here');
    assert.ok(!ids.includes(`QC-${String(O4).slice(-6)}`), 'unpaid excluded');
    const pickup = lines.find((l) => l[0] === `QC-${String(O2).slice(-6)}`);
    assert.equal(pickup[5], '5');
    assert.equal(pickup[9], '90');
});
await check('GST CSV: per-slab rate derived from the stored tax, CGST + SGST = GST', async () => {
    const r = await reports.buildRestaurantReport(S, { type: 'gst', format: 'csv', ...RANGE });
    const rows = parseCsv(r.body.toString('utf8')).slice(1);
    assert.equal(rows.length, 3);
    near(rows.reduce((s, x) => s + Number(x[7]), 0), 33);
    near(rows.reduce((s, x) => s + Number(x[5]) + Number(x[6]), 0), 33);
    assert.deepEqual(rows.map((x) => Number(x[4])), [5, 5, 12]);
});
for (const type of reports.REPORT_TYPES) {
    await check(`${type} report renders as a PDF`, async () => {
        const r = await reports.buildRestaurantReport(S, { type, format: 'pdf', ...RANGE });
        assert.equal(r.contentType, 'application/pdf');
        assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
    });
}

console.log('\nsettlement statements (qc)');
await check('cycle 2026-09 reconciles and carries fulfilment and parent on each line', async () => {
    const s = await reports.getSettlementStatement(S, '2026-09');
    const t = s.totals;
    assert.equal(t.orders, 3);
    near(t.itemSales, 450);
    near(t.taxableValue, 450);
    near(t.gstCollected, 33);
    near(t.commission, 45);
    near(t.otherAdjustments, 0);
    near(t.netPayout, 405);
    near(t.taxableValue + t.packaging - t.commission - t.restaurantDiscounts + t.otherAdjustments, t.netPayout, 'reconciles');
    near(t.paidOut, 100);
    assert.equal(s.restaurant.name, 'Corner Kirana');
    assert.match(s.restaurant.code, /^STORE/);
    const c1 = s.lines.find((l) => l.orderId === `QC-${String(C1).slice(-6)}`);
    assert.equal(c1.parentOrderId, String(parent));
    assert.equal(c1.deliveryFee, 15);
    const o2 = s.lines.find((l) => l.orderId === `QC-${String(O2).slice(-6)}`);
    assert.equal(o2.fulfilmentType, 'pickup');
    assert.equal(o2.deliveryFee, 0);
    const pdf = await reports.buildSettlementStatementFile(S, '2026-09', { format: 'pdf' });
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
    const csv = await reports.buildSettlementStatementFile(S, '2026-09', { format: 'csv' });
    assert.equal(parseCsv(csv.body.toString('utf8')).length, 4);
    const { statements } = await reports.listSettlementStatements(S, { limit: 2 });
    assert.equal(statements.length, 2);
    await rejects(reports.getSettlementStatement(S, '2026-13'), 400);
});

console.log('\nHTTP (/qc/restaurant)');
const restaurantRoutes = (await import(`${BASE}/restaurant/routes/restaurant.routes.js`)).default;
const errorHandler = (await import('../src/modules/quickCommerce/middleware/errorHandler.js')).default;
const { signAccessToken } = await import('../src/modules/quickCommerce/core/auth/token.util.js');
const app = express();
app.use(express.json());
app.use('/api/v1/qc/restaurant', restaurantRoutes);
app.use(errorHandler);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/api/v1/qc`;
const token = signAccessToken({ userId: String(S), role: 'RESTAURANT' });
const get = (path, auth = token) => fetch(`${base}${path}`, { headers: auth ? { authorization: `Bearer ${auth}` } : {} });

await check('GET /qc/restaurant/analytics/sales (and signed-out is 401)', async () => {
    const res = await get('/restaurant/analytics/sales?from=2026-09-15&to=2026-09-30&groupBy=week');
    assert.equal(res.status, 200);
    const body = await res.json();
    near(body.data.totals.payout, 405);
    assert.equal(body.data.series.length, 3);
    assert.ok(Array.isArray(body.data.customerInsights.topCustomers));
    assert.equal((await get('/restaurant/analytics/sales', null)).status, 401);
});
await check('the existing GET /qc/restaurant/analytics still answers', async () => {
    const res = await get('/restaurant/analytics?from=2026-09-15&to=2026-09-30');
    assert.equal(res.status, 200);
});
await check('GET /qc/restaurant/reports serves CSV and PDF attachments; bad range is 400', async () => {
    const csv = await get('/restaurant/reports?type=sales&format=csv&from=2026-09-15&to=2026-09-30');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /^text\/csv/);
    assert.match(csv.headers.get('content-disposition'), /attachment; filename="sales-report_2026-09-15_to_2026-09-30\.csv"/);
    const pdf = await get('/restaurant/reports?type=orders&format=pdf&from=2026-09-15&to=2026-09-30');
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal((await get('/restaurant/reports?type=orders&from=2026-09-30&to=2026-09-01')).status, 400);
});
await check('GET /qc/restaurant/settlements, /:cycleId and /:cycleId/download', async () => {
    const list = await get('/restaurant/settlements?limit=2');
    assert.equal(list.status, 200);
    assert.equal((await list.json()).data.statements.length, 2);
    const one = await get('/restaurant/settlements/2026-09');
    near((await one.json()).data.totals.netPayout, 405);
    const file = await get('/restaurant/settlements/2026-09/download?format=csv');
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-type'), /^text\/csv/);
});

server.close();
await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll qc-store-reports checks passed');
process.exit(failed ? 1 : 0);
