/**
 * A service-provider cancellation penalty is charged exactly once, on the next
 * booking, and never lost.
 *
 * Run: node tests/sp-penalty.smoke.mjs
 *
 * createBooking folds wallet.penalty into finalAmount, and used to zero the penalty
 * with user.save() BEFORE the booking was inserted: an insert that failed lost the
 * penalty uncharged, and two bookings at once both charged it. Clearing and
 * inserting are now one transaction with a guarded decrement.
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
    await mongoose.connect(replSet.getUri(), { dbName: 'sp_penalty' });

    const Booking = require('../src/modules/serviceProvider/models/Booking.js');
    const User = require('../src/modules/serviceProvider/models/User.js');
    const Service = require('../src/modules/serviceProvider/models/UserService.js');
    const Worker = require('../src/modules/serviceProvider/models/Worker.js');
    for (const M of [Booking, User, Service, Worker]) await M.createCollection().catch(() => {});
    await Worker.init().catch(() => {});
    const { createBooking } = require('../src/modules/serviceProvider/controllers/bookingControllers/userBookingController.js');

    const oid = () => new mongoose.Types.ObjectId();
    let seq = 9900000000;
    const serviceId = oid();
    await Service.collection.insertOne({ _id: serviceId, title: 'AC repair', basePrice: 500, category: 'Appliance' });

    const user = async (penalty) => {
        const _id = oid();
        await User.collection.insertOne({ _id, name: 'U', email: `p${seq}@t.test`, phone: String(seq++), wallet: { balance: 0, penalty } });
        return _id;
    };
    const book = async (userId) => {
        const res = {
            statusCode: 200, body: null,
            status(c) { this.statusCode = c; return this; },
            json(p) { this.body = p; return this; },
        };
        await createBooking({
            user: { id: String(userId) },
            body: {
                serviceId: String(serviceId),
                address: { addressLine1: '1 St', city: 'Pune', state: 'MH', pincode: '411001', lat: 18.52, lng: 73.85 },
                scheduledDate: new Date(Date.now() + 86400000).toISOString(),
                scheduledTime: '10:00',
                timeSlot: { start: '10:00', end: '11:00' },
                paymentMethod: 'pay_at_home',
            },
        }, res);
        return res;
    };
    const penaltyOf = async (id) => (await User.findById(id).lean()).wallet.penalty;

    await check('the penalty is charged on the booking and cleared, once', async () => {
        const u = await user(49);
        const r = await book(u);
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        assert.equal(r.body.data.finalAmount, 549);
        assert.equal(await penaltyOf(u), 0);
    });

    await check('a booking with no penalty is unaffected', async () => {
        const u = await user(0);
        const r = await book(u);
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        assert.equal(r.body.data.finalAmount, 500);
    });

    await check('two bookings at once: the penalty is charged on exactly one', async () => {
        const u = await user(49);
        const [a, b] = await Promise.all([book(u), book(u)]);
        const created = [a, b].filter((r) => r.statusCode === 201);
        assert.equal(created.length, 1, [a, b].map((r) => r.statusCode).join(','));
        assert.equal([a, b].filter((r) => r.statusCode === 409).length, 1);
        assert.equal(await penaltyOf(u), 0);
        assert.equal(await Booking.countDocuments({ userId: u, finalAmount: 549 }), 1);
    });

    await check('if the booking cannot be inserted, the penalty is kept for next time', async () => {
        const u = await user(49);
        const original = Booking.create;
        Booking.create = async () => { throw new Error('simulated insert failure'); };
        let r;
        try {
            r = await book(u);
        } finally {
            Booking.create = original;
        }
        assert.notEqual(r.statusCode, 201);
        assert.equal(await penaltyOf(u), 49, 'not lost');
        assert.equal(await Booking.countDocuments({ userId: u }), 0);
    });

    // Background tasks scheduled with setImmediate may still be running.
    await new Promise((r) => setTimeout(r, 500));
    await mongoose.disconnect();
    await replSet.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
