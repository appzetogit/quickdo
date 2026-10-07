/**
 * Taxi driver and rider refresh tokens.
 *
 * Run: node tests/taxi-refresh-token.smoke.mjs
 *
 * Driver and rider OTP sign-in used to return one 15-minute `token` and no way
 * to renew it, so drivers were signed out mid-shift. Sign-in now also returns
 * `accessToken`, `refreshToken` and `expiresIn`; POST /auth/refresh-token rotates
 * the refresh token, a replayed (already used) refresh token revokes the whole
 * session, an inactive account cannot refresh, and logout revokes the session.
 *
 * Real taxi routers and middleware; the database is in memory.
 */
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_ACCESS_SECRET = process.env.JWT_SECRET = 'smoke-access-secret';
process.env.JWT_REFRESH_SECRET = 'smoke-refresh-secret';
process.env.USE_DEFAULT_OTP = 'true';
process.env.STATIC_OTP_CODE = '0000';
if (process.env.NODE_ENV === 'production') delete process.env.NODE_ENV;

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'taxi_refresh_token' });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
};

const { driverRouter } = await import('../src/modules/taxi/driver/routes/driverRoutes.js');
const { userRouter } = await import('../src/modules/taxi/user/routes/userRoutes.js');
const { errorHandler } = await import('../src/modules/taxi/middlewares/errorMiddleware.js');
const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
const { User } = await import('../src/modules/taxi/user/models/User.js');
const { OtpRateLimit } = await import('../src/core/otp/otpRateLimit.model.js');
const { TaxiRefreshToken } = await import('../src/modules/taxi/services/refreshTokenService.js');

const app = express();
app.use(express.json());
app.use('/api/v1/taxi/drivers', driverRouter);
app.use('/api/v1/taxi/users', userRouter);
app.use(errorHandler);
const listener = app.listen(0);
const base = `http://127.0.0.1:${listener.address().port}/api/v1/taxi`;

const call = async (method, path, { body, token } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
};

const mkDriver = async (phone, extra = {}) => {
  const _id = new mongoose.Types.ObjectId();
  await Driver.collection.insertOne({
    _id, name: `D${phone}`, phone, vehicleType: 'bike', approve: true, status: 'approved', deletedAt: null, ...extra,
  });
  return _id;
};

const clearOtpQuota = () => mongoose.connection.db.collection(OtpRateLimit.collection.collectionName).deleteMany({});

const driverSignIn = async (phone) => {
  await clearOtpQuota();
  const sent = await call('POST', '/drivers/auth/send-otp', { body: { phone } });
  assert.equal(sent.status, 201, `send-otp: ${JSON.stringify(sent.body)}`);
  const verified = await call('POST', '/drivers/auth/verify-otp', { body: { phone, otp: '0000' } });
  assert.equal(verified.status, 200, `verify-otp: ${JSON.stringify(verified.body)}`);
  return verified.body.data;
};

// ─── Driver ──────────────────────────────────────────────────────────────────
const driverPhone = '9000000001';
const driverId = await mkDriver(driverPhone);
let signIn;

await check('driver OTP sign-in returns token, accessToken, refreshToken and expiresIn', async () => {
  signIn = await driverSignIn(driverPhone);
  assert.ok(signIn.token, 'token');
  assert.equal(signIn.accessToken, signIn.token, 'token is kept and equals accessToken');
  assert.ok(signIn.refreshToken, 'refreshToken');
  assert.ok(Number(signIn.expiresIn) > 0, 'expiresIn');
  assert.equal(String(jwt.decode(signIn.accessToken).sub), String(driverId));
});

await check('the access token from sign-in works on a driver route', async () => {
  const me = await call('GET', '/drivers/me', { token: signIn.accessToken });
  assert.equal(me.status, 200, JSON.stringify(me.body));
});

await check('a refresh token is not accepted as an access token', async () => {
  const me = await call('GET', '/drivers/me', { token: signIn.refreshToken });
  assert.equal(me.status, 401);
});

let rotated;
await check('refresh rotates: a new access and refresh token', async () => {
  const r = await call('POST', '/drivers/auth/refresh-token', { body: { refreshToken: signIn.refreshToken } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  rotated = r.body.data;
  assert.ok(rotated.accessToken && rotated.refreshToken && rotated.token);
  assert.notEqual(rotated.refreshToken, signIn.refreshToken, 'refresh token rotated');
  assert.ok(Number(rotated.expiresIn) > 0);
  const me = await call('GET', '/drivers/me', { token: rotated.accessToken });
  assert.equal(me.status, 200);
});

await check('a driver refresh token is refused on the user refresh route', async () => {
  const r = await call('POST', '/users/auth/refresh-token', { body: { refreshToken: rotated.refreshToken } });
  assert.equal(r.status, 401);
});

await check('reusing the old refresh token is refused and revokes the whole family', async () => {
  const replay = await call('POST', '/drivers/auth/refresh-token', { body: { refreshToken: signIn.refreshToken } });
  assert.equal(replay.status, 401);
  // The newer token of the same session is now dead too.
  const newer = await call('POST', '/drivers/auth/refresh-token', { body: { refreshToken: rotated.refreshToken } });
  assert.equal(newer.status, 401);
  const live = await TaxiRefreshToken.countDocuments({ subjectId: driverId, revokedAt: null });
  assert.equal(live, 0);
});

await check('a missing or garbage refresh token is refused', async () => {
  assert.equal((await call('POST', '/drivers/auth/refresh-token', { body: {} })).status, 400);
  assert.equal((await call('POST', '/drivers/auth/refresh-token', { body: { refreshToken: 'nope' } })).status, 401);
});

await check('a blocked driver cannot refresh, and the session is revoked', async () => {
  const s = await driverSignIn(driverPhone);
  await Driver.collection.updateOne({ _id: driverId }, { $set: { approve: false, status: 'inactive' } });
  const r = await call('POST', '/drivers/auth/refresh-token', { body: { refreshToken: s.refreshToken } });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  await Driver.collection.updateOne({ _id: driverId }, { $set: { approve: true, status: 'approved' } });
  // Revoked: unblocking does not bring the old session back.
  const again = await call('POST', '/drivers/auth/refresh-token', { body: { refreshToken: s.refreshToken } });
  assert.equal(again.status, 401);
});

await check('a deleted driver cannot refresh', async () => {
  const phone = '9000000002';
  const id = await mkDriver(phone);
  const s = await driverSignIn(phone);
  await Driver.collection.updateOne({ _id: id }, { $set: { deletedAt: new Date() } });
  const r = await call('POST', '/drivers/auth/refresh-token', { body: { refreshToken: s.refreshToken } });
  assert.equal(r.status, 401);
});

await check('a driver pending approval refreshes, but the new token stays limited to pending routes', async () => {
  const phone = '9000000003';
  await mkDriver(phone, { approve: false, status: 'pending' });
  const s = await driverSignIn(phone);
  const r = await call('POST', '/drivers/auth/refresh-token', { body: { refreshToken: s.refreshToken } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // PATCH /online needs approval. (Not GET /me here: it currently marks the
  // driver approved as a side effect -- a separate, known issue.)
  const online = await call('PATCH', '/drivers/online', { token: r.body.data.accessToken, body: {} });
  assert.equal(online.status, 403, JSON.stringify(online.body));
});

await check('driver logout revokes the session', async () => {
  const s = await driverSignIn(driverPhone);
  const out = await call('POST', '/drivers/auth/logout', { body: { refreshToken: s.refreshToken } });
  assert.equal(out.status, 200);
  assert.equal(out.body.data.revoked, true);
  const r = await call('POST', '/drivers/auth/refresh-token', { body: { refreshToken: s.refreshToken } });
  assert.equal(r.status, 401);
  // Idempotent.
  const again = await call('POST', '/drivers/auth/logout', { body: { refreshToken: s.refreshToken } });
  assert.equal(again.status, 200);
});

// ─── Rider (taxi user) ───────────────────────────────────────────────────────
const userPhone = '9100000001';
const userId = new mongoose.Types.ObjectId();
await User.collection.insertOne({ _id: userId, name: 'Rider', phone: userPhone, active: true, isActive: true, deletedAt: null });

const userSignIn = async () => {
  await clearOtpQuota();
  const sent = await call('POST', '/users/auth/send-otp', { body: { phone: userPhone } });
  assert.equal(sent.status, 201, `send-otp: ${JSON.stringify(sent.body)}`);
  const verified = await call('POST', '/users/auth/verify-otp', { body: { phone: userPhone, otp: '0000' } });
  assert.equal(verified.status, 200, `verify-otp: ${JSON.stringify(verified.body)}`);
  assert.equal(verified.body.data.exists, true);
  return verified.body.data;
};

let userSession;
await check('rider OTP sign-in returns token, accessToken, refreshToken and expiresIn', async () => {
  userSession = await userSignIn();
  assert.ok(userSession.token);
  assert.equal(userSession.accessToken, userSession.token);
  assert.ok(userSession.refreshToken);
  assert.ok(Number(userSession.expiresIn) > 0);
});

await check('rider refresh rotates, and reuse revokes the family', async () => {
  const r = await call('POST', '/users/auth/refresh-token', { body: { refreshToken: userSession.refreshToken } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.notEqual(r.body.data.refreshToken, userSession.refreshToken);
  const me = await call('GET', '/users/me', { token: r.body.data.accessToken });
  assert.equal(me.status, 200);
  assert.equal((await call('POST', '/users/auth/refresh-token', { body: { refreshToken: userSession.refreshToken } })).status, 401);
  assert.equal((await call('POST', '/users/auth/refresh-token', { body: { refreshToken: r.body.data.refreshToken } })).status, 401);
});

await check('a rider refresh token is refused on the driver refresh route', async () => {
  const s = await userSignIn();
  assert.equal((await call('POST', '/drivers/auth/refresh-token', { body: { refreshToken: s.refreshToken } })).status, 401);
});

await check('rider logout revokes; a deactivated rider cannot refresh', async () => {
  const s = await userSignIn();
  assert.equal((await call('POST', '/users/auth/logout', { body: { refreshToken: s.refreshToken } })).status, 200);
  assert.equal((await call('POST', '/users/auth/refresh-token', { body: { refreshToken: s.refreshToken } })).status, 401);

  const s2 = await userSignIn();
  await User.collection.updateOne({ _id: userId }, { $set: { isActive: false } });
  assert.equal((await call('POST', '/users/auth/refresh-token', { body: { refreshToken: s2.refreshToken } })).status, 403);
});

listener.close();
await mongoose.disconnect();
await server.stop();

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall taxi refresh-token checks passed');
process.exit(0);
