/**
 * Only a booking's own parties can set its price or confirm its payment.
 *
 * Run: node tests/sp-cash-collection-authz.smoke.mjs
 *
 * /bookings/cash/:id/* sat behind `authenticate` alone, so any logged-in account --
 * a customer, any vendor, any worker -- could set any booking's price, or confirm
 * a cash / manual-QR payment and have the partner credited from the bill. And the
 * OTP check was `customerConfirmationOTP && otp && ...`: leaving otp out skipped it.
 *
 * Drives the REAL router over HTTP. Only `authenticate` is stubbed, to choose who
 * is calling; the ownership guard and controllers are the real code.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const require = createRequire(import.meta.url);

process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';

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
    await mongoose.connect(replSet.getUri(), { dbName: 'sp_cash_authz' });

    // Caller chosen per request via headers; everything after this is real.
    const auth = require('../src/modules/serviceProvider/middleware/authMiddleware.js');
    auth.authenticate = (req, res, next) => {
        const id = req.headers['x-test-id'];
        if (!id) return res.status(401).json({ success: false });
        req.user = { _id: id, id };
        req.userRole = req.headers['x-test-role'];
        next();
    };

    const express = require('express');
    const Booking = require('../src/modules/serviceProvider/models/Booking.js');
    const Vendor = require('../src/modules/serviceProvider/models/Vendor.js');
    const VendorBill = require('../src/modules/serviceProvider/models/VendorBill.js');
    const Transaction = require('../src/modules/serviceProvider/models/Transaction.js');
    for (const M of [Booking, Vendor, VendorBill, Transaction]) await M.createCollection().catch(() => {});

    const app = express();
    app.use(express.json());
    app.set('io', null);
    app.use('/bookings/cash', require('../src/modules/serviceProvider/routes/booking-routes/cashCollection.routes.js'));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;

    const req = async (method, path, { as, body } = {}) => {
        const headers = { 'content-type': 'application/json' };
        if (as) { headers['x-test-id'] = String(as.id); headers['x-test-role'] = as.role; }
        const r = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
        return { status: r.status, body: await r.json().catch(() => null) };
    };

    const oid = () => new mongoose.Types.ObjectId();
    let seq = 9920000000;
    const vendorId = oid();
    const otherVendorId = oid();
    const customerId = oid();
    const workerId = oid();
    for (const id of [vendorId, otherVendorId]) {
        await Vendor.collection.insertOne({ _id: id, name: 'V', businessName: 'B', email: `ca${seq}@t.test`, phone: String(seq++), wallet: { earnings: 0, dues: 0, cashLimit: 100000 } });
    }
    const booking = async (over = {}) => {
        const _id = oid();
        await Booking.collection.insertOne({
            _id, bookingNumber: `BK${seq++}`, bookingModel: 'vendor', userId: customerId, vendorId, workerId: null,
            status: 'work_done', paymentStatus: 'pending', paymentMethod: 'pay_at_home', finalAmount: 1500,
            serviceId: oid(), serviceName: 'AC repair', serviceCategory: 'Appliance', basePrice: 1000,
            scheduledDate: new Date(), scheduledTime: '10:00',
            address: { addressLine1: '1 St', city: 'Pune', state: 'MH', pincode: '411001' },
            timeSlot: { start: '10:00', end: '11:00' },
            ...over,
        });
        await VendorBill.collection.insertOne({ _id: oid(), bookingId: _id, vendorId, grandTotal: 1500, vendorTotalEarning: 1200, status: 'generated' });
        return _id;
    };
    const earnings = async (id) => (await Vendor.findById(id).lean()).wallet.earnings;

    const owner = { id: vendorId, role: 'VENDOR' };
    const stranger = { id: otherVendorId, role: 'VENDOR' };
    const customer = { id: customerId, role: 'USER' };
    const someWorker = { id: workerId, role: 'WORKER' };

    console.log('\nstrangers are refused');
    await check('another vendor cannot set the price', async () => {
        const b = await booking();
        const r = await req('POST', `/bookings/cash/${b}/initiate-online`, { as: stranger, body: { totalAmount: 1 } });
        assert.equal(r.status, 404);
        assert.equal((await Booking.findById(b).lean()).finalAmount, 1500);
    });
    await check('the customer cannot set the price either', async () => {
        const b = await booking();
        const r = await req('POST', `/bookings/cash/${b}/initiate`, { as: customer, body: { totalAmount: 1 } });
        assert.equal(r.status, 404);
        assert.equal((await Booking.findById(b).lean()).finalAmount, 1500);
    });
    await check('an unassigned worker cannot confirm a manual online payment', async () => {
        const b = await booking({ customerConfirmationOTP: '4321' });
        const r = await req('POST', `/bookings/cash/${b}/confirm-manual-online`, { as: someWorker, body: { otp: '4321' } });
        assert.equal(r.status, 404);
        assert.equal(await earnings(vendorId), 0);
    });
    await check('another vendor cannot confirm cash on it', async () => {
        const b = await booking({ customerConfirmationOTP: '4321' });
        const r = await req('POST', `/bookings/cash/${b}/confirm`, { as: stranger, body: { otp: '4321' } });
        assert.equal(r.status, 404);
        assert.equal((await Booking.findById(b).lean()).cashCollected, undefined);
    });
    await check('an unknown or malformed booking id is 404 for everyone', async () => {
        assert.equal((await req('GET', `/bookings/cash/${oid()}/status`, { as: owner })).status, 404);
        assert.equal((await req('GET', '/bookings/cash/not-an-id/status', { as: owner })).status, 404);
    });

    console.log('\nthe OTP cannot be skipped');
    await check('the owner confirming a manual online payment WITHOUT the OTP is refused and credits nothing', async () => {
        const b = await booking({ customerConfirmationOTP: '4321' });
        const r = await req('POST', `/bookings/cash/${b}/confirm-manual-online`, { as: owner, body: {} });
        assert.notEqual(r.status, 200, JSON.stringify(r.body));
        assert.equal(await earnings(vendorId), 0);
        assert.notEqual((await Booking.findById(b).lean()).status, 'completed');
    });
    await check('manual online confirm with no OTP ever issued is refused too', async () => {
        const b = await booking();
        const r = await req('POST', `/bookings/cash/${b}/confirm-manual-online`, { as: owner, body: { otp: '' } });
        assert.notEqual(r.status, 200);
        assert.equal(await earnings(vendorId), 0);
    });
    await check('the owner confirming cash WITHOUT the issued OTP is refused', async () => {
        const b = await booking({ customerConfirmationOTP: '4321' });
        const r = await req('POST', `/bookings/cash/${b}/confirm`, { as: owner, body: { amount: 1500 } });
        assert.notEqual(r.status, 200, JSON.stringify(r.body));
        assert.notEqual((await Booking.findById(b).lean()).cashCollected, true);
    });

    console.log('\nthe real flows still work');
    await check('the owner can set the final amount (they bill at the door)', async () => {
        const b = await booking();
        const r = await req('POST', `/bookings/cash/${b}/initiate`, { as: owner, body: { totalAmount: 1750 } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal((await Booking.findById(b).lean()).finalAmount, 1750);
    });
    await check('the owner confirming a manual online payment with the right OTP completes it and credits earnings', async () => {
        const before = await earnings(vendorId);
        const b = await booking({ customerConfirmationOTP: '4321' });
        const r = await req('POST', `/bookings/cash/${b}/confirm-manual-online`, { as: owner, body: { otp: '4321' } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(await earnings(vendorId), before + 1200);
    });
    await check('the customer and the partner can both read the status', async () => {
        const b = await booking();
        assert.equal((await req('GET', `/bookings/cash/${b}/status`, { as: customer })).status, 200);
        assert.equal((await req('GET', `/bookings/cash/${b}/status`, { as: owner })).status, 200);
        assert.equal((await req('GET', `/bookings/cash/${b}/status`, { as: stranger })).status, 404);
    });

    server.close();
    await mongoose.disconnect();
    await replSet.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
