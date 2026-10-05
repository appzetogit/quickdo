/**
 * Service-provider worker payments and the retired cash-collection endpoint,
 * through the real controllers on a replica set.
 *
 * Run: node tests/sp-worker-pay.smoke.mjs
 *
 *  - POST /vendor/wallet/cash-collection credited the bill's full earning while
 *    raising dues only by a client-supplied amount, with no guard, then crashed on
 *    an invalid enum after the money moved. Unused by any client; now 410.
 *  - Vendor pay-worker recorded a payment the vendor made directly, and ALSO
 *    credited the worker's platform-withdrawable balance -- paying them twice. Its
 *    three writes were a Promise.all with no transaction and a read-then-check.
 *  - Admin pay-worker read-modify-saved the balance with no row. Its credit is kept
 *    (what it should mean is an open question), but it is now atomic and recorded.
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
        statusCode: 200, body: null,
        status(c) { this.statusCode = c; return this; },
        json(p) { this.body = p; return this; },
    };
    await handler({ params, body, query: {}, user: { id: String(userId || new mongoose.Types.ObjectId()) } }, res);
    return res;
};

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'sp_worker_pay' });

    const Vendor = require('../src/modules/serviceProvider/models/Vendor.js');
    const Worker = require('../src/modules/serviceProvider/models/Worker.js');
    const Booking = require('../src/modules/serviceProvider/models/Booking.js');
    const Transaction = require('../src/modules/serviceProvider/models/Transaction.js');
    const VendorBill = require('../src/modules/serviceProvider/models/VendorBill.js');
    for (const M of [Vendor, Worker, Booking, Transaction, VendorBill]) await M.createCollection().catch(() => {});

    const vendorWallet = require('../src/modules/serviceProvider/controllers/vendorControllers/vendorWalletController.js');
    const adminWorker = require('../src/modules/serviceProvider/controllers/adminControllers/adminWorkerController.js');

    const oid = () => new mongoose.Types.ObjectId();
    let seq = 9800000000;
    const vendor = async (wallet = {}) => {
        const _id = oid();
        await Vendor.collection.insertOne({ _id, name: 'V', businessName: 'B', email: `v${seq}@t.test`, phone: String(seq++), wallet: { dues: 0, earnings: 0, ...wallet } });
        return _id;
    };
    const worker = async (balance = 0) => {
        const _id = oid();
        await Worker.collection.insertOne({ _id, name: 'W', email: `w${seq}@t.test`, phone: String(seq++), wallet: { balance, earnings: 0, dues: 0 } });
        return _id;
    };
    const booking = async (over) => {
        const _id = oid();
        await Booking.collection.insertOne({ _id, bookingNumber: `BK${seq++}`, status: 'work_done', paymentStatus: 'pending', workerPaymentStatus: 'PENDING', finalAmount: 1000, ...over });
        return _id;
    };
    const wallet = async (Model, id) => (await Model.findById(id).lean()).wallet;

    console.log('\nretired cash-collection endpoint');
    await check('answers 410 and moves no money, however it is called', async () => {
        const v = await vendor({ dues: 0, earnings: 0 });
        const b = await booking({ vendorId: v });
        await VendorBill.collection.insertOne({ _id: oid(), bookingId: b, vendorId: v, vendorTotalEarning: 800, status: 'generated' });
        for (let i = 0; i < 3; i += 1) {
            const r = await call(vendorWallet.recordCashCollection, { userId: v, body: { bookingId: String(b), amount: 1 } });
            assert.equal(r.statusCode, 410);
        }
        const w = await wallet(Vendor, v);
        assert.equal(w.earnings, 0, 'earnings were NOT inflated');
        assert.equal(w.dues, 0);
        assert.equal(await Transaction.countDocuments({ vendorId: v }), 0);
    });

    console.log('\nvendor pays a worker directly');
    await check('the payment is recorded and the booking completed, but the platform balance does not move', async () => {
        const v = await vendor();
        const w = await worker(250);
        const b = await booking({ vendorId: v, workerId: w });
        const r = await call(vendorWallet.payWorker, { userId: v, body: { bookingId: String(b), amount: 600, paymentMethod: 'cash' } });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.equal((await wallet(Worker, w)).balance, 250, 'not withdrawable a second time from the platform');
        const doc = await Booking.findById(b).lean();
        assert.equal(doc.workerPaymentStatus, 'PAID');
        assert.equal(doc.status, 'completed');
        assert.ok(doc.completedAt);
        const row = await Transaction.findOne({ bookingId: b, type: 'worker_payment' }).lean();
        assert.equal(row.amount, 600);
        assert.equal(row.metadata.movesWallet, false);
    });
    await check('a method outside the enum (upi) is recorded as other, not half-written', async () => {
        const v = await vendor();
        const w = await worker(0);
        const b = await booking({ vendorId: v, workerId: w });
        const r = await call(vendorWallet.payWorker, { userId: v, body: { bookingId: String(b), amount: 300, paymentMethod: 'upi' } });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        const row = await Transaction.findOne({ bookingId: b }).lean();
        assert.equal(row.paymentMethod, 'other');
        assert.equal(row.metadata.paymentMethod, 'upi');
    });
    await check('five submits at once record one payment', async () => {
        const v = await vendor();
        const w = await worker(0);
        const b = await booking({ vendorId: v, workerId: w });
        const outs = await Promise.all([1, 2, 3, 4, 5].map(() =>
            call(vendorWallet.payWorker, { userId: v, body: { bookingId: String(b), amount: 400 } })));
        assert.equal(outs.filter((o) => o.statusCode === 200).length, 1, outs.map((o) => o.statusCode).join(','));
        assert.equal(await Transaction.countDocuments({ bookingId: b, type: 'worker_payment' }), 1);
    });
    await check('another vendor cannot record payment on the booking', async () => {
        const v = await vendor();
        const w = await worker(0);
        const b = await booking({ vendorId: v, workerId: w });
        const r = await call(vendorWallet.payWorker, { userId: await vendor(), body: { bookingId: String(b), amount: 400 } });
        assert.equal(r.statusCode, 404);
        assert.equal(await Transaction.countDocuments({ bookingId: b }), 0);
    });

    console.log('\nadmin records a payment');
    await check('credits the balance (existing behaviour) and writes a row with before and after', async () => {
        const w = await worker(100);
        const admin = oid();
        const r = await call(adminWorker.payWorker, { userId: admin, params: { id: String(w) }, body: { amount: 250, reference: 'NEFT9', notes: 'march' } });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.equal(r.body.data.balance, 350);
        const row = await Transaction.findOne({ workerId: w, type: 'worker_payment' }).lean();
        assert.equal(row.balanceBefore, 100);
        assert.equal(row.balanceAfter, 350);
        assert.equal(row.referenceId, 'NEFT9');
        assert.equal(String(row.metadata.adminId), String(admin));
    });
    await check('concurrent credits are all kept, none overwritten', async () => {
        const w = await worker(0);
        await Promise.all([
            ...[1, 2, 3, 4].map(() => call(adminWorker.payWorker, { params: { id: String(w) }, body: { amount: 100 } })),
            Worker.updateOne({ _id: w }, { $inc: { 'wallet.balance': 55 } }),
        ]);
        assert.equal((await wallet(Worker, w)).balance, 455);
        assert.equal(await Transaction.countDocuments({ workerId: w, type: 'worker_payment' }), 4);
    });
    await check('an unknown worker is 404 and writes nothing', async () => {
        const id = oid();
        const r = await call(adminWorker.payWorker, { params: { id: String(id) }, body: { amount: 100 } });
        assert.equal(r.statusCode, 404);
        assert.equal(await Transaction.countDocuments({ workerId: id }), 0);
    });

    await mongoose.disconnect();
    await replSet.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
