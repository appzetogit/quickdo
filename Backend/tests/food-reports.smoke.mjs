/**
 * Restaurant reports, analytics, settlement statements, GSTIN checks, the food
 * invoice PDF, onboarding menu import and restaurant email sign-in
 * (SOW plan 6.1 - 6.7).
 *
 * Run: node tests/food-reports.smoke.mjs
 *
 * Isolated in-memory MongoDB replica set; nothing external is called (SMTP is
 * a recording transport, the GST provider is a registered fake).
 *
 * The seeded month (all times IST), restaurant "Spice Hub":
 *
 *   O1 16 Sep 12:00  delivered  food 200 (excl. GST 5%) + packing 10, commission 20   ledger share 190   customer A
 *   O2 16 Sep 20:00  delivered  food 105 incl. GST (taxable 100), commission 10        ledger share  90   customer A
 *   O3 22 Sep        delivered  food 300, platform packing 15, commission 30,
 *                               restaurant-funded coupon 50                           ledger share 220   customer B
 *   O4 17 Sep        cancelled  food 100                                               ledger refunded    customer C
 *   O5 17 Sep        unpaid online order (pending_payment) -- never counted
 *   O6  2 Oct        delivered  food 100, commission 10, no ledger entry -> payout 90  customer C
 *   X1 another restaurant's delivered order on 16 Sep -- never counted
 *
 * Sep 15-30: 4 orders, 3 delivered, gross 615, GST 30, commission 60, payout 500.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.BULLMQ_ENABLED = 'false';
process.env.REDIS_ENABLED = 'false';
process.env.JWT_ACCESS_SECRET ||= 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET ||= 'b'.repeat(48);
delete process.env.EMAIL_HOST;
delete process.env.GST_VERIFY_PROVIDER;

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

const outbox = [];

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'food_reports' });

    const { config } = await import('../src/config/env.js');
    config.nodeEnv = 'test';
    config.useDefaultOtp = false;
    config.otpRateLimit = 50;
    const { __setMailTransportForTests } = await import('../src/services/mailTransport.js');
    __setMailTransportForTests({ sendMail: async (msg) => { outbox.push(msg); return { messageId: `m${outbox.length}` }; } });

    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
    const { FoodTransaction } = await import('../src/modules/food/orders/models/foodTransaction.model.js');
    const { FoodRestaurantWithdrawal } = await import('../src/modules/food/restaurant/models/foodRestaurantWithdrawal.model.js');
    const { FoodOffer } = await import('../src/modules/food/admin/models/offer.model.js');
    const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
    const reports = await import('../src/modules/food/restaurant/services/restaurantReports.service.js');
    const period = await import('../src/core/documents/period.js');
    const { toCsv, csvCell } = await import('../src/core/documents/csv.js');
    const gstin = await import('../src/core/gst/gstin.js');
    const gstSvc = await import('../src/core/gst/gstVerification.service.js');
    const invoice = await import('../src/modules/food/orders/services/orderInvoice.service.js');
    const { signAccessToken } = await import('../src/core/auth/token.util.js');

    const oid = () => new mongoose.Types.ObjectId();
    const rid = oid();
    const otherRid = oid();
    const [custA, custB, custC] = [oid(), oid(), oid()];
    const { FoodUser } = await import('../src/core/users/user.model.js');
    await FoodUser.collection.insertMany([custA, custB, custC].map((_id, i) => ({ _id, name: `Customer ${i}`, phone: `98765000${20 + i}`, isActive: true })));
    await FoodRestaurant.collection.insertMany([
        {
            _id: rid, restaurantName: 'Spice Hub', ownerName: 'Asha', ownerEmail: 'Owner@SpiceHub.in', ownerPhone: '9876500011',
            status: 'approved', gstRegistered: true, gstNumber: '27AAPFU0939F1ZV', gstLegalName: '', panNumber: 'AAPFU0939F',
            location: { formattedAddress: '1 MG Road, Pune', state: 'Maharashtra', city: 'Pune' }, createdAt: new Date(),
        },
        { _id: otherRid, restaurantName: 'Other', ownerName: 'O', ownerPhone: '9876500012', status: 'approved', createdAt: new Date() },
    ]);

    const order = (id, { status = 'delivered', at, user, subtotal, commissionable, inclusive = false, gstRate = 5, packaging = 0, packagingMode = 'RESTAURANT', commission = 0, coupon, discount = 0, total, restaurant = rid }) => ({
        _id: id,
        order_id: `FOD-${String(id).slice(-6)}`,
        orderId: `FOD-${String(id).slice(-6)}`,
        restaurantId: restaurant,
        userId: user,
        orderStatus: status,
        createdAt: ist(at),
        updatedAt: ist(at),
        items: [{ itemId: 'i1', name: 'Paneer = Tikka', price: subtotal, quantity: 1, addons: [], addonsTotal: 0 }],
        deliveryAddress: { street: '2 FC Road', city: 'Pune', state: 'Maharashtra', fullName: 'Ravi' },
        customerName: 'Ravi',
        payment: { method: 'razorpay', status: status === 'pending_payment' ? 'created' : 'paid' },
        statusHistory: status === 'delivered' ? [{ at: ist(at), from: 'picked_up', to: 'delivered' }] : [],
        pricing: {
            subtotal,
            commissionableAmount: commissionable ?? subtotal,
            pricesIncludeGst: inclusive,
            gstRate,
            tax: inclusive ? 0 : (commissionable ?? subtotal) * gstRate / 100,
            packagingFee: packaging,
            netPackagingFee: packaging,
            packagingMode,
            restaurantCommission: commission,
            discount,
            couponCode: coupon || null,
            bill: coupon ? { discountOnNet: discount } : null,
            deliveryFee: 30,
            platformFee: 10,
            platformFeeGst: 1.8,
            platformFeeGstRate: 18,
            total: total ?? subtotal + 41.8,
        },
    });
    const [O1, O2, O3, O4, O5, O6, X1] = [oid(), oid(), oid(), oid(), oid(), oid(), oid()];
    const o1 = order(O1, { at: '2026-09-16T12:00:00', user: custA, subtotal: 200, packaging: 10, commission: 20, total: 252 });
    // O1 carries the real stored bill so the invoice prints exactly it.
    o1.pricing.bill = {
        itemAmount: 200, packagingFee: 10, discount: 0, pricesIncludeGst: false, netItemAmount: 200, netPackagingFee: 10,
        discountOnNet: 0, taxableAmount: 210, gstRate: 5, gstOnItems: 10.5, deliveryFee: 30, surgeAmount: 0,
        platformFee: 10, platformFeeGstRate: 18, platformFeeGst: 1.8, tip: 0, roundOff: -0.3, grandTotal: 262,
    };
    o1.pricing.total = 262;
    await FoodOrder.collection.insertMany([
        o1,
        order(O2, { at: '2026-09-16T20:00:00', user: custA, subtotal: 105, commissionable: 100, inclusive: true, commission: 10 }),
        order(O3, { at: '2026-09-22T13:00:00', user: custB, subtotal: 300, packaging: 15, packagingMode: 'ADMIN', commission: 30, coupon: 'MYDEAL', discount: 50 }),
        order(O4, { status: 'cancelled_by_user', at: '2026-09-17T10:00:00', user: custC, subtotal: 100, commission: 10 }),
        order(O5, { status: 'pending_payment', at: '2026-09-17T11:00:00', user: oid(), subtotal: 999, commission: 99 }),
        order(O6, { at: '2026-10-02T10:00:00', user: custC, subtotal: 100, commission: 10 }),
        order(X1, { at: '2026-09-16T12:00:00', user: custA, subtotal: 500, commission: 50, restaurant: otherRid }),
    ]);
    await FoodOffer.collection.insertOne({ couponCode: 'MYDEAL', createdByRole: 'RESTAURANT', restaurantId: rid });
    const tx = (orderId, at, share, commission, status = 'captured', restaurant = rid) => ({
        orderId, userId: custA, restaurantId: restaurant, paymentMethod: 'razorpay', status,
        createdAt: ist(at), updatedAt: ist(at),
        amounts: { totalCustomerPaid: 0, restaurantShare: share, restaurantCommission: commission, riderShare: 0, platformNetProfit: 0 },
        settlement: { isRestaurantSettled: false },
    });
    await FoodTransaction.collection.insertMany([
        tx(O1, '2026-09-16T12:00:00', 190, 20),
        tx(O2, '2026-09-16T20:00:00', 90, 10),
        tx(O3, '2026-09-22T13:00:00', 220, 30),
        tx(O4, '2026-09-17T10:00:00', 90, 10, 'refunded'),
        tx(X1, '2026-09-16T12:00:00', 450, 50, 'captured', otherRid),
    ]);
    await FoodRestaurantWithdrawal.collection.insertMany([
        { restaurantId: rid, amount: 300, status: 'approved', processedAt: ist('2026-09-25T10:00:00'), transactionId: 'UTR123', createdAt: ist('2026-09-24T10:00:00'), updatedAt: ist('2026-09-25T10:00:00') },
        { restaurantId: rid, amount: 50, status: 'pending', createdAt: ist('2026-09-26T10:00:00'), updatedAt: ist('2026-09-26T10:00:00') },
    ]);

    console.log('\nperiods');
    await check('IST day ranges, Monday weeks and the 15th-to-15th settlement cycle', async () => {
        const r = period.parseRange({ from: '2026-09-15', to: '2026-09-30' });
        assert.equal(r.start.toISOString(), '2026-09-14T18:30:00.000Z');
        assert.equal(r.end.toISOString(), '2026-09-30T18:30:00.000Z');
        assert.equal(r.days, 16);
        assert.throws(() => period.parseRange({ from: '2026-09-30', to: '2026-09-01' }), /on or before/);
        assert.throws(() => period.parseRange({ from: '2024-01-01', to: '2026-09-01' }), /at most/);
        assert.equal(period.listBuckets(r.start, r.end, 'week')[0].key, '2026-09-14');
        const c = period.cycleWindow('2026-09');
        assert.equal(c.from, '2026-09-15');
        assert.equal(c.to, '2026-10-14');
        assert.equal(period.cycleIdFor(ist('2026-10-14T23:00:00')), '2026-09');
        assert.equal(period.cycleIdFor(ist('2026-10-15T00:30:00')), '2026-10');
        assert.equal(period.cycleIdFor(ist('2026-01-03T00:30:00')), '2025-12');
    });

    console.log('\nanalytics aggregated in MongoDB (6.2)');
    await check('totals: unpaid orders and other restaurants excluded; money from delivered orders only', async () => {
        const a = await reports.getSalesAnalytics(rid, { from: '2026-09-15', to: '2026-09-30', groupBy: 'day' });
        const t = a.totals;
        assert.equal(t.orders, 4);
        assert.equal(t.delivered, 3);
        assert.equal(t.cancelled, 1);
        near(t.grossSales, 615, 'gross');
        near(t.gst, 30, 'gst');
        near(t.commission, 60, 'commission');
        near(t.payout, 500, 'payout from the ledger');
        assert.equal(t.uniqueCustomers, 3);
        assert.equal(t.repeatCustomers, 1);
        assert.equal(a.empty, false);
        assert.equal(a.series.length, 16, 'one bucket per day, gaps filled');
        const d16 = a.series.find((s) => s.period === '2026-09-16');
        assert.equal(d16.orders, 2);
        near(d16.grossSales, 315);
        near(d16.payout, 280);
        assert.equal(a.series.find((s) => s.period === '2026-09-18').orders, 0);
    });
    await check('groupBy week (Monday, IST) and month', async () => {
        const w = await reports.getSalesAnalytics(rid, { from: '2026-09-15', to: '2026-09-30', groupBy: 'week' });
        assert.deepEqual(w.series.map((s) => [s.period, s.orders]), [['2026-09-14', 3], ['2026-09-21', 1], ['2026-09-28', 0]]);
        const m = await reports.getSalesAnalytics(rid, { from: '2026-09-01', to: '2026-10-31', groupBy: 'month' });
        assert.deepEqual(m.series.map((s) => [s.period, s.delivered]), [['2026-09-01', 3], ['2026-10-01', 1]]);
        near(m.series[1].payout, 90, 'no ledger entry: the ledger formula');
    });
    await check('no orders in range -> empty, zero-filled series', async () => {
        const a = await reports.getSalesAnalytics(rid, { from: '2026-06-01', to: '2026-06-07' });
        assert.equal(a.empty, true);
        assert.equal(a.series.length, 7);
        assert.equal(a.totals.orders, 0);
    });
    await check('a bad groupBy is a 400', async () => {
        await rejects(reports.getSalesAnalytics(rid, { groupBy: 'year' }), 400);
    });

    console.log('\nreports (6.1)');
    await check('CSV escapes quotes and neutralises spreadsheet formulas, numbers stay numbers', async () => {
        assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
        assert.equal(csvCell('+91 98'), "'+91 98");
        assert.equal(csvCell(-40), '-40');
        const csv = toCsv([{ header: 'A', key: 'a' }], [{ a: 'x,y' }]);
        assert.ok(csv.startsWith('﻿A\r\n"x,y"'));
    });
    await check('orders CSV: one row per counted order with the ledger payout', async () => {
        const r = await reports.buildRestaurantReport(rid, { type: 'orders', format: 'csv', from: '2026-09-15', to: '2026-09-30' });
        assert.match(r.contentType, /^text\/csv/);
        assert.equal(r.filename, 'orders-report_2026-09-15_to_2026-09-30.csv');
        const lines = parseCsv(r.body.toString('utf8'));
        assert.equal(lines.length, 5, 'header + 4 orders');
        const o3 = lines.find((l) => l[0] === `FOD-${String(O3).slice(-6)}`);
        assert.equal(o3[7], '50', 'restaurant-funded discount');
        assert.equal(o3[9], '220', 'ledger payout');
        assert.ok(!r.body.toString().includes('FOD-' + String(O5).slice(-6)), 'unpaid order excluded');
    });
    await check('GST CSV splits CGST/SGST on delivered orders', async () => {
        const r = await reports.buildRestaurantReport(rid, { type: 'gst', format: 'csv', from: '2026-09-15', to: '2026-09-30' });
        const rows = parseCsv(r.body.toString('utf8')).slice(1);
        assert.equal(rows.length, 3);
        near(rows.reduce((s, x) => s + Number(x[7]), 0), 30, 'total GST');
        near(rows.reduce((s, x) => s + Number(x[5]) + Number(x[6]), 0), 30, 'cgst + sgst');
    });
    for (const type of reports.REPORT_TYPES) {
        await check(`${type} report renders as a PDF`, async () => {
            const r = await reports.buildRestaurantReport(rid, { type, format: 'pdf', from: '2026-09-15', to: '2026-09-30' });
            assert.equal(r.contentType, 'application/pdf');
            assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
            assert.ok(r.body.length > 1000);
        });
    }
    await check('unknown type / format are 400s', async () => {
        await rejects(reports.buildRestaurantReport(rid, { type: 'nope' }), 400);
        await rejects(reports.buildRestaurantReport(rid, { type: 'orders', format: 'xls' }), 400);
    });

    console.log('\nsettlement statements (6.3)');
    await check('cycle 2026-09 totals reconcile: A + B - C - D + E = payout', async () => {
        const s = await reports.getSettlementStatement(rid, '2026-09');
        const t = s.totals;
        assert.equal(s.cycle.from, '2026-09-15');
        assert.equal(t.orders, 3, 'captured ledger entries in the cycle');
        assert.equal(t.refundedOrders, 1);
        near(t.itemSales, 605);
        near(t.taxableValue, 600);
        near(t.gstCollected, 30);
        near(t.packaging, 10);
        near(t.commission, 60);
        near(t.restaurantDiscounts, 50);
        near(t.otherAdjustments, 0);
        near(t.deductions, 110);
        near(t.netPayout, 500);
        near(t.taxableValue + t.packaging - t.commission - t.restaurantDiscounts + t.otherAdjustments, t.netPayout, 'reconciles');
        near(t.paidOut, 300, 'approved withdrawal processed in the cycle');
        assert.equal(s.lines.length, 3);
        assert.equal(s.restaurant.gstin, '27AAPFU0939F1ZV');
    });
    await check('statement PDF and CSV download; bad cycle id is a 400', async () => {
        const pdf = await reports.buildSettlementStatementFile(rid, '2026-09', { format: 'pdf' });
        assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
        assert.equal(pdf.filename, 'settlement-statement_2026-09.pdf');
        const csv = await reports.buildSettlementStatementFile(rid, '2026-09', { format: 'csv' });
        assert.equal(parseCsv(csv.body.toString('utf8')).length, 4);
        await rejects(reports.getSettlementStatement(rid, '2026-13'), 400);
        await rejects(reports.getSettlementStatement(rid, 'sept'), 400);
    });
    await check('statement list returns the requested number of cycles, newest first', async () => {
        const { statements } = await reports.listSettlementStatements(rid, { limit: 3 });
        assert.equal(statements.length, 3);
        assert.ok(statements[0].start > statements[1].start);
        assert.ok(statements.every((s) => s.totals && typeof s.totals.netPayout === 'number'));
    });

    console.log('\nHTTP (restaurant routes)');
    const restaurantRoutes = (await import('../src/modules/food/restaurant/routes/restaurant.routes.js')).default;
    const orderUserRoutes = (await import('../src/modules/food/orders/routes/order.routes.user.js')).default;
    const { authMiddleware } = await import('../src/core/auth/auth.middleware.js');
    const errorHandler = (await import('../src/middleware/errorHandler.js')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/food/restaurant', restaurantRoutes);
    app.use('/api/v1/food/orders', authMiddleware, orderUserRoutes);
    app.use(errorHandler);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1/food`;
    const restaurantToken = signAccessToken({ userId: String(rid), role: 'RESTAURANT' });
    const get = (path, token) => fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

    await check('GET /restaurant/analytics/sales answers JSON; signed-out is 401', async () => {
        const res = await get('/restaurant/analytics/sales?from=2026-09-15&to=2026-09-30&groupBy=week', restaurantToken);
        assert.equal(res.status, 200);
        const body = await res.json();
        near(body.data.totals.payout, 500);
        assert.equal((await get('/restaurant/analytics/sales')).status, 401);
    });
    await check('GET /restaurant/reports serves text/csv and application/pdf as attachments', async () => {
        const csv = await get('/restaurant/reports?type=sales&format=csv&from=2026-09-15&to=2026-09-30', restaurantToken);
        assert.equal(csv.status, 200);
        assert.match(csv.headers.get('content-type'), /^text\/csv/);
        assert.match(csv.headers.get('content-disposition'), /attachment; filename="sales-report_2026-09-15_to_2026-09-30\.csv"/);
        const pdf = await get('/restaurant/reports?type=orders&format=pdf&from=2026-09-15&to=2026-09-30', restaurantToken);
        assert.equal(pdf.status, 200);
        assert.equal(pdf.headers.get('content-type'), 'application/pdf');
        assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
        const bad = await get('/restaurant/reports?type=orders&from=2026-09-30&to=2026-09-01', restaurantToken);
        assert.equal(bad.status, 400);
    });
    await check('GET /restaurant/settlements/:cycleId(/download)', async () => {
        const res = await get('/restaurant/settlements/2026-09', restaurantToken);
        assert.equal(res.status, 200);
        near((await res.json()).data.totals.netPayout, 500);
        const pdf = await get('/restaurant/settlements/2026-09/download?format=pdf', restaurantToken);
        assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    });
    await check('POST /restaurant/gst/verify (public) checks the checksum', async () => {
        const post = (body) => fetch(`${base}/restaurant/gst/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const ok = await (await post({ gstin: '27aapfu0939f1zv' })).json();
        assert.equal(ok.data.status, 'offline_valid');
        assert.equal(ok.data.stateName, 'Maharashtra');
        const typo = await (await post({ gstin: '27AAPFU0939F1ZW' })).json();
        assert.equal(typo.data.status, 'invalid');
        assert.equal(typo.data.checksumValid, false);
    });

    console.log('\nGSTIN (6.4)');
    await check('checksum: real GSTINs pass, a one-character typo fails', async () => {
        assert.equal(gstin.isGstinChecksumValid('27AAPFU0939F1ZV'), true);
        assert.equal(gstin.isGstinChecksumValid('29AAGCB7383J1Z4'), true);
        assert.equal(gstin.isGstinChecksumValid('27AAPFU0939F1ZW'), false);
        assert.equal(gstin.isGstinChecksumValid('27AAPFU0939G1ZV'), false);
        const i = gstin.inspectGstin('27aapfu0939f1zv');
        assert.deepEqual([i.formatValid, i.checksumValid, i.pan, i.stateCode], [true, true, 'AAPFU0939F', '27']);
        assert.equal(gstin.inspectGstin('27AAPFU0939F1Z').formatValid, false);
    });
    await check('no provider configured: offline result, PAN and state mismatches flagged', async () => {
        const v = await gstSvc.verifyGstin('27AAPFU0939F1ZV', { panNumber: 'ABCDE1234F', state: 'Karnataka' });
        assert.equal(v.status, 'offline_valid');
        assert.equal(v.provider, 'none');
        assert.deepEqual(v.mismatches.map((m) => m.field).sort(), ['pan', 'state']);
        assert.equal((await gstSvc.verifyGstin('27AAPFU0939F1ZW')).status, 'invalid');
    });
    await check('a configured provider fills legal name / address and flags a name mismatch', async () => {
        gstSvc.registerGstProvider('fake', async (g) => (g === '27AAPFU0939F1ZV'
            ? gstSvc.mapTaxpayerRecord({ data: { lgnm: 'SPICE HUB PRIVATE LIMITED', tradeNam: 'Spice Hub', sts: 'Active', pradr: { addr: { bno: '1', st: 'MG Road', loc: 'Camp', dst: 'Pune', stcd: 'Maharashtra', pncd: '411001' } } } })
            : { found: false }));
        process.env.GST_VERIFY_PROVIDER = 'fake';
        try {
            const ok = await gstSvc.verifyGstin('27AAPFU0939F1ZV', { legalName: 'Spice Hub Pvt Ltd' });
            assert.equal(ok.status, 'verified');
            assert.equal(ok.legalName, 'SPICE HUB PRIVATE LIMITED');
            assert.match(ok.address, /MG Road, Camp, Pune, Maharashtra, 411001/);
            assert.equal(ok.mismatches.length, 0, 'Pvt Ltd = Private Limited');
            const bad = await gstSvc.verifyGstin('27AAPFU0939F1ZV', { legalName: 'Curry Palace' });
            assert.deepEqual(bad.mismatches.map((m) => m.field), ['legalName']);
            assert.equal((await gstSvc.verifyGstin('29AAGCB7383J1Z4')).status, 'not_found');

            // Admin review re-check stores the result and fills the blank legal name.
            const { reverifyRestaurantGstinAdminController } = await import('../src/modules/food/restaurant/controllers/gstVerification.controller.js');
            let sent;
            const res = { status(c) { this.code = c; return this; }, json(b) { sent = { code: this.code, ...b }; return this; } };
            await reverifyRestaurantGstinAdminController({ params: { id: String(rid) } }, res, (e) => { throw e; });
            assert.equal(sent.code, 200);
            assert.equal(sent.data.verification.status, 'verified');
            const stored = await FoodRestaurant.findById(rid).lean();
            assert.equal(stored.gstVerification.status, 'verified');
            assert.equal(stored.gstLegalName, 'SPICE HUB PRIVATE LIMITED');
        } finally {
            delete process.env.GST_VERIFY_PROVIDER;
        }
    });
    await check('a provider outage never blocks: status error with offline checks kept', async () => {
        gstSvc.registerGstProvider('down', async () => { throw new Error('ECONNRESET'); });
        process.env.GST_VERIFY_PROVIDER = 'down';
        try {
            const v = await gstSvc.verifyGstin('27AAPFU0939F1ZV');
            assert.equal(v.status, 'error');
            assert.equal(v.checksumValid, true);
        } finally {
            delete process.env.GST_VERIFY_PROVIDER;
        }
    });

    console.log('\ninvoice PDF (6.7)');
    await check('the stored bill, GST split CGST/SGST, adds up to what was paid', async () => {
        const r = await invoice.getCustomerOrderInvoice(String(O1), String(custA));
        assert.equal(r.contentType, 'application/pdf');
        assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
        const d = r.data;
        near(d.gst.cgst, 5.25);
        near(d.gst.sgst, 5.25);
        assert.equal(d.gst.cgstRate, 2.5);
        const s = d.summary;
        near(s.itemAmount + s.packaging + d.gst.total + s.deliveryFee + s.platformFee + s.platformFeeGst + s.tip + s.roundOff, d.grandTotal, 'lines add up');
        near(d.grandTotal, 262);
        assert.equal(d.restaurant.gstin, '27AAPFU0939F1ZV');
        assert.equal(d.invoiceNumber, `FD-FOD-${String(O1).slice(-6)}`);
    });
    await check('someone else\'s order is 403, an undelivered one 409', async () => {
        await rejects(invoice.getCustomerOrderInvoice(String(O1), String(custB)), 403);
        await rejects(invoice.getCustomerOrderInvoice(String(O4), String(custC)), 409);
        await rejects(invoice.getCustomerOrderInvoice(String(oid()), String(custC)), 404);
    });
    await check('GET /food/orders/:id/invoice over HTTP', async () => {
        const token = signAccessToken({ userId: String(custA), role: 'USER' });
        const res = await get(`/orders/${String(O1)}/invoice`, token);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'application/pdf');
        assert.match(res.headers.get('content-disposition'), /invoice-FOD-/);
    });

    console.log('\nonboarding menu (6.6)');
    await check('typed first items go through the bulk importer; bad rows are reported, not fatal', async () => {
        const { importOnboardingMenu, normalizeFirstItems } = await import('../src/modules/food/restaurant/services/onboardingMenu.service.js');
        assert.equal(await importOnboardingMenu(rid, {}), null);
        const r = await importOnboardingMenu(rid, {
            firstItems: JSON.stringify([
                { name: 'Veg Thali', price: 180, category: 'Mains', foodType: 'Veg' },
                { name: 'Chicken Biryani', price: '240', foodType: 'Non-Veg' },
                { name: 'Free lunch', price: 0 },
            ]),
        });
        assert.equal(r.firstItems.success, 2);
        assert.equal(r.firstItems.failed, 1);
        const items = await FoodItem.find({ restaurantId: rid }).lean();
        assert.deepEqual(items.map((i) => i.name).sort(), ['Chicken Biryani', 'Veg Thali']);
        const sheet = await importOnboardingMenu(rid, { menuSheet: { buffer: Buffer.from('not a workbook') } });
        assert.match(sheet.sheet.error, /xlsx/i);
        assert.equal(normalizeFirstItems('[').errors.length, 1);
    });

    console.log('\nrestaurant email sign-in (6.5)');
    const restEmail = await import('../src/core/auth/restaurantEmailAuth.service.js');
    const lastCode = (to) => String([...outbox].reverse().find((m) => m.to === to)?.text || '').match(/\b(\d{6})\b/)?.[1];
    await check('a known owner email gets a code and signs in; the answer is the phone login\'s', async () => {
        const r = await restEmail.requestRestaurantEmailOtp({ email: 'owner@spicehub.in' });
        assert.equal(r.codeLength, 6);
        const code = lastCode('owner@spicehub.in');
        assert.ok(code, 'a code was emailed');
        await rejects(restEmail.verifyRestaurantEmailOtp({ email: 'owner@spicehub.in', otp: code === '000000' ? '111111' : '000000' }), 401);
        const ok = await restEmail.verifyRestaurantEmailOtp({ email: 'Owner@SpiceHub.in', otp: code });
        assert.ok(ok.accessToken && ok.refreshToken);
        assert.equal(String(ok.user._id), String(rid));
        await rejects(restEmail.verifyRestaurantEmailOtp({ email: 'owner@spicehub.in', otp: code }), 401);
    });
    await check('an unknown email gets the same answer and no email', async () => {
        const before = outbox.length;
        const r = await restEmail.requestRestaurantEmailOtp({ email: 'nobody@example.com' });
        assert.match(r.message, /If a restaurant uses this email/);
        assert.equal(outbox.length, before);
    });
    await check('a pending outlet gets the pending answer, not a session', async () => {
        await FoodRestaurant.collection.insertOne({ restaurantName: 'New Cafe', ownerName: 'N', ownerPhone: '9876500013', ownerEmail: 'new@cafe.in', status: 'pending' });
        await restEmail.requestRestaurantEmailOtp({ email: 'new@cafe.in' });
        const r = await restEmail.verifyRestaurantEmailOtp({ email: 'new@cafe.in', otp: lastCode('new@cafe.in') });
        assert.equal(r.pendingApproval, true);
        assert.equal(r.accessToken, undefined);
    });

    server.close();
    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
