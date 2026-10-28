/**
 * Zone-level settings: a zone beats its module, and a module beats all modules.
 *
 * Run: node tests/zone-settings.smoke.mjs
 *
 *   - delivery formula, platform fee, cancellation rules and the order hold each
 *     take a zone's own value, and fall back when the zone has none;
 *   - the daily incentive ladder: a zone with its own ladder counts only that
 *     zone's deliveries; the default ladder counts everything else;
 *   - the Master zone picker lists a module's zones.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`); }
};

const { set, invalidateCache } = await import('../src/core/config/resolver.service.js');
const save = async (key, level, scopeId, value) => { await set(key, { level, scopeId, value }); invalidateCache(); };
const oid = () => new mongoose.Types.ObjectId();
const INDORE = String(oid());
const DEWAS = String(oid());

console.log('\nSettings per zone');
await check('delivery formula: zone > food > all modules', async () => {
  const { resolveDeliveryFormula, priceDelivery } = await import('../src/core/finance/deliveryFormula.js');
  const f = (base) => ({ mode: 'simple', customer: { base, includedKm: 50, perKm: 0 }, rider: { base: 1, includedKm: 50, perKm: 0 } });
  await save('earnings.formula', 'global', '*', f(20));
  await save('earnings.formula', 'vertical', 'food', f(30));
  await save('earnings.formula', 'zone', INDORE, f(40));
  const fee = async (zoneId) => priceDelivery((await resolveDeliveryFormula({ vertical: 'food', zoneId })).formula, 3).customerFee;
  assert.equal(await fee(INDORE), 40);
  assert.equal(await fee(DEWAS), 30);
  assert.equal(priceDelivery((await resolveDeliveryFormula({ vertical: 'quickCommerce', zoneId: DEWAS })).formula, 3).customerFee, 20);
});
await check('platform fee: a zone\'s own fee', async () => {
  const { withMasterFees } = await import('../src/core/finance/platformFees.service.js');
  await save('fees.platformFee', 'vertical', 'food', 8);
  await save('fees.platformFee', 'zone', INDORE, 3);
  assert.equal((await withMasterFees('food', { platformFee: 99 }, { zoneId: INDORE })).platformFee, 3);
  assert.equal((await withMasterFees('food', { platformFee: 99 }, { zoneId: DEWAS })).platformFee, 8);
  assert.equal((await withMasterFees('food', { platformFee: 99 })).platformFee, 8);
});
await check('cancellation window: a zone\'s own rules', async () => {
  const { getCancelRules, clearCancelRulesCache } = await import('../src/modules/food/orders/services/cancellationPolicy.js');
  await save('orders.cancelAfterAccept', 'vertical', 'food', true);
  await save('orders.cancelWindowMinutes', 'vertical', 'food', 5);
  await save('orders.cancelWindowMinutes', 'zone', INDORE, 12);
  clearCancelRulesCache();
  assert.equal((await getCancelRules('food', INDORE)).windowMinutes, 12);
  assert.equal((await getCancelRules('food', DEWAS)).windowMinutes, 5);
});
await check('order hold: a zone\'s own hold', async () => {
  const { holdSecondsFor } = await import('../src/core/orders/orderHold.js');
  await save('orders.holdSeconds', 'vertical', 'food', 30);
  await save('orders.holdSeconds', 'zone', INDORE, 90);
  assert.equal(await holdSecondsFor('food', INDORE), 90);
  assert.equal(await holdSecondsFor('food', DEWAS), 30);
  assert.equal(await holdSecondsFor('quickCommerce', DEWAS), 0);
});
await check('a zone value cannot be set per rider (partner level still refused)', async () => {
  await assert.rejects(() => set('orders.holdSeconds', { level: 'partner', scopeId: 'r1', value: 5 }));
});

console.log('\nDaily ladder per zone');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { DriverIncentiveRule } = await import('../src/core/incentives/models/driverIncentiveRule.model.js');
const { __testables: inc } = await import('../src/core/incentives/services/incentiveService.js');
const rider = oid();
const now = new Date();
const deliver = (zoneId, n) => Array.from({ length: n }, () => ({
  _id: oid(), zoneId: zoneId ? new mongoose.Types.ObjectId(zoneId) : null, orderStatus: 'delivered',
  'dispatch': { deliveryPartnerId: rider }, deliveryState: { deliveredAt: now },
}));
await FoodOrder.collection.insertMany([...deliver(INDORE, 6), ...deliver(DEWAS, 3), ...deliver(null, 1)]);
const tiers = [{ fromOrders: 1, toOrders: 5, rewardAmount: 100 }];
await DriverIncentiveRule.create({ segment: 'foodAndQuick', tiers, title: 'default' });
await DriverIncentiveRule.create({ segment: 'foodAndQuick', tiers, title: 'indore', zoneId: INDORE, zoneName: 'Indore' });
const ctx = { foodPartnerId: rider, qcPartnerId: null };
const bounds = inc.istDayBounds();

await check('an order in a zone with its own ladder climbs that ladder, counting only that zone', async () => {
  const { rule, scope } = await inc.ladderFor('foodAndQuick', INDORE);
  assert.equal(rule.title, 'indore');
  assert.equal(await inc.countCompletedToday(ctx, 'foodAndQuick', bounds, scope), 6);
});
await check('an order elsewhere climbs the default ladder, counting every other zone', async () => {
  const { rule, scope } = await inc.ladderFor('foodAndQuick', DEWAS);
  assert.equal(rule.title, 'default');
  assert.equal(await inc.countCompletedToday(ctx, 'foodAndQuick', bounds, scope), 4); // 3 Dewas + 1 unzoned
});
await check('no trip counts toward two ladders', async () => {
  const a = await inc.ladderFor('foodAndQuick', INDORE);
  const b = await inc.ladderFor('foodAndQuick', null);
  const total = await inc.countCompletedToday(ctx, 'foodAndQuick', bounds, a.scope)
    + await inc.countCompletedToday(ctx, 'foodAndQuick', bounds, b.scope);
  assert.equal(total, 10);
});
await check('saving a zone ladder leaves the default ladder live', async () => {
  const { validateIncentiveRuleUpsertDto } = await import('../src/core/incentives/validators/incentiveRule.validator.js');
  const body = validateIncentiveRuleUpsertDto({ segment: 'foodAndQuick', tiers, zoneId: INDORE, zoneName: 'Indore' });
  assert.equal(String(body.zoneId), INDORE);
  const noZone = validateIncentiveRuleUpsertDto({ segment: 'foodAndQuick', tiers });
  assert.equal(noZone.zoneId, null);
  assert.throws(() => validateIncentiveRuleUpsertDto({ segment: 'foodAndQuick', tiers, zoneId: 'nope' }));
});

console.log('\nZone picker');
await check('lists a module\'s zones, active first', async () => {
  const { FoodZone } = await import('../src/modules/food/admin/models/zone.model.js');
  await FoodZone.collection.insertMany([
    { name: 'Bhopal', isActive: false, coordinates: [] },
    { name: 'Indore', isActive: true, coordinates: [] },
  ]);
  const { listZonesFor } = await import('../src/core/appServices/appServices.service.js');
  const zones = await listZonesFor('food');
  assert.deepEqual(zones.map((z) => [z.name, z.active]), [['Indore', true], ['Bhopal', false]]);
  assert.equal(await listZonesFor('nope'), null);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall zone checks passed');
process.exit(failed ? 1 : 0);
