/**
 * A store signs up, is reviewed, and goes live.
 *
 * Run: node tests/partner-onboarding.smoke.mjs
 *
 * What this guards:
 *   - the phone check says where a partner stands (new / pending / rejected /
 *     approved) instead of refusing pending and rejected sellers blind;
 *   - a rejected store sees the reason and can resubmit;
 *   - the onboarding token is not a seller session;
 *   - the store type survives registration (it used to be dropped);
 *   - the Medical store type is gone (client decision D2): 'medical' is no
 *     partner type, nothing creates a pharmacy, and a legacy pharmacy takes no
 *     orders.
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
const { approveRestaurant, rejectRestaurant } = await import(`${B}/admin/services/admin.service.js`);
const { loadRestaurantForOrdering } = await import(`${B}/orders/services/order-pricing.service.js`);
const { verifyAccessToken } = await import('../src/modules/quickCommerce/core/auth/token.util.js');

/** A store application with everything on the checklist. */
const complete = (overrides = {}) => ({
    restaurantName: 'Care Kirana',
    ownerName: 'Asha Verma',
    ownerEmail: 'asha@example.com',
    storeType: 'kirana',
    addressLine1: '12 MG Road',
    city: 'Indore',
    state: 'MP',
    pincode: '452001',
    formattedAddress: '12 MG Road, Indore',
    latitude: '22.7196',
    longitude: '75.8577',
    panNumber: 'ABCDE1234F',
    nameOnPan: 'Asha Verma',
    panImage: '/uploads/qc/partners/pan.webp',
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
const verify = async (phone, type = 'store') => {
    await OtpRateLimit.deleteMany({});
    const { otp } = await partner.requestPartnerOtp({ phone, type });
    assert.ok(otp, 'no OTP exposed in test mode');
    return partner.verifyPartnerOtp({ phone, otp: String(otp), type });
};

console.log('\nthe list');

await check('a store checklist names what is missing, and has no medical documents', () => {
    const { missing, complete: done } = rules.evaluateApplication('store', {});
    assert.equal(done, false);
    assert.ok(missing.includes('IFSC code'));
    assert.ok(!missing.includes('Front / entrance photo'), 'the front photo is optional for a store');
    assert.ok(!missing.some((m) => /drug|pharmacist/i.test(m)), 'no medical documents on the list');
});

await check('Medical is no longer a partner type', () => {
    assert.deepEqual([...rules.PARTNER_TYPES], ['restaurant', 'store']);
    assert.equal(rules.normalizePartnerType('medical'), null);
    assert.equal(rules.normalizePartnerType('pharmacy'), null);
    assert.equal(rules.evaluateApplication('medical', {}).items.length, 0);
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

await check('choosing Medical store is refused', async () => {
    await assert.rejects(() => partner.requestPartnerOtp({ phone: '9812345609', type: 'medical' }), /Choose Restaurant or Store/);
});

await check('an application is created pending, with its store type and documents', async () => {
    const out = await partner.submitApplication(token, complete());
    assert.equal(out.state, 'pending');
    const doc = await FoodRestaurant.findOne({ ownerPhoneLast10: '9812345601' }).lean();
    assert.equal(doc.storeType, 'kirana');
    assert.equal(doc.status, 'pending');
    assert.equal(doc.storePhotos.front, '/uploads/qc/partners/front.webp');
    assert.ok(!doc.drugLicenseNumber, 'no drug licence written');
});

await check('the phone in the token wins over one in the body', async () => {
    const fresh = await verify('9812345602');
    await partner.submitApplication(fresh.onboardingToken, complete({ restaurantName: 'Body Phone', ownerPhone: '9000000000' }));
    assert.equal(await FoodRestaurant.countDocuments({ ownerPhoneLast10: '9000000000' }), 0);
    assert.equal(await FoodRestaurant.countDocuments({ ownerPhoneLast10: '9812345602' }), 1);
});

await check('an application asking to be a pharmacy is made a grocery store', async () => {
    const fresh = await verify('9812345603');
    await partner.submitApplication(fresh.onboardingToken, complete({ restaurantName: 'Was Pharmacy', storeType: 'pharmacy' }));
    const doc = await FoodRestaurant.findOne({ ownerPhoneLast10: '9812345603' }).lean();
    assert.equal(doc.storeType, 'grocery');
});

await check('THE OLD BUG: registration keeps storeType', () => {
    const v = validateRestaurantRegisterDto({
        restaurantName: 'X', ownerName: 'Y', pureVegRestaurant: 'false', storeType: 'kirana',
    });
    assert.equal(v.storeType, 'kirana');
});

await check('signing in again shows pending, not a refusal', async () => {
    const out = await verify('9812345601');
    assert.equal(out.state, 'pending');
    assert.equal(out.application.restaurantName, 'Care Kirana');
    assert.equal(out.application.drugLicenseNumber, undefined, 'no drug licence in the application');
});

console.log('\nreview');

const idOf = async (last10) => String((await FoodRestaurant.findOne({ ownerPhoneLast10: last10 }).lean())._id);

await check('a rejected store sees the reason when it signs in', async () => {
    await rejectRestaurant(await idOf('9812345601'), 'PAN photo is blurred');
    const out = await verify('9812345601');
    assert.equal(out.state, 'rejected');
    assert.equal(out.application.rejectionReason, 'PAN photo is blurred');
    assert.ok(out.onboardingToken);
    token = out.onboardingToken;
});

await check('  and resubmitting goes back to pending with the reason cleared', async () => {
    const out = await partner.submitApplication(token, { panImage: '/uploads/qc/partners/pan-clear.webp' });
    assert.equal(out.state, 'pending');
    const doc = await FoodRestaurant.findOne({ ownerPhoneLast10: '9812345601' }).lean();
    assert.equal(doc.panImage, '/uploads/qc/partners/pan-clear.webp');
    assert.equal(doc.rejectionReason, undefined);
});

await check('approved, the next sign-in is a real session', async () => {
    await approveRestaurant(await idOf('9812345601'));
    const out = await verify('9812345601');
    assert.equal(out.state, 'approved');
    assert.ok(out.session?.accessToken);
    assert.equal(verifyAccessToken(out.session.accessToken).role, 'RESTAURANT');
    assert.equal(out.onboardingToken, undefined);
});

await check('an approved store cannot be edited through the application', async () => {
    await assert.rejects(() => partner.submitApplication(token, { restaurantName: 'Renamed' }), /already approved/);
});

console.log('\nother cases');

await check('a legacy pharmacy number signs in as a store', async () => {
    await FoodRestaurant.create({
        restaurantName: 'Old Chemist', ownerName: 'G', ownerPhone: '9812345677',
        ownerPhoneLast10: '9812345677', storeType: 'pharmacy', status: 'pending',
    });
    const out = await verify('9812345677');
    assert.equal(out.state, 'pending');
    assert.equal(out.type, 'store');
});

await check('Restaurant is routed to its own sign-up', async () => {
    await assert.rejects(() => partner.requestPartnerOtp({ phone: '9812345688', type: 'restaurant' }), /restaurant partner login/);
});

await check('a live legacy pharmacy takes no orders; a live store does', async () => {
    const legacy = await FoodRestaurant.create({
        restaurantName: 'Old Pharmacy', ownerName: 'L', ownerPhone: '9812345666', storeType: 'pharmacy', status: 'approved',
    });
    await assert.rejects(() => loadRestaurantForOrdering(String(legacy._id)), /not taking orders/);
    const id = await idOf('9812345601');
    const doc = await loadRestaurantForOrdering(id);
    assert.equal(String(doc._id), id);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
