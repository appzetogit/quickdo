/**
 * Master > Cancellation Policy: one rule for Food and Quick & Medical.
 *
 * Run: node tests/cancel-policy-master.smoke.mjs
 *
 * What this guards:
 *   - with nothing set in Master, Food keeps its own screen's rule and Quick
 *     keeps "only before the store accepts" -- exactly today's behaviour;
 *   - a Master rule reaches both, and a per-service value beats the global one;
 *   - a real Quick cancellation (QC cancelOrder) is allowed inside the window
 *     after acceptance, refused after it, and never once the rider has it;
 *   - the Quick order screen gets the same cancel countdown Food's does;
 *   - Food's own screen shows its saved rule and says when Master overrides it.
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
    console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
  }
};

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.MONGODB_URI = mongod.getUri();
await mongoose.connect(process.env.MONGO_URI);

const policy = await import('../src/modules/food/orders/services/cancellationPolicy.js');
const resolver = await import('../src/core/config/resolver.service.js');
const qc = await import('../src/modules/quickCommerce/modules/food/orders/services/order.service.js');
const { FoodOrder: QuickOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');

const set = (key, value, vertical = null) =>
  resolver.set(key, vertical ? { level: 'vertical', scopeId: vertical, value } : { level: 'global', scopeId: '*', value });
const minutesAgo = (m) => new Date(Date.now() - m * 60_000);
const oid = () => new mongoose.Types.ObjectId();

/** A Quick order in a given state, accepted some minutes ago, written raw. */
async function quickOrder(status, acceptedMinutesAgo = 1, extra = {}) {
  const _id = oid();
  const userId = oid();
  await QuickOrder.collection.insertOne({
    _id,
    order_id: `QC-${String(_id).slice(-6)}`,
    userId,
    restaurantId: oid(),
    items: [{ itemId: oid(), name: 'Milk 1L', price: 100, quantity: 1 }],
    deliveryAddress: {
      label: 'Home', street: '1 Test Rd', city: 'Palampur', state: 'HP',
      location: { type: 'Point', coordinates: [76.539, 32.115] },
    },
    orderStatus: status,
    statusHistory: status === 'created' ? [] : [{ at: minutesAgo(acceptedMinutesAgo), byRole: 'RESTAURANT', from: 'created', to: 'confirmed' }],
    payment: { method: 'cash', status: 'cod_pending' },
    pricing: { subtotal: 100, total: 100 },
    createdAt: minutesAgo(acceptedMinutesAgo + 1),
    updatedAt: minutesAgo(acceptedMinutesAgo),
    ...extra,
  });
  return { id: String(_id), userId: String(userId) };
}
const cancelQuick = (o) => qc.cancelOrder(o.id, o.userId, 'changed my mind');
const statusOf = async (o) => (await QuickOrder.findById(o.id).lean()).orderStatus;

console.log('\nNothing set in Master');
await check('Food keeps its own screen\'s rule', async () => {
  await policy.setCancelRules({ allowAfterAccept: true, windowMinutes: 3, stopWhenPreparing: true });
  const r = await policy.getCancelRules('food');
  assert.equal(r.allowAfterAccept, true);
  assert.equal(r.windowMinutes, 3);
  assert.equal(r.source.allowAfterAccept, 'service');
});
await check('Quick keeps "only before the store accepts"', async () => {
  const r = await policy.getCancelRules('quickCommerce');
  assert.equal(r.allowAfterAccept, false);
});
await check('a waiting Quick order can be cancelled', async () => {
  const o = await quickOrder('created');
  await cancelQuick(o);
  assert.equal(await statusOf(o), 'cancelled_by_user');
});
await check('an accepted Quick order cannot, as before', async () => {
  const o = await quickOrder('confirmed', 1);
  await assert.rejects(() => cancelQuick(o), /the store has accepted it/);
  assert.equal(await statusOf(o), 'confirmed');
});

console.log('\nSet once in Master');
await check('a global rule reaches both services', async () => {
  await set('orders.cancelAfterAccept', true);
  await set('orders.cancelWindowMinutes', 5);
  for (const v of ['food', 'quickCommerce']) {
    const r = await policy.getCancelRules(v);
    assert.equal(r.allowAfterAccept, true, v);
    assert.equal(r.windowMinutes, 5, v);
    assert.equal(r.source.windowMinutes, 'master', v);
  }
});
await check('a Quick order accepted 2 minutes ago can now be cancelled', async () => {
  const o = await quickOrder('confirmed', 2);
  await cancelQuick(o);
  assert.equal(await statusOf(o), 'cancelled_by_user');
});
await check('one accepted 6 minutes ago cannot', async () => {
  const o = await quickOrder('confirmed', 6);
  await assert.rejects(() => cancelQuick(o), /more than 5 minutes ago/);
});
await check('one already being prepared cannot (stop when preparing, Food\'s default)', async () => {
  const o = await quickOrder('preparing', 1);
  await assert.rejects(() => cancelQuick(o), /started preparing/);
});
await check('one the rider has picked up never can', async () => {
  const o = await quickOrder('picked_up', 1);
  await assert.rejects(() => cancelQuick(o), /picked up/);
});
await check('the Quick order screen shows the countdown', async () => {
  const o = await quickOrder('confirmed', 1);
  const c = policy.cancellationForClient(await QuickOrder.findById(o.id).lean(), await policy.getCancelRules('quickCommerce'));
  assert.equal(c.allowed, true);
  assert.ok(c.secondsLeft > 200 && c.secondsLeft <= 240, `secondsLeft ${c.secondsLeft}`);
});

console.log('\nPer service');
await check('switching it off for Quick only leaves Food on the global rule', async () => {
  await set('orders.cancelAfterAccept', false, 'quickCommerce');
  assert.equal((await policy.getCancelRules('quickCommerce')).allowAfterAccept, false);
  assert.equal((await policy.getCancelRules('food')).allowAfterAccept, true);
  const o = await quickOrder('confirmed', 1);
  await assert.rejects(() => cancelQuick(o));
});

console.log('\nFood\'s own screen');
await check('shows its saved rule and which fields Master overrides', async () => {
  const a = await policy.foodCancelRulesForAdmin();
  assert.equal(a.windowMinutes, 3);
  assert.deepEqual(a.overriddenByMaster.sort(), ['allowAfterAccept', 'windowMinutes']);
  assert.equal(a.inForce.windowMinutes, 5);
});

console.log('\nClearing');
await check('clearing Master hands each service its own rule back', async () => {
  await set('orders.cancelAfterAccept', null);
  await set('orders.cancelWindowMinutes', null);
  await set('orders.cancelAfterAccept', null, 'quickCommerce');
  assert.equal((await policy.getCancelRules('food')).windowMinutes, 3);
  assert.equal((await policy.getCancelRules('quickCommerce')).allowAfterAccept, false);
  assert.deepEqual((await policy.foodCancelRulesForAdmin()).overriddenByMaster, []);
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll cancellation policy checks passed');
process.exit(failed ? 1 : 0);
