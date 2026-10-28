/**
 * Restaurant web-portal login: email + password, then an OTP to the phone on file.
 *
 * Run: node tests/restaurant-web-login.smoke.mjs
 *
 *  - A wrong password (or unknown email) sends no OTP and says only "invalid".
 *  - The right password sends the OTP to the restaurant's ownerPhone, never to a
 *    number from the request, and the login completes only with that OTP.
 *  - The step-1 ticket is required, so the OTP step cannot be reached without
 *    the password, and the password hash never comes back in the response.
 *
 * Runs outside production, so the issued OTP is returned; SMS goes to a closed
 * local port, so nothing is ever sent.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
// Point SMS at a closed local port so a test run can never text a real number.
// Set before env.js is imported; dotenv does not override existing variables.
process.env.SMS_PROVIDER = 'smsindiahub';
process.env.SMS_INDIA_HUB_URL = 'http://127.0.0.1:9/';
process.env.SMS_INDIA_HUB_TIMEOUT_MS = '2000';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

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

const rejects = (promise) => promise.then(() => null, (e) => e);

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'restaurant_web_login' });

    const { config } = await import('../src/config/env.js');
    config.nodeEnv = 'development';
    config.useDefaultOtp = false;
    const auth = await import('../src/core/auth/auth.service.js');
    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');


    const ownerPhone = '9876501234';
    const restaurant = await FoodRestaurant.create({
        restaurantName: 'Web Login Kitchen',
        ownerName: 'Owner',
        ownerEmail: 'Owner.Kitchen@Gmail.com',
        ownerPhone,
        primaryContactNumber: ownerPhone,
        status: 'approved',
        pureVegRestaurant: false,
    });
    await FoodRestaurant.updateOne(
        { _id: restaurant._id },
        { $set: { portalPassword: await auth.hashRestaurantPortalPassword('correct-horse-1'), portalPasswordSetAt: new Date() } },
    );

    await check('wrong password is refused with a generic message', async () => {
        const err = await rejects(auth.requestRestaurantWebLoginOtp('owner.kitchen@gmail.com', 'nope'));
        assert.ok(err, 'wrong password accepted');
        assert.equal(err.statusCode, 401);
        assert.equal(err.message, 'Invalid email or password');
    });

    await check('unknown email gets the same message', async () => {
        const err = await rejects(auth.requestRestaurantWebLoginOtp('nobody@gmail.com', 'correct-horse-1'));
        assert.equal(err?.message, 'Invalid email or password');
    });

    let step1;
    await check('right password (email case-insensitive) issues a ticket and masks the phone', async () => {
        step1 = await auth.requestRestaurantWebLoginOtp('owner.kitchen@gmail.com', 'correct-horse-1');
        assert.ok(step1.ticket);
        assert.equal(step1.maskedPhone, '******1234');
        assert.match(String(step1.otp), /^\d{4,6}$/);
    });

    await check('the OTP is not accepted on the app phone-login path', async () => {
        const err = await rejects(auth.verifyRestaurantOtpAndLogin(ownerPhone, step1.otp));
        assert.ok(err, 'web-scope OTP worked on the phone login');
    });

    await check('a forged or missing ticket is refused', async () => {
        const err = await rejects(auth.verifyRestaurantWebLoginOtp('not-a-ticket', 'owner.kitchen@gmail.com', step1.otp));
        assert.equal(err?.statusCode, 401);
    });

    await check('a wrong OTP is refused', async () => {
        const wrong = step1.otp === '0000' ? '1111' : '0000';
        const err = await rejects(auth.verifyRestaurantWebLoginOtp(step1.ticket, 'owner.kitchen@gmail.com', wrong));
        assert.equal(err?.statusCode, 401);
    });

    await check('resend issues a fresh code using only the ticket', async () => {
        const resent = await auth.resendRestaurantWebLoginOtp(step1.ticket, 'owner.kitchen@gmail.com');
        assert.equal(resent.maskedPhone, '******1234');
        step1.otp = resent.otp;
    });

    await check('ticket + right OTP logs in, without leaking the password hash', async () => {
        const result = await auth.verifyRestaurantWebLoginOtp(step1.ticket, 'owner.kitchen@gmail.com', step1.otp);
        assert.ok(result.accessToken);
        assert.equal(String(result.user._id), String(restaurant._id));
        const json = JSON.stringify(result.user);
        assert.ok(!json.includes('portalPassword"'), 'hash returned to client');
    });

    await check('a restaurant with no password set cannot sign in on the web', async () => {
        await FoodRestaurant.create({
            restaurantName: 'No Password Cafe',
            ownerName: 'Owner 2',
            ownerEmail: 'nopass@gmail.com',
            ownerPhone: '9876505678',
            status: 'approved',
            pureVegRestaurant: false,
        });
        const err = await rejects(auth.requestRestaurantWebLoginOtp('nopass@gmail.com', ''));
        assert.equal(err?.statusCode, 401);
    });

    // ------------------------------------------- stores and medical stores ---
    console.log('\nquick commerce (stores, medical stores)');
    const { setSellerPortalPassword } = await import('../src/core/auth/sellerWebLogin.js');
    const partner = await import('../src/modules/quickCommerce/modules/food/partner/partner.service.js');
    const { FoodRestaurant: QCSeller } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');

    const pharmacy = await QCSeller.create({
        restaurantName: 'Web Login Pharmacy',
        ownerName: 'Chemist',
        ownerEmail: 'chemist@gmail.com',
        ownerPhone: '9876509999',
        storeType: 'pharmacy',
        status: 'approved',
        pureVegRestaurant: false,
    });
    const pendingStore = await QCSeller.create({
        restaurantName: 'Pending Grocery',
        ownerName: 'Grocer',
        ownerEmail: 'grocer@gmail.com',
        ownerPhone: '9876508888',
        storeType: 'grocery',
        status: 'pending',
        pureVegRestaurant: false,
    });

    await check('admin setter refuses a short password and stores a hash otherwise', async () => {
        const short = await rejects(setSellerPortalPassword(QCSeller, String(pharmacy._id), 'short'));
        assert.equal(short?.statusCode, 400);
        const saved = await setSellerPortalPassword(QCSeller, String(pharmacy._id), 'pharma-pass-1');
        assert.ok(saved.portalPasswordSetAt);
        const raw = await QCSeller.findById(pharmacy._id).select('+portalPassword').lean();
        assert.match(raw.portalPassword, /^\$2[aby]\$/);
        await setSellerPortalPassword(QCSeller, String(pendingStore._id), 'grocer-pass-1');
    });

    await check('a medical store cannot sign in through the store login', async () => {
        const err = await rejects(partner.requestPartnerWebLoginOtp({ email: 'chemist@gmail.com', password: 'pharma-pass-1', type: 'store' }));
        assert.equal(err?.statusCode, 400);
        assert.match(err.message, /medical store/);
    });

    await check('a store still under review is told so, and gets no code', async () => {
        const err = await rejects(partner.requestPartnerWebLoginOtp({ email: 'grocer@gmail.com', password: 'grocer-pass-1', type: 'store' }));
        assert.match(err?.message || '', /under review/);
    });

    await check('wrong password is refused for stores too', async () => {
        const err = await rejects(partner.requestPartnerWebLoginOtp({ email: 'chemist@gmail.com', password: 'nope', type: 'medical' }));
        assert.equal(err?.statusCode, 401);
    });

    await check('a restaurant ticket is useless on the store login', async () => {
        const food = await auth.requestRestaurantWebLoginOtp('owner.kitchen@gmail.com', 'correct-horse-1');
        const err = await rejects(partner.verifyPartnerWebLoginOtp({ ticket: food.ticket, email: 'owner.kitchen@gmail.com', otp: food.otp, type: 'store' }));
        assert.equal(err?.statusCode, 401);
    });

    await check('medical store: password, then OTP to its phone, signs in', async () => {
        const step = await partner.requestPartnerWebLoginOtp({ email: 'Chemist@Gmail.com', password: 'pharma-pass-1', type: 'medical' });
        assert.equal(step.maskedPhone, '******9999');
        const resent = await partner.resendPartnerWebLoginOtp({ ticket: step.ticket, email: 'chemist@gmail.com' });
        const result = await partner.verifyPartnerWebLoginOtp({ ticket: step.ticket, email: 'chemist@gmail.com', otp: resent.otp, type: 'medical' });
        assert.equal(result.state, 'approved');
        assert.ok(result.session?.accessToken);
        assert.equal(String(result.session.user._id), String(pharmacy._id));
        assert.ok(!JSON.stringify(result.session.user).includes('portalPassword"'), 'hash returned to client');
    });


    await mongoose.disconnect();
    await replSet.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
