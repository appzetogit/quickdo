/**
 * In production, a made-up Razorpay payment cannot mark a ride or a tip paid.
 *
 * Run: node tests/taxi-mock-payment-refused.smoke.mjs
 *
 * Found by the calculation audit, 11 Sep. The ride-completion and tip verify
 * endpoints accepted razorpay_order_id "mock_order_<paise>_x" with the signature
 * "mock_signature_bypass" in production: the amount was read out of the order
 * id and Razorpay was never asked. A cash ride could be marked paid online --
 * the driver credited its fare from the platform -- and a made-up Rs 5000 tip
 * credited the driver Rs 5000.
 *
 * Each case first runs with NODE_ENV=development, where the mock is meant to
 * work. That control proves the setup reaches the payment code, so the
 * production refusal is a real refusal and not a test that fails for some
 * other reason. Runs on a single-node replica set because completion uses a
 * transaction.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let failed = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};
const id = () => new mongoose.Types.ObjectId();
const mockRes = () => ({
    code: 200,
    body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
});

const main = async () => {
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri(), { dbName: 'taxi_mock_payment' });

    const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
    const { User } = await import('../src/modules/taxi/user/models/User.js');
    const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
    const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');
    const controller = await import('../src/modules/taxi/user/controllers/rideController.js');
    // Create every collection and index up front: MongoDB refuses to create one
    // for the first time inside a transaction, and completion runs in one.
    for (const model of Object.values(mongoose.models)) {
        await model.init().catch(() => {});
    }

    const userId = id();
    const driverId = id();
    await User.collection.insertOne({ _id: userId, name: 'Rider', phone: '9999999990', createdAt: new Date() });
    // Every field the driver schema requires, so saving the driver on completion
    // succeeds and the control below exercises the whole payment path.
    await Driver.collection.insertOne({
        _id: driverId, name: 'Driver', phone: '9999999991', password: 'secret123', vehicleType: 'Bike',
        location: { type: 'Point', coordinates: [75.8843673, 22.728214] }, wallet: { balance: 0 }, createdAt: new Date(),
    });

    // A completed online ride of Rs 118, not yet paid for.
    const makeRide = async () => {
        const _id = id();
        await Ride.collection.insertOne({
            _id, userId, driverId, status: 'completed', liveStatus: 'completed', fare: 118, baseFare: 118,
            paymentMethod: 'online', serviceType: 'ride', transport_type: 'taxi',
            pickupLocation: { type: 'Point', coordinates: [75.8843673, 22.728214] },
            dropLocation: { type: 'Point', coordinates: [75.8968202, 22.75521] },
            pickupAddress: 'A', dropAddress: 'B', createdAt: new Date(), updatedAt: new Date(),
        });
        return _id;
    };
    const call = async (fn, rideId, body) => {
        try {
            await fn({ params: { rideId: String(rideId) }, body, auth: { sub: String(userId) } }, mockRes());
            return { accepted: true };
        } catch (err) {
            return { accepted: false, message: err.message };
        }
    };
    const paid = async (rideId) => {
        const r = await Ride.findById(rideId).lean();
        return Boolean(r?.driverPaymentCollection?.paidAt) || r?.driverPaymentCollection?.status === 'paid';
    };
    const credits = (rideId) => WalletTransaction.countDocuments({ rideId });
    const fakeFare = () => ({
        rating: 5, comment: '', tipAmount: 0,
        razorpay_order_id: 'mock_order_11800_x',
        razorpay_payment_id: 'pay_' + new mongoose.Types.ObjectId().toString(),
        razorpay_signature: 'mock_signature_bypass',
    });
    const fakeTip = () => ({
        rating: 5, comment: '', tipAmount: 5000,
        razorpay_order_id: 'mock_order_500000_x',
        razorpay_payment_id: 'pay_' + new mongoose.Types.ObjectId().toString(),
        razorpay_signature: 'mock_signature_bypass',
    });
    const previousEnv = process.env.NODE_ENV;

    console.log('\nride payment');
    process.env.NODE_ENV = 'development';
    const devRide = await makeRide();
    const dev = await call(controller.verifyRazorpayRideCompletion, devRide, fakeFare());
    const devPaid = await paid(devRide);
    check('control: in development the mock payment is accepted (the setup reaches the payment code)', () => {
        assert.ok(dev.accepted && devPaid, `accepted=${dev.accepted} paid=${devPaid} ${dev.message || ''}`);
    });

    process.env.NODE_ENV = 'production';
    const prodRide = await makeRide();
    const prod = await call(controller.verifyRazorpayRideCompletion, prodRide, fakeFare());
    const prodPaid = await paid(prodRide);
    const prodCredits = await credits(prodRide);
    check('THE BUG: in production the made-up payment is refused', () => assert.equal(prod.accepted, false));
    check('  the ride is not marked paid', () => assert.equal(prodPaid, false));
    check('  and nothing is credited to the driver', () => assert.equal(prodCredits, 0, `${prodCredits} credits`));

    console.log('\ntip');
    process.env.NODE_ENV = 'development';
    const devTipRide = await makeRide();
    const devTip = await call(controller.verifyRazorpayRideTip, devTipRide, fakeTip());
    const devTipSaved = (await Ride.findById(devTipRide).lean())?.feedback?.tipAmount;
    check('control: in development the mock tip is accepted', () => {
        assert.ok(devTip.accepted && Number(devTipSaved) === 5000, `accepted=${devTip.accepted} tip=${devTipSaved} ${devTip.message || ''}`);
    });

    process.env.NODE_ENV = 'production';
    const prodTipRide = await makeRide();
    const prodTip = await call(controller.verifyRazorpayRideTip, prodTipRide, fakeTip());
    const prodTipSaved = Number((await Ride.findById(prodTipRide).lean())?.feedback?.tipAmount || 0);
    const prodTipCredits = await credits(prodTipRide);
    check('THE BUG: in production the made-up Rs 5000 tip is refused', () => assert.equal(prodTip.accepted, false));
    check('  no tip is recorded and nothing reaches the driver', () => {
        assert.equal(prodTipSaved, 0, `tip ${prodTipSaved}`);
        assert.equal(prodTipCredits, 0, `${prodTipCredits} credits`);
    });

    process.env.NODE_ENV = previousEnv;
    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
