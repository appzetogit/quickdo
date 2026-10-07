/**
 * Service-provider booking features (plan §3.4–3.5).
 *
 * Run: node tests/sp-quote-booking.smoke.mjs
 *
 *  - preferred provider: offered alone first (wave 0), then the normal waves
 *    once Settings.preferredProviderTimeoutSec passes; an ineligible preferred
 *    provider is skipped;
 *  - provider listing ranked by rating and distance, only eligible providers;
 *  - add-ons priced into the booking from the catalogue;
 *  - quote flow: request -> quotes -> accept -> normal booking at that price;
 *  - before/after work photos required at start/complete (per-category toggle),
 *    legacy flat photo arrays read as 'after', and the migration script;
 *  - invoice endpoint returns application/pdf;
 *  - SOW category seed is idempotent.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.SP_DISABLE_INVOICE_EMAIL = 'true';
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

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const res = () => {
    const r = {
        statusCode: 200, body: null, headers: {}, raw: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; },
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        end(buf) { this.raw = buf; return this; }
    };
    return r;
};
const call = async (fn, { params = {}, body = {}, query = {}, user = { id: String(oid()) }, app } = {}) => {
    const r = res();
    await fn({ params, body, query, user, app: app || { get: () => null } }, r);
    return r;
};
const north = (lat, lng, km) => ({ lat: lat + km / 111.32, lng });
const waitFor = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error('timed out waiting');
        await new Promise((r) => setTimeout(r, 100));
    }
};

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'sp_quote_booking' });

    require('../src/modules/serviceProvider/models/index.js');
    const Settings = require('../src/modules/serviceProvider/models/Settings.js');
    const Worker = require('../src/modules/serviceProvider/models/Worker.js');
    const Category = require('../src/modules/serviceProvider/models/Category.js');
    const Booking = require('../src/modules/serviceProvider/models/Booking.js');
    const BookingRequest = require('../src/modules/serviceProvider/models/BookingRequest.js');
    const UserService = require('../src/modules/serviceProvider/models/UserService.js');
    const User = require('../src/modules/serviceProvider/models/User.js');
    const Quote = require('../src/modules/serviceProvider/models/Quote.js');
    const Availability = require('../src/modules/serviceProvider/models/Availability.js');
    for (const M of [Settings, Worker, Category, Booking, BookingRequest, UserService, User, Quote, Availability]) {
        await M.createCollection().catch(() => {});
    }
    await Worker.syncIndexes();
    await Quote.syncIndexes();

    // Sockets are not initialised in a test; give the controllers a no-op hub.
    const fakeIo = { to: () => ({ emit: () => {} }), emit: () => {} };
    const sockets = require('../src/modules/serviceProvider/sockets/index.js');
    sockets.getIO = () => fakeIo;

    const userCtl = require('../src/modules/serviceProvider/controllers/bookingControllers/userBookingController.js');
    const quoteCtl = require('../src/modules/serviceProvider/controllers/bookingControllers/quoteController.js');
    const providerSearch = require('../src/modules/serviceProvider/controllers/userControllers/providerSearchController.js');
    const workerCtl = require('../src/modules/serviceProvider/controllers/bookingControllers/workerBookingController.js');
    const photoCtl = require('../src/modules/serviceProvider/controllers/bookingControllers/workPhotoController.js');
    const { BookingScheduler } = require('../src/modules/serviceProvider/services/bookingScheduler.js');

    await Settings.collection.insertOne({ type: 'global', bookingModel: 'worker', searchRadius: 10, preferredProviderTimeoutSec: 60, waveDuration: 60, maxSearchTime: 30, serviceGstPercentage: 18 });

    const center = { lat: 18.52, lng: 73.85 };
    let phone = 9400000000;
    const worker = async (over = {}) => {
        const _id = oid();
        const at = over.at || center;
        delete over.at;
        await Worker.collection.insertOne({
            _id, name: over.name || 'W', phone: String(phone++), approvalStatus: 'approved', isActive: true, status: 'ONLINE', isOnline: true,
            serviceCategories: ['AC Repair'], rating: 4, subscription: { isActive: true, expiryDate: new Date(Date.now() + 30 * DAY) },
            geoLocation: { type: 'Point', coordinates: [at.lng, at.lat] }, ...over
        });
        return _id;
    };
    const acCat = oid();
    const consultCat = oid();
    const noPhotoCat = oid();
    await Category.collection.insertMany([
        { _id: acCat, title: 'AC Repair', slug: 'ac-repair', isConsultancy: false },
        { _id: consultCat, title: 'Packers & Movers', slug: 'packers-movers', isConsultancy: true },
        { _id: noPhotoCat, title: 'Doctor Consultation', slug: 'doctor-consultation', requireWorkPhotos: false }
    ]);
    const serviceId = oid();
    const filterAddOn = oid();
    await UserService.collection.insertOne({
        _id: serviceId, brandId: oid(), categoryId: acCat, title: 'AC service', basePrice: 500, gstPercentage: 18, status: 'active',
        addOns: [
            { _id: filterAddOn, name: 'Filter replacement', price: 200, gstPercentage: 18, maxQuantity: 2, isActive: true },
            { _id: oid(), name: 'Retired add-on', price: 50, isActive: false }
        ]
    });
    const userId = oid();
    await User.collection.insertOne({ _id: userId, name: 'Cust', phone: '9300000001', email: 'cust@t.test', wallet: { balance: 0, penalty: 0 } });
    const user = { id: String(userId) };

    const bookingBody = (over = {}) => ({
        serviceId: String(serviceId),
        address: { addressLine1: '1 Road', city: 'Pune', state: 'MH', pincode: '411001', lat: center.lat, lng: center.lng },
        scheduledDate: '2026-10-12', scheduledTime: '15:00', timeSlot: { start: '15:00', end: '16:00' },
        paymentMethod: 'pay_at_home',
        ...over
    });

    console.log('\nadd-ons');
    const near = await worker({ name: 'Near', at: north(center.lat, center.lng, 1), rating: 3 });
    const far = await worker({ name: 'Far', at: north(center.lat, center.lng, 6), rating: 5 });
    await check('add-ons are priced from the catalogue into basePrice, tax and the total', async () => {
        const r = await call(userCtl.createBooking, { body: bookingBody({ addOns: [{ addOnId: String(filterAddOn), quantity: 2 }] }), user });
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        const b = await Booking.findById(r.body.data._id).lean();
        assert.equal(b.addOns.length, 1);
        assert.equal(b.addOns[0].total, 400);
        assert.equal(b.addOnsTotal, 472, '400 + 18% GST');
        assert.equal(b.basePrice, 900, '500 service + 400 add-ons');
        assert.ok(b.finalAmount >= 500 * 1.18 + 472 - 0.01, `finalAmount ${b.finalAmount}`);
    });
    await check('unknown, inactive or over-quantity add-ons are refused', async () => {
        assert.equal((await call(userCtl.createBooking, { body: bookingBody({ addOns: [{ addOnId: String(oid()) }] }), user })).statusCode, 400);
        assert.equal((await call(userCtl.createBooking, { body: bookingBody({ addOns: [{ addOnId: String(filterAddOn), quantity: 3 }] }), user })).statusCode, 400);
    });

    console.log('\nprovider listing');
    await check('GET /users/providers ranks eligible providers by rating and distance', async () => {
        const offline = await worker({ name: 'Off duty', status: 'OFFLINE', rating: 5 });
        const unsub = await worker({ name: 'Lapsed', rating: 5, subscription: { isActive: false } });
        const r = await call(providerSearch.listProviders, { query: { categoryId: String(acCat), lat: String(center.lat), lng: String(center.lng), date: '2026-10-12', time: '15:00' }, user });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        const got = r.body.data.map((p) => String(p._id));
        assert.ok(got.includes(String(near)) && got.includes(String(far)));
        assert.ok(!got.includes(String(offline)) && !got.includes(String(unsub)), 'only on-duty, subscribed providers');
        assert.equal(r.body.data[0].providerType, 'worker');
        for (let i = 1; i < r.body.data.length; i++) assert.ok(r.body.data[i - 1].score >= r.body.data[i].score);
        assert.equal((await call(providerSearch.listProviders, { query: { lat: '1', lng: '1' }, user })).statusCode, 400);
        await Worker.deleteMany({ _id: { $in: [offline, unsub] } });
    });
    await check('a provider on leave on that date is not listed', async () => {
        await Availability.create({ providerType: 'worker', providerId: far, overrides: [{ date: '2026-10-12', type: 'leave' }] });
        const r = await call(providerSearch.listProviders, { query: { categoryId: String(acCat), lat: String(center.lat), lng: String(center.lng), date: '2026-10-12', time: '15:00' }, user });
        assert.ok(!r.body.data.some((p) => String(p._id) === String(far)));
        await Availability.deleteMany({});
    });

    console.log('\npreferred provider');
    let preferredBooking;
    await check('the preferred provider gets the offer alone (wave 0)', async () => {
        const r = await call(userCtl.createBooking, { body: bookingBody({ preferredProviderId: String(far) }), user });
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        assert.equal(r.body.data.preferredOffer.status, 'offered');
        preferredBooking = r.body.data._id;
        const b = await waitFor(async () => {
            const x = await Booking.findById(preferredBooking).lean();
            return x.waveStartedAt ? x : null;
        });
        assert.equal(b.currentWave, 0);
        assert.deepEqual(b.potentialWorkers.map((p) => String(p.workerId)), [String(near)], 'the rest wait for wave 1');
        const reqs = await waitFor(async () => {
            const list = await BookingRequest.find({ bookingId: preferredBooking }).lean();
            return list.length ? list : null;
        });
        assert.deepEqual(reqs.map((q) => String(q.workerId)), [String(far)]);
        assert.equal(reqs[0].wave, 0);
    });
    await check('before the timeout the scheduler leaves it alone; after it, wave 1 goes to the others', async () => {
        const scheduler = new BookingScheduler(fakeIo);
        await scheduler.processWaves();
        assert.equal((await Booking.findById(preferredBooking).lean()).currentWave, 0);
        await Booking.updateOne({ _id: preferredBooking }, { $set: { 'preferredOffer.expiresAt': new Date(Date.now() - 1000) } });
        await scheduler.processWaves();
        const b = await Booking.findById(preferredBooking).lean();
        assert.equal(b.currentWave, 1);
        assert.equal(b.preferredOffer.status, 'timed_out');
        assert.ok(b.notifiedWorkers.map(String).includes(String(near)));
        assert.ok(await BookingRequest.exists({ bookingId: preferredBooking, workerId: near }));
    });
    await check('the preferred worker can still accept while the offer stands, and it is marked accepted', async () => {
        const r = await call(userCtl.createBooking, { body: bookingBody({ preferredProviderId: String(near) }), user });
        const id = r.body.data._id;
        await waitFor(async () => BookingRequest.exists({ bookingId: id, workerId: near }));
        const acc = await call(workerCtl.respondToJob, { params: { id }, body: { status: 'ACCEPTED' }, user: { id: String(near) } });
        assert.equal(acc.statusCode, 200, JSON.stringify(acc.body));
        const b = await Booking.findById(id).lean();
        assert.equal(String(b.workerId), String(near));
        assert.equal(b.preferredOffer.status, 'accepted');
    });
    await check('an ineligible preferred provider is skipped and the normal waves run', async () => {
        const r = await call(userCtl.createBooking, { body: bookingBody({ preferredProviderId: String(oid()) }), user });
        assert.equal(r.statusCode, 201);
        assert.equal(r.body.data.preferredOffer.status, 'unavailable');
        const b = await waitFor(async () => {
            const x = await Booking.findById(r.body.data._id).lean();
            return x.waveStartedAt ? x : null;
        });
        assert.equal(b.currentWave, 1);
    });

    console.log('\nquote flow');
    let requestId;
    await check('quotes are refused for non-consultancy categories', async () => {
        const r = await call(quoteCtl.createQuoteRequest, { body: { categoryId: String(acCat), address: bookingBody().address, requirementText: 'x' }, user });
        assert.equal(r.statusCode, 400);
    });
    await Worker.updateMany({}, { $set: { serviceCategories: ['AC Repair', 'Packers & Movers'] } });
    await check('a quote request reaches providers in range', async () => {
        const r = await call(quoteCtl.createQuoteRequest, {
            body: { categoryId: String(consultCat), address: bookingBody().address, requirementText: 'Move a 2BHK', scheduledDate: '2026-10-20' },
            user
        });
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        assert.equal(r.body.data.providersNotified, 2);
        requestId = r.body.data._id;
        const b = await Booking.findById(requestId).lean();
        assert.equal(b.status, 'quote_requested');
        assert.equal(b.isConsultancyRequest, true);
        assert.equal(b.waveStartedAt ?? null, null, 'never picked up by the wave scheduler');
    });
    let nearQuote;
    let farQuote;
    await check('providers see the request and submit quotes; a provider not offered it cannot', async () => {
        const list = await call(quoteCtl.workerQuotes.listOpenRequests, { user: { id: String(near) } });
        assert.ok(list.body.data.some((x) => String(x._id) === String(requestId)));
        const outsider = await worker({ at: north(center.lat, center.lng, 40) });
        assert.equal((await call(quoteCtl.workerQuotes.submitQuote, { params: { bookingId: requestId }, body: { lineItems: [{ name: 'Move', price: 1 }] }, user: { id: String(outsider) } })).statusCode, 404);
        assert.equal((await call(quoteCtl.workerQuotes.submitQuote, { params: { bookingId: requestId }, body: { lineItems: [] }, user: { id: String(near) } })).statusCode, 400);
        const a = await call(quoteCtl.workerQuotes.submitQuote, {
            params: { bookingId: requestId },
            body: { lineItems: [{ name: 'Packing', price: 1000 }, { name: 'Truck', price: 2000, quantity: 1 }], visitingCharges: 100, note: 'Sunday ok' },
            user: { id: String(near) }
        });
        assert.equal(a.statusCode, 201, JSON.stringify(a.body));
        assert.equal(a.body.data.subtotal, 3000);
        assert.equal(a.body.data.tax, 540);
        assert.equal(a.body.data.amount, 3640);
        nearQuote = a.body.data._id;
        const b = await call(quoteCtl.workerQuotes.submitQuote, { params: { bookingId: requestId }, body: { lineItems: [{ name: 'All in', price: 4000 }], gstPercentage: 0 }, user: { id: String(far) } });
        assert.equal(b.statusCode, 201);
        farQuote = b.body.data._id;
        const revised = await call(quoteCtl.workerQuotes.submitQuote, { params: { bookingId: requestId }, body: { lineItems: [{ name: 'All in', price: 3500 }], gstPercentage: 0 }, user: { id: String(far) } });
        assert.equal(revised.statusCode, 200, 'resubmitting revises the same quote');
        assert.equal(await Quote.countDocuments({ bookingId: requestId }), 2);
    });
    await check('the customer sees both quotes, cheapest first', async () => {
        const r = await call(quoteCtl.getQuoteRequest, { params: { bookingId: requestId }, user });
        assert.equal(r.statusCode, 200);
        assert.deepEqual(r.body.data.quotes.map((q) => q.amount), [3500, 3640]);
    });
    await check('an expired quote cannot be accepted', async () => {
        await Quote.updateOne({ _id: farQuote }, { $set: { validUntil: new Date(Date.now() - 1000) } });
        const r = await call(quoteCtl.acceptQuote, { params: { quoteId: farQuote }, body: {}, user });
        assert.equal(r.statusCode, 400);
        await Quote.updateOne({ _id: farQuote }, { $set: { validUntil: new Date(Date.now() + DAY), status: 'submitted' } });
    });
    await check('accepting a quote makes it a normal booking at that price; the other is rejected', async () => {
        const r = await call(quoteCtl.acceptQuote, { params: { quoteId: nearQuote }, body: { paymentMethod: 'pay_at_home' }, user });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        const b = await Booking.findById(requestId).lean();
        assert.equal(b.status, 'assigned');
        assert.equal(String(b.workerId), String(near));
        assert.equal(b.finalAmount, 3640);
        assert.equal(b.basePrice, 3000);
        assert.equal(b.tax, 540);
        assert.equal(b.visitingCharges, 100);
        assert.equal(String(b.acceptedQuoteId), String(nearQuote));
        assert.equal((await Quote.findById(farQuote).lean()).status, 'rejected');
        assert.equal((await call(quoteCtl.acceptQuote, { params: { quoteId: farQuote }, body: {}, user })).statusCode, 400);
    });
    await check('lapsed requests expire', async () => {
        const r = await call(quoteCtl.createQuoteRequest, { body: { categoryId: String(consultCat), address: bookingBody().address, requirementText: 'x' }, user });
        await Booking.updateOne({ _id: r.body.data._id }, { $set: { quoteExpiresAt: new Date(Date.now() - 1000) } });
        await quoteCtl.expireQuotes({ force: true });
        const b = await Booking.findById(r.body.data._id).lean();
        assert.equal(b.status, 'cancelled');
        assert.equal(b.cancellationReason, 'quote_request_expired');
    });

    console.log('\nwork photos');
    const jobAt = async (status, over = {}) => {
        const _id = oid();
        await Booking.collection.insertOne({
            _id, bookingNumber: `BK${phone++}`, userId, serviceId, categoryId: acCat, serviceName: 'AC service', serviceCategory: 'AC Repair',
            basePrice: 500, finalAmount: 590, bookingModel: 'worker', workerId: near, status, visitOtp: '1234',
            address: { addressLine1: 'x', city: 'Pune', state: 'MH', pincode: '1' },
            scheduledDate: new Date(), scheduledTime: '10:00', timeSlot: { start: '10:00', end: '11:00' }, ...over
        });
        return _id;
    };
    const asNear = { id: String(near) };
    await check('starting work without a before photo is refused; with one it proceeds', async () => {
        const id = await jobAt('journey_started');
        const r = await call(workerCtl.verifyVisit, { params: { id: String(id) }, body: { otp: '1234' }, user: asNear });
        assert.equal(r.statusCode, 400);
        assert.equal(r.body.code, 'BEFORE_PHOTOS_REQUIRED');
        assert.equal((await Booking.findById(id).lean()).status, 'journey_started');
        const ok = await call(workerCtl.verifyVisit, { params: { id: String(id) }, body: { otp: '1234', location: { lat: 18.5, lng: 73.8 }, beforePhotos: ['https://img/before1.jpg'] }, user: asNear });
        assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
        const b = await Booking.findById(id).lean();
        assert.equal(b.workPhotos.before[0].url, 'https://img/before1.jpg');
        assert.equal(b.workPhotos.before[0].lat, 18.5);
        assert.equal(b.workPhotos.before[0].uploadedBy, String(near));
        assert.ok(b.workPhotos.before[0].uploadedAt);
    });
    await check('completing without an after photo is refused; the photos endpoint or afterPhotos satisfies it', async () => {
        const id = await jobAt('in_progress', { workPhotos: { before: [{ url: 'b' }], after: [] } });
        const r = await call(workerCtl.completeJob, { params: { id: String(id) }, body: {}, user: asNear });
        assert.equal(r.statusCode, 400);
        assert.equal(r.body.code, 'AFTER_PHOTOS_REQUIRED');
        const bad = await call(photoCtl.uploadWorkerPhotos, { params: { id: String(id) }, body: { phase: 'during', photos: ['x'] }, user: asNear });
        assert.equal(bad.statusCode, 400);
        const up = await call(photoCtl.uploadWorkerPhotos, { params: { id: String(id) }, body: { phase: 'after', photos: [{ url: 'https://img/after1.jpg', lat: 1, lng: 2 }] }, user: asNear });
        assert.equal(up.statusCode, 200, JSON.stringify(up.body));
        const ok = await call(workerCtl.completeJob, { params: { id: String(id) }, body: { afterPhotos: ['https://img/after2.jpg'] }, user: asNear });
        assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
        const b = await Booking.findById(id).lean();
        assert.deepEqual(b.workPhotos.after.map((p) => p.url), ['https://img/after1.jpg', 'https://img/after2.jpg']);
        assert.equal(b.status, 'work_done');
    });
    await check('the legacy workPhotos array on complete still works (as after photos)', async () => {
        const id = await jobAt('in_progress');
        const ok = await call(workerCtl.completeJob, { params: { id: String(id) }, body: { workPhotos: ['https://img/legacy.jpg'] }, user: asNear });
        assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
        assert.equal((await Booking.findById(id).lean()).workPhotos.after[0].url, 'https://img/legacy.jpg');
    });
    await check('a category with requireWorkPhotos off needs no photos', async () => {
        const id = await jobAt('journey_started', { categoryId: noPhotoCat });
        assert.equal((await call(workerCtl.verifyVisit, { params: { id: String(id) }, body: { otp: '1234' }, user: asNear })).statusCode, 200);
        assert.equal((await call(workerCtl.completeJob, { params: { id: String(id) }, body: {}, user: asNear })).statusCode, 200);
    });
    await check('old flat photo arrays read back as { before: [], after: [...] }', async () => {
        const id = await jobAt('completed', { workPhotos: ['https://img/old1.jpg', 'https://img/old2.jpg'] });
        const doc = await Booking.findById(id);
        const json = doc.toJSON();
        assert.deepEqual(json.workPhotos.before, []);
        assert.deepEqual(json.workPhotos.after.map((p) => p.url), ['https://img/old1.jpg', 'https://img/old2.jpg']);
        const r = await call(userCtl.getBookingById, { params: { id: String(id) }, user });
        assert.equal(r.body.data.workPhotos.after.length, 2);
    });
    await check('the photo migration: dry run writes nothing, apply moves old arrays into after', async () => {
        const { migrateWorkPhotos } = await import('../scripts/sp-migrate-work-photos.js');
        const quiet = () => {};
        const dry = await migrateWorkPhotos({ apply: false, log: quiet });
        assert.ok(dry.scanned >= 1);
        assert.ok(Array.isArray((await Booking.collection.findOne({ workPhotos: { $type: 'array' } }))?.workPhotos));
        await migrateWorkPhotos({ apply: true, log: quiet });
        assert.equal(await Booking.collection.countDocuments({ workPhotos: { $type: 'array' } }), 0);
        const again = await migrateWorkPhotos({ apply: true, log: quiet });
        assert.equal(again.scanned, 0);
    });

    console.log('\ninvoice');
    await check('GET /users/bookings/:id/invoice returns a PDF with an invoice number', async () => {
        await Settings.updateOne({ type: 'global' }, { $set: { invoicePrefix: 'HMS', sacCode: '998719' } });
        const id = await jobAt('completed', { addOns: [{ name: 'Filter', price: 200, quantity: 1, gstPercentage: 18, total: 200 }], addOnsTotal: 236, basePrice: 700, tax: 126, finalAmount: 826, paymentMethod: 'cash' });
        const r = await call(userCtl.getBookingInvoice, { params: { id: String(id) }, user });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.equal(r.headers['content-type'], 'application/pdf');
        assert.ok(Buffer.isBuffer(r.raw) && r.raw.subarray(0, 5).toString() === '%PDF-');
        const b = await Booking.findById(id).lean();
        assert.match(b.invoiceNumber, /^HMS-\d{4}-\d{6}$/);
        const again = await call(userCtl.getBookingInvoice, { params: { id: String(id) }, user });
        assert.equal((await Booking.findById(id).lean()).invoiceNumber, b.invoiceNumber, 'number assigned once');
        assert.ok(again.raw.length > 500);
    });
    await check('no invoice before the work is done, nor for someone else\'s booking', async () => {
        const id = await jobAt('assigned');
        assert.equal((await call(userCtl.getBookingInvoice, { params: { id: String(id) }, user })).statusCode, 400);
        const done = await jobAt('completed');
        assert.equal((await call(userCtl.getBookingInvoice, { params: { id: String(done) }, user: { id: String(oid()) } })).statusCode, 404);
    });
    await check('invoice lines come from the booking, not the commission snapshot', async () => {
        const { invoiceLines } = require('../src/modules/serviceProvider/services/invoiceService.js');
        const t = invoiceLines({ serviceName: 'AC', basePrice: 700, addOns: [{ name: 'Filter', price: 200, quantity: 1, gstPercentage: 18, total: 200 }], tax: 126, finalAmount: 826, visitingCharges: 0, commissionSnapshot: { amount: 999 } }, null);
        assert.deepEqual(t.lines.map((l) => l.amount), [500, 200]);
        assert.equal(t.total, 826);
        assert.ok(!JSON.stringify(t).includes('999'));
    });

    console.log('\ncategory seed');
    await check('the SOW category seed creates the missing categories once', async () => {
        const { seedSowCategories, SOW_CATEGORIES } = await import('../scripts/sp-seed-sow-categories.js');
        const quiet = () => {};
        const first = await seedSowCategories({ apply: true, log: quiet });
        assert.ok(first.skipped.includes('AC Repair') && first.skipped.includes('Packers & Movers') && first.skipped.includes('Doctor Consultation'));
        assert.equal(first.created.length, SOW_CATEGORIES.length - 3);
        const second = await seedSowCategories({ apply: true, log: quiet });
        assert.equal(second.created.length, 0);
        const pandit = await Category.findOne({ title: 'Pandit Booking' }).lean();
        assert.equal(pandit.requireWorkPhotos, false);
        assert.equal((await Category.findOne({ title: 'Painting' }).lean()).isConsultancy, true);
    });

    await mongoose.disconnect();
    await replSet.stop();

    console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
});
