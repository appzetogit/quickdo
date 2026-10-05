/**
 * A medical store signs up, is reviewed, and is only live once complete.
 *
 * Run: node tests/partner-onboarding.smoke.mjs
 *
 * What this guards:
 *   - the phone check says where a partner stands (new / pending / rejected /
 *     approved) instead of refusing pending and rejected sellers blind;
 *   - a pharmacy cannot be submitted or approved without the documents and the
 *     front photo, and the refusal names what is missing;
 *   - a rejected pharmacy sees the reason and can resubmit;
 *   - the onboarding token is not a seller session;
 *   - the store type survives registration (it used to be dropped, so every
 *     app pharmacy became a grocery store);
 *   - an expired drug licence takes a live pharmacy offline.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

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

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('partner_onboarding');
await mongoose.connect(mongo.getUri('partner_onboarding'));

const B = '../src/modules/quickCommerce/modules/food';
const rules = await import(`${B}/shared/partnerOnboarding.js`);
const partner = await import(`${B}/partner/partner.service.js`);
const { FoodRestaurant } = await import(`${B}/restaurant/models/restaurant.model.js`);
const { validateRestaurantRegisterDto } = await import(`${B}/restaurant/validators/restaurant.validator.js`);
const { approveRestaurant } = await import(`${B}/admin/services/admin.service.js`);
const { loadRestaurantForOrdering } = await import(`${B}/orders/services/order-pricing.service.js`);
const { verifyAccessToken } = await import('../src/modules/quickCommerce/core/auth/token.util.js');

const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);

/** Everything a pharmacy application needs. */
const complete = (overrides = {}) => ({
    restaurantName: 'Care Pharmacy',
    ownerName: 'Asha Verma',
    ownerEmail: 'asha@example.com',
    addressLine1: '12 MG Road',
    city: 'Indore',
    state: 'MP',
    pincode: '452001',
    formattedAddress: '12 MG Road, Indore',
    latitude: '22.7196',
    longitude: '75.8577',
    drugLicenseNumber: 'MP-DL-2024-001',
    drugLicenseExpiry: future,
    drugLicenseImage: '/uploads/qc/partners/dl.webp',
    panNumber: 'ABCDE1234F',
    nameOnPan: 'Asha Verma',
    panImage: '/uploads/qc/partners/pan.webp',
    businessRegistrationImage: '/uploads/qc/partners/reg.pdf',
    pharmacistName: 'R. Kumar',
    pharmacistRegistrationNumber: 'PCI-55512',
    pharmacistCertificateImage: '/uploads/qc/partners/pharmacist.pdf',
    storeFrontImage: '/uploads/qc/partners/front.webp',
    accountHolderName: 'Asha Verma',
    accountNumber: '123456789012',
    ifscCode: 'HDFC0001234',
    upiId: 'asha@upi',
    ...overrides,
});

const { OtpRateLimit } = await import('../src/core/otp/otpRateLimit.model.js');

// Each step signs in again, which a real partner would not do four times in ten
// minutes; the shared OTP budget (3 per 10 min) is tested elsewhere.
const verify = async (phone, type = 'medical') => {
    await OtpRateLimit.deleteMany({});
    const { otp } = await partner.requestPartnerOtp({ phone, type });
    assert.ok(otp, 'no OTP exposed in test mode');
    return partner.verifyPartnerOtp({ phone, otp: String(otp), type });
};

console.log('\nthe list');

await check('an empty pharmacy application names what is missing', () => {
    const { missing, complete: done } = rules.evaluateApplication('medical', {});
    assert.equal(done, false);
    for (const label of ['Drug licence number', 'Front / entrance photo', 'Pharmacist registration certificate', 'IFSC code']) {
        assert.ok(missing.includes(label), `missing list lacks ${label}`);
    }
    assert.ok(!missing.includes('Email'), 'email is optional');
    assert.ok(!missing.includes('Inside the store photo'), 'inside photo is optional');
});

await check('GST certificate is required only when GST registered', () => {
    const base = { gstRegistered: false };
    assert.ok(!rules.evaluateApplication('medical', base).missing.includes('GST certificate'));
    assert.ok(rules.evaluateApplication('medical', { gstRegistered: true }).missing.includes('GST certificate'));
});

await check('licence states: valid, expiring within 30 days, expired, missing', () => {
    const now = new Date('2026-09-17T00:00:00Z');
    assert.equal(rules.drugLicenceStatus({ drugLicenseExpiry: '2027-09-17' }, now).state, 'valid');
    assert.equal(rules.drugLicenceStatus({ drugLicenseExpiry: '2026-10-01' }, now).state, 'expiring');
    assert.equal(rules.drugLicenceStatus({ drugLicenseExpiry: '2026-09-16' }, now).state, 'expired');
    assert.equal(rules.drugLicenceStatus({}, now).state, 'missing');
});

console.log('\nsigning up');

let token;

await check('a new number is told it is new, with an onboarding token', async () => {
    const out = await verify('9812345601');
    assert.equal(out.state, 'new');
    assert.ok(out.onboardingToken);
    assert.equal(out.session, undefined, 'a new partner must not get a session');
    token = out.onboardingToken;
});

await check('the onboarding token is not a seller session', () => {
    assert.throws(() => verifyAccessToken(token));
});

await check('an incomplete pharmacy application is refused, naming what is missing', async () => {
    await assert.rejects(
        () => partner.submitApplication(token, complete({ storeFrontImage: '', pharmacistCertificateImage: '' })),
        /Front \/ entrance photo|Pharmacist registration certificate/,
    );
    assert.equal(await FoodRestaurant.countDocuments({}), 0);
});

await check('a complete one is created pending, as a pharmacy, with every document', async () => {
    const out = await partner.submitApplication(token, complete());
    assert.equal(out.state, 'pending');
    const doc = await FoodRestaurant.findOne({ ownerPhoneLast10: '9812345601' }).lean();
    assert.equal(doc.storeType, 'pharmacy');
    assert.equal(doc.status, 'pending');
    assert.equal(doc.pharmacist.registrationNumber, 'PCI-55512');
    assert.equal(doc.storePhotos.front, '/uploads/qc/partners/front.webp');
    assert.equal(doc.drugLicenseNumber, 'MP-DL-2024-001');
});

await check('the phone in the token wins over one in the body', async () => {
    const fresh = await verify('9812345602');
    await partner.submitApplication(fresh.onboardingToken, complete({ restaurantName: 'Body Phone', ownerPhone: '9000000000' }));
    assert.equal(await FoodRestaurant.countDocuments({ ownerPhoneLast10: '9000000000' }), 0);
    assert.equal(await FoodRestaurant.countDocuments({ ownerPhoneLast10: '9812345602' }), 1);
});

await check('THE OLD BUG: registration keeps storeType and the licence', () => {
    const v = validateRestaurantRegisterDto({
        restaurantName: 'X', ownerName: 'Y', pureVegRestaurant: 'false',
        storeType: 'pharmacy', drugLicenseNumber: 'N', drugLicenseExpiry: future,
    });
    assert.equal(v.storeType, 'pharmacy');
    assert.equal(v.drugLicenseNumber, 'N');
});

await check('signing in again shows pending, not a refusal', async () => {
    const out = await verify('9812345601');
    assert.equal(out.state, 'pending');
    assert.equal(out.checklist.complete, true);
    assert.equal(out.application.restaurantName, 'Care Pharmacy');
});

console.log('\nreview');

const idOf = async (last10) => String((await FoodRestaurant.findOne({ ownerPhoneLast10: last10 }).lean())._id);

await check('rejecting needs a reason', async () => {
    const id = await idOf('9812345601');
    await assert.rejects(() => partner.rejectApplication(id, ''), /reason/);
});

await check('a rejected pharmacy sees the reason when it signs in', async () => {
    await partner.rejectApplication(await idOf('9812345601'), 'Drug licence photo is blurred');
    const out = await verify('9812345601');
    assert.equal(out.state, 'rejected');
    assert.equal(out.application.rejectionReason, 'Drug licence photo is blurred');
    assert.ok(out.onboardingToken);
    token = out.onboardingToken;
});

await check('  and resubmitting goes back to pending with the reason cleared', async () => {
    const out = await partner.submitApplication(token, { drugLicenseImage: '/uploads/qc/partners/dl-clear.webp' });
    assert.equal(out.state, 'pending');
    const doc = await FoodRestaurant.findOne({ ownerPhoneLast10: '9812345601' }).lean();
    assert.equal(doc.drugLicenseImage, '/uploads/qc/partners/dl-clear.webp');
    assert.equal(doc.rejectionReason, undefined);
});

await check('  but a resubmission that removes a required document is refused', async () => {
    await assert.rejects(() => partner.submitApplication(token, { storeFrontImage: '' }), /Front \/ entrance photo/);
});

await check('an incomplete pharmacy cannot be approved, from either admin screen', async () => {
    const bare = await FoodRestaurant.create({
        restaurantName: 'Bare Pharmacy', ownerName: 'Z', ownerPhone: '9812345699', storeType: 'pharmacy', status: 'pending',
    });
    await assert.rejects(() => partner.approveApplication(String(bare._id)), /Still needed/);
    await assert.rejects(() => approveRestaurant(String(bare._id)), /Still needed/);
});

await check('a complete one is approved, and the next sign-in is a real session', async () => {
    await partner.approveApplication(await idOf('9812345601'));
    const out = await verify('9812345601');
    assert.equal(out.state, 'approved');
    assert.ok(out.session?.accessToken);
    assert.equal(verifyAccessToken(out.session.accessToken).role, 'RESTAURANT');
    assert.equal(out.onboardingToken, undefined);
});

await check('an approved store cannot be edited through the application', async () => {
    await assert.rejects(() => partner.submitApplication(token, { restaurantName: 'Renamed' }), /already approved/);
});

await check('the admin list shows applications with their checklist', async () => {
    const rows = await partner.listApplicationsForAdmin({ status: 'pending' });
    const bare = rows.find((r) => r.restaurantName === 'Bare Pharmacy');
    assert.ok(bare, 'pending pharmacy not listed');
    assert.equal(bare.checklist.complete, false);
    assert.ok(bare.checklist.missing.length > 3);
});

console.log('\nother cases');

await check('a grocery number choosing Medical is told which it is', async () => {
    await FoodRestaurant.create({
        restaurantName: 'Daily Grocery', ownerName: 'G', ownerPhone: '9812345677',
        ownerPhoneLast10: '9812345677', storeType: 'grocery', status: 'approved',
    });
    const out = await verify('9812345677', 'medical');
    assert.equal(out.state, 'other_type');
    assert.equal(out.existingType, 'store');
    assert.equal(out.session, undefined);
});

await check('Restaurant is routed to its own sign-up', async () => {
    await assert.rejects(() => partner.requestPartnerOtp({ phone: '9812345688', type: 'restaurant' }), /restaurant partner login/);
});

await check('an expired licence takes a live pharmacy offline for orders', async () => {
    const id = await idOf('9812345601');
    await FoodRestaurant.updateOne({ _id: id }, { $set: { drugLicenseExpiry: new Date(past) } });
    await assert.rejects(() => loadRestaurantForOrdering(id), /not taking orders/);
    await FoodRestaurant.updateOne({ _id: id }, { $set: { drugLicenseExpiry: new Date(future) } });
    const doc = await loadRestaurantForOrdering(id);
    assert.equal(String(doc._id), id);
});

await check('a live pharmacy with no expiry on file is not switched off', async () => {
    const legacy = await FoodRestaurant.create({
        restaurantName: 'Old Pharmacy', ownerName: 'L', ownerPhone: '9812345666', storeType: 'pharmacy', status: 'approved',
    });
    const doc = await loadRestaurantForOrdering(String(legacy._id));
    assert.equal(doc.restaurantName, 'Old Pharmacy');
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
