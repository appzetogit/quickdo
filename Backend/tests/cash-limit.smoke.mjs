/**
 * One cash limit, managed in Platform settings, for riders and service providers.
 *
 * Run: node tests/cash-limit.smoke.mjs
 *
 * Before: riders (taxi, food, quick commerce) were limited by the food admin's
 * delivery cash limit; service providers by a per-vendor field that SP's own
 * screen pushed onto every vendor. Two unrelated numbers with no shared control.
 *
 * Now both read `finance.cashLimit` from core/config (partner > zone > vertical >
 * global). An administered value wins; with none, each partner keeps today's
 * figure -- so deploying changes nothing. Checked here on a replica set:
 *
 *   riders   today's food figure until set; global applies to all three
 *            verticals at once; a per-rider override wins; a vertical value does
 *            NOT touch riders (their limit spans verticals); enforcement can be
 *            switched off; riderFinance actually blocks on the resolved figure
 *   SP       the vendor's own field until set; the serviceProvider vertical value
 *            and a partner override apply; SP's own settings screen and per-vendor
 *            edit write through to Platform settings; vendor search filters on it
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

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'cash_limit' });

    const config = await import('../src/core/config/resolver.service.js');
    const { PlatformSetting } = await import('../src/core/config/setting.model.js');
    const { resolveSharedCashLimit, getRiderFinance } = await import('../src/core/finance/riderFinance.service.js');
    const setLimit = (level, scopeId, value) => config.set('finance.cashLimit', { level, scopeId, value, updatedBy: 'test', reason: 'test' });
    const clearAll = async () => { await PlatformSetting.deleteMany({}); config.invalidateCache(); };

    // Today's rider limit lives in the food admin setting.
    await mongoose.connection.db.collection('food_delivery_cash_limits')
        .insertOne({ isActive: true, deliveryCashLimit: 1500, deliveryWithdrawalLimit: 100, createdAt: new Date() });

    console.log('\nriders (taxi + food + quick commerce)');
    const riderId = oid();
    await check('with nothing set in Platform settings, the food admin figure still applies', async () => {
        const r = await resolveSharedCashLimit({ partnerId: String(riderId) });
        assert.equal(r.cashLimit, 1500);
        assert.match(r.cashLimitSource, /Existing setting/);
    });
    await check('a global value applies to every rider', async () => {
        await setLimit('global', '*', 3000);
        assert.equal((await resolveSharedCashLimit({ partnerId: String(riderId) })).cashLimit, 3000);
        assert.equal((await resolveSharedCashLimit({ partnerId: String(oid()) })).cashLimit, 3000);
    });
    await check('a per-rider override wins over global', async () => {
        await setLimit('partner', String(riderId), 500);
        const r = await resolveSharedCashLimit({ partnerId: String(riderId) });
        assert.equal(r.cashLimit, 500);
        assert.equal(r.cashLimitSource, 'Partner override');
        assert.equal((await resolveSharedCashLimit({ partnerId: String(oid()) })).cashLimit, 3000, 'others unaffected');
    });
    await check('a vertical value does not change a rider\'s cross-vertical limit', async () => {
        await setLimit('vertical', 'food', 99);
        assert.equal((await resolveSharedCashLimit({ partnerId: String(oid()) })).cashLimit, 3000);
    });
    await check('switching enforcement off keeps the figure visible but stops it blocking', async () => {
        await config.set('finance.enforceCashLimit', { level: 'global', scopeId: '*', value: false, updatedBy: 'test' });
        const r = await resolveSharedCashLimit({ partnerId: String(oid()) });
        assert.equal(r.cashLimit, 0);
        assert.equal(r.configuredCashLimit, 3000);
        await config.set('finance.enforceCashLimit', { level: 'global', scopeId: '*', value: null, updatedBy: 'test' });
    });
    await check('riderFinance blocks on the resolved per-rider figure', async () => {
        const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
        // Rs 450 of taxi cash owed (-450 signed): above taxi's -500 minimum balance, so the
        // cash limit is the rule under test -- over a 400 per-rider limit, under the global 3000.
        await setLimit('partner', String(riderId), 400);
        // Pin taxi's minimum-balance rule to -1000 so it cannot fire first.
        const { AdminAppSetting } = await import('../src/modules/taxi/admin/models/AdminAppSetting.js');
        await AdminAppSetting.collection.updateOne({ scope: 'default' }, { $set: { 'wallet_setting.driver_wallet_minimum_amount_to_get_an_order': -1000 } }, { upsert: true });
        await Driver.collection.insertOne({ _id: riderId, name: 'R', phone: '+919700000001', wallet: { balance: -450, isBlocked: false } });
        const f = await getRiderFinance(riderId);
        assert.equal(f.cashLimit, 400);
        assert.equal(f.cashInHand, 450);
        assert.equal(f.isBlocked, true);
        assert.equal(f.blockReason, 'cash_limit_reached');
        await setLimit('partner', String(riderId), null);
        const g = await getRiderFinance(riderId);
        assert.equal(g.cashLimit, 3000);
        assert.notEqual(g.blockReason, 'cash_limit_reached');
    });

    console.log('\nservice providers');
    await clearAll();
    const Vendor = require('../src/modules/serviceProvider/models/Vendor.js');
    const { effectiveCashLimit } = require('../src/modules/serviceProvider/utils/cashLimit.js');
    const settlement = require('../src/modules/serviceProvider/controllers/adminControllers/settlementController.js');
    const settings = require('../src/modules/serviceProvider/controllers/adminControllers/settingsController.js');
    const { findVendorsByCity } = require('../src/modules/serviceProvider/services/locationService.js');
    let seq = 9730000000;
    const vendor = async (wallet) => {
        const _id = oid();
        await Vendor.collection.insertOne({ _id, name: 'V', businessName: 'B', email: `cl${seq}@t.test`, phone: String(seq++),
            approvalStatus: 'approved', isActive: true, address: { city: 'Pune' }, service: ['Plumbing'], wallet,
            // KYC the schema requires, so the controllers' own vendor.save() validates.
            pan: { number: 'ABCDE1234F', document: 'pan.jpg' }, aadhar: { number: '123412341234', document: 'a.jpg', backDocument: 'b.jpg' } });
        return _id;
    };
    const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

    const v1 = await vendor({ dues: 5000, earnings: 0, cashLimit: 10000 });
    await check('with nothing set, a vendor keeps its own limit', async () => {
        const r = await effectiveCashLimit(await Vendor.findById(v1).lean());
        assert.equal(r.limit, 10000);
    });
    await check('the global value now reaches service providers too', async () => {
        await setLimit('global', '*', 4000);
        assert.equal((await effectiveCashLimit(await Vendor.findById(v1).lean())).limit, 4000);
    });
    await check('a serviceProvider vertical value wins over global for SP only', async () => {
        await setLimit('vertical', 'serviceProvider', 6000);
        assert.equal((await effectiveCashLimit(await Vendor.findById(v1).lean())).limit, 6000);
        assert.equal((await resolveSharedCashLimit({ partnerId: String(oid()) })).cashLimit, 4000, 'riders still on global');
    });
    await check('SP\'s own settings screen writes its vendor limit through as the SP vertical value', async () => {
        const r = res();
        await settings.updateSettings({ body: { vendorCashLimit: 7000 }, user: { id: String(oid()) } }, r, (e) => { throw e; });
        const row = await PlatformSetting.findOne({ key: 'finance.cashLimit', level: 'vertical', scopeId: 'serviceProvider' }).lean();
        assert.equal(row.value, 7000);
        assert.equal((await effectiveCashLimit(await Vendor.findById(v1).lean())).limit, 7000);
    });
    await check('the per-vendor edit writes a partner override, which wins', async () => {
        const r = res();
        await settlement.updateCashLimit({ params: { vendorId: String(v1) }, body: { limit: 2500 }, user: { id: String(oid()) } }, r);
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        const eff = await effectiveCashLimit(await Vendor.findById(v1).lean());
        assert.equal(eff.limit, 2500);
        assert.equal(eff.source, 'Partner override');
    });
    await check('vendor search drops a vendor whose dues exceed the effective limit, and never returns the wallet', async () => {
        const v2 = await vendor({ dues: 100, earnings: 0, cashLimit: 10000 });
        const found = await findVendorsByCity('Pune', { checkCashLimit: true });
        const ids = found.map((v) => String(v._id));
        assert.ok(!ids.includes(String(v1)), 'v1 owes 5000 against 2500');
        assert.ok(ids.includes(String(v2)), 'v2 owes 100 against 7000');
        assert.ok(found.every((v) => v.wallet === undefined), 'wallet leaked into search results');
    });
    await check('a configured 0 means no ceiling for SP, not "block everyone"', async () => {
        await setLimit('partner', String(v1), 0);
        assert.ok((await effectiveCashLimit(await Vendor.findById(v1).lean())).limit > 1e12);
    });

    await mongoose.disconnect();
    await replSet.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
