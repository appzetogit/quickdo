/**
 * Taxi promotions and safety admin routes are for admins with taxi access.
 *
 * Run: node tests/taxi-admin-service-access.smoke.mjs
 *
 * Found in review: the promotions router is also mounted at /api/v1 (the promo
 * page calls /api/v1/admin/promos) with only an "is an admin" check, and the
 * safety routes had the same. A Food-only sub-admin could create taxi promo
 * codes, push notifications to every taxi user, and read SOS alerts.
 */
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_ACCESS_SECRET = process.env.JWT_SECRET = 'smoke-secret';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'taxi_admin_access' });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
};

const { promotionsRouter } = await import('../src/modules/taxi/admin/promotions/routes/index.js');
const { adminSafetyRouter } = await import('../src/modules/taxi/safety/routes/adminSafety.routes.js');
const { errorHandler } = await import('../src/modules/taxi/middlewares/errorMiddleware.js');

const app = express();
app.use(express.json());
app.use('/api/v1', promotionsRouter);
// Another module's admin route under the same prefix must not be affected.
app.get('/api/v1/admin/something-else', (_req, res) => res.json({ ok: true }));
app.use('/api/v1/taxi/admin/safety', adminSafetyRouter);
app.use(errorHandler);
const listener = app.listen(0);
const base = `http://127.0.0.1:${listener.address().port}`;

const admins = mongoose.connection.db.collection('admins');
const mkAdmin = async (servicesAccess, extra = {}) => {
  const _id = new mongoose.Types.ObjectId();
  await admins.insertOne({ _id, name: 'A', email: `${_id}@t.test`, role: 'admin', servicesAccess, isActive: true, ...extra });
  return jwt.sign({ sub: String(_id), userId: String(_id), role: 'admin' }, 'smoke-secret');
};
// Sub-admins holding the promotions permission: only the panel access differs.
const foodOnly = await mkAdmin(['food'], { role: 'subadmin', permissions: ['promotions.write', 'cms.write'] });
const taxi = await mkAdmin(['taxi'], { role: 'subadmin', permissions: ['promotions.write', 'cms.write'] });
const taxiNoPerm = await mkAdmin(['taxi'], { role: 'subadmin', permissions: [] });
const owner = await mkAdmin([], { role: 'superadmin' });

const hit = async (token, method, path, body) => {
  const r = await fetch(base + path, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.status;
};

for (const [method, path, body] of [
  ['POST', '/api/v1/admin/promos', { code: 'FREE100', value: 100 }],
  ['GET', '/api/v1/admin/promos'],
  ['POST', '/api/v1/admin/notifications/send', { title: 'x', body: 'y' }],
  ['GET', '/api/v1/admin/promotions/bootstrap'],
]) {
  await check(`a Food-only admin is refused: ${method} ${path}`, async () => {
    assert.equal(await hit(foodOnly, method, path, body), 403);
  });
  await check(`a taxi admin is not refused: ${method} ${path}`, async () => {
    assert.notEqual(await hit(taxi, method, path, body), 403);
  });
}
await check('the platform owner is not refused', async () => {
  assert.notEqual(await hit(owner, 'POST', '/api/v1/admin/promos', { code: 'X' }), 403);
});
await check('a taxi sub-admin without the promotions permission cannot create a promo', async () => {
  assert.equal(await hit(taxiNoPerm, 'POST', '/api/v1/admin/promos', { code: 'X' }), 403);
});
await check('a taxi sub-admin with only the promotions permission cannot broadcast', async () => {
  const promosOnly = await mkAdmin(['taxi'], { role: 'subadmin', permissions: ['promotions.write'] });
  assert.equal(await hit(promosOnly, 'POST', '/api/v1/admin/notifications/send', { title: 'x' }), 403);
});
await check("another module's /api/v1/admin route is untouched for a Food-only admin", async () => {
  assert.equal(await hit(foodOnly, 'GET', '/api/v1/admin/something-else'), 200);
});

const coreToken = (t) => jwt.sign({ ...jwt.decode(t), role: 'ADMIN' }, 'smoke-secret');
await check('a Food-only admin cannot read taxi SOS alerts', async () => {
  assert.equal(await hit(coreToken(foodOnly), 'GET', '/api/v1/taxi/admin/safety/alerts'), 403);
});
await check('a taxi admin can', async () => {
  assert.notEqual(await hit(coreToken(taxi), 'GET', '/api/v1/taxi/admin/safety/alerts'), 403);
});

listener.close();
await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
