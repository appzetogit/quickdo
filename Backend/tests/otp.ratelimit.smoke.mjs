// One OTP budget per phone number, shared by every service on the platform.
//
// Before this existed: food counted per-scope in Mongo, service-provider counted in
// Redis (and so counted nothing, because REDIS_ENABLED is unset and that path failed
// open), and taxi's three OTP entry points had no throttle at all. A single number
// could pull a full quota from each service independently.
//
// The check that matters is CROSS-SERVICE: spend the budget on taxi, then confirm food
// and service-provider are already exhausted for that number.
//
// Run: node tests/otp.ratelimit.smoke.mjs

import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let failures = 0;
const check = (name, fn) => {
    if (fn.constructor.name === 'AsyncFunction') throw new Error(`check("${name}") given an async fn — rejections would be swallowed`);
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (err) {
        failures++;
        console.log(`  FAIL ${name}\n         ${err.message}`);
    }
};

const LIMIT = 3;
const WINDOW = 600;
process.env.OTP_RATE_LIMIT = String(LIMIT);
process.env.OTP_RATE_WINDOW = String(WINDOW);
process.env.NODE_ENV = 'test';

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
await mongoose.connect(process.env.MONGO_URI);

const { consumeOtpQuota, otpRateLimitMessage, OTP_SERVICES } = await import('../src/core/otp/otpRateLimit.service.js');
const { OtpRateLimit } = await import('../src/core/otp/otpRateLimit.model.js');

console.log('\n[1] a single service is limited');
{
    const phone = '9000000001';
    const results = [];
    for (let i = 0; i < LIMIT + 2; i++) results.push(await consumeOtpQuota(phone, { service: OTP_SERVICES.FOOD }));
    check(`first ${LIMIT} allowed`, () => assert.deepEqual(results.slice(0, LIMIT).map((r) => r.allowed), Array(LIMIT).fill(true)));
    check('the next two are refused', () => assert.deepEqual(results.slice(LIMIT).map((r) => r.allowed), [false, false]));
    check('refusal carries a retry-after', () => assert.ok(results[LIMIT].retryAfterSeconds > 0 && results[LIMIT].retryAfterSeconds <= WINDOW));
    check('refusal message is human', () => assert.match(otpRateLimitMessage(results[LIMIT]), /Too many OTP requests/));
}

console.log('\n[2] THE POINT — the budget is shared across services');
{
    const phone = '9000000002';
    // spend the whole budget on taxi's three separate entry points
    const a = await consumeOtpQuota(phone, { service: OTP_SERVICES.TAXI_USER });
    const b = await consumeOtpQuota(phone, { service: OTP_SERVICES.TAXI_DRIVER });
    const c = await consumeOtpQuota(phone, { service: OTP_SERVICES.TAXI_ONBOARDING });
    check('taxi user / driver / onboarding each consume the SAME budget', () =>
        assert.deepEqual([a.allowed, b.allowed, c.allowed, a.count, b.count, c.count], [true, true, true, 1, 2, 3]));

    const food = await consumeOtpQuota(phone, { service: OTP_SERVICES.FOOD });
    check('food is now refused for that number', () => assert.equal(food.allowed, false));

    const sp = await consumeOtpQuota(phone, { service: OTP_SERVICES.SERVICE_PROVIDER });
    check('service-provider is also refused', () => assert.equal(sp.allowed, false));
}

console.log('\n[3] numbers do not interfere with each other');
{
    const other = await consumeOtpQuota('9000000003', { service: OTP_SERVICES.FOOD });
    check('a different number starts fresh', () => assert.equal(other.allowed, true) || assert.equal(other.count, 1));
    check('and its count is 1', () => assert.equal(other.count, 1));
}

console.log('\n[4] phone formatting cannot buy a second budget');
{
    const forms = ['9000000004', '+919000000004', '919000000004', '0 90000 00004', '+91-90000-00004'];
    const counts = [];
    for (const f of forms) counts.push((await consumeOtpQuota(f, { service: OTP_SERVICES.FOOD })).count);
    check(`all formats hit one counter (counts ${counts.join(',')})`, () => assert.deepEqual(counts, [1, 2, 3, 4, 5]));
    const docs = await OtpRateLimit.countDocuments({ _id: '9000000004' });
    check('exactly one document for that number', () => assert.equal(docs, 1));
}

console.log('\n[5] the window resets');
{
    const phone = '9000000005';
    for (let i = 0; i < LIMIT; i++) await consumeOtpQuota(phone, { service: OTP_SERVICES.FOOD });
    const blocked = await consumeOtpQuota(phone, { service: OTP_SERVICES.FOOD });
    check('blocked at the limit', () => assert.equal(blocked.allowed, false));

    // age the window out rather than sleeping for 10 minutes
    await OtpRateLimit.updateOne({ _id: phone }, { $set: { windowStartedAt: new Date(Date.now() - (WINDOW + 60) * 1000) } });
    const after = await consumeOtpQuota(phone, { service: OTP_SERVICES.FOOD });
    check('allowed again once the window has passed', () => assert.equal(after.allowed, true));
    check('and the counter restarted at 1', () => assert.equal(after.count, 1));
}

console.log('\n[6] it does not depend on Redis');
{
    check('REDIS_ENABLED is off for this run', () => assert.notEqual(process.env.REDIS_ENABLED, 'true'));
    const stored = await OtpRateLimit.countDocuments({});
    check(`counters are persisted in Mongo (${stored} docs)`, () => assert.ok(stored > 0));
}

console.log('\n[7] unusable input fails open rather than locking anyone out');
{
    const junk = await consumeOtpQuota('', { service: OTP_SERVICES.FOOD });
    check('empty phone is allowed through', () => assert.equal(junk.allowed, true));
}

console.log('\n[8] every OTP send path is wired in');
{
    const { readFile } = await import('node:fs/promises');
    const paths = {
        'core/otp (food)': '../src/core/otp/otp.service.js',
        'taxi user login': '../src/modules/taxi/user/services/userOtpService.js',
        'taxi driver login': '../src/modules/taxi/driver/services/loginOtpService.js',
        'taxi driver onboarding': '../src/modules/taxi/driver/services/onboardingService.js',
        'service-provider': '../src/modules/serviceProvider/utils/redisOtp.util.js',
    };
    for (const [label, p] of Object.entries(paths)) {
        const src = await readFile(new URL(p, import.meta.url), 'utf8');
        check(`${label} consumes the shared budget`, () => assert.match(src, /consumeOtpQuota/));
    }
    // and the old per-service counters are gone
    const spSrc = await readFile(new URL(paths['service-provider'], import.meta.url), 'utf8');
    check('service-provider no longer counts in Redis', () => assert.doesNotMatch(spSrc, /rate:otp:/));
    const foodSrc = await readFile(new URL(paths['core/otp (food)'], import.meta.url), 'utf8');
    check('food no longer enforces via requestCount', () => assert.doesNotMatch(foodSrc, /requestCount >= /));
}

await mongoose.disconnect();
await mongod.stop();
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
