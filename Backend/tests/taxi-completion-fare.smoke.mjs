/**
 * A completed taxi ride charges what the rider agreed to, never what the
 * driver's app sends, and the driver is paid on the full fare.
 *
 * Run: node tests/taxi-completion-fare.smoke.mjs
 *
 * Found by the calculation audit, 11 Sep: completion rebuilt the fare from the
 * starting fare -- a Rs 59 promo ride finished at Rs 118, an accepted Rs 148
 * bid at Rs 118 -- and added whatever charges the driver's app sent (a Rs 118
 * ride completed at Rs 918). A cancellation fee the rider owed was wiped from
 * them and taken out of the driver's pay instead, and an online ride's
 * earnings reached the driver before the rider had paid.
 *
 * Drives the real updateRideLifecycle, settlement and payment verification on
 * a single-node replica set (settlement runs in a transaction).
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
const r2 = (n) => Math.round(Number(n) * 100) / 100;

const main = async () => {
    process.env.NODE_ENV = 'development';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri(), { dbName: 'taxi_completion' });

    const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
    const { RideBid } = await import('../src/modules/taxi/user/models/RideBid.js');
    const { User } = await import('../src/modules/taxi/user/models/User.js');
    const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
    const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');
    const svc = await import('../src/modules/taxi/services/rideService.js');
    const controller = await import('../src/modules/taxi/user/controllers/rideController.js');
    for (const model of Object.values(mongoose.models)) await model.init().catch(() => {});

    let phone = 9000000000;
    const makeUser = async (due = 0) => {
        const _id = id();
        await User.collection.insertOne({ _id, name: 'Rider', phone: String(phone++), pending_cancellation_due: due, createdAt: new Date() });
        return _id;
    };
    const makeDriver = async () => {
        const _id = id();
        await Driver.collection.insertOne({
            _id, name: 'Driver', phone: String(phone++), password: 'secret123', vehicleType: 'Bike',
            isOnline: true, isOnRide: true, location: { type: 'Point', coordinates: [75.88, 22.72] },
            wallet: { balance: 0 }, createdAt: new Date(),
        });
        return _id;
    };
    // A ride under way: the driver waited 10 minutes at pickup (2 free, Rs 1 a
    // minute after), so the honest waiting charge is Rs 8.
    const makeRide = async ({ userId, driverId, agreed, promo = 0, method = 'online', snapshot = {}, extra = {} }) => {
        const _id = id();
        const now = Date.now();
        await Ride.collection.insertOne({
            _id, userId, driverId, status: 'ongoing', liveStatus: 'started', fare: agreed, baseFare: 118,
            paymentMethod: method, serviceType: 'ride', transport_type: 'taxi',
            pickupLocation: { type: 'Point', coordinates: [75.8843673, 22.728214] },
            dropLocation: { type: 'Point', coordinates: [75.8968202, 22.75521] },
            pickupAddress: 'A', dropAddress: 'B',
            arrivedAt: new Date(now - 15 * 60000), startedAt: new Date(now - 5 * 60000),
            pricingSnapshot: {
                starting_fare: 118, agreed_fare: agreed, promo_discount_applied: promo,
                waiting_charge: 1, free_waiting_before: 2, ride_surge_amount: 0,
                admin_commission_type_from_driver: 1, admin_commission_from_driver: 10,
                cancellation_fee_goes_to: 'admin', ...snapshot,
            },
            createdAt: new Date(), updatedAt: new Date(), ...extra,
        });
        return _id;
    };
    // What the driver's app sends at completion -- all of it must be ignored.
    const driverSends = { fare: 918, baseFare: 918, additionalCharge: 500, waitingChargeAmount: 300, timeChargeAmount: 50, distanceChargeAmount: 50 };
    const complete = (rideId, driverId) => svc.updateRideLifecycle({ rideId, driverId, nextStatus: 'completed', ...driverSends });
    const load = (rideId) => Ride.findById(rideId).lean();
    const credits = (rideId) => WalletTransaction.find({ rideId }).lean();

    console.log('\na Rs 59 promo ride (Rs 118 before the promo)');
    const u1 = await makeUser(); const d1 = await makeDriver();
    const promoRide = await makeRide({ userId: u1, driverId: d1, agreed: 59, promo: 59 });
    await complete(promoRide, d1);
    const p = await load(promoRide);
    check('THE BUG: charged Rs 59 + Rs 8 waiting = Rs 67 -- not Rs 118, not Rs 918', () => assert.equal(r2(p.fare), 67, `fare ${p.fare}`));
    check('the driver app\'s Rs 500 extra and Rs 300 waiting are ignored', () => {
        assert.equal(r2(p.waitingChargeAmount), 8, `waiting ${p.waitingChargeAmount}`);
        assert.equal(r2(p.additionalCharge || 0), 0, `additional ${p.additionalCharge}`);
    });
    const promoCreditsAtCompletion = await credits(promoRide);
    check('online: nothing reaches the driver before the rider pays', () => assert.equal(promoCreditsAtCompletion.length, 0, `${promoCreditsAtCompletion.length} credits`));

    console.log('\nthe same ride with no promo');
    const u2 = await makeUser(); const d2 = await makeDriver();
    const plainRide = await makeRide({ userId: u2, driverId: d2, agreed: 118 });
    await complete(plainRide, d2);
    const n = await load(plainRide);
    check('charged Rs 118 + Rs 8 = Rs 126', () => assert.equal(r2(n.fare), 126, `fare ${n.fare}`));
    check('THE BUG: the platform funds the promo -- the promo driver earns the same as this one', () => {
        assert.ok(n.driverEarnings > 0, `earnings ${n.driverEarnings}`);
        assert.equal(r2(p.driverEarnings), r2(n.driverEarnings), `promo ride ${p.driverEarnings} vs plain ${n.driverEarnings}`);
    });
    check('driver earnings + commission = the full fare', () => assert.equal(r2(n.driverEarnings + n.commissionAmount), 126));

    console.log('\nthe rider pays the online fare');
    const pay = (rideId, userId, amount) => controller.verifyRazorpayRideCompletion({
        params: { rideId: String(rideId) }, auth: { sub: String(userId) },
        body: { rating: 5, comment: '', tipAmount: 0, razorpay_order_id: `mock_order_${Math.round(amount * 100)}_x`,
            razorpay_payment_id: 'pay_' + id().toString(), razorpay_signature: 'mock_signature_bypass' },
    }, { status() { return this; }, json() { return this; } });
    await pay(plainRide, u2, 126);
    const earned = (await credits(plainRide)).filter((t) => t.type === 'ride_earning');
    check('now the driver is credited his earnings, once', () => {
        assert.equal(earned.length, 1, `${earned.length} ride_earning credits`);
        assert.equal(r2(earned[0].amount), r2(n.driverEarnings));
    });

    console.log('\nan accepted Rs 148 bid, booked before agreed_fare existed');
    const u3 = await makeUser(); const d3 = await makeDriver();
    const bidId = id();
    const bidRide = await makeRide({ userId: u3, driverId: d3, agreed: 148, snapshot: { agreed_fare: undefined, promo_discount_applied: undefined }, extra: { acceptedBidId: bidId } });
    await RideBid.collection.insertOne({ _id: bidId, rideId: bidRide, driverId: d3, bidFare: 148, status: 'accepted', createdAt: new Date() });
    await complete(bidRide, d3);
    const b = await load(bidRide);
    check('THE BUG: charged the Rs 148 bid + Rs 8 = Rs 156 -- not Rs 118', () => assert.equal(r2(b.fare), 156, `fare ${b.fare}`));

    console.log('\na cash ride whose rider owes a Rs 30 cancellation fee');
    const u4 = await makeUser(30); const d4 = await makeDriver();
    const dueRide = await makeRide({ userId: u4, driverId: d4, agreed: 118, method: 'cash' });
    await complete(dueRide, d4);
    const c = await load(dueRide);
    const rider = await User.findById(u4).lean();
    check('THE BUG: the fee is added to the rider\'s fare: Rs 118 + 8 + 30 = Rs 156', () => assert.equal(r2(c.fare), 156, `fare ${c.fare}`));
    check('  and cleared from what the rider owes', () => assert.equal(Number(rider.pending_cancellation_due || 0), 0));
    check('THE BUG: the driver earns on Rs 126, the same as a ride with no fee -- the fee is not taken from him', () => assert.equal(r2(c.driverEarnings), r2(n.driverEarnings), `earnings ${c.driverEarnings} vs ${n.driverEarnings}`));
    const cashTx = (await credits(dueRide)).find((t) => ['commission_deduction', 'ride_earning'].includes(t.type));
    check('  his wallet is debited the commission plus the Rs 30 he collected for the platform', () => {
        assert.ok(cashTx, 'no settlement transaction');
        assert.equal(r2(cashTx.amount), r2(c.driverEarnings - 156), `debit ${cashTx.amount}`);
    });

    console.log('\nan insured cash ride: Rs 20 premium');
    const u5 = await makeUser(); const d5 = await makeDriver();
    const insured = await makeRide({ userId: u5, driverId: d5, agreed: 118, method: 'cash',
        snapshot: { insurance: { plan_id: id(), name: 'Accident cover', cover_amount: 100000, premium_type: 'flat', premium_value: 20, premium: 20 } } });
    await complete(insured, d5);
    const ins = await load(insured);
    check('the rider pays Rs 118 + 8 waiting + Rs 20 insurance = Rs 146', () => assert.equal(r2(ins.fare), 146, `fare ${ins.fare}`));
    check('  insurance_fee records the Rs 20', () => assert.equal(r2(ins.insurance_fee), 20));
    check('the driver earns the same as an uninsured ride -- no commission on the premium, none of it his', () => assert.equal(r2(ins.driverEarnings), r2(n.driverEarnings), `earnings ${ins.driverEarnings} vs ${n.driverEarnings}`));
    const insTx = (await credits(insured)).find((t) => ['commission_deduction', 'ride_earning'].includes(t.type));
    check('  his wallet is debited the commission plus the Rs 20 he collected for the insurer', () => {
        assert.ok(insTx, 'no settlement transaction');
        assert.equal(r2(insTx.amount), r2(ins.driverEarnings - 146), `debit ${insTx.amount}`);
    });

    console.log('\nan insured ride cancelled before it ran');
    const u6 = await makeUser(); const d6 = await makeDriver();
    const cancelledInsured = await makeRide({ userId: u6, driverId: d6, agreed: 118,
        snapshot: { insurance: { plan_id: id(), name: 'Accident cover', premium: 20 } }, extra: { status: 'cancelled', liveStatus: 'cancelled' } });
    const ci = await load(cancelledInsured);
    check('is never charged the premium', () => assert.equal(Number(ci.insurance_fee || 0), 0));

    /*
     * The platform incentive from Master > Delivery Earnings.
     *
     * Taxi drivers sat outside that engine: an admin who set an incentive for
     * "All modules" paid food and quick-commerce riders and paid taxi drivers
     * nothing. It has to reach the driver WITHOUT the rider being charged more
     * -- the platform funds it, exactly like a promo.
     */
    console.log('');
    console.log('the platform incentive from Master');
    const { set: setSetting, invalidateCache } = await import('../src/core/config/resolver.service.js');

    const u7 = await makeUser(); const d7 = await makeDriver();
    const noRule = await makeRide({ userId: u7, driverId: d7, agreed: 118, method: 'cash' });
    await complete(noRule, d7);
    const before = await load(noRule);
    check('no rule set: the driver earns exactly what he always did', () => {
        assert.equal(r2(before.driverEarnings + before.commissionAmount), r2(before.fare), `earnings ${before.driverEarnings}`);
        assert.equal(Number(before.driverIncentiveAmount || 0), 0);
    });

    await setSetting('earnings.incentive', {
        level: 'vertical', scopeId: 'taxi',
        // 20%, not 10%: commission here is 10%, and an incentive that exactly
        // cancels it moves the wallet by zero -- which would make the credit
        // check below pass while proving nothing.
        value: { isEnabled: true, minOrderAmount: 100, incentivePercent: 20 },
    });
    invalidateCache();

    const u8 = await makeUser(); const d8 = await makeDriver();
    const withRule = await makeRide({ userId: u8, driverId: d8, agreed: 118, method: 'cash' });
    await complete(withRule, d8);
    const after = await load(withRule);
    const afterTx = await credits(withRule);
    check('the taxi driver is now paid the incentive on top of his fare', () => {
        assert.ok(after.driverIncentiveAmount > 0, `incentive ${after.driverIncentiveAmount}`);
        assert.equal(r2(after.driverEarnings), r2(before.driverEarnings + after.driverIncentiveAmount),
            `earnings ${after.driverEarnings} vs ${before.driverEarnings} + ${after.driverIncentiveAmount}`);
    });
    check('  the RIDER is charged exactly the same -- the platform funds it', () => {
        assert.equal(r2(after.fare), r2(before.fare), `fare ${after.fare} vs ${before.fare}`);
    });
    check('  and it reaches his wallet: on cash, the platform credits him', () => {
        const t = afterTx[0];
        assert.ok(t, 'no settlement transaction');
        assert.equal(r2(t.amount), r2(after.driverEarnings - after.fare), `amount ${t.amount}`);
        // 20% incentive against 10% commission, so he ends up owed money on a
        // ride where he would normally owe the platform.
        assert.ok(t.amount > 0, `expected a credit, got ${t.amount}`);
    });

    /*
     * Under the floor. The incentive is judged on the fare the driver is
     * SETTLED on, which is before any platform-funded promo -- a Rs 59 promo
     * ride is still a Rs 126 ride to him. So the small ride here carries no
     * promo, or it would clear the minimum after the promo is added back.
     */
    const u9 = await makeUser(); const d9 = await makeDriver();
    const belowFloor = await makeRide({ userId: u9, driverId: d9, agreed: 50, method: 'cash' });
    await complete(belowFloor, d9);
    const small = await load(belowFloor);
    check('a ride under the minimum earns no incentive', () => {
        assert.equal(Number(small.driverIncentiveAmount || 0), 0, `incentive ${small.driverIncentiveAmount}`);
    });

    await setSetting('earnings.incentive', { level: 'vertical', scopeId: 'taxi', value: null });
    invalidateCache();

    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
