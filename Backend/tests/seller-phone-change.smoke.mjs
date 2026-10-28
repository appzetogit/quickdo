/**
 * A seller changes its login number only by proving the new one with an OTP.
 *
 * Run: node tests/seller-phone-change.smoke.mjs
 *
 * What this guards:
 *   - the code goes to the NEW number, and only that code moves the account;
 *   - a number another account uses, or the current one, is refused up front;
 *   - a wrong code is a 400, not a 401 that would sign the seller out;
 *   - primaryContactNumber follows when it held the old number, so the old
 *     number stops signing in; a different contact number is left alone;
 *   - saving the profile can no longer move the login number by itself.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
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
process.env.MONGODB_URI = mongo.getUri('phone_change');
await mongoose.connect(mongo.getUri('phone_change'));

const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { createSellerPhoneChange } = await import('../src/core/auth/sellerPhoneChange.js');
const { updateRestaurantProfile } = await import('../src/modules/food/restaurant/services/restaurant.service.js');
const { OtpRateLimit } = await import('../src/core/otp/otpRateLimit.model.js').catch(() => ({}));

const change = createSellerPhoneChange({ Model: FoodRestaurant, otpScope: 'restaurant_phone_change' });
const clearLimits = async () => { if (OtpRateLimit) await OtpRateLimit.deleteMany({}); };

const a = await FoodRestaurant.create({ restaurantName: 'A', ownerName: 'O', ownerPhone: '9811111111', primaryContactNumber: '9811111111', status: 'approved' });
const b = await FoodRestaurant.create({ restaurantName: 'B', ownerName: 'O', ownerPhone: '9822222222', primaryContactNumber: '9833333333', status: 'approved' });

await check('a number another account uses is refused before any code is sent', async () => {
    await clearLimits();
    await assert.rejects(() => change.requestOtp(a._id, '9822222222'), /already registered with another account/);
    await assert.rejects(() => change.requestOtp(a._id, '+91 98333 33333'), /already registered with another account/);
});

await check('the current number and a malformed one are refused', async () => {
    await assert.rejects(() => change.requestOtp(a._id, '9811111111'), /already your login number/);
    await assert.rejects(() => change.requestOtp(a._id, '12345'), /valid 10-digit/);
});

await check('a wrong code is a 400 and changes nothing', async () => {
    await clearLimits();
    const sent = await change.requestOtp(a._id, '9844444444');
    assert.ok(sent.otp, 'no OTP exposed in test mode');
    const wrong = String(sent.otp) === '0000' ? '1111' : '0000';
    await assert.rejects(() => change.verify(a._id, '9844444444', wrong), (err) => err.statusCode === 400);
    const doc = await FoodRestaurant.findById(a._id).lean();
    assert.equal(doc.ownerPhone, '9811111111');
});

await check('the right code moves the login number, and the contact number with it', async () => {
    await clearLimits();
    const sent = await change.requestOtp(a._id, '98444 44444');
    assert.equal(sent.maskedPhone, '******4444');
    const out = await change.verify(a._id, '9844444444', String(sent.otp));
    assert.equal(out.ownerPhone, '9844444444');
    const doc = await FoodRestaurant.findById(a._id).lean();
    assert.equal(doc.ownerPhone, '9844444444');
    assert.equal(doc.ownerPhoneLast10, '9844444444');
    assert.equal(doc.primaryContactNumber, '9844444444', 'old number would still sign in');
});

await check('a different contact number is left alone', async () => {
    await clearLimits();
    const sent = await change.requestOtp(b._id, '9855555555');
    await change.verify(b._id, '9855555555', String(sent.otp));
    const doc = await FoodRestaurant.findById(b._id).lean();
    assert.equal(doc.ownerPhone, '9855555555');
    assert.equal(doc.primaryContactNumber, '9833333333');
});

await check('saving the profile cannot move the login number', async () => {
    await assert.rejects(() => updateRestaurantProfile(String(a._id), { ownerPhone: '9866666666' }), /Change number/);
    await updateRestaurantProfile(String(a._id), { ownerPhone: '+91 9844444444', ownerName: 'Owner Two' });
    const doc = await FoodRestaurant.findById(a._id).lean();
    assert.equal(doc.ownerPhone, '9844444444');
    assert.equal(doc.ownerName, 'Owner Two');
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
