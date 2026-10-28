/**
 * The Petpooja status webhook acts only for a caller holding the shared secret.
 *
 * Run: node tests/petpooja-webhook-auth.smoke.mjs
 *
 * Found in review: the route is public, order ids are guessable (FOD- + 7
 * digits), outlet_code was optional, and "cancelled" refunds the order. Anyone
 * could cancel any order at a Petpooja restaurant.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'petpooja_auth' });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
};

const { FoodPetpoojaSettings } = await import('../src/modules/food/admin/models/petpoojaSettings.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { petpoojaWebhookController } = await import('../src/modules/food/orders/controllers/petpooja.controller.js');
const admin = await import('../src/modules/food/admin/controllers/businessSettings.controller.js');

const restaurantId = new mongoose.Types.ObjectId();
await FoodRestaurant.collection.insertOne({ _id: restaurantId, restaurantName: 'R', petpoojaEnabled: true, petpoojaOutletId: 'OUT1' });
await FoodOrder.collection.insertOne({
  _id: new mongoose.Types.ObjectId(), order_id: 'FOD-1234567', orderStatus: 'created',
  restaurantId, userId: new mongoose.Types.ObjectId(), createdAt: new Date(),
});

const run = (fn, req) => new Promise((resolve) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
  fn({ body: {}, query: {}, headers: {}, get(h) { return this.headers[h.toLowerCase()]; }, protocol: 'https', ...req }, res, (e) => resolve({ status: 500, body: e?.message }));
});
// 'bogus' never reaches a status change, so a 400 "Unmapped status" means the caller got through.
const hook = (req) => run(petpoojaWebhookController, { body: { order_id: 'FOD-1234567', status: 'bogus', outlet_code: 'OUT1' }, ...req });

await check('enabling the integration generates a secret and returns the callback URL', async () => {
  const r = await run(admin.updatePetpoojaSettings, { body: { enabled: true, apiKey: 'k', clientCode: 'c' }, headers: { host: 'quickdropsindia.com' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const doc = await FoodPetpoojaSettings.findOne().lean();
  assert.ok(doc.webhookSecret.length >= 32);
  assert.ok(JSON.stringify(r.body).includes(`/api/v1/petpooja/webhook?token=${doc.webhookSecret}`));
});
const secret = (await FoodPetpoojaSettings.findOne().lean()).webhookSecret;

await check('no token is refused', async () => { assert.equal((await hook({})).status, 401); });
await check('a wrong token is refused', async () => { assert.equal((await hook({ query: { token: 'x'.repeat(48) } })).status, 401); });
await check('the right token (query) gets through', async () => {
  const r = await hook({ query: { token: secret } });
  assert.equal(r.status, 400); assert.match(r.body.message, /Unmapped status/);
});
await check('the right token (header) gets through', async () => {
  const r = await hook({ headers: { 'x-petpooja-token': secret } });
  assert.equal(r.status, 400); assert.match(r.body.message, /Unmapped status/);
});
await check('a missing outlet code is refused even with the token', async () => {
  const r = await hook({ query: { token: secret }, body: { order_id: 'FOD-1234567', status: 'cancelled' } });
  assert.equal(r.status, 400); assert.match(r.body.message, /outlet_code/);
});
await check('a wrong outlet code is refused', async () => {
  const r = await hook({ query: { token: secret }, body: { order_id: 'FOD-1234567', status: 'cancelled', outlet_code: 'OUT2' } });
  assert.equal(r.status, 400); assert.match(r.body.message, /Outlet/);
});
await check('enabled with no secret at all refuses everything', async () => {
  await FoodPetpoojaSettings.updateOne({}, { $set: { webhookSecret: '' } });
  assert.equal((await hook({ query: { token: '' } })).status, 401);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
