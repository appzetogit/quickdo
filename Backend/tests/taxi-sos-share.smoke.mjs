/**
 * SOS and live trip sharing (SOW plan §4.7, §4.8).
 *
 * Run: node tests/taxi-sos-share.smoke.mjs
 *
 * Every SOS entry point lands on one service: it saves the alert, tells the
 * admins, texts the rider's trusted contacts (or the driver's emergency
 * contacts) the live trip link, and keeps recording the position -- at most
 * every 10 s -- until an admin resolves it. The link opens a public page that
 * shows the live status and position, the driver's first name and the vehicle
 * number, and nothing else.
 *
 * SMS India Hub is stood in for by a recorder (setSosSmsSender); nothing is sent.
 */
process.env.NODE_ENV = 'development';
process.env.TRIP_SHARE_BASE_URL = 'https://app.example.com';

import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

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
const id = () => new mongoose.Types.ObjectId();

const main = async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'taxi_sos' });

    const { User } = await import('../src/modules/taxi/user/models/User.js');
    const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
    const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
    const { SafetyAlert } = await import('../src/modules/taxi/common/models/SafetyAlert.js');
    const TrustedContact = (await import('../src/modules/taxi/safety/models/TrustedContact.js')).default;
    const TripShareLink = (await import('../src/modules/taxi/safety/models/TripShareLink.js')).default;
    const sos = await import('../src/modules/taxi/safety/services/sos.service.js');
    const share = await import('../src/modules/taxi/safety/services/tripShare.service.js');
    const userSafety = (await import('../src/modules/taxi/safety/services/userSafety.service.js')).default;
    const { setSocketServer } = await import('../src/modules/taxi/services/dispatchService.js');
    const { sendSosAlertSms } = await import('../src/modules/taxi/services/smsService.js');
    for (const model of Object.values(mongoose.models)) await model.init().catch(() => {});

    const emitted = [];
    setSocketServer({ to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) });
    const texts = [];
    sos.setSosSmsSender(async (args) => { texts.push(args); return { sent: true }; });

    const userId = id();
    const driverId = id();
    await User.collection.insertOne({ _id: userId, name: 'Asha Verma', phone: '9811111111', createdAt: new Date() });
    await Driver.collection.insertOne({
        _id: driverId, name: 'Suresh Kumar Yadav', phone: '9822222222', password: 'x', vehicleType: 'sedan',
        vehicleNumber: 'MP09AB1234', vehicleColor: 'White', vehicleMake: 'Maruti', vehicleModel: 'Dzire',
        approve: true, emergencyContacts: [{ name: 'Wife', phone: '9833333333' }], createdAt: new Date(),
    });
    await TrustedContact.create([
        { user_id: userId, name: 'Mother', relation: 'mother', phone: '9844444444' },
        { user_id: userId, name: 'Brother', relation: 'brother', phone: '9855555555' },
    ]);
    const rideId = id();
    await Ride.collection.insertOne({
        _id: rideId, userId, driverId, status: 'ongoing', liveStatus: 'started', fare: 200,
        pickupLocation: { type: 'Point', coordinates: [75.88, 22.72] }, dropLocation: { type: 'Point', coordinates: [75.9, 22.75] },
        pickupAddress: '12 MG Road, Indore', dropAddress: '7 Vijay Nagar, Indore', otp: '8765',
        lastDriverLocation: { type: 'Point', coordinates: [75.885, 22.73], heading: 90, updatedAt: new Date() },
        stops: [{ address: 'Palasia', lat: 22.724, lng: 75.884, order: 1, reachedAt: new Date() }],
        createdAt: new Date(), updatedAt: new Date(),
    });

    /* -------------------------------------------------------------- SOS -- */
    console.log('\nSOS (4.7)');
    const alert = await sos.triggerSos({ sourceApp: 'user', actorId: userId, rideId, location: { lat: 22.731, lng: 75.886 } });
    await check('the alert is saved on the ride, with where the rider is', async () => {
        assert.equal(alert.status, 'active');
        assert.equal(alert.rideId, String(rideId));
        assert.deepEqual(alert.location.coordinates, [75.886, 22.731]);
        assert.equal((await SafetyAlert.countDocuments()), 1);
    });
    await check('the admins are told over the socket', async () => {
        assert.ok(emitted.some((e) => e.room === 'admin:broadcast' && e.event === 'new_sos' && e.payload.id === alert.id));
        assert.ok(emitted.some((e) => e.room === 'admin:broadcast' && e.event === 'safety:alert:new'));
    });
    await check('every trusted contact is texted the live trip link', async () => {
        assert.equal(texts.length, 2);
        assert.deepEqual(texts.map((t) => t.phone).sort(), ['9844444444', '9855555555']);
        const token = (await TripShareLink.findOne({ trip_id: rideId }).lean()).token;
        for (const text of texts) {
            assert.equal(text.link, `https://app.example.com/track-trip/${token}`);
            assert.equal(text.name, 'Asha');
        }
        const saved = await SafetyAlert.findById(alert.id).lean();
        assert.deepEqual(saved.contactsNotified.map((c) => c.status), ['sent', 'sent']);
        assert.ok(!JSON.stringify(saved.contactsNotified).includes('9844444444'), 'contact phones are masked');
    });
    await check('pressed again, it adds to the same alert and texts nobody twice', async () => {
        const again = await sos.triggerSos({ sourceApp: 'user', actorId: userId, rideId });
        assert.equal(again.id, alert.id);
        assert.equal(texts.length, 2);
    });

    const t0 = new Date();
    await check('the position is recorded at most every 10 seconds while the alert is open', async () => {
        const soon = await sos.recordSosLocation({ alertId: alert.id, sourceApp: 'user', actorId: userId, coordinates: { lat: 22.74, lng: 75.89 }, at: new Date(t0.getTime() + 2000) });
        assert.equal(soon.recorded, false);
        const later = await sos.recordSosLocation({ alertId: alert.id, sourceApp: 'user', actorId: userId, coordinates: { lat: 22.74, lng: 75.89 }, at: new Date(t0.getTime() + 11000) });
        assert.equal(later.recorded, true);
        const saved = await SafetyAlert.findById(alert.id).lean();
        assert.deepEqual(saved.location.coordinates, [75.89, 22.74]);
        assert.ok(saved.locationTrail.length >= 2);
    });
    await check('only the alert\'s own rider can post its position', async () => {
        await assert.rejects(() => sos.recordSosLocation({ alertId: alert.id, sourceApp: 'user', actorId: id(), coordinates: [75.8, 22.7] }), /not found/);
    });
    await check('the driver\'s ride location updates follow the alert too', async () => {
        await SafetyAlert.updateOne({ _id: alert.id }, { $set: { lastLocationAt: new Date(Date.now() - 60000) } });
        assert.equal(await sos.recordSosLocationForRide({ rideId, coordinates: [75.9, 22.75] }), 1);
    });

    const driverAlert = await sos.triggerSos({ sourceApp: 'driver', actorId: driverId, rideId });
    await check('a driver\'s SOS texts the driver\'s emergency contacts', async () => {
        assert.equal(driverAlert.sourceApp, 'driver');
        const last = texts[texts.length - 1];
        assert.equal(last.phone, '9833333333');
        assert.equal(last.name, 'Suresh');
        assert.match(last.link, /\/track-trip\//);
    });

    await check('the old POST /safety/sos goes through the same service', async () => {
        const otherUser = id();
        await User.collection.insertOne({ _id: otherUser, name: 'Ravi', phone: '9866666666', createdAt: new Date() });
        await TrustedContact.create({ user_id: otherUser, name: 'Friend', relation: 'friend', phone: '9877777777' });
        const before = texts.length;
        const legacy = await userSafety.triggerSOS(otherUser, { latitude: 22.7, longitude: 75.8 });
        assert.equal(legacy.sourceApp, 'user');
        assert.equal(texts.length, before + 1);
        assert.match(texts[texts.length - 1].link, /google\.com\/maps/, 'no ride: a map link to where they are');
    });

    await check('resolved by an admin, it stops recording', async () => {
        const resolved = await sos.resolveSos({ alertId: alert.id, adminId: 'admin1', note: 'Called the rider' });
        assert.equal(resolved.status, 'resolved');
        const after = await sos.recordSosLocation({ alertId: alert.id, sourceApp: 'user', actorId: userId, coordinates: [75.8, 22.7], at: new Date(Date.now() + 60000) });
        assert.equal(after.recorded, false);
        const list = await sos.listSos({ status: 'active' });
        assert.ok(!list.results.some((a) => a.id === alert.id));
    });

    await check('with no DLT template configured, the real sender logs and sends nothing', async () => {
        delete process.env.SMS_INDIA_HUB_SOS_TEMPLATE_ID;
        const result = await sendSosAlertSms({ phone: '9844444444', name: 'Asha', link: 'https://x' });
        assert.deepEqual(result, { sent: false, reason: 'sos_template_missing' });
    });

    /* ------------------------------------------------- live trip sharing -- */
    console.log('\nlive trip sharing (4.8)');
    const link = await share.createTripShareLink({ userId, rideId });
    await check('a rider shares their own ride; the same live link comes back', async () => {
        assert.match(link.token, /^[a-f0-9]{48}$/);
        assert.equal(link.url, `https://app.example.com/track-trip/${link.token}`);
    });
    await check('nobody can share a ride that is not theirs', async () => {
        await assert.rejects(() => share.createTripShareLink({ userId: id(), rideId }), /not found/);
    });
    const view = await share.getPublicTripView(link.token);
    await check('the public view: live status, position, driver first name, vehicle number', async () => {
        assert.equal(view.liveStatus, 'started');
        assert.equal(view.isLive, true);
        assert.equal(view.location.lat, 22.73);
        assert.equal(view.driver.firstName, 'Suresh');
        assert.equal(view.driver.vehicleNumber, 'MP09AB1234');
        assert.equal(view.stopsReached, 1);
    });
    await check('and no personal data', async () => {
        const json = JSON.stringify(view);
        for (const secret of ['9822222222', '9811111111', 'Yadav', 'Asha', 'Verma', 'MG Road', 'Vijay Nagar', '8765', String(userId), String(driverId), String(rideId)]) {
            assert.ok(!json.includes(secret), `leaks ${secret}`);
        }
    });
    await check('an unknown or malformed token is a 404', async () => {
        await assert.rejects(() => share.getPublicTripView('f'.repeat(48)), (err) => err.statusCode === 404);
        await assert.rejects(() => share.getPublicTripView('not-a-token'), (err) => err.statusCode === 404);
    });
    await check('an expired or revoked link is a 410', async () => {
        await TripShareLink.updateOne({ token: link.token }, { $set: { expiry_time: new Date(Date.now() - 1000) } });
        await assert.rejects(() => share.getPublicTripView(link.token), (err) => err.statusCode === 410);
        await TripShareLink.updateOne({ token: link.token }, { $set: { expiry_time: new Date(Date.now() + 3600000), status: 'revoked' } });
        await assert.rejects(() => share.getPublicTripView(link.token), (err) => err.statusCode === 410);
    });
    await check('once the ride ends the link no longer shows where anyone is', async () => {
        await TripShareLink.updateOne({ token: link.token }, { $set: { status: 'active' } });
        await Ride.updateOne({ _id: rideId }, { $set: { status: 'completed', liveStatus: 'completed' } });
        const ended = await share.getPublicTripView(link.token);
        assert.equal(ended.isLive, false);
        assert.equal(ended.location, null);
    });

    await check('GET /public/trip/:token answers without signing in', async () => {
        const express = (await import('express')).default;
        const { taxiRouter } = await import('../src/modules/taxi/routes/index.js');
        const errorHandler = (await import('../src/middleware/errorHandler.js')).default;
        const app = express();
        app.use('/api/v1/taxi', taxiRouter);
        app.use(errorHandler);
        const server = app.listen(0);
        const port = server.address().port;
        try {
            const ok = await fetch(`http://127.0.0.1:${port}/api/v1/taxi/public/trip/${link.token}`);
            assert.equal(ok.status, 200);
            assert.equal((await ok.json()).data.driver.firstName, 'Suresh');
            const missing = await fetch(`http://127.0.0.1:${port}/api/v1/taxi/public/trip/${'a'.repeat(48)}`);
            assert.equal(missing.status, 404);
        } finally {
            server.close();
        }
    });

    await mongoose.disconnect();
    await mongo.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
