/**
 * The shared OTP engine (food, quick commerce): stored hashed, single use,
 * attempts counted atomically, SMS failure surfaced.
 *
 * Run: node tests/otp-lockdown.smoke.mjs
 *
 *   - the stored value is not the code;
 *   - the right code verifies once; 20 parallel verifications of it: exactly one wins;
 *   - 30 parallel wrong guesses consume at most OTP_MAX_ATTEMPTS, and after that
 *     even the right code is refused;
 *   - a code for one phone does not work for another, nor for another scope;
 *   - an expired code is refused;
 *   - a row written before this change (plain code) still verifies once;
 *   - in production a failed SMS is an error, not "OTP sent".
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
delete process.env.USE_DEFAULT_OTP;
process.env.OTP_MAX_ATTEMPTS = '5';
process.env.OTP_RATE_LIMIT = '1000';

let smsOk = true;
globalThis.fetch = async () => ({
  ok: smsOk,
  status: smsOk ? 200 : 500,
  text: async () => (smsOk ? '{"ErrorCode":"000","ErrorMessage":"Done"}' : 'down'),
});

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`); }
};

const { config } = await import('../src/config/env.js');
const { createOrUpdateOtp, verifyOtp, OtpDeliveryError } = await import('../src/core/otp/otp.service.js');
const { FoodOtp } = await import('../src/core/otp/otp.model.js');
await FoodOtp.syncIndexes();
config.otpMaxAttempts = 5;
config.useDefaultOtp = false; // the local .env turns it on
config.otpRateLimit = 1000;

let n = 0;
const phone = () => `98${String(10000000 + (n += 1)).slice(-8)}`;

await check('the database holds a hash, not the code', async () => {
  const p = phone();
  const code = await createOrUpdateOtp(p, 'user');
  assert.match(code, /^\d{4}$/);
  const row = await FoodOtp.findOne({ phone: p }).lean();
  assert.notEqual(row.otp, code);
  assert.ok(row.otp.startsWith('h1:'));
});

await check('20 parallel verifications of the right code: exactly one succeeds', async () => {
  const p = phone();
  const code = await createOrUpdateOtp(p, 'user');
  const results = await Promise.all(Array.from({ length: 20 }, () => verifyOtp(p, code, 'user')));
  assert.equal(results.filter((r) => r.valid).length, 1);
  assert.equal(await FoodOtp.countDocuments({ phone: p }), 0);
});

await check('a used code cannot be replayed', async () => {
  const p = phone();
  const code = await createOrUpdateOtp(p, 'user');
  assert.equal((await verifyOtp(p, code, 'user')).valid, true);
  assert.equal((await verifyOtp(p, code, 'user')).valid, false);
});

await check('30 parallel wrong guesses use at most 5 attempts, then the right code is refused', async () => {
  const p = phone();
  const code = await createOrUpdateOtp(p, 'user');
  const wrong = code === '0000' ? '0001' : '0000';
  await Promise.all(Array.from({ length: 30 }, () => verifyOtp(p, wrong, 'user')));
  const row = await FoodOtp.findOne({ phone: p }).lean();
  assert.equal(row.attempts, 5);
  const r = await verifyOtp(p, code, 'user');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'Max attempts exceeded');
});

await check('a code does not work for another phone or another scope', async () => {
  const a = phone();
  const b = phone();
  const code = await createOrUpdateOtp(a, 'user');
  await createOrUpdateOtp(b, 'user');
  await createOrUpdateOtp(a, 'restaurant');
  const other = await verifyOtp(b, code, 'user');
  assert.equal(other.valid, false);
  const row = await FoodOtp.findOne({ phone: a, scope: 'restaurant' }).lean();
  assert.notEqual(row.otp, (await FoodOtp.findOne({ phone: a, scope: 'user' }).lean()).otp);
});

await check('an expired code is refused', async () => {
  const p = phone();
  const code = await createOrUpdateOtp(p, 'user');
  await FoodOtp.updateOne({ phone: p }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const r = await verifyOtp(p, code, 'user');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'OTP expired');
});

await check('a row stored before this change (plain code) verifies once', async () => {
  const p = phone();
  await FoodOtp.create({ phone: p, scope: 'user', otp: '4321', expiresAt: new Date(Date.now() + 60000) });
  assert.equal((await verifyOtp(p, '4321', 'user')).valid, true);
  assert.equal((await verifyOtp(p, '4321', 'user')).valid, false);
});

await check('production: an SMS that fails is an error, not a silent success', async () => {
  const prev = config.nodeEnv;
  config.nodeEnv = 'production';
  smsOk = false;
  try {
    await assert.rejects(() => createOrUpdateOtp(phone(), 'user'), (e) => e instanceof OtpDeliveryError && e.statusCode === 503);
  } finally {
    config.nodeEnv = prev;
    smsOk = true;
  }
});

await check('production: a delivered SMS returns normally', async () => {
  const prev = config.nodeEnv;
  config.nodeEnv = 'production';
  try {
    const code = await createOrUpdateOtp(phone(), 'user');
    assert.match(code, /^\d{4}$/);
  } finally {
    config.nodeEnv = prev;
  }
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall otp lockdown checks passed');
process.exit(failed ? 1 : 0);
