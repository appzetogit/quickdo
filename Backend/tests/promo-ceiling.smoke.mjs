/**
 * Master > Promotions: the platform ceiling on what a promo may give away.
 *
 * Run: node tests/promo-ceiling.smoke.mjs
 *
 * The ceiling has to hold two properties, and the second is the one that is
 * easy to get wrong:
 *
 *   1. it only ever TIGHTENS -- a code allowing fewer uses keeps its own number;
 *   2. ZERO MEANS UNLIMITED in both coupon systems, so a plain Math.min would
 *      read "no cap" as the smallest cap and refuse every redemption.
 *
 * Also checked: nothing changes until a ceiling is set, and a per-module ceiling
 * beats the global one for that module only.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());

const { set, invalidateCache } = await import('../src/core/config/resolver.service.js');
const { coerce } = await import('../src/core/config/registry.js');
const { tighten, resolvePromoCeiling, effectivePromoLimits } =
  await import('../src/core/finance/promoLimits.service.js');

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

await check('unlimited is not mistaken for zero', () => {
  // Every shape the two systems use for "no limit".
  for (const unlimited of [0, null, undefined, '', '0']) {
    assert.equal(tighten(unlimited, null), null, `own=${unlimited}, no ceiling`);
    // A ceiling gives an uncapped code a limit -- that is the feature.
    assert.equal(tighten(unlimited, 3), 3, `own=${unlimited}, ceiling 3`);
  }
});

await check('the ceiling only ever tightens', () => {
  assert.equal(tighten(2, 5), 2, 'a stricter code keeps its own limit');
  assert.equal(tighten(10, 5), 5, 'a looser code is capped');
  assert.equal(tighten(5, 5), 5);
  // Raising the ceiling must not make a live promo more generous.
  assert.equal(tighten(2, 100), 2);
});

await check('no ceiling set: the code keeps exactly what it asks for', async () => {
  const c = await resolvePromoCeiling({ vertical: 'taxi' });
  assert.equal(c.perUser, null);
  assert.equal(c.total, null);
  const limits = await effectivePromoLimits({ vertical: 'taxi', ownPerUser: 4, ownTotal: 0 });
  assert.equal(limits.perUser, 4);
  assert.equal(limits.total, null, 'an uncapped code stays uncapped');
});

await check('a global ceiling reaches every module', async () => {
  await set('promo.maxUsesPerUser', { level: 'global', value: 3 });
  invalidateCache();
  for (const vertical of ['taxi', 'food', 'quickCommerce', 'medical']) {
    const l = await effectivePromoLimits({ vertical, ownPerUser: 10, ownTotal: 0 });
    assert.equal(l.perUser, 3, vertical);
  }
  // A code asking for less is untouched.
  const strict = await effectivePromoLimits({ vertical: 'taxi', ownPerUser: 1, ownTotal: 0 });
  assert.equal(strict.perUser, 1);
});

await check('a module ceiling beats the global one, for that module only', async () => {
  await set('promo.maxUsesPerUser', { level: 'vertical', scopeId: 'taxi', value: 1 });
  invalidateCache();
  const taxi = await effectivePromoLimits({ vertical: 'taxi', ownPerUser: 10, ownTotal: 0 });
  assert.equal(taxi.perUser, 1);
  const food = await effectivePromoLimits({ vertical: 'food', ownPerUser: 10, ownTotal: 0 });
  assert.equal(food.perUser, 3, 'food still reads the global ceiling');
});

await check('the total ceiling caps an uncapped code', async () => {
  await set('promo.maxUsesTotal', { level: 'global', value: 500 });
  invalidateCache();
  const l = await effectivePromoLimits({ vertical: 'food', ownPerUser: 1, ownTotal: 0 });
  assert.equal(l.total, 500, 'a code with no total cap inherits the ceiling');
  const smaller = await effectivePromoLimits({ vertical: 'food', ownPerUser: 1, ownTotal: 50 });
  assert.equal(smaller.total, 50, 'a code with a smaller cap keeps it');
});

await check('clearing the ceiling restores the code\'s own terms', async () => {
  await set('promo.maxUsesPerUser', { level: 'vertical', scopeId: 'taxi', value: null });
  await set('promo.maxUsesPerUser', { level: 'global', value: null });
  await set('promo.maxUsesTotal', { level: 'global', value: null });
  invalidateCache();
  const l = await effectivePromoLimits({ vertical: 'taxi', ownPerUser: 10, ownTotal: 0 });
  assert.equal(l.perUser, 10);
  assert.equal(l.total, null);
});

await check('a ceiling of zero is refused rather than blocking every promo', () => {
  // min: 1 in the registry. Without it, 0 would read as "nobody may use any
  // code" on one screen and "unlimited" on the other.
  assert.throws(() => coerce('promo.maxUsesPerUser', 0), /at least 1/);
  assert.throws(() => coerce('promo.maxUsesTotal', 0), /at least 1/);
  // Clearing is how you remove a ceiling, and that stays available.
  assert.equal(coerce('promo.maxUsesPerUser', ''), null);
});

await check('the ceiling cannot be set per zone or per rider', async () => {
  for (const level of ['zone', 'partner']) {
    await assert.rejects(
      () => set('promo.maxUsesPerUser', { level, scopeId: 'x', value: 2 }),
      /cannot be set at the/,
      level,
    );
  }
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
