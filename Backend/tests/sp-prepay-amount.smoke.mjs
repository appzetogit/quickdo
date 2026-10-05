/**
 * A service-provider booking is only marked paid for the amount it costs, and a
 * refund never returns more than was paid.
 *
 * Run: node tests/sp-prepay-amount.smoke.mjs
 *
 * createBooking takes prices from the client, so a booking can be created at Rs 1.
 * That alone is a pricing problem (open, see the report). What turned it into money
 * leaving the platform were two follow-on paths, closed here:
 *
 *  - Pay an OLD order after the bill. razorpayOrderId is never cleared, and
 *    verifyPaymentWebhook checked only the signature: a Rs 1 order created at
 *    checkout, paid after a Rs 2000 bill, marked the booking paid and credited the
 *    partner the full bill.
 *  - Refund the BILL. finalAmount is overwritten with the bill total, and every
 *    refund path refunded finalAmount: pay Rs 1, get billed Rs 2000, cancel, receive
 *    Rs 2000 in the wallet.
 *
 * Razorpay is stubbed at the service boundary; everything else is the real code on
 * a replica set.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const require = createRequire(import.meta.url);

// Credentials present, so confirmGatewayPayment does NOT take its dev mock path.
process.env.RAZORPAY_KEY_ID = 'rzp_test_stub';
process.env.RAZORPAY_KEY_SECRET = 'stub_secret';

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
    await mongoose.connect(replSet.getUri(), { dbName: 'sp_prepay' });

    // Gateway stubs, installed before anything destructures them.
    const razorpay = require('../src/modules/serviceProvider/services/razorpayService.js');
    const captured = new Map(); // paymentId -> { orderId, paise }
    razorpay.verifyPayment = () => true;
    razorpay.getPaymentDetails = async (paymentId) => {
        const p = captured.get(paymentId);
        return p ? { success: true, payment: { id: paymentId, order_id: p.orderId, status: 'captured', amount: p.paise } } : { success: false };
    };
    razorpay.getOrderDetails = async (orderId) => ({ success: true, order: { id: orderId, notes: {} } });

    const Booking = require('../src/modules/serviceProvider/models/Booking.js');
    const User = require('../src/modules/serviceProvider/models/User.js');
    const Vendor = require('../src/modules/serviceProvider/models/Vendor.js');
    const VendorBill = require('../src/modules/serviceProvider/models/VendorBill.js');
    const Transaction = require('../src/modules/serviceProvider/models/Transaction.js');
    for (const M of [Booking, User, Vendor, VendorBill, Transaction]) await M.createCollection().catch(() => {});

    const payment = require('../src/modules/serviceProvider/controllers/paymentControllers/paymentController.js');
    const { cancelBooking } = require('../src/modules/serviceProvider/controllers/bookingControllers/userBookingController.js');
    const { expireTimedOutBooking } = require('../src/modules/serviceProvider/services/bookingExpiry.js');

    const oid = () => new mongoose.Types.ObjectId();
    let seq = 9910000000;
    const call = async (handler, req) => {
        const res = {
            statusCode: 200, body: null,
            status(c) { this.statusCode = c; return this; },
            json(p) { this.body = p; return this; },
        };
        // app.get('io') is read after commit to emit sockets; none in a test.
        await handler({ params: {}, query: {}, app: { get: () => null }, ...req }, res);
        return res;
    };
    const user = async (balance = 0) => {
        const _id = oid();
        await User.collection.insertOne({ _id, name: 'U', email: `pp${seq}@t.test`, phone: String(seq++), wallet: { balance, penalty: 0 } });
        return _id;
    };
    const vendor = async () => {
        const _id = oid();
        await Vendor.collection.insertOne({ _id, name: 'V', businessName: 'B', email: `pv${seq}@t.test`, phone: String(seq++), wallet: { earnings: 0, dues: 0 } });
        return _id;
    };
    const booking = async (over) => {
        const _id = oid();
        await Booking.collection.insertOne({
            _id, bookingNumber: `BK${seq++}`, bookingModel: 'vendor', paymentStatus: 'pending',
            // Required by the schema, so the controllers' own .save() calls validate.
            serviceId: oid(), serviceName: 'AC repair', serviceCategory: 'Appliance', basePrice: 500, scheduledDate: new Date(), scheduledTime: '10:00',
            address: { addressLine1: '1 St', city: 'Pune', state: 'MH', pincode: '411001' },
            timeSlot: { start: '10:00', end: '11:00' },
            ...over,
        });
        return _id;
    };
    const verify = (orderId, paymentId) => call(payment.verifyPaymentWebhook, {
        body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: 'sig' },
    });
    const earningsOf = async (id) => (await Vendor.findById(id).lean()).wallet.earnings;
    const balanceOf = async (id) => (await User.findById(id).lean()).wallet.balance;

    console.log('\npaying an old order after the bill');
    await check('a Rs 1 order paid after a Rs 2000 bill is NOT marked paid and credits no one', async () => {
        const u = await user();
        const v = await vendor();
        // Order created at checkout for Rs 1; the bill has since raised finalAmount.
        const b = await booking({ userId: u, vendorId: v, status: 'work_done', finalAmount: 2000, razorpayOrderId: 'order_old' });
        await VendorBill.collection.insertOne({ _id: oid(), bookingId: b, vendorId: v, grandTotal: 2000, vendorTotalEarning: 1600, status: 'generated' });
        captured.set('pay_old', { orderId: 'order_old', paise: 100 });

        const r = await verify('order_old', 'pay_old');
        assert.equal(r.statusCode, 409, JSON.stringify(r.body));
        const doc = await Booking.findById(b).lean();
        assert.equal(doc.paymentStatus, 'pending');
        assert.equal(await earningsOf(v), 0, 'partner not credited the bill for a Rs 1 payment');
        assert.equal(await Transaction.countDocuments({ bookingId: b }), 0);
    });

    await check('the same booking paid the real Rs 2000 goes through, credits the partner, records paidAmount', async () => {
        const u = await user();
        const v = await vendor();
        const b = await booking({ userId: u, vendorId: v, status: 'work_done', finalAmount: 2000, razorpayOrderId: 'order_real' });
        await VendorBill.collection.insertOne({ _id: oid(), bookingId: b, vendorId: v, grandTotal: 2000, vendorTotalEarning: 1600, status: 'generated' });
        captured.set('pay_real', { orderId: 'order_real', paise: 200000 });

        const r = await verify('order_real', 'pay_real');
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        const doc = await Booking.findById(b).lean();
        assert.equal(doc.paymentStatus, 'success');
        assert.equal(doc.paidAmount, 2000);
        assert.equal(await earningsOf(v), 1600);
    });

    await check('a replayed verify is still answered as already processed, not as a mismatch', async () => {
        const r = await verify('order_real', 'pay_real');
        assert.equal(r.statusCode, 200);
        assert.equal(r.body.data.alreadyProcessed, true);
    });

    await check('a payment that belongs to a different order is refused', async () => {
        const u = await user();
        await booking({ userId: u, status: 'searching', finalAmount: 500, razorpayOrderId: 'order_x' });
        captured.set('pay_elsewhere', { orderId: 'order_y', paise: 50000 });
        const r = await verify('order_x', 'pay_elsewhere');
        assert.equal(r.statusCode, 400);
    });

    console.log('\nrefunds are capped at what was paid');
    const prepaidThenBilled = async () => {
        const u = await user(0);
        const b = await booking({ userId: u, status: 'searching', finalAmount: 1, razorpayOrderId: `order_${seq}` });
        const orderId = `order_${seq - 1}`;
        await Booking.updateOne({ _id: b }, { $set: { razorpayOrderId: orderId } });
        captured.set(`pay_${orderId}`, { orderId, paise: 100 });
        const r = await verify(orderId, `pay_${orderId}`);
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        // The job is then billed: finalAmount becomes the bill total.
        await Booking.updateOne({ _id: b }, { $set: { finalAmount: 2000, status: 'confirmed' } });
        return { u, b };
    };

    await check('cancel after the bill: refunds the Rs 1 paid, not the Rs 2000 bill', async () => {
        const { u, b } = await prepaidThenBilled();
        const r = await call(cancelBooking, { params: { id: String(b) }, body: {}, user: { id: String(u) } });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.equal(await balanceOf(u), 1);
        assert.equal((await Booking.findById(b).lean()).refundedAmount, 1);
    });

    await check('admin refund cannot exceed what was paid either', async () => {
        const { b } = await prepaidThenBilled();
        const r = await call(payment.processRefund, { body: { bookingId: String(b), amount: 2000 }, user: { id: String(oid()) } });
        assert.equal(r.statusCode, 400, JSON.stringify(r.body));
    });

    await check('timeout refund is capped too', async () => {
        const u = await user(0);
        const b = await booking({ userId: u, status: 'searching', vendorId: null, workerId: null, paymentStatus: 'success', paymentMethod: 'online', paidAmount: 1, finalAmount: 2000 });
        const out = await expireTimedOutBooking(b);
        assert.equal(out.refundAmount, 1);
        assert.equal(await balanceOf(u), 1);
    });

    await check('a wallet payment records what it debited as paidAmount', async () => {
        const u = await user(800);
        const b = await booking({ userId: u, status: 'searching', finalAmount: 650 });
        const r = await call(payment.processWalletPayment, { body: { bookingId: String(b) }, user: { id: String(u) } });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        const doc = await Booking.findById(b).lean();
        assert.equal(doc.paidAmount, 650);
        assert.equal(await balanceOf(u), 150);
    });

    await mongoose.disconnect();
    await replSet.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
