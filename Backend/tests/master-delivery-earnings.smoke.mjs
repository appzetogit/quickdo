/**
 * Master > Delivery earnings: the engine that decides what a rider is paid.
 *
 * Run: node tests/master-delivery-earnings.smoke.mjs
 *
 * The claim this has to defend is that moving the earning table into Master
 * changes nothing until somebody sets one. So the first check is the important
 * one: with no row saved, every module still reads its own table.
 *
 *   - nothing set  -> the module's own bands, marked as such;
 *   - global set   -> wins for every module;
 *   - vertical set -> wins over global for that module only;
 *   - zone set     -> wins over vertical;
 *   - band matching keeps the old fallbacks (past the last band, below the first);
 *   - the incentive falls back to the module's rule, and a global rule reaches
 *     quick commerce, which has no rule of its own today;
 *   - a malformed table is refused rather than stored.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());

const { set, invalidateCache } = await import('../src/core/config/resolver.service.js');
const { coerce } = await import('../src/core/config/registry.js');
const { resolveEarningSlabs, resolveIncentive, pickSlab } =
  await import('../src/core/finance/deliveryEarnings.service.js');

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

// What the food module has in its own collection today.
const legacyRows = [
  { _id: new mongoose.Types.ObjectId(), minDistance: 0, maxDistance: 3, userDeliveryFee: 25, commissionPerKm: 0, basePayout: 20 },
  { _id: new mongoose.Types.ObjectId(), minDistance: 3, maxDistance: 8, userDeliveryFee: 0, commissionPerKm: 7, basePayout: 30 },
];
const loadLegacy = async () => legacyRows;
const ZONE = String(new mongoose.Types.ObjectId());

const band = (min, max, base, perKm, fee = 0) => ({
  minDistance: min, maxDistance: max, basePayout: base, commissionPerKm: perKm, userDeliveryFee: fee,
});

await check('nothing set in Master: the module keeps its own table', async () => {
  const { slabs, level, source } = await resolveEarningSlabs({ vertical: 'food', loadLegacy });
  assert.equal(level, 'legacy');
  assert.match(source, /not yet set in Master/);
  assert.equal(slabs.length, 2);
  assert.equal(slabs[1].basePayout, 30);
  // The band id survives, so per-band admin commission still matches.
  assert.equal(slabs[0].distanceRuleId, String(legacyRows[0]._id));
});

await check('the old band-matching fallbacks are unchanged', async () => {
  const { slabs } = await resolveEarningSlabs({ vertical: 'food', loadLegacy });
  assert.equal(pickSlab(slabs, 1).basePayout, 20, 'inside the first band');
  assert.equal(pickSlab(slabs, 5).basePayout, 30, 'inside the second');
  assert.equal(pickSlab(slabs, 3).basePayout, 30, 'a boundary belongs to the upper band');
  // Past the last band: the widest band, never zero. Unpaid work otherwise.
  assert.equal(pickSlab(slabs, 40).basePayout, 30);
  assert.equal(pickSlab(slabs, -1), null);
  assert.equal(pickSlab([], 5), null);
});

await check('with no extra rate, a band charges exactly what it did before', async () => {
  const { bandFee } = await import('../src/core/finance/deliveryEarnings.service.js');
  // A flat customer fee wins and stays flat.
  assert.equal(bandFee({ minDistance: 5, maxDistance: 6, userDeliveryFee: 59, commissionPerKm: 59 }, 5.5).fee, 59);
  assert.equal(bandFee({ minDistance: 5, maxDistance: 6, userDeliveryFee: 59, commissionPerKm: 59 }, 45).fee, 59);
  // No customer fee: the per-km rate over the whole trip, as before.
  assert.equal(bandFee({ minDistance: 3, maxDistance: 8, userDeliveryFee: 0, commissionPerKm: 7 }, 4).fee, 28);
  assert.equal(bandFee(null, 5).fee, 0);
});

await check('an open-ended band charges for the distance past it', async () => {
  const { bandFee } = await import('../src/core/finance/deliveryEarnings.service.js');
  // "6 km and beyond: Rs 59, then Rs 12 per extra km"
  const open = { minDistance: 6, maxDistance: null, userDeliveryFee: 59, commissionPerKm: 0, extraPerKm: 12 };
  assert.equal(bandFee(open, 6).fee, 59, 'at the band start, nothing extra');
  assert.equal(bandFee(open, 10).fee, 59 + 48, '4km over at Rs 12');
  const long = bandFee(open, 45);
  assert.equal(long.extraKm, 39);
  assert.equal(long.extra, 468);
  assert.equal(long.fee, 527, 'a 45km trip is no longer billed as a 6km one');
  // The parts are reported so a bill can be explained.
  assert.equal(long.base, 59);
});

await check('the extra rides on top of a per-km band too', async () => {
  const { bandFee } = await import('../src/core/finance/deliveryEarnings.service.js');
  const b = { minDistance: 10, maxDistance: null, userDeliveryFee: 0, commissionPerKm: 5, extraPerKm: 3 };
  // 5/km over the whole 14km, plus 3/km for the 4km past the band start.
  assert.equal(bandFee(b, 14).fee, 70 + 12);
});

await check('an extra rate is validated like every other figure', () => {
  assert.throws(() => coerce('earnings.distanceSlabs', [{ ...band(0, null, 10, 1), extraPerKm: -5 }]), /extra per-km/);
  const ok = coerce('earnings.distanceSlabs', [{ ...band(6, null, 59, 0), extraPerKm: 12 }]);
  assert.equal(ok[0].extraPerKm, 12);
  assert.equal(ok[0].maxDistance, null, 'an open-ended band is allowed');
  // Bands that do not set one are stored flat, not undefined.
  const flat = coerce('earnings.distanceSlabs', [band(0, 5, 20, 2)]);
  assert.equal(flat[0].extraPerKm, 0);
});

await check('a global table wins for every module', async () => {
  await set('earnings.distanceSlabs', { level: 'global', value: [band(0, null, 99, 5)] });
  invalidateCache();
  for (const vertical of ['food', 'quickCommerce', 'medical']) {
    const { slabs, level } = await resolveEarningSlabs({ vertical, loadLegacy });
    assert.equal(level, 'global', vertical);
    assert.equal(pickSlab(slabs, 12).basePayout, 99, vertical);
  }
});

await check('a module override beats the global table, for that module only', async () => {
  await set('earnings.distanceSlabs', { level: 'vertical', scopeId: 'quickCommerce', value: [band(0, null, 44, 3)] });
  invalidateCache();
  const qc = await resolveEarningSlabs({ vertical: 'quickCommerce', loadLegacy });
  assert.equal(qc.level, 'vertical');
  assert.equal(pickSlab(qc.slabs, 2).basePayout, 44);
  // Food is untouched by quick commerce's override.
  const food = await resolveEarningSlabs({ vertical: 'food', loadLegacy });
  assert.equal(food.level, 'global');
  assert.equal(pickSlab(food.slabs, 2).basePayout, 99);
});

await check('a city override beats the module table', async () => {
  await set('earnings.distanceSlabs', { level: 'zone', scopeId: ZONE, value: [band(0, null, 77, 9)] });
  invalidateCache();
  const inZone = await resolveEarningSlabs({ vertical: 'quickCommerce', zoneId: ZONE, loadLegacy });
  assert.equal(inZone.level, 'zone');
  assert.equal(pickSlab(inZone.slabs, 2).basePayout, 77);
  // Another city still reads the module table.
  const elsewhere = await resolveEarningSlabs({ vertical: 'quickCommerce', zoneId: String(new mongoose.Types.ObjectId()), loadLegacy });
  assert.equal(elsewhere.level, 'vertical');
});

await check('clearing an override falls back to the level above', async () => {
  await set('earnings.distanceSlabs', { level: 'zone', scopeId: ZONE, value: null });
  invalidateCache();
  const { level } = await resolveEarningSlabs({ vertical: 'quickCommerce', zoneId: ZONE, loadLegacy });
  assert.equal(level, 'vertical');
});

await check('the incentive falls back to the module rule, and a global rule reaches quick commerce', async () => {
  const foodRule = { isEnabled: true, minOrderAmount: 500, incentivePercent: 4 };
  const before = await resolveIncentive({ vertical: 'food', legacy: foodRule });
  assert.equal(before.level, 'legacy');
  assert.equal(before.incentivePercent, 4);
  // Quick commerce has no rule of its own: no incentive, not a free payout.
  const qcBefore = await resolveIncentive({ vertical: 'quickCommerce', legacy: null });
  assert.equal(qcBefore.isEnabled, false);
  assert.equal(qcBefore.incentivePercent, 0);

  await set('earnings.incentive', { level: 'global', value: { isEnabled: true, minOrderAmount: 300, incentivePercent: 6 } });
  invalidateCache();
  const qcAfter = await resolveIncentive({ vertical: 'quickCommerce', legacy: null });
  assert.equal(qcAfter.level, 'global');
  assert.equal(qcAfter.incentivePercent, 6);
  assert.equal(qcAfter.minOrderAmount, 300);
});

await check('a malformed table is refused, not stored', () => {
  assert.throws(() => coerce('earnings.distanceSlabs', []), /at least one distance band/);
  assert.throws(() => coerce('earnings.distanceSlabs', [band(5, 2, 10, 1)]), /greater than/);
  assert.throws(() => coerce('earnings.distanceSlabs', [band(0, 5, -1, 1)]), /base payout/);
  assert.throws(() => coerce('earnings.distanceSlabs', 'not a table'), /valid JSON/);
  assert.throws(() => coerce('earnings.incentive', { incentivePercent: 150 }), /between 0 and 100/);
  // Bands are stored in distance order whatever order they arrive in.
  const sorted = coerce('earnings.distanceSlabs', [band(5, 9, 1, 1), band(0, 5, 2, 2)]);
  assert.deepEqual(sorted.map((b) => b.minDistance), [0, 5]);
});

await check('the editor endpoint returns the bands, their ids and the source', async () => {
  const { FoodDeliveryCommissionRule } = await import('../src/modules/food/admin/models/deliveryCommissionRule.model.js');
  await FoodDeliveryCommissionRule.collection.insertMany(
    legacyRows.map((r) => ({ ...r, status: true })),
  );
  const { getEarningsController } = await import('../src/core/finance/earnings.controller.js');

  const call = (vertical) => new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ statusCode: this.statusCode, body }); return this; },
    };
    getEarningsController({ params: { vertical }, query: {} }, res, reject);
  });

  const ok = await call('food');
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.success, true);
  // The module's own bands come back WITH their ids -- what "start from the
  // current table" relies on to keep per-band admin commission matching.
  assert.equal(ok.body.data.moduleBands.length, 2);
  assert.equal(ok.body.data.moduleBands[0].distanceRuleId, String(legacyRows[0]._id));
  assert.ok(ok.body.data.slabSource, 'the screen must be able to say where the figure came from');

  const bad = await call('not-a-module');
  assert.equal(bad.statusCode, 400);
});

await check('a table cannot be set per rider', async () => {
  await assert.rejects(
    () => set('earnings.distanceSlabs', { level: 'partner', scopeId: 'r1', value: [band(0, null, 5, 1)] }),
    /cannot be set at the partner level/,
  );
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
