/**
 * Service-provider onboarding & assignment eligibility (plan §3.2–3.3, §3.6).
 *
 * Run: node tests/sp-onboarding.smoke.mjs
 *
 *  - vendor subscription gate: off by default, on only after the grace date;
 *  - verification checklist: approval blocked until the Settings-required items
 *    are verified; the required list is configurable; reject needs a note;
 *  - bank details: IFSC validated, masked on read, withdrawals fall back to them;
 *  - onboarding profile: GSTIN/PAN validation, categories by name or id;
 *  - email verification through the shared OTP store;
 *  - availability calendar and personal service radius in assignment;
 *  - category-id migration (dry run vs apply);
 *  - worker earnings by day/week/month.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.USE_DEFAULT_OTP = 'true'; // static 123456 outside production
process.env.SP_DISABLE_INVOICE_EMAIL = 'true';
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'test';

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
const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const call = async (fn, { params = {}, body = {}, query = {}, user = { id: String(oid()) } } = {}) => {
    const r = res();
    await fn({ params, body, query, user }, r);
    return r;
};

// Point offset by km to the north of (lat, lng).
const north = (lat, lng, km) => ({ lat: lat + km / 111.32, lng });

const main = async () => {
    const elig = require('../src/modules/serviceProvider/services/providerEligibility.js');

    console.log('\npure helpers');
    await check('vendor gate: off when the flag is off, on only after the grace date', async () => {
        const now = new Date('2026-10-07T10:00:00Z');
        assert.equal(elig.vendorSubscriptionGateActive({}, now), false);
        assert.equal(elig.vendorSubscriptionGateActive({ requireVendorSubscription: false, vendorSubscriptionGraceUntil: null }, now), false);
        assert.equal(elig.vendorSubscriptionGateActive({ requireVendorSubscription: true, vendorSubscriptionGraceUntil: null }, now), true);
        assert.equal(elig.vendorSubscriptionGateActive({ requireVendorSubscription: true, vendorSubscriptionGraceUntil: new Date('2026-11-01') }, now), false);
        assert.equal(elig.vendorSubscriptionGateActive({ requireVendorSubscription: true, vendorSubscriptionGraceUntil: new Date('2026-10-01') }, now), true);
    });
    await check('bookingSlot parses date + 12h/24h times in IST; instant = now', async () => {
        const s = elig.bookingSlot({ scheduledDate: '2026-10-12', timeSlot: { start: '02:30 PM' } });
        assert.deepEqual(s, { dateStr: '2026-10-12', weekday: 1, minutes: 14 * 60 + 30 });
        const t = elig.bookingSlot({ scheduledDate: new Date('2026-10-11T19:00:00Z'), scheduledTime: '09:00' });
        assert.equal(t.dateStr, '2026-10-12', '19:00Z is 00:30 IST the next day');
        const n = elig.bookingSlot({ bookingType: 'instant' }, new Date('2026-10-07T04:30:00Z'));
        assert.equal(n.dateStr, '2026-10-07');
        assert.equal(n.minutes, 10 * 60);
    });
    await check('isAvailableAt: no calendar = available; weekly hours; leave and custom overrides', async () => {
        const cal = {
            weekly: [{ day: 1, slots: [{ start: '09:00', end: '18:00' }] }, { day: 0, off: true, slots: [] }],
            overrides: [{ date: '2026-10-19', type: 'leave', slots: [] }, { date: '2026-10-26', type: 'custom', slots: [{ start: '20:00', end: '22:00' }] }]
        };
        assert.equal(elig.isAvailableAt(null, { dateStr: '2026-10-12', weekday: 1, minutes: 600 }), true);
        assert.equal(elig.isAvailableAt(cal, { dateStr: '2026-10-12', weekday: 1, minutes: 600 }), true);
        assert.equal(elig.isAvailableAt(cal, { dateStr: '2026-10-12', weekday: 1, minutes: 19 * 60 }), false, 'after hours');
        assert.equal(elig.isAvailableAt(cal, { dateStr: '2026-10-11', weekday: 0, minutes: 600 }), false, 'day off');
        assert.equal(elig.isAvailableAt(cal, { dateStr: '2026-10-13', weekday: 2, minutes: 600 }), false, 'weekday not listed');
        assert.equal(elig.isAvailableAt(cal, { dateStr: '2026-10-19', weekday: 1, minutes: 600 }), false, 'leave');
        assert.equal(elig.isAvailableAt(cal, { dateStr: '2026-10-26', weekday: 1, minutes: 600 }), false, 'custom hours only');
        assert.equal(elig.isAvailableAt(cal, { dateStr: '2026-10-26', weekday: 1, minutes: 21 * 60 }), true);
        assert.equal(elig.isAvailableAt({ weekly: [], overrides: [] }, { dateStr: '2026-10-13', weekday: 2, minutes: 1 }), true, 'empty weekly = all week');
    });
    const onb = require('../src/modules/serviceProvider/utils/providerOnboarding.js');
    await check('IFSC / account validation and masking', async () => {
        assert.ok(onb.normalizeBankDetails({ accountNumber: '12345678901', ifscCode: 'sbin0001234', accountHolderName: 'A' }).value);
        assert.match(onb.normalizeBankDetails({ accountNumber: '12345678901', ifscCode: 'SBIN1234', accountHolderName: 'A' }).error, /IFSC/);
        assert.match(onb.normalizeBankDetails({ accountNumber: '12', ifscCode: 'SBIN0001234', accountHolderName: 'A' }).error, /accountNumber/);
        assert.ok(onb.normalizeBankDetails({ upiId: 'name@okaxis' }).value, 'UPI alone is enough');
        assert.equal(onb.maskAccountNumber('12345678901'), 'XXXXXXX8901');
    });

    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'sp_onboarding' });

    require('../src/modules/serviceProvider/models/index.js');
    const Settings = require('../src/modules/serviceProvider/models/Settings.js');
    const Vendor = require('../src/modules/serviceProvider/models/Vendor.js');
    const Worker = require('../src/modules/serviceProvider/models/Worker.js');
    const Category = require('../src/modules/serviceProvider/models/Category.js');
    const Booking = require('../src/modules/serviceProvider/models/Booking.js');
    const VendorBill = require('../src/modules/serviceProvider/models/VendorBill.js');
    const Withdrawal = require('../src/modules/serviceProvider/models/Withdrawal.js');
    const Availability = require('../src/modules/serviceProvider/models/Availability.js');
    const Token = require('../src/modules/serviceProvider/models/Token.js');
    for (const M of [Settings, Vendor, Worker, Category, Booking, VendorBill, Withdrawal, Availability, Token]) {
        await M.createCollection().catch(() => {});
    }
    await Vendor.syncIndexes();
    await Worker.syncIndexes();
    await Availability.syncIndexes();

    const adminVendor = require('../src/modules/serviceProvider/controllers/adminControllers/adminVendorController.js');
    const adminWorker = require('../src/modules/serviceProvider/controllers/adminControllers/adminWorkerController.js');
    const verification = require('../src/modules/serviceProvider/controllers/adminControllers/adminVerificationController.js');
    const settingsCtl = require('../src/modules/serviceProvider/controllers/adminControllers/settingsController.js');
    const onboarding = require('../src/modules/serviceProvider/controllers/providerControllers/providerOnboardingController.js');
    const workerWallet = require('../src/modules/serviceProvider/controllers/workerControllers/workerWalletController.js');
    const vendorWallet = require('../src/modules/serviceProvider/controllers/vendorControllers/vendorWalletController.js');
    const location = require('../src/modules/serviceProvider/services/locationService.js');
    const dashboard = require('../src/modules/serviceProvider/controllers/workerControllers/workerDashboardController.js');

    await Settings.collection.insertOne({ type: 'global', searchRadius: 5 });

    let phone = 9500000000;
    const center = { lat: 18.52, lng: 73.85 };
    const vendor = async (over = {}) => {
        const _id = oid();
        await Vendor.collection.insertOne({
            _id, name: 'V', businessName: 'Biz', email: `on${phone}@t.test`, phone: String(phone++),
            approvalStatus: 'approved', isActive: true, categories: ['AC'], address: { city: 'Pune', lat: center.lat, lng: center.lng },
            location: { lat: center.lat, lng: center.lng }, settings: { serviceRange: 10 }, ...over
        });
        return _id;
    };
    const worker = async (over = {}) => {
        const _id = oid();
        const at = over.at || center;
        delete over.at;
        await Worker.collection.insertOne({
            _id, name: 'W', phone: String(phone++), approvalStatus: 'approved', isActive: true, status: 'ONLINE',
            serviceCategories: ['AC'], subscription: { isActive: true, expiryDate: new Date(Date.now() + 30 * DAY) },
            geoLocation: { type: 'Point', coordinates: [at.lng, at.lat] }, ...over
        });
        return _id;
    };

    console.log('\nvendor subscription gate');
    const unsubscribed = await vendor();
    const ids = (list) => list.map((v) => String(v._id));
    await check('flag off (default): a vendor without a subscription is still offered jobs', async () => {
        const s = await Settings.findOne({ type: 'global' }).lean();
        assert.equal(s.requireVendorSubscription ?? false, false);
        const found = await location.findVendorsByCity('Pune', { service: 'AC' });
        assert.ok(ids(found).includes(String(unsubscribed)));
    });
    await check('admin settings accept the flag and the grace date; bad dates are refused', async () => {
        const bad = await call(settingsCtl.updateSettings, { body: { vendorSubscriptionGraceUntil: 'not a date' } });
        assert.equal(bad.statusCode, 400);
        const ok = await call(settingsCtl.updateSettings, { body: { requireVendorSubscription: true, vendorSubscriptionGraceUntil: new Date(Date.now() + 7 * DAY).toISOString() } });
        assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
    });
    await check('flag on, grace not passed: still offered', async () => {
        assert.ok(ids(await location.findVendorsByCity('Pune', { service: 'AC' })).includes(String(unsubscribed)));
    });
    await check('flag on, grace passed: only subscribed vendors', async () => {
        await Settings.updateOne({ type: 'global' }, { $set: { vendorSubscriptionGraceUntil: new Date(Date.now() - DAY) } });
        const subscribed = await vendor({ subscription: { isActive: true, expiryDate: new Date(Date.now() + 10 * DAY) } });
        const found = ids(await location.findVendorsByCity('Pune', { service: 'AC' }));
        assert.ok(!found.includes(String(unsubscribed)));
        assert.ok(found.includes(String(subscribed)));
        await Settings.updateOne({ type: 'global' }, { $set: { requireVendorSubscription: false } });
    });

    console.log('\nverification checklist');
    const pendingVendor = await vendor({ approvalStatus: 'pending', aadhar: { number: '1', document: 'a', backDocument: 'b' }, pan: { number: 'ABCDE1234F', document: 'p' } });
    await check('approval is blocked until aadhaar, pan and address are verified', async () => {
        const r = await call(adminVendor.approveVendor, { params: { id: String(pendingVendor) } });
        assert.equal(r.statusCode, 400);
        assert.equal(r.body.code, 'VERIFICATION_INCOMPLETE');
        assert.deepEqual(r.body.missing.sort(), ['aadhaar', 'address', 'pan']);
    });
    await check('rejecting an item needs a note; unknown items are refused', async () => {
        assert.equal((await call(verification.setVendorVerification, { params: { id: String(pendingVendor), item: 'pan' }, body: { status: 'rejected' } })).statusCode, 400);
        assert.equal((await call(verification.setVendorVerification, { params: { id: String(pendingVendor), item: 'passport' }, body: { status: 'verified' } })).statusCode, 400);
        const r = await call(verification.setVendorVerification, { params: { id: String(pendingVendor), item: 'pan' }, body: { status: 'rejected', note: 'blurry' } });
        assert.equal(r.statusCode, 200);
        assert.equal(r.body.data.verification.items.pan.status, 'rejected');
    });
    await check('after verifying the required items the vendor can be approved (background optional)', async () => {
        const adminId = String(oid());
        for (const item of ['aadhaar', 'pan', 'address']) {
            const r = await call(verification.setVendorVerification, { params: { id: String(pendingVendor), item }, body: { status: 'verified' }, user: { id: adminId } });
            assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        }
        const v = await Vendor.findById(pendingVendor).lean();
        assert.equal(String(v.verification.aadhaar.verifiedBy), adminId);
        assert.ok(v.verification.aadhaar.verifiedAt);
        const r = await call(adminVendor.approveVendor, { params: { id: String(pendingVendor) } });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.equal((await Vendor.findById(pendingVendor).lean()).approvalStatus, 'approved');
    });
    await check('verifying gst sets gst.verified', async () => {
        await call(verification.setVendorVerification, { params: { id: String(pendingVendor), item: 'gst' }, body: { status: 'verified' } });
        assert.equal((await Vendor.findById(pendingVendor).lean()).gst.verified, true);
    });
    await check('the required list is a setting: workers can be approved on aadhaar alone', async () => {
        const w = await worker({ approvalStatus: 'pending' });
        assert.equal((await call(adminWorker.approveWorker, { params: { id: String(w) } })).statusCode, 400);
        const bad = await call(settingsCtl.updateSettings, { body: { workerRequiredVerifications: ['aadhaar', 'retina'] } });
        assert.equal(bad.statusCode, 400);
        assert.equal((await call(settingsCtl.updateSettings, { body: { workerRequiredVerifications: ['aadhaar'] } })).statusCode, 200);
        await call(verification.setWorkerVerification, { params: { id: String(w), item: 'aadhaar' }, body: { status: 'verified' } });
        const r = await call(adminWorker.approveWorker, { params: { id: String(w) } });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    });
    await check('admin detail shows the checklist and a masked account number', async () => {
        await Vendor.updateOne({ _id: pendingVendor }, { $set: { bankDetails: { accountNumber: '123456789012', ifscCode: 'HDFC0001234', accountHolderName: 'V' } } });
        const r = await call(adminVendor.getVendorDetails, { params: { id: String(pendingVendor) } });
        assert.equal(r.statusCode, 200);
        assert.equal(r.body.data.onboarding.bankDetails.accountNumber, 'XXXXXXXX9012');
        assert.equal(r.body.data.vendor.bankDetails.accountNumber, 'XXXXXXXX9012');
        assert.equal(r.body.data.onboarding.verification.items.pan.status, 'verified');
        assert.equal(r.body.data.onboarding.verification.missing.length, 0);
    });

    console.log('\nbank details and withdrawals');
    const vOnb = onboarding.forRole('vendor');
    const wOnb = onboarding.forRole('worker');
    await check('PUT /bank-details validates IFSC and returns the account masked', async () => {
        const w = await worker();
        const bad = await call(wOnb.updateBankDetails, { body: { accountNumber: '123456789', ifscCode: 'BAD', accountHolderName: 'W' }, user: { id: String(w) } });
        assert.equal(bad.statusCode, 400);
        const ok = await call(wOnb.updateBankDetails, { body: { bankDetails: { accountNumber: '1234567890', ifscCode: 'icic0000001', accountHolderName: 'W', bankName: 'ICICI' } }, user: { id: String(w) } });
        assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
        assert.equal(ok.body.data.bankDetails.accountNumber, 'XXXXXX7890');
        const saved = await Worker.findById(w).lean();
        assert.equal(saved.bankDetails.ifscCode, 'ICIC0000001');
        assert.equal(saved.bankDetails.accountNumber, '1234567890');
    });
    await check('a worker withdrawal without bankDetails uses the saved ones; none saved = 400', async () => {
        const w = await worker({ wallet: { balance: 500 }, bankDetails: { accountNumber: '9876543210', ifscCode: 'SBIN0001234', accountHolderName: 'W' } });
        const r = await call(workerWallet.requestWithdrawal, { body: { amount: 200 }, user: { id: String(w) } });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        const wd = await Withdrawal.findOne({ workerId: w }).lean();
        assert.equal(wd.bankDetails.accountNumber, '9876543210');
        const none = await worker({ wallet: { balance: 500 } });
        const r2 = await call(workerWallet.requestWithdrawal, { body: { amount: 200 }, user: { id: String(none) } });
        assert.equal(r2.statusCode, 400);
        assert.match(r2.body.message, /bank details/i);
    });
    await check('a vendor withdrawal with a bad IFSC is refused; saved details are used otherwise', async () => {
        const v = await vendor({ wallet: { earnings: 1000 }, bankDetails: { accountNumber: '111122223333', ifscCode: 'UTIB0000123', accountHolderName: 'V' } });
        const bad = await call(vendorWallet.requestWithdrawal, { body: { amount: 100, bankDetails: { accountNumber: '111122223333', ifscCode: 'XX', accountHolderName: 'V' } }, user: { id: String(v) } });
        assert.equal(bad.statusCode, 400);
        const ok = await call(vendorWallet.requestWithdrawal, { body: { amount: 100 }, user: { id: String(v) } });
        assert.ok([200, 201].includes(ok.statusCode), JSON.stringify(ok.body));
        assert.equal((await Withdrawal.findOne({ vendorId: v }).lean()).bankDetails.ifscCode, 'UTIB0000123');
    });

    console.log('\nonboarding profile and categories');
    const ac = oid();
    const plumbing = oid();
    await Category.collection.insertMany([{ _id: ac, title: 'AC', slug: 'ac' }, { _id: plumbing, title: 'Plumber', slug: 'plumber' }]);
    await check('GSTIN / PAN / experience validated; certifications saved', async () => {
        const w = await worker();
        const user = { id: String(w) };
        assert.equal((await call(wOnb.updateOnboarding, { body: { gst: { number: 'NOTAGSTIN' } }, user })).statusCode, 400);
        assert.equal((await call(wOnb.updateOnboarding, { body: { pan: { number: '123' } }, user })).statusCode, 400);
        assert.equal((await call(wOnb.updateOnboarding, { body: { experienceYears: 200 }, user })).statusCode, 400);
        const r = await call(wOnb.updateOnboarding, {
            body: {
                gst: { number: '27abcde1234f1z5', document: 'https://x/gst.pdf' },
                pan: { number: 'abcde1234f', document: 'https://x/pan.jpg' },
                experienceYears: 6,
                serviceRadiusKm: 12,
                certifications: [{ name: 'ITI Electrician', issuer: 'NCVT', expiresAt: '2028-01-01' }]
            },
            user
        });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.equal(r.body.data.gst.number, '27ABCDE1234F1Z5');
        assert.equal(r.body.data.gst.verified, false, 'providers cannot self-verify');
        assert.equal(r.body.data.pan.number, 'ABCDE1234F');
        assert.equal(r.body.data.serviceRadiusKm, 12);
        assert.equal(r.body.data.certifications[0].issuer, 'NCVT');
    });
    await check('categories accept names or ids and store both forms; unknown ids are refused', async () => {
        const v = await vendor();
        const user = { id: String(v) };
        assert.equal((await call(vOnb.updateOnboarding, { body: { categories: [String(oid())] }, user })).statusCode, 400);
        const r = await call(vOnb.updateOnboarding, { body: { categories: ['ac', String(plumbing), 'Gardening'] }, user });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        const saved = await Vendor.findById(v).lean();
        assert.deepEqual(saved.categoryIds.map(String).sort(), [String(ac), String(plumbing)].sort());
        assert.deepEqual(saved.categories, ['AC', 'Plumber', 'Gardening'], 'names kept, unknown name kept as text');
    });

    console.log('\nemail verification');
    await check('send-otp then verify sets isEmailVerified; a wrong code does not', async () => {
        const w = await worker({ email: `mail${phone}@t.test` });
        const user = { id: String(w) };
        const sent = await call(wOnb.sendEmailOtp, { user });
        assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
        assert.equal((await call(wOnb.verifyEmailOtp, { body: { otp: '12345' }, user })).statusCode, 400);
        const ok = await call(wOnb.verifyEmailOtp, { body: { otp: '123456' }, user });
        assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
        assert.equal((await Worker.findById(w).lean()).isEmailVerified, true);
    });
    await check('changing the email resets verification; a taken email is refused', async () => {
        const a = await vendor({ isEmailVerified: true });
        const b = await vendor();
        const bEmail = (await Vendor.findById(b).lean()).email;
        assert.equal((await call(vOnb.sendEmailOtp, { body: { email: bEmail }, user: { id: String(a) } })).statusCode, 409);
        const r = await call(vOnb.sendEmailOtp, { body: { email: 'fresh@t.test' }, user: { id: String(a) } });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        const saved = await Vendor.findById(a).lean();
        assert.equal(saved.email, 'fresh@t.test');
        assert.equal(saved.isEmailVerified, false);
    });

    console.log('\navailability and radius in assignment');
    await Worker.deleteMany({});
    await check('availability endpoints validate and save weekly hours and overrides', async () => {
        const w = await worker();
        const user = { id: String(w) };
        assert.equal((await call(wOnb.putAvailability, { body: { weekly: [{ day: 9, slots: [] }] }, user })).statusCode, 400);
        assert.equal((await call(wOnb.putAvailability, { body: { weekly: [{ day: 1, slots: [{ start: '18:00', end: '09:00' }] }] }, user })).statusCode, 400);
        const ok = await call(wOnb.putAvailability, { body: { weekly: [{ day: 1, slots: [{ start: '09:00', end: '13:00' }] }] }, user });
        assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
        const o = await call(wOnb.addOverride, { body: { date: '2026-10-19', type: 'leave', note: 'Diwali' }, user });
        assert.equal(o.statusCode, 200, JSON.stringify(o.body));
        assert.equal(o.body.data.overrides.length, 1);
        const again = await call(wOnb.addOverride, { body: { date: '2026-10-19', type: 'custom', slots: [{ start: '10:00', end: '11:00' }] }, user });
        assert.equal(again.body.data.overrides.length, 1, 'same date replaced, not duplicated');
        const del = await call(wOnb.removeOverride, { params: { date: '2026-10-19' }, user });
        assert.equal(del.body.data.overrides.length, 0);
        await Worker.deleteOne({ _id: w });
        await Availability.deleteMany({});
    });
    await check('assignment skips workers unavailable at the booking slot', async () => {
        const free = await worker();
        const offHours = await worker();
        const onLeave = await worker();
        await Availability.create([
            { providerType: 'worker', providerId: offHours, weekly: [{ day: 1, slots: [{ start: '09:00', end: '12:00' }] }] },
            { providerType: 'worker', providerId: onLeave, overrides: [{ date: '2026-10-12', type: 'leave' }] }
        ]);
        const slot = elig.bookingSlot({ scheduledDate: '2026-10-12', timeSlot: { start: '15:00' } });
        const found = ids(await location.findNearbyWorkers(center, 5, { service: 'AC', slot }));
        assert.ok(found.includes(String(free)));
        assert.ok(!found.includes(String(offHours)), 'outside weekly hours');
        assert.ok(!found.includes(String(onLeave)), 'on leave');
        const morning = elig.bookingSlot({ scheduledDate: '2026-10-12', timeSlot: { start: '10:00' } });
        assert.ok(ids(await location.findNearbyWorkers(center, 5, { service: 'AC', slot: morning })).includes(String(offHours)));
        await Worker.deleteMany({});
        await Availability.deleteMany({});
    });
    await check('a worker\'s own serviceRadiusKm narrows or widens the global radius', async () => {
        const nearButSmall = await worker({ at: north(center.lat, center.lng, 3), serviceRadiusKm: 2 });
        const farButWide = await worker({ at: north(center.lat, center.lng, 8), serviceRadiusKm: 15 });
        const farDefault = await worker({ at: north(center.lat, center.lng, 8) });
        const nearDefault = await worker({ at: north(center.lat, center.lng, 2) });
        const found = ids(await location.findNearbyWorkers(center, 5, { service: 'AC' }));
        assert.ok(!found.includes(String(nearButSmall)), '3 km away, works within 2 km');
        assert.ok(found.includes(String(farButWide)), '8 km away, works within 15 km');
        assert.ok(!found.includes(String(farDefault)), '8 km away, global radius 5 km');
        assert.ok(found.includes(String(nearDefault)));
        await Worker.deleteMany({});
    });
    await check('workers are matched by categoryIds as well as names', async () => {
        const byId = await worker({ serviceCategories: [], categoryIds: [ac] });
        const found = ids(await location.findNearbyWorkers(center, 5, { service: 'AC', categoryId: ac }));
        assert.ok(found.includes(String(byId)));
        await Worker.deleteMany({});
    });

    console.log('\ncategory-id migration');
    await check('dry run reports, apply writes, rerun is a no-op', async () => {
        const { migrateCategoryIds } = await import('../scripts/sp-migrate-category-ids.js');
        const w = await worker({ serviceCategories: ['ac', 'Unknown Trade'] });
        const quiet = () => {};
        const dry = await migrateCategoryIds({ apply: false, log: quiet });
        assert.ok(dry.worker.changed >= 1);
        assert.equal(((await Worker.findById(w).lean()).categoryIds || []).length, 0, 'dry run writes nothing');
        await migrateCategoryIds({ apply: true, log: quiet });
        assert.deepEqual((await Worker.findById(w).lean()).categoryIds.map(String), [String(ac)]);
        const again = await migrateCategoryIds({ apply: true, log: quiet });
        assert.equal(again.worker.changed, 0);
        assert.ok(again.unmatched['Unknown Trade']);
        await Worker.deleteMany({});
    });

    console.log('\nworker earnings breakdown');
    await check('daily / weekly / monthly buckets and today/week/month summary', async () => {
        const w = await worker();
        const now = Date.now();
        const mk = async (daysAgo, amount, over = {}) => {
            const _id = oid();
            await Booking.collection.insertOne({
                _id, bookingNumber: `BK${phone++}`, userId: oid(), serviceId: oid(), serviceName: 'AC', serviceCategory: 'AC',
                basePrice: amount, finalAmount: amount, bookingModel: 'worker', workerId: w, status: 'completed',
                completedAt: new Date(now - daysAgo * DAY), address: { addressLine1: 'x', city: 'Pune', state: 'MH', pincode: '1' },
                scheduledDate: new Date(), scheduledTime: '10:00', timeSlot: { start: '10:00', end: '11:00' }, ...over
            });
            return _id;
        };
        await mk(0, 800, { commissionSnapshot: { model: 'subscription', amount: 0 } });
        await mk(0, 2000, { commissionSnapshot: { model: 'commission', amount: 300 } });
        const billed = await mk(40, 1500);
        await VendorBill.collection.insertOne({ bookingId: billed, workerId: w, grandTotal: 1500, vendorTotalEarning: 1500, status: 'paid' });
        const r = await call(dashboard.getEarningsBreakdown, { query: { period: 'daily' }, user: { id: String(w) } });
        assert.equal(r.statusCode, 200, JSON.stringify(r.body));
        assert.equal(r.body.data.summary.today, 2500, '800 + (2000 - 300)');
        assert.equal(r.body.data.summary.total, 4000);
        const today = r.body.data.earningsData.find((b) => b.period === elig.localParts(new Date()).dateStr);
        assert.equal(today.jobs, 2);
        assert.equal(r.body.data.earningsData.length, 1, 'the 40-day-old job is outside the daily window');
        const m = await call(dashboard.getEarningsBreakdown, { query: { period: 'monthly' }, user: { id: String(w) } });
        assert.equal(m.body.data.earningsData.reduce((s, b) => s + b.earnings, 0), 4000);
        const wk = await call(dashboard.getEarningsBreakdown, { query: { period: 'weekly' }, user: { id: String(w) } });
        assert.match(wk.body.data.earningsData[0].period, /^\d{4}-W\d{2}$/);
        const stats = await call(dashboard.getDashboardStats, { user: { id: String(w) } });
        assert.equal(stats.body.data.earningsBreakdown.today, 2500);
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
