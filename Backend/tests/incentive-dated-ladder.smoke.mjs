/**
 * A limited-time ladder runs on top of the permanent one, between its dates.
 *
 * Run: node tests/incentive-dated-ladder.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'incentive_dated' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { FoodDeliveryPartner: FoodRider } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { DriverIncentiveRule } = await import('../src/core/incentives/models/driverIncentiveRule.model.js');
const { validateIncentiveRuleUpsertDto } = await import('../src/core/incentives/validators/incentiveRule.validator.js');
const incentives = await import('../src/core/incentives/services/incentiveService.js');

const food = await FoodRider.create({ name: 'R', phone: '9400000011', status: 'approved' });
const hour = 3600 * 1000;
await DriverIncentiveRule.create({ segment: 'foodAndQuick', title: 'Every day', windowType: 'daily', isActive: true, tiers: [{ fromOrders: 1, toOrders: 5, rewardAmount: 100 }] });
const promo = await DriverIncentiveRule.create({
  segment: 'foodAndQuick', title: 'Festival', windowType: 'daily', isActive: true,
  startsAt: new Date(Date.now() - 30 * 60 * 1000), endsAt: new Date(Date.now() + 24 * hour),
  tiers: [{ fromOrders: 1, toOrders: 2, rewardAmount: 300 }],
});
// One order before the promo started, one after.
await FoodOrder.collection.insertMany([
  { order_id: 'FOD-A', orderStatus: 'delivered', dispatch: { status: 'accepted', deliveryPartnerId: food._id }, deliveryState: { deliveredAt: new Date(Date.now() - 45 * 60 * 1000) }, createdAt: new Date(Date.now() - 50 * 60 * 1000) },
  { order_id: 'FOD-B', orderStatus: 'delivered', dispatch: { status: 'accepted', deliveryPartnerId: food._id }, deliveryState: { deliveredAt: new Date() }, createdAt: new Date() },
]);

await check('while running, the promo is the rider\'s ladder and counts only orders since it started', async () => {
  const card = await incentives.getCurrentIncentiveForFoodPartner(food._id);
  assert.equal(String(card.id), String(promo._id), JSON.stringify(card).slice(0, 300));
  assert.equal(card.completedOrders, 1);
});

await check('once it ends, the permanent ladder is back', async () => {
  await DriverIncentiveRule.updateOne({ _id: promo._id }, { $set: { endsAt: new Date(Date.now() - 1000) } });
  const card = await incentives.getCurrentIncentiveForFoodPartner(food._id);
  assert.notEqual(String(card.id), String(promo._id));
  assert.equal(card.completedOrders, 2);
});

await check('dates are checked when saving', async () => {
  const base = { segment: 'foodAndQuick', tiers: [{ fromOrders: 1, toOrders: 2, rewardAmount: 10 }] };
  assert.throws(() => validateIncentiveRuleUpsertDto({ ...base, startsAt: '2026-10-05', endsAt: '2026-10-04' }), /after the start/);
  const ok = validateIncentiveRuleUpsertDto({ ...base, startsAt: '2026-10-05', endsAt: '' });
  assert.ok(ok.startsAt instanceof Date);
  assert.equal(ok.endsAt, null);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
