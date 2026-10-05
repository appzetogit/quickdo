/**
 * Service-provider customers who paid up front get their money back when the
 * booking is cancelled or nobody accepts it.
 *
 * Run: node tests/sp-refunds.smoke.mjs
 *
 * Two refund paths, both silently refunding nothing:
 *
 *  - Search timeout (bookingScheduler): checked paymentStatus === 'SUCCESS' while
 *    the stored value is 'success', so no timed-out prepaid booking was ever
 *    refunded. Had it matched, it would have thrown after crediting (enum value
 *    'REFUNDED'), leaving the booking refundable again on the next tick.
 *  - User cancel: the method list omitted 'online', which is what a Razorpay
 *    payment stores, so those customers were never refunded.
 *
 * Drives the real bookingExpiry service and the real cancelBooking controller on a
 * replica set.
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

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'sp_refunds' });

    const Booking = require('../src/modules/serviceProvider/models/Booking.js');
    const User = require('../src/modules/serviceProvider/models/User.js');
    const Transaction = require('../src/modules/serviceProvider/models/Transaction.js');
    const { expireTimedOutBooking } = require('../src/modules/serviceProvider/services/bookingExpiry.js');
    const { PREPAID_PAYMENT_METHODS } = require('../src/modules/serviceProvider/utils/constants.js');
    for (const M of [Booking, User, Transaction]) await M.createCollection().catch(() => {});

    const oid = () => new mongoose.Types.ObjectId();
    let seq = 9600000000;
    const user = async (balance = 0) => {
        const _id = oid();
        await User.collection.insertOne({ _id, name: 'U', email: `u${seq}@t.test`, phone: String(seq++), wallet: { balance, penalty: 0 } });
        return _id;
    };
    const booking = async (userId, over = {}) => {
        const _id = oid();
        await Booking.collection.insertOne({
            _id, userId, bookingNumber: `BK${seq++}`, status: 'searching', vendorId: null, workerId: null,
            paymentStatus: 'success', paymentMethod: 'online', finalAmount: 750, createdAt: new Date(), ...over,
        });
        return _id;
    };
    const balance = async (id) => (await User.findById(id).lean()).wallet.balance;
    const statusOf = async (id) => Booking.findById(id).lean();

    await check('precondition: what verifyPaymentWebhook stores is a prepaid method', async () => {
        assert.ok(PREPAID_PAYMENT_METHODS.includes('online'));
    });

    console.log('\nsearch timeout');
    await check('a booking paid online is cancelled AND refunded to the wallet', async () => {
        const u = await user(100);
        const b = await booking(u);
        const r = await expireTimedOutBooking(b);
        assert.deepEqual(r, { cancelled: true, refundAmount: 750 });
        assert.equal(await balance(u), 850);
        const doc = await statusOf(b);
        assert.equal(doc.status, 'no_vendors');
        assert.equal(doc.paymentStatus, 'refunded');
        assert.equal(doc.refundedAmount, 750);
        const row = await Transaction.findOne({ bookingId: b, type: 'refund' }).lean();
        assert.equal(row.amount, 750);
        assert.equal(row.balanceBefore, 100);
        assert.equal(row.balanceAfter, 850);
    });
    await check('wallet-paid bookings are refunded too', async () => {
        const u = await user(0);
        const b = await booking(u, { paymentMethod: 'wallet', finalAmount: 300 });
        await expireTimedOutBooking(b);
        assert.equal(await balance(u), 300);
    });
    await check('an unpaid or cash booking is cancelled with no refund', async () => {
        const u = await user(0);
        const unpaid = await booking(u, { paymentStatus: 'pending' });
        const cash = await booking(u, { paymentMethod: 'cash', paymentStatus: 'pending' });
        assert.deepEqual(await expireTimedOutBooking(unpaid), { cancelled: true, refundAmount: 0 });
        assert.deepEqual(await expireTimedOutBooking(cash), { cancelled: true, refundAmount: 0 });
        assert.equal(await balance(u), 0);
        assert.equal(await Transaction.countDocuments({ userId: u }), 0);
    });
    await check('every scheduler tick and instance firing at once refunds exactly once', async () => {
        const u = await user(0);
        const b = await booking(u);
        const outs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => expireTimedOutBooking(b)));
        assert.equal(outs.filter((o) => o.cancelled).length, 1);
        assert.equal(await balance(u), 750);
        assert.equal(await Transaction.countDocuments({ bookingId: b, type: 'refund' }), 1);
    });
    await check('a booking a partner already accepted is left alone', async () => {
        const u = await user(0);
        const b = await booking(u, { vendorId: oid(), status: 'confirmed' });
        assert.equal((await expireTimedOutBooking(b)).cancelled, false);
        assert.equal((await statusOf(b)).status, 'confirmed');
        assert.equal(await balance(u), 0);
    });
    await check('no user to refund: nothing is cancelled, so the paid booking stays visible', async () => {
        const b = await booking(oid());
        const r = await expireTimedOutBooking(b);
        assert.equal(r.cancelled, false);
        const doc = await statusOf(b);
        assert.equal(doc.status, 'searching');
        assert.equal(doc.paymentStatus, 'success');
    });

    console.log('\nbackfilling refunds missed before the fix');
    const { classifyMissedRefund, refundMissedBooking } = require('../src/modules/serviceProvider/services/bookingExpiry.js');
    await check('owed in full: timed out, or user-cancelled before the journey', async () => {
        assert.deepEqual(classifyMissedRefund({ status: 'no_vendors', paymentStatus: 'success', paymentMethod: 'online', finalAmount: 500 }), { action: 'refund', amount: 500 });
        assert.deepEqual(classifyMissedRefund({ status: 'cancelled', cancelledBy: 'user', paymentStatus: 'success', paymentMethod: 'online', finalAmount: 500 }), { action: 'refund', amount: 500 });
    });
    await check('a fee case, a vendor/admin cancel, or an existing refund row goes to review, never auto-paid', async () => {
        const base = { status: 'cancelled', paymentStatus: 'success', paymentMethod: 'online', finalAmount: 500 };
        assert.equal(classifyMissedRefund({ ...base, cancelledBy: 'user', journeyStartedAt: new Date() }).action, 'review');
        assert.equal(classifyMissedRefund({ ...base, cancelledBy: 'vendor' }).action, 'review');
        assert.equal(classifyMissedRefund({ ...base, cancelledBy: 'user' }, { hasRefundRow: true }).action, 'review');
    });
    await check('refunded, unpaid, cash or live bookings are skipped', async () => {
        const base = { status: 'no_vendors', paymentStatus: 'success', paymentMethod: 'online', finalAmount: 500 };
        assert.equal(classifyMissedRefund({ ...base, paymentStatus: 'refunded' }).action, 'skip');
        assert.equal(classifyMissedRefund({ ...base, paymentMethod: 'cash' }).action, 'skip');
        assert.equal(classifyMissedRefund({ ...base, status: 'confirmed' }).action, 'skip');
    });
    await check('a stuck timed-out booking is refunded once, however often the backfill runs', async () => {
        const u = await user(10);
        const b = await booking(u, { status: 'no_vendors', cancelledBy: 'system' });
        const runs = await Promise.all([1, 2, 3].map(() => refundMissedBooking(b)));
        assert.equal(runs.filter((r) => r.refunded).length, 1);
        assert.equal(await balance(u), 760);
        assert.equal((await statusOf(b)).paymentStatus, 'refunded');
        assert.equal((await refundMissedBooking(b)).refunded, false);
        assert.equal(await balance(u), 760);
    });
    await check('a review case is never paid by the backfill', async () => {
        const u = await user(0);
        const b = await booking(u, { status: 'cancelled', cancelledBy: 'user', journeyStartedAt: new Date() });
        const r = await refundMissedBooking(b);
        assert.equal(r.refunded, false);
        assert.equal(r.action, 'review');
        assert.equal(await balance(u), 0);
    });

    console.log('\nuser cancels');
    // Loaded after the models: the controller pulls in notification/socket helpers
    // that must not fail the test, and they are fired only after commit.
    const { cancelBooking } = require('../src/modules/serviceProvider/controllers/bookingControllers/userBookingController.js');
    const cancel = async (userId, id) => {
        const res = {
            statusCode: 200, body: null,
            status(c) { this.statusCode = c; return this; },
            json(p) { this.body = p; return this; },
        };
        await cancelBooking({ params: { id: String(id) }, body: { cancellationReason: 'changed plans' }, user: { id: String(userId) } }, res);
        return res;
    };
    await check('a booking paid online and cancelled before the journey is refunded in full', async () => {
        const u = await user(0);
        const b = await booking(u);
        const r = await cancel(u, b);
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.equal(await balance(u), 750);
        const doc = await statusOf(b);
        assert.equal(doc.status, 'cancelled');
        assert.equal(doc.paymentStatus, 'refunded');
    });
    await check('cancelling it again refunds nothing more', async () => {
        const u = await user(0);
        const b = await booking(u);
        await cancel(u, b);
        const again = await cancel(u, b);
        assert.equal(again.statusCode, 400);
        assert.equal(await balance(u), 750);
    });

    console.log('\nadmin refund (processRefund)');
    // Stub the gateway BEFORE the controller loads: it destructures refundPayment.
    const razorpay = require('../src/modules/serviceProvider/services/razorpayService.js');
    const gatewayCalls = [];
    razorpay.refundPayment = async (paymentId, amount) => {
        gatewayCalls.push({ paymentId, amount });
        return { success: true, refund: { id: `rfnd_${gatewayCalls.length}` } };
    };
    const payment = require('../src/modules/serviceProvider/controllers/paymentControllers/paymentController.js');
    const refund = async (body) => {
        const res = {
            statusCode: 200, body: null,
            status(c) { this.statusCode = c; return this; },
            json(p) { this.body = p; return this; },
        };
        await payment.processRefund({ body, params: {}, query: {}, user: { id: String(oid()) } }, res);
        return res;
    };
    await check('a wallet refund credits the wallet AND writes a refund row', async () => {
        const u = await user(40);
        const b = await booking(u, { status: 'cancelled', paymentMethod: 'wallet', finalAmount: 500 });
        const r = await refund({ bookingId: String(b) });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.equal(await balance(u), 540);
        const row = await Transaction.findOne({ bookingId: b, type: 'refund' }).lean();
        assert.equal(row.amount, 500);
        assert.equal(row.balanceBefore, 40);
        assert.equal(row.balanceAfter, 540);
    });
    await check('a missing customer refunds nothing and leaves the booking refundable', async () => {
        const b = await booking(oid(), { status: 'cancelled', paymentMethod: 'wallet', finalAmount: 500 });
        const r = await refund({ bookingId: String(b) });
        assert.equal(r.statusCode, 404);
        assert.equal((await statusOf(b)).paymentStatus, 'success');
        assert.equal(await Transaction.countDocuments({ bookingId: b }), 0);
    });
    await check("a booking paid 'online' can be refunded to the original method, and it is recorded", async () => {
        const u = await user(0);
        const b = await booking(u, { status: 'cancelled', paymentMethod: 'online', razorpayPaymentId: 'pay_abc', finalAmount: 700 });
        const r = await refund({ bookingId: String(b), amount: 300 });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.deepEqual(gatewayCalls.at(-1), { paymentId: 'pay_abc', amount: 300 });
        assert.equal(await balance(u), 0, 'went to the card, not the wallet');
        const row = await Transaction.findOne({ bookingId: b, type: 'refund' }).lean();
        assert.equal(row.paymentMethod, 'razorpay');
        assert.equal(row.referenceId, `rfnd_${gatewayCalls.length}`);
        assert.equal(row.metadata.movesWallet, false);
    });

    await mongoose.disconnect();
    await replSet.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
