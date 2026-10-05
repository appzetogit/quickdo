/**
 * Service-provider dues settlement and withdrawal rejection, through the real
 * admin controller, against a real replica set.
 *
 * Run: node tests/sp-settlement.smoke.mjs
 *
 * Found while mapping SP wallet writes for the master ledger:
 *
 *  - approveSettlement ended on `vendor.wallet.dues` with `vendor` undefined, so
 *    EVERY approval reduced dues, saved, and then answered 500 -- the admin panel
 *    reported failure for approvals that had gone through.
 *  - It checked 'pending' by reading, so two approvals at once both reduced dues.
 *  - It wrote dues as an absolute value from that read, losing any concurrent $inc.
 *  - No transaction row was written for the movement.
 *  - rejectWithdrawal had no status check: an approved, already-paid withdrawal
 *    could be flipped to 'rejected'. rejectSettlement could overwrite 'approved'.
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

const call = async (handler, { params = {}, body = {}, userId } = {}) => {
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
    await handler({ params, body, query: {}, user: { id: userId || String(new mongoose.Types.ObjectId()) } }, res);
    return res;
};

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'sp_settlement' });

    // Emails are fire-and-forget after commit; stub so the test sends nothing.
    const email = require('../src/modules/serviceProvider/services/emailService.js');
    email.sendDuesPaymentApprovedEmail = async () => {};

    const Vendor = require('../src/modules/serviceProvider/models/Vendor.js');
    const Worker = require('../src/modules/serviceProvider/models/Worker.js');
    const Settlement = require('../src/modules/serviceProvider/models/Settlement.js');
    const Withdrawal = require('../src/modules/serviceProvider/models/Withdrawal.js');
    const Transaction = require('../src/modules/serviceProvider/models/Transaction.js');
    const ctl = require('../src/modules/serviceProvider/controllers/adminControllers/settlementController.js');

    for (const M of [Vendor, Worker, Settlement, Withdrawal, Transaction]) {
        await M.createCollection().catch(() => {});
    }

    const oid = () => new mongoose.Types.ObjectId();
    let phone = 9500000000;
    const vendor = async (wallet) => {
        const _id = oid();
        await Vendor.collection.insertOne({ _id, name: 'V', businessName: 'B', email: `v${phone}@t.test`, phone: String(phone++), wallet: { cashLimit: 10000, ...wallet } });
        return _id;
    };
    const settlementFor = async (field, id, amount, over = {}) => {
        const _id = oid();
        await Settlement.collection.insertOne({ _id, [field]: id, amount, status: 'pending', paymentMethod: 'upi', paymentReference: 'UTR123', ...over });
        return _id;
    };
    const wallet = async (Model, id) => (await Model.findById(id).lean()).wallet;

    console.log('\napproving a vendor settlement');
    const v1 = await vendor({ dues: 5000, isBlocked: true, blockedAt: new Date(), blockReason: 'dues' });
    const s1 = await settlementFor('vendorId', v1, 3000);
    let res;
    await check('answers 200, not 500 -- the success is reported as a success', async () => {
        res = await call(ctl.approveSettlement, { params: { settlementId: String(s1) } });
        assert.equal(res.statusCode, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.newDues, 2000);
    });
    await check('dues go down by the amount, totalSettled goes up, and the block is lifted', async () => {
        const w = await wallet(Vendor, v1);
        assert.equal(w.dues, 2000);
        assert.equal(w.totalSettled, 3000);
        assert.equal(w.isBlocked, false);
        assert.equal(w.blockedAt, null);
    });
    await check('a settlement transaction row records the movement with before and after', async () => {
        const rows = await Transaction.find({ vendorId: v1, type: 'settlement' }).lean();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].amount, 3000);
        assert.equal(rows[0].balanceBefore, 5000);
        assert.equal(rows[0].balanceAfter, 2000);
        assert.equal(rows[0].referenceId, 'UTR123');
        assert.equal((await Settlement.findById(s1).lean()).balanceAfter, 2000);
    });
    await check('approving it again is refused and changes nothing', async () => {
        const again = await call(ctl.approveSettlement, { params: { settlementId: String(s1) } });
        assert.equal(again.statusCode, 400);
        assert.equal((await wallet(Vendor, v1)).dues, 2000);
    });

    console.log('\nfive approvals of one settlement at once');
    const v2 = await vendor({ dues: 5000 });
    const s2 = await settlementFor('vendorId', v2, 1000);
    await check('exactly one succeeds and dues fall by 1000 once', async () => {
        const all = await Promise.all([1, 2, 3, 4, 5].map(() => call(ctl.approveSettlement, { params: { settlementId: String(s2) } })));
        assert.equal(all.filter((r) => r.statusCode === 200).length, 1, all.map((r) => r.statusCode).join(','));
        assert.equal((await wallet(Vendor, v2)).dues, 4000);
        assert.equal(await Transaction.countDocuments({ vendorId: v2, type: 'settlement' }), 1);
    });

    console.log('\nconcurrent cash collection');
    const v3 = await vendor({ dues: 5000 });
    const s3 = await settlementFor('vendorId', v3, 1000);
    await check('a dues $inc racing the approval is not overwritten', async () => {
        await Promise.all([
            call(ctl.approveSettlement, { params: { settlementId: String(s3) } }),
            Vendor.updateOne({ _id: v3 }, { $inc: { 'wallet.dues': 700 } }),
        ]);
        assert.equal((await wallet(Vendor, v3)).dues, 4700);
    });

    console.log('\nedges');
    await check('dues never go below zero; the row records what was actually applied', async () => {
        const v = await vendor({ dues: 400 });
        const s = await settlementFor('vendorId', v, 1000);
        const r = await call(ctl.approveSettlement, { params: { settlementId: String(s) } });
        assert.equal(r.statusCode, 200);
        assert.equal((await wallet(Vendor, v)).dues, 0);
        const row = await Transaction.findOne({ vendorId: v, type: 'settlement' }).lean();
        assert.equal(row.metadata.appliedToDues, 400);
    });
    await check('a worker settlement reduces worker dues', async () => {
        const w = oid();
        await Worker.collection.insertOne({ _id: w, name: 'W', email: `w${phone}@t.test`, phone: String(phone++), wallet: { dues: 900, balance: 50 } });
        const s = await settlementFor('workerId', w, 600);
        const r = await call(ctl.approveSettlement, { params: { settlementId: String(s) } });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        const ww = await wallet(Worker, w);
        assert.equal(ww.dues, 300);
        assert.equal(ww.balance, 50, 'balance untouched');
        assert.equal(await Transaction.countDocuments({ workerId: w, type: 'settlement' }), 1);
    });
    await check('an unknown settlement is 404', async () => {
        const r = await call(ctl.approveSettlement, { params: { settlementId: String(oid()) } });
        assert.equal(r.statusCode, 404);
    });

    console.log('\nrejections');
    await check('an approved settlement cannot be rejected afterwards', async () => {
        const r = await call(ctl.rejectSettlement, { params: { settlementId: String(s1) }, body: { rejectionReason: 'no' } });
        assert.equal(r.statusCode, 400);
        assert.equal((await Settlement.findById(s1).lean()).status, 'approved');
    });
    await check('a pending settlement can be rejected, and dues are untouched', async () => {
        const v = await vendor({ dues: 800 });
        const s = await settlementFor('vendorId', v, 300);
        const r = await call(ctl.rejectSettlement, { params: { settlementId: String(s) }, body: { rejectionReason: 'no proof' } });
        assert.equal(r.statusCode, 200);
        assert.equal((await Settlement.findById(s).lean()).status, 'rejected');
        assert.equal((await wallet(Vendor, v)).dues, 800);
    });
    await check('an approved, paid withdrawal cannot be flipped to rejected', async () => {
        const v = await vendor({ earnings: 2000 });
        const w = oid();
        await Withdrawal.collection.insertOne({ _id: w, vendorId: v, amount: 500, status: 'pending' });
        const approved = await call(ctl.approveWithdrawal, { params: { withdrawalId: String(w) }, body: { transactionReference: 'T1' } });
        assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
        const r = await call(ctl.rejectWithdrawal, { params: { withdrawalId: String(w) }, body: { reason: 'oops' } });
        assert.equal(r.statusCode, 400);
        assert.equal((await Withdrawal.findById(w).lean()).status, 'approved');
    });
    await check('a pending withdrawal can still be rejected', async () => {
        const v = await vendor({ earnings: 2000 });
        const w = oid();
        await Withdrawal.collection.insertOne({ _id: w, vendorId: v, amount: 500, status: 'pending' });
        const r = await call(ctl.rejectWithdrawal, { params: { withdrawalId: String(w) }, body: { reason: 'bank details' } });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.equal((await Withdrawal.findById(w).lean()).status, 'rejected');
    });

    await mongoose.disconnect();
    await replSet.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
