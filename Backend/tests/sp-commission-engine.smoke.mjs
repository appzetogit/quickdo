/**
 * Service-provider subscription & commission engine (SOW §8, plan §3.2).
 *
 * Run: node tests/sp-commission-engine.smoke.mjs
 *
 *  - utils/commission.js computeCommission is driven directly for the decision
 *    table: under the threshold with/without a subscription, over it with
 *    provider / category / global rules, fixed vs percentage, fixed capped.
 *  - resolveCommission, the bill controller and bookingSplit run against a real
 *    replica set, to check the snapshot is written where commission is worked out
 *    and that editing a rule afterwards leaves it alone.
 *  - With no rules at all the engine must charge exactly what the old global
 *    servicePayoutPercentage did.
 *  - Subscription payments split into platform fee + remainder ledger lines.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const require = createRequire(import.meta.url);

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;

const main = async () => {
    const engine = require('../src/modules/serviceProvider/utils/commission.js');
    const { computeCommission } = engine;

    // ── Pure decision table ────────────────────────────────────────────────
    console.log('\ndecision table (pure)');
    const providerId = oid();
    const categoryId = oid();
    const t0 = new Date('2026-01-01');
    const rule = (over) => ({ _id: oid(), active: true, createdAt: t0, ...over });
    const globalPct = rule({ scope: 'global', type: 'percentage', value: 10 });
    const categoryPct = rule({ scope: 'category', refId: categoryId, type: 'percentage', value: 15 });
    const providerFixed = rule({ scope: 'provider', refId: providerId, providerType: 'vendor', type: 'fixed', value: 250 });
    const ctx = { providerId, providerType: 'vendor', categoryId, threshold: 1000, fallbackPayoutPct: 90 };

    await check('under the threshold with an active subscription: commission 0, model subscription', async () => {
        const s = computeCommission({ ...ctx, total: 900, subscriptionActive: true, rules: [globalPct, categoryPct, providerFixed] });
        assert.equal(s.model, 'subscription');
        assert.equal(s.amount, 0);
        assert.equal(s.flag, null);
    });
    await check('exactly at the threshold is still the subscription model', async () => {
        const s = computeCommission({ ...ctx, total: 1000, subscriptionActive: true, rules: [globalPct] });
        assert.equal(s.model, 'subscription');
        assert.equal(s.amount, 0);
    });
    await check('under the threshold without a subscription: the global rate, flagged', async () => {
        const s = computeCommission({ ...ctx, total: 800, subscriptionActive: false, rules: [globalPct, categoryPct, providerFixed] });
        assert.equal(s.model, 'commission');
        assert.equal(s.scope, 'global', 'provider/category rules only apply above the threshold');
        assert.equal(s.amount, 80);
        assert.equal(s.flag, 'no_active_subscription');
    });
    await check('over the threshold: a provider rule beats category and global', async () => {
        const s = computeCommission({ ...ctx, total: 2000, subscriptionActive: true, rules: [globalPct, categoryPct, providerFixed] });
        assert.equal(s.model, 'commission');
        assert.equal(s.scope, 'provider');
        assert.equal(String(s.ruleId), String(providerFixed._id));
        assert.equal(s.amount, 250);
    });
    await check('over the threshold: a category rule beats global', async () => {
        const s = computeCommission({ ...ctx, total: 2000, subscriptionActive: true, rules: [globalPct, categoryPct] });
        assert.equal(s.scope, 'category');
        assert.equal(s.amount, 300, '15% of the WHOLE 2000, not of the 1000 above the threshold');
    });
    await check('over the threshold: the global rule when nothing more specific matches', async () => {
        const other = rule({ scope: 'category', refId: oid(), type: 'percentage', value: 50 });
        const s = computeCommission({ ...ctx, total: 2000, subscriptionActive: true, rules: [globalPct, other] });
        assert.equal(s.scope, 'global');
        assert.equal(s.amount, 200);
    });
    await check('a provider rule for the other provider type does not apply', async () => {
        const workerRule = rule({ scope: 'provider', refId: providerId, providerType: 'worker', type: 'fixed', value: 1 });
        const s = computeCommission({ ...ctx, total: 2000, rules: [globalPct, workerRule] });
        assert.equal(s.scope, 'global');
    });
    await check('fixed vs percentage on the same booking', async () => {
        const fixed = computeCommission({ ...ctx, total: 3000, rules: [rule({ scope: 'global', type: 'fixed', value: 120 })] });
        const pct = computeCommission({ ...ctx, total: 3000, rules: [rule({ scope: 'global', type: 'percentage', value: 12 })] });
        assert.equal(fixed.type, 'fixed');
        assert.equal(fixed.amount, 120);
        assert.equal(pct.type, 'percentage');
        assert.equal(pct.amount, 360);
    });
    await check('a fixed commission is capped at the base it is charged on', async () => {
        const s = computeCommission({ ...ctx, total: 1500, base: 400, rules: [rule({ scope: 'global', type: 'fixed', value: 999 })] });
        assert.equal(s.amount, 400);
        const t = computeCommission({ ...ctx, total: 1500, rules: [rule({ scope: 'global', type: 'fixed', value: 5000 })] });
        assert.equal(t.amount, 1500, 'capped at the booking total when base = total');
    });
    await check('inactive and out-of-window rules are ignored; the newest live rule wins', async () => {
        const now = new Date('2026-06-01');
        const off = rule({ scope: 'global', type: 'percentage', value: 40, active: false, createdAt: new Date('2026-05-01') });
        const expired = rule({ scope: 'global', type: 'percentage', value: 30, validTo: new Date('2026-05-01'), createdAt: new Date('2026-04-01') });
        const future = rule({ scope: 'global', type: 'percentage', value: 20, validFrom: new Date('2026-07-01'), createdAt: new Date('2026-05-15') });
        const older = rule({ scope: 'global', type: 'percentage', value: 5, createdAt: new Date('2026-01-01') });
        const newer = rule({ scope: 'global', type: 'percentage', value: 7, createdAt: new Date('2026-03-01') });
        const s = computeCommission({ ...ctx, total: 2000, now, rules: [off, expired, future, older, newer] });
        assert.equal(s.value, 7);
    });
    await check('no rules at all: falls back to 100 - servicePayoutPercentage', async () => {
        const s = computeCommission({ ...ctx, total: 2000, rules: [], fallbackPayoutPct: 90 });
        assert.equal(s.scope, 'settings');
        assert.equal(s.type, 'percentage');
        assert.equal(s.value, 10);
        assert.equal(s.amount, 200);
        const u = computeCommission({ ...ctx, total: 500, rules: [], fallbackPayoutPct: 75 });
        assert.equal(u.amount, 125, 'unsubscribed under the threshold: the old rate, unchanged');
    });

    // ── Against a database ─────────────────────────────────────────────────
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'sp_commission_engine' });

    const Settings = require('../src/modules/serviceProvider/models/Settings.js');
    const Booking = require('../src/modules/serviceProvider/models/Booking.js');
    const Vendor = require('../src/modules/serviceProvider/models/Vendor.js');
    const Worker = require('../src/modules/serviceProvider/models/Worker.js');
    const VendorBill = require('../src/modules/serviceProvider/models/VendorBill.js');
    const CommissionRule = require('../src/modules/serviceProvider/models/CommissionRule.js');
    const Category = require('../src/modules/serviceProvider/models/Category.js');
    const Transaction = require('../src/modules/serviceProvider/models/Transaction.js');
    const billCtl = require('../src/modules/serviceProvider/controllers/vendorControllers/vendorBillController.js');
    const ruleCtl = require('../src/modules/serviceProvider/controllers/adminControllers/commissionRuleController.js');
    const ledger = require('../src/modules/serviceProvider/services/subscriptionLedger.js');

    for (const M of [Settings, Booking, Vendor, Worker, VendorBill, CommissionRule, Category, Transaction]) {
        await M.createCollection().catch(() => {});
    }

    const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

    let phone = 9600000000;
    const active = { isActive: true, expiryDate: new Date(Date.now() + 30 * DAY) };
    const vendor = async (subscription) => {
        const _id = oid();
        await Vendor.collection.insertOne({ _id, name: 'V', businessName: 'B', email: `ce${phone}@t.test`, phone: String(phone++), approvalStatus: 'approved', isActive: true, ...(subscription ? { subscription } : {}) });
        return _id;
    };
    const worker = async (subscription) => {
        const _id = oid();
        await Worker.collection.insertOne({ _id, name: 'W', phone: String(phone++), ...(subscription ? { subscription } : {}) });
        return _id;
    };
    const booking = async (over) => {
        const _id = oid();
        await Booking.collection.insertOne({
            _id, bookingNumber: `BK${phone++}`, userId: oid(), serviceId: oid(), serviceName: 'AC repair', serviceCategory: 'AC',
            basePrice: 0, finalAmount: 0, bookingModel: 'vendor', status: 'in_progress',
            address: { addressLine1: 'x', city: 'Pune', state: 'MH', pincode: '411001' },
            scheduledDate: new Date(), scheduledTime: '10:00', timeSlot: { start: '10:00', end: '11:00' },
            ...over
        });
        return _id;
    };

    console.log('\nwith no rules and no engine settings');
    await Settings.collection.insertOne({ type: 'global', servicePayoutPercentage: 80 });
    await check('settings carry the seeded subscription values', async () => {
        const s = await Settings.findOne({ type: 'global' });
        assert.equal(s.subscriptionPrice, 1000);
        assert.equal(s.subscriptionPlatformFee, 100);
        assert.equal(s.commissionThreshold, 1000);
        assert.ok(s.subscriptionRemainderLabel);
    });
    await check('resolveCommission over the threshold charges the old global rate (20%)', async () => {
        const v = await vendor(active);
        const b = await Booking.findById(await booking({ vendorId: v }));
        const s = await engine.resolveCommission(b, { total: 3000 });
        assert.equal(s.scope, 'settings');
        assert.equal(s.amount, 600);
        assert.equal(s.providerType, 'vendor');
        assert.equal(String(s.providerId), String(v));
    });
    await check('resolveCommission under the threshold reads the provider\'s live subscription', async () => {
        const subscribed = await Booking.findById(await booking({ bookingModel: 'worker', workerId: await worker(active) }));
        const lapsed = await Booking.findById(await booking({ bookingModel: 'worker', workerId: await worker({ isActive: true, expiryDate: new Date(Date.now() - DAY) }) }));
        assert.equal((await engine.resolveCommission(subscribed, { total: 700 })).model, 'subscription');
        const s = await engine.resolveCommission(lapsed, { total: 700 });
        assert.equal(s.model, 'commission');
        assert.equal(s.flag, 'no_active_subscription');
        assert.equal(s.amount, 140);
    });

    console.log('\nadmin commission rules');
    const cat = oid();
    await Category.collection.insertOne({ _id: cat, title: 'AC', slug: 'ac' });
    const call = async (fn, { params = {}, body = {}, query = {} } = {}) => {
        const r = res();
        await fn({ params, body, query, user: { id: String(oid()) } }, r);
        return r;
    };
    let globalRuleId;
    let categoryRuleId;
    await check('validation refuses a percentage over 100, a global refId, a missing category', async () => {
        assert.equal((await call(ruleCtl.createRule, { body: { scope: 'global', type: 'percentage', value: 120 } })).statusCode, 400);
        assert.equal((await call(ruleCtl.createRule, { body: { scope: 'global', refId: String(cat), type: 'fixed', value: 10 } })).statusCode, 400);
        assert.equal((await call(ruleCtl.createRule, { body: { scope: 'category', refId: String(oid()), type: 'fixed', value: 10 } })).statusCode, 400);
        assert.equal((await call(ruleCtl.createRule, { body: { scope: 'provider', refId: String(oid()), providerType: 'vendor', type: 'fixed', value: 10 } })).statusCode, 400);
    });
    await check('creates global and category rules', async () => {
        const g = await call(ruleCtl.createRule, { body: { scope: 'global', type: 'percentage', value: 12 } });
        assert.equal(g.statusCode, 201, JSON.stringify(g.body));
        globalRuleId = g.body.data._id;
        const c = await call(ruleCtl.createRule, { body: { scope: 'category', refId: String(cat), type: 'percentage', value: 15 } });
        assert.equal(c.statusCode, 201, JSON.stringify(c.body));
        assert.equal(c.body.data.refLabel, 'AC');
        categoryRuleId = c.body.data._id;
        const list = await call(ruleCtl.listRules);
        assert.equal(list.body.data.length, 2);
        assert.equal(list.body.settings.fallbackCommissionPercentage, 20);
    });

    console.log('\nsnapshot written at bill time, and frozen');
    const v2 = await vendor(active);
    const b2 = await booking({ vendorId: v2, categoryId: cat, basePrice: 2000, finalAmount: 2000 });
    await check('the bill controller stores the snapshot and nets it off the vendor\'s service earning', async () => {
        const r = res();
        await billCtl.createOrUpdateBill({ params: { bookingId: String(b2) }, body: { services: [], parts: [] }, user: { id: String(v2) }, userRole: 'VENDOR' }, r);
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        const bk = await Booking.findById(b2).lean();
        assert.equal(bk.commissionSnapshot.model, 'commission');
        assert.equal(bk.commissionSnapshot.scope, 'category');
        assert.equal(String(bk.commissionSnapshot.ruleId), String(categoryRuleId));
        assert.equal(bk.commissionSnapshot.amount, 300);
        const bill = await VendorBill.findOne({ bookingId: b2 }).lean();
        assert.equal(bill.vendorServiceEarning, 1700);
        assert.equal(engine.billSplit(bk, bill).partnerEarning, bill.vendorTotalEarning);
    });
    await check('editing (and then deleting) the rule leaves the stored snapshot alone', async () => {
        const upd = await call(ruleCtl.updateRule, { params: { id: String(categoryRuleId) }, body: { type: 'fixed', value: 50 } });
        assert.equal(upd.statusCode, 200, JSON.stringify(upd.body));
        let bk = await Booking.findById(b2).lean();
        assert.equal(bk.commissionSnapshot.amount, 300);
        assert.equal(bk.commissionSnapshot.type, 'percentage');
        assert.equal(bk.commissionSnapshot.value, 15);
        assert.equal((await call(ruleCtl.deleteRule, { params: { id: String(categoryRuleId) } })).statusCode, 200);
        bk = await Booking.findById(b2);
        const bill = await VendorBill.findOne({ bookingId: b2 }).lean();
        const split = await engine.bookingSplit({ booking: bk, bill });
        assert.equal(split.snapshot.amount, 300);
        assert.equal(split.partnerEarning, bill.vendorTotalEarning);
    });
    await check('a new booking after the edit picks up the global rule instead', async () => {
        const bk = await Booking.findById(await booking({ vendorId: v2, categoryId: cat }));
        const s = await engine.resolveCommission(bk, { total: 2000 });
        assert.equal(s.scope, 'global');
        assert.equal(String(s.ruleId), String(globalRuleId));
        assert.equal(s.amount, 240);
    });
    await check('toggling the global rule off falls back to servicePayoutPercentage', async () => {
        assert.equal((await call(ruleCtl.toggleRule, { params: { id: String(globalRuleId) } })).body.data.active, false);
        const bk = await Booking.findById(await booking({ vendorId: v2 }));
        const s = await engine.resolveCommission(bk, { total: 2000 });
        assert.equal(s.scope, 'settings');
        assert.equal(s.amount, 400);
    });
    await check('a provider rule wins over everything for that provider', async () => {
        const p = await call(ruleCtl.createRule, { body: { scope: 'provider', refId: String(v2), providerType: 'vendor', type: 'fixed', value: 99 } });
        assert.equal(p.statusCode, 201, JSON.stringify(p.body));
        const bk = await Booking.findById(await booking({ vendorId: v2, categoryId: cat }));
        const s = await engine.resolveCommission(bk, { total: 5000 });
        assert.equal(s.scope, 'provider');
        assert.equal(s.amount, 99);
    });

    console.log('\nworker model');
    await check('subscribed worker under the threshold keeps the whole bill', async () => {
        const w = await worker(active);
        const b = await booking({ bookingModel: 'worker', workerId: w, basePrice: 800, finalAmount: 800 });
        const r = res();
        await billCtl.createOrUpdateBill({ params: { bookingId: String(b) }, body: {}, user: { id: String(w) }, userRole: 'WORKER' }, r);
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        const bk = await Booking.findById(b).lean();
        assert.equal(bk.commissionSnapshot.model, 'subscription');
        const bill = await VendorBill.findOne({ bookingId: b }).lean();
        const split = engine.billSplit(bk, bill);
        assert.equal(split.platformCommission, 0);
        assert.equal(split.partnerEarning, bill.grandTotal);
    });
    await check('a worker booking billed before snapshots existed still pays 100%', async () => {
        const split = engine.billSplit({ bookingModel: 'worker' }, { grandTotal: 1500 });
        assert.equal(split.partnerEarning, 1500);
        assert.equal(split.platformCommission, 0);
    });
    await check('settlement without a bill resolves, stores and charges the snapshot', async () => {
        const w = await worker(active);
        const bk = await Booking.findById(await booking({ bookingModel: 'worker', workerId: w, finalAmount: 1200 }));
        const split = await engine.bookingSplit({ booking: bk, amount: 1200 });
        assert.equal(split.snapshot.model, 'commission');
        assert.equal(split.platformCommission, 240, 'global rule is off, so the 20% settings fallback on the whole 1200');
        assert.equal(split.partnerEarning, 960);
        await bk.save();
        assert.equal((await Booking.findById(bk._id).lean()).commissionSnapshot.amount, 240);
    });

    console.log('\nsubscription ledger');
    await check('a payment is written as platform fee + remainder', async () => {
        await Settings.updateOne({ type: 'global' }, { $set: { subscriptionRemainderLabel: 'provider_pool' } });
        const w = await worker();
        const out = await ledger.recordSubscriptionPayment({ providerType: 'worker', providerId: w, amount: 1000, referenceId: 'pay_1', orderId: 'order_1', plan: { title: 'Monthly', durationDays: 30 } });
        assert.equal(out.fee, 100);
        assert.equal(out.remainder, 900);
        const rows = await Transaction.find({ referenceId: 'pay_1' }).lean();
        assert.equal(rows.length, 2);
        const fee = rows.find((r) => r.type === 'subscription_platform_fee');
        const rest = rows.find((r) => r.type === 'subscription_remainder');
        assert.equal(fee.amount, 100);
        assert.equal(rest.amount, 900);
        assert.equal(rest.metadata.ledgerAccount, 'provider_pool');
    });
    await check('vendor payments land on the vendor', async () => {
        const v = await vendor();
        await ledger.recordSubscriptionPayment({ providerType: 'vendor', providerId: v, amount: 1000, referenceId: 'pay_2', plan: { title: 'Monthly' } });
        assert.equal(await Transaction.countDocuments({ vendorId: v, referenceId: 'pay_2' }), 2);
    });
    await check('revenue counts only the fee as platform revenue (legacy rows: min(amount, fee))', async () => {
        await Transaction.collection.insertOne({ workerId: oid(), type: 'worker_subscription', amount: 1000, status: 'completed', description: 'legacy', createdAt: new Date() });
        const r = await ledger.subscriptionRevenue();
        assert.equal(r.gross, 3000);
        assert.equal(r.platformFee, 300);
        assert.equal(r.remainder, 2700);
    });

    await mongoose.disconnect();
    await replSet.stop();

    console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
});
