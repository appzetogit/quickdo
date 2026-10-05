/**
 * Other people's data stays theirs: seven read-side leaks found in one sweep.
 *
 * Run: node tests/data-exposure.smoke.mjs
 *
 *  1. Taxi driver onboarding (unauthenticated) looked a registration up by PHONE:
 *     anyone with an applicant's number got their licence / Aadhaar / RC documents,
 *     and /complete handed back a driver access token. The session endpoint also
 *     returned the password hash. saveDriverDocuments had no OTP check.
 *  2. GET /v1/food/restaurant/restaurants/:id (unauthenticated) returned PAN, GST,
 *     bank account, UPI, KYC image URLs, owner email/phone and FCM tokens.
 *  3. Food order route returned any order's rider position and delivery point to
 *     any logged-in customer or rider.
 *  4. A taxi customer token passed the quick-commerce auth middleware as role USER
 *     with no userId, skipping getOrderById's ownership check.
 *  5. Taxi pool group returned every passenger's name, address, coordinates and
 *     ride OTP to anyone with the id.
 *  6. SP scrap detail returned any customer's pickup address and contact details.
 *  7. SP worker job detail showed every unassigned booking to every worker.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import express from 'express';
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
const rejects = async (fn, pattern) => {
    let threw = null;
    try { await fn(); } catch (err) { threw = err; }
    assert.ok(threw, 'expected it to be refused');
    if (pattern) assert.match(String(threw.message), pattern);
    return threw;
};
const oid = () => new mongoose.Types.ObjectId();

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'data_exposure' });

    // --- 1. taxi driver onboarding -------------------------------------------
    console.log('\ntaxi driver onboarding');
    const onboarding = await import('../src/modules/taxi/driver/services/onboardingService.js');
    const { DriverRegistrationSession } = await import('../src/modules/taxi/driver/models/DriverRegistrationSession.js');
    const future = new Date(Date.now() + 3600_000);
    const session = (over) => DriverRegistrationSession.collection.insertOne({
        registrationId: crypto.randomUUID(), phone: '9876543210', role: 'driver', status: 'otp_verified',
        otpHash: 'x', otpExpiresAt: future, expiresAt: future, otpVerifiedAt: new Date(),
        personal: { fullName: 'Applicant', email: 'a@t.test', gender: 'male', passwordHash: 'SECRET-HASH' },
        documents: { drivingLicence: 'https://files.example/licence.jpg' },
        ...over,
    });
    const verified = crypto.randomUUID();
    await session({ registrationId: verified, phone: '9000000001' });
    const unverified = crypto.randomUUID();
    await session({ registrationId: unverified, phone: '9000000002', otpVerifiedAt: null, status: 'otp_sent' });

    await check('knowing only the phone number gets nothing: documents and completion refuse', async () => {
        await rejects(() => onboarding.saveDriverDocuments({ phone: '9000000001', documents: {} }), /registrationId is required/);
        await rejects(() => onboarding.completeDriverOnboarding({ phone: '9000000001' }), /registrationId is required/);
        await rejects(() => onboarding.getDriverOnboardingSession({ phone: '9000000001' }), /registrationId is required/);
    });
    await check('documents cannot be saved before the OTP is verified', async () => {
        await rejects(() => onboarding.saveDriverDocuments({ registrationId: unverified, documents: {} }), /Verify OTP/);
    });
    await check('the session response never includes the password hash', async () => {
        const out = await onboarding.getDriverOnboardingSession({ registrationId: verified });
        assert.equal(out.personal.fullName, 'Applicant');
        assert.equal(out.personal.passwordHash, undefined);
    });
    await check('the applicant with the registrationId still proceeds', async () => {
        const out = await onboarding.saveDriverDocuments({ registrationId: verified, documents: {} });
        assert.ok(out);
    });

    // --- 2. public restaurant detail ------------------------------------------
    console.log('\nfood public restaurant detail');
    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    const { getApprovedRestaurantByIdOrSlug } = await import('../src/modules/food/restaurant/services/restaurant.service.js');
    const restaurantId = oid();
    await FoodRestaurant.collection.insertOne({
        _id: restaurantId, restaurantName: 'Spice Hub', restaurantNameNormalized: 'spice hub', status: 'approved',
        cuisines: ['Indian'], fssaiNumber: '12345678901234',
        panNumber: 'ABCDE1234F', nameOnPan: 'Owner', panImage: '/uploads/pan.jpg',
        gstNumber: '27ABCDE1234F1Z5', gstLegalName: 'Spice Hub Pvt', gstAddress: 'Pune', gstImage: '/uploads/gst.jpg',
        accountNumber: '000123456789', ifscCode: 'HDFC0000001', accountHolderName: 'Owner', upiId: 'owner@upi',
        upiQrImage: '/uploads/qr.jpg', ownerEmail: 'owner@t.test', ownerPhone: '9999999999', primaryContactNumber: '9999999998',
        fcmTokens: ['tok'], fcmTokenMobile: ['tok2'],
    });
    await check('by id: no PAN, GST, bank, UPI, KYC images, owner contact or push tokens', async () => {
        const r = await getApprovedRestaurantByIdOrSlug(String(restaurantId));
        assert.equal(r.restaurantName, 'Spice Hub');
        for (const f of ['panNumber', 'nameOnPan', 'panImage', 'gstNumber', 'gstLegalName', 'gstAddress', 'gstImage',
            'accountNumber', 'ifscCode', 'accountHolderName', 'upiId', 'upiQrImage', 'ownerEmail', 'ownerPhone',
            'primaryContactNumber', 'fcmTokens', 'fcmTokenMobile']) {
            assert.equal(r[f], undefined, `${f} leaked`);
        }
        assert.equal(r.fssaiNumber, '12345678901234', 'the displayed licence number stays');
    });
    await check('by slug: the same', async () => {
        const r = await getApprovedRestaurantByIdOrSlug('spice hub');
        assert.equal(r.accountNumber, undefined);
        assert.equal(r.panNumber, undefined);
    });

    // --- 3. food order route ---------------------------------------------------
    console.log('\nfood order route');
    const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
    const { getOrderRoute } = await import('../src/modules/food/orders/services/order-route.service.js');
    const customer = oid();
    const rider = oid();
    const orderId = oid();
    await FoodOrder.collection.insertOne({ _id: orderId, orderId: 'FOD-0000001', userId: customer, restaurantId, orderStatus: 'picked_up', dispatch: { deliveryPartnerId: rider } });
    await check('another customer or rider is refused', async () => {
        await rejects(() => getOrderRoute(String(orderId), {}, { userId: String(oid()) }), /Not your order/);
        await rejects(() => getOrderRoute(String(orderId), {}, { deliveryPartnerId: String(oid()) }), /Not your order/);
        await rejects(() => getOrderRoute('FOD-0000001', {}, {}), /Not your order/);
    });
    await check('the order\'s own customer and rider pass the check', async () => {
        for (const viewer of [{ userId: String(customer) }, { deliveryPartnerId: String(rider) }]) {
            try { await getOrderRoute(String(orderId), {}, viewer); } catch (err) {
                assert.doesNotMatch(String(err.message), /Not your order/);
            }
        }
    });

    // --- 3b. rider's available-orders list ------------------------------------
    console.log('\nfood available orders (rider)');
    const { listOrdersAvailableDelivery } = await import('../src/modules/food/orders/services/order-delivery.service.js');
    const { FoodUser } = await import('../src/core/users/user.model.js');
    const browsingRider = oid();
    const offerCustomer = oid();
    await FoodUser.collection.insertOne({ _id: offerCustomer, name: 'Meera', phone: '9812345678', email: 'meera@t.test' });
    const offer = oid();
    const mine = oid();
    await FoodOrder.collection.insertMany([
        { _id: offer, orderId: 'FOD-0000002', userId: offerCustomer, restaurantId, orderStatus: 'preparing', customerPhone: '9812345678',
          dispatch: { status: 'unassigned', offeredTo: [{ partnerId: browsingRider, action: 'offered' }] }, deliveryAddress: { street: '1 Lane', city: 'Pune', state: 'MH', phone: '9812345678' }, createdAt: new Date() },
        { _id: mine, orderId: 'FOD-0000003', userId: offerCustomer, restaurantId, orderStatus: 'picked_up', customerPhone: '9812345678',
          dispatch: { status: 'accepted', deliveryPartnerId: browsingRider }, deliveryAddress: { street: '1 Lane', city: 'Pune', state: 'MH', phone: '9812345678' }, createdAt: new Date() },
    ]);
    await check('an open offer shows the customer name and address, but no phone or email', async () => {
        const listed = await listOrdersAvailableDelivery(String(browsingRider), {}); const docs = listed.data || listed.docs || [];
        const o = docs.find((d) => String(d._id) === String(offer));
        assert.ok(o, 'offer listed');
        assert.equal(o.userId.name, 'Meera');
        assert.equal(o.userId.phone, undefined);
        assert.equal(o.userId.email, undefined);
        assert.equal(o.customerPhone, undefined);
        assert.equal(o.deliveryAddress.phone, undefined);
        assert.equal(o.deliveryAddress.street, '1 Lane');
    });
    await check("the rider's own accepted order keeps the customer's phone", async () => {
        const listed = await listOrdersAvailableDelivery(String(browsingRider), {}); const docs = listed.data || listed.docs || [];
        const o = docs.find((d) => String(d._id) === String(mine));
        assert.ok(o, 'own order listed');
        assert.equal(o.userId.phone, '9812345678');
        assert.equal(o.customerPhone, '9812345678');
    });

    // --- 3c. public nearby drivers ----------------------------------------------
    console.log('\ntaxi public nearby drivers');
    const { listAvailableDrivers } = await import('../src/modules/taxi/user/controllers/rideController.js');
    const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
    await Driver.collection.createIndex({ location: '2dsphere' });
    const vehicleTypeId = oid();
    await Driver.collection.insertOne({ _id: oid(), name: 'Named Driver', phone: '+919800000001', vehicleNumber: 'MH12AB1234', vehicleColor: 'White',
        vehicleMake: 'Maruti', vehicleModel: 'Dzire', vehicleTypeId, vehicleType: 'car', isOnline: true, rating: 4.8,
        isOnRide: false, workMode: 'all', serviceCapabilities: ['taxi'], activeAssignment: null,
        location: { type: 'Point', coordinates: [73.85, 18.52] } });
    await check('the unauthenticated map gets positions and vehicle type, but no name or number plate', async () => {
        let body = null;
        await listAvailableDrivers({ query: { vehicleTypeId: String(vehicleTypeId), lat: '18.52', lng: '73.85' } }, { json: (b) => { body = b; } });
        const d = body.data.drivers[0];
        assert.ok(d, 'driver listed');
        assert.ok(Array.isArray(d.location.coordinates));
        for (const f of ['name', 'phone', 'vehicleNumber', 'vehicleColor', 'vehicleMake', 'vehicleModel']) {
            assert.equal(d[f], undefined, `${f} leaked`);
        }
    });

    // --- 4. quick-commerce auth with a taxi token ------------------------------
    console.log('\nquick-commerce auth middleware');
    const { authMiddleware } = await import('../src/modules/quickCommerce/core/auth/auth.middleware.js');
    const { signAccessToken: signTaxi } = await import('../src/modules/taxi/services/tokenService.js');
    const app = express();
    app.get('/probe', authMiddleware, (req, res) => res.json({ user: req.user }));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const probe = (token) => fetch(`http://127.0.0.1:${server.address().port}/probe`, { headers: { authorization: `Bearer ${token}` } })
        .then(async (r) => ({ status: r.status, body: await r.json() }));
    await check('a taxi customer token is refused, not let through as USER with no id', async () => {
        const r = await probe(signTaxi({ sub: String(oid()), role: 'user' }));
        assert.equal(r.status, 401, JSON.stringify(r.body));
    });
    server.close();

    // --- 5. taxi pool group -----------------------------------------------------
    console.log('\ntaxi pool group');
    const { getPoolGroupById } = await import('../src/modules/taxi/user/controllers/rideController.js');
    const { InstantPoolGroup } = await import('../src/modules/taxi/admin/models/InstantPoolGroup.js');
    const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
    const driverId = oid();
    const passengerA = oid();
    const passengerB = oid();
    const rideA = oid();
    const rideB = oid();
    await Ride.collection.insertMany([{ _id: rideA, userId: passengerA }, { _id: rideB, userId: passengerB }]);
    const groupId = oid();
    await InstantPoolGroup.collection.insertOne({
        _id: groupId, driverId, vehicleTypeId: oid(), activeRides: [rideA, rideB], status: 'active',
        routeSequence: [
            { _id: oid(), type: 'pickup', rideId: rideA, address: 'A street', coordinates: [73.8, 18.5], passengerName: 'Asha', otp: '1111', status: 'pending' },
            { _id: oid(), type: 'pickup', rideId: rideB, address: 'B street', coordinates: [73.9, 18.6], passengerName: 'Bala', otp: '2222', status: 'pending' },
        ],
    });
    const group = async (auth) => {
        let out = null; let error = null;
        await getPoolGroupById({ params: { poolGroupId: String(groupId) }, auth }, { json: (b) => { out = b; } }, (e) => { error = e; });
        return { out, error };
    };
    await check('a stranger (customer or driver) gets 404', async () => {
        assert.equal((await group({ sub: String(oid()), role: 'user' })).error?.statusCode, 404);
        assert.equal((await group({ sub: String(oid()), role: 'driver' })).error?.statusCode, 404);
    });
    await check('no one receives a ride OTP', async () => {
        for (const auth of [{ sub: String(driverId), role: 'driver' }, { sub: String(passengerA), role: 'user' }]) {
            const { out } = await group(auth);
            assert.ok(out, `no data for ${auth.role}`);
            assert.ok(out.data.routeSequence.every((s) => s.otp === undefined), 'otp leaked');
        }
    });
    await check('the driver keeps every stop\'s coordinates for navigation', async () => {
        const { out } = await group({ sub: String(driverId), role: 'driver' });
        assert.ok(out.data.routeSequence.every((s) => Array.isArray(s.coordinates)));
    });
    await check('a passenger sees co-riders\' names and addresses but coordinates only for their own stop', async () => {
        const { out } = await group({ sub: String(passengerA), role: 'user' });
        const mine = out.data.routeSequence.find((s) => String(s.rideId) === String(rideA));
        const theirs = out.data.routeSequence.find((s) => String(s.rideId) === String(rideB));
        assert.ok(Array.isArray(mine.coordinates));
        assert.equal(theirs.coordinates, undefined);
        assert.equal(theirs.passengerName, 'Bala');
        assert.equal(theirs.address, 'B street');
    });

    // --- 6/7. service provider -----------------------------------------------
    console.log('\nservice provider');
    const Scrap = require('../src/modules/serviceProvider/models/Scrap.js');
    const SPUser = require('../src/modules/serviceProvider/models/User.js');
    require('../src/modules/serviceProvider/models/Vendor.js'); // registered for getScrapById's populate
    const Booking = require('../src/modules/serviceProvider/models/Booking.js');
    const { getScrapById } = require('../src/modules/serviceProvider/controllers/scrapController.js');
    const { getJobById } = require('../src/modules/serviceProvider/controllers/bookingControllers/workerBookingController.js');
    const spCall = async (handler, req) => {
        const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
        await handler(req, res);
        return res;
    };
    const scrapOwner = oid();
    await SPUser.collection.insertOne({ _id: scrapOwner, name: 'Ravi', phone: '9811111111', email: 'ravi@t.test' });
    const pendingScrap = oid();
    const acceptedScrap = oid();
    const acceptingVendor = oid();
    await mongoose.connection.db.collection('sp_vendors').insertOne({ _id: acceptingVendor, name: 'Vendor', businessName: 'Scrap Co', phone: '9822222222', email: 'sv@t.test' });
    await Scrap.collection.insertMany([
        { _id: pendingScrap, userId: scrapOwner, title: 'Old AC', status: 'pending', address: { fullAddress: 'Flat 1' } },
        { _id: acceptedScrap, userId: scrapOwner, title: 'Old fridge', status: 'accepted', vendorId: acceptingVendor },
    ]);
    const asRole = (role, id) => ({ user: { id: String(id), _id: String(id) }, userRole: role });
    await check('scrap: another customer or a worker gets 404', async () => {
        assert.equal((await spCall(getScrapById, { params: { id: String(pendingScrap) }, ...asRole('USER', oid()) })).statusCode, 404);
        assert.equal((await spCall(getScrapById, { params: { id: String(pendingScrap) }, ...asRole('WORKER', oid()) })).statusCode, 404);
    });
    await check('scrap: a vendor browsing a pending request sees it without the customer\'s phone or email', async () => {
        const r = await spCall(getScrapById, { params: { id: String(pendingScrap) }, ...asRole('VENDOR', oid()) });
        assert.equal(r.statusCode, 200);
        assert.equal(r.body.data.userId.name, 'Ravi');
        assert.equal(r.body.data.userId.phone, undefined);
        assert.equal(r.body.data.userId.email, undefined);
    });
    await check('scrap: another vendor cannot read an ACCEPTED request; its vendor and owner can', async () => {
        assert.equal((await spCall(getScrapById, { params: { id: String(acceptedScrap) }, ...asRole('VENDOR', oid()) })).statusCode, 404);
        assert.equal((await spCall(getScrapById, { params: { id: String(acceptedScrap) }, ...asRole('VENDOR', acceptingVendor) })).body.data.userId.phone, '9811111111');
        assert.equal((await spCall(getScrapById, { params: { id: String(acceptedScrap) }, ...asRole('USER', scrapOwner) })).statusCode, 200);
    });

    const offeredWorker = oid();
    const openBooking = oid();
    await Booking.collection.insertOne({
        _id: openBooking, bookingNumber: 'BK-OPEN', userId: scrapOwner, workerId: null, status: 'searching',
        potentialWorkers: [{ _id: oid(), workerId: offeredWorker, distance: 2 }], notifiedWorkers: [],
    });
    const job = (workerId) => spCall(getJobById, { params: { id: String(openBooking) }, user: { id: String(workerId) } });
    await check('worker job: a worker it was never offered to is refused', async () => {
        assert.equal((await job(oid())).statusCode, 403);
    });
    await check('worker job: the offered worker sees it, without the customer\'s phone or email until assigned', async () => {
        const r = await job(offeredWorker);
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.equal(r.body.data.userId.phone, undefined);
        assert.equal(r.body.data.userId.name, 'Ravi');
    });

    await mongoose.disconnect();
    await replSet.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
