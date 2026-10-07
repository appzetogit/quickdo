/**
 * A vendor waiting for approval can reach onboarding, and nothing else.
 *
 * Run: node tests/sp-vendor-onboarding-token.smoke.mjs
 *
 * Approval needs the verification checklist, but a pending vendor used to get no
 * token, so GET/PUT /vendors/onboarding, bank details, email OTP and document
 * upload were unreachable until approval. Pending (and rejected) vendors now get
 * an `onboardingToken` (scope 'onboarding') that the SP auth middleware accepts
 * only on the onboarding routes; bookings, wallet and the rest still answer 403.
 * An approved vendor gets the full `accessToken` as before.
 *
 * Real SP router and middleware; the database is in memory.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_ACCESS_SECRET = process.env.JWT_SECRET = 'smoke-access-secret';
process.env.JWT_REFRESH_SECRET = 'smoke-refresh-secret';
process.env.USE_DEFAULT_OTP = 'true'; // static 123456 outside production
process.env.SP_DISABLE_INVOICE_EMAIL = 'true';
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'test';

const require = createRequire(import.meta.url);

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'sp_vendor_onboarding_token' });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
};

const spRouter = require('../src/modules/serviceProvider/routes/index.js');
const Vendor = require('../src/modules/serviceProvider/models/Vendor.js');

const app = express();
app.use(express.json());
app.use('/api/v1/sp', spRouter);
const listener = app.listen(0);
const base = `http://127.0.0.1:${listener.address().port}/api/v1/sp`;

const call = async (method, path, { body, token } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
};

const mkVendor = async (phone, approvalStatus, extra = {}) => {
  const _id = new mongoose.Types.ObjectId();
  await Vendor.collection.insertOne({
    _id, name: `V${phone}`, email: `v${phone}@t.test`, phone, approvalStatus, isActive: true,
    isPhoneVerified: true, service: [], ...extra,
  });
  return _id;
};

const signIn = async (phone) => {
  const sent = await call('POST', '/vendors/auth/send-otp', { body: { phone } });
  assert.equal(sent.status, 200, `send-otp: ${JSON.stringify(sent.body)}`);
  const verified = await call('POST', '/vendors/auth/verify-login', { body: { phone, otp: '123456' } });
  assert.equal(verified.status, 200, `verify-login: ${JSON.stringify(verified.body)}`);
  return verified.body;
};

// ─── Pending vendor ──────────────────────────────────────────────────────────
const pendingPhone = '9200000001';
const pendingId = await mkVendor(pendingPhone, 'pending');
let pending;

await check('a pending vendor gets an OTP and an onboarding token, not a full token', async () => {
  pending = await signIn(pendingPhone);
  assert.equal(pending.tokenScope, 'onboarding');
  assert.ok(pending.onboardingToken, 'onboardingToken');
  assert.ok(pending.onboardingRefreshToken, 'onboardingRefreshToken');
  assert.equal(pending.accessToken, undefined, 'no accessToken: old clients must not treat this as a full login');
  assert.equal(pending.vendor.adminApproval, 'pending');
  assert.equal(jwt.decode(pending.onboardingToken).scope, 'onboarding');
});

const onboardingAllowed = [
  ['GET', '/vendors/onboarding'],
  ['PUT', '/vendors/onboarding', { experienceYears: 3 }],
  ['PUT', '/vendors/bank-details', { accountHolderName: 'V', accountNumber: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC' }],
  ['GET', '/vendors/availability'],
  ['GET', '/vendors/profile'],
];
for (const [method, path, body] of onboardingAllowed) {
  await check(`onboarding token works: ${method} ${path}`, async () => {
    const r = await call(method, path, { token: pending.onboardingToken, body });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
}

await check('onboarding token reaches email OTP and document upload (not refused by auth)', async () => {
  const email = await call('POST', '/vendors/email/send-otp', { token: pending.onboardingToken, body: { email: 'v@t.test' } });
  assert.ok(![401, 403].includes(email.status), `email/send-otp -> ${email.status} ${JSON.stringify(email.body)}`);
  const upload = await call('POST', '/upload', { token: pending.onboardingToken });
  assert.ok(![401, 403].includes(upload.status), `upload -> ${upload.status} ${JSON.stringify(upload.body)}`);
});

const fullOnly = [
  ['GET', '/vendors/bookings'],
  ['GET', '/vendors/bookings/pending'],
  ['GET', '/vendors/wallet'],
  ['GET', '/vendors/transactions'],
  ['PUT', '/vendors/profile', { name: 'Changed' }],
  ['GET', '/upload/sign-signature'],
];
for (const [method, path, body] of fullOnly) {
  await check(`onboarding token is refused: ${method} ${path}`, async () => {
    const r = await call(method, path, { token: pending.onboardingToken, body });
    assert.equal(r.status, 403, `${r.status} ${JSON.stringify(r.body)}`);
  });
}

await check('a full-scope token for a pending vendor is still refused everywhere', async () => {
  const { generateAccessToken } = require('../src/modules/serviceProvider/utils/tokenService.js');
  const v = await Vendor.findById(pendingId).lean();
  const full = generateAccessToken({ userId: pendingId, role: 'VENDOR', loginSessionId: v.loginSessionId });
  assert.equal((await call('GET', '/vendors/onboarding', { token: full })).status, 403);
  assert.equal((await call('GET', '/vendors/bookings', { token: full })).status, 403);
});

await check('onboarding refresh keeps the onboarding scope while pending', async () => {
  const r = await call('POST', '/vendors/auth/refresh-token', { body: { refreshToken: pending.onboardingRefreshToken } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.tokenScope, 'onboarding');
  assert.equal(jwt.decode(r.body.accessToken).scope, 'onboarding');
  assert.equal((await call('GET', '/vendors/wallet', { token: r.body.accessToken })).status, 403);
});

await check('once approved, the same refresh returns a full token', async () => {
  await Vendor.collection.updateOne({ _id: pendingId }, { $set: { approvalStatus: 'approved' } });
  const r = await call('POST', '/vendors/auth/refresh-token', { body: { refreshToken: pending.onboardingRefreshToken } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.tokenScope, 'full');
  assert.equal(jwt.decode(r.body.accessToken).scope, undefined);
  assert.notEqual((await call('GET', '/vendors/wallet', { token: r.body.accessToken })).status, 403);
  // The onboarding token itself stays limited even after approval.
  assert.equal((await call('GET', '/vendors/wallet', { token: pending.onboardingToken })).status, 403);
});

// ─── Approved vendor ─────────────────────────────────────────────────────────
await check('an approved vendor gets a full accessToken as before', async () => {
  const phone = '9200000002';
  await mkVendor(phone, 'approved');
  const s = await signIn(phone);
  assert.ok(s.accessToken && s.refreshToken);
  assert.equal(s.onboardingToken, undefined);
  assert.equal(jwt.decode(s.accessToken).scope, undefined);
  assert.notEqual((await call('GET', '/vendors/bookings', { token: s.accessToken })).status, 403);
  assert.equal((await call('GET', '/vendors/onboarding', { token: s.accessToken })).status, 200);
});

// ─── Rejected / suspended ────────────────────────────────────────────────────
await check('a rejected vendor gets an onboarding token with the rejection reason', async () => {
  const phone = '9200000003';
  await mkVendor(phone, 'rejected', { rejectedReason: 'PAN unreadable' });
  const s = await signIn(phone);
  assert.equal(s.tokenScope, 'onboarding');
  assert.equal(s.vendor.rejectedReason, 'PAN unreadable');
  assert.equal((await call('GET', '/vendors/onboarding', { token: s.onboardingToken })).status, 200);
  assert.equal((await call('GET', '/vendors/bookings', { token: s.onboardingToken })).status, 403);
});

await check('a suspended vendor gets no OTP, and an old onboarding token stops working', async () => {
  const phone = '9200000004';
  const id = await mkVendor(phone, 'pending');
  const s = await signIn(phone);
  await Vendor.collection.updateOne({ _id: id }, { $set: { approvalStatus: 'suspended' } });
  assert.equal((await call('POST', '/vendors/auth/send-otp', { body: { phone } })).status, 403);
  assert.equal((await call('GET', '/vendors/onboarding', { token: s.onboardingToken })).status, 403);
  assert.equal((await call('POST', '/vendors/auth/refresh-token', { body: { refreshToken: s.onboardingRefreshToken } })).status, 403);
});

await check('logout works with the onboarding token and ends that session', async () => {
  const phone = '9200000005';
  await mkVendor(phone, 'pending');
  const s = await signIn(phone);
  assert.equal((await call('POST', '/vendors/auth/logout', { token: s.onboardingToken, body: {} })).status, 200);
  assert.equal((await call('GET', '/vendors/onboarding', { token: s.onboardingToken })).status, 401);
});

listener.close();
await mongoose.disconnect();
await server.stop();

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall SP vendor onboarding-token checks passed');
process.exit(0);
