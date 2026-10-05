/**
 * Master > Platform Fee & GST: one platform fee for Food and Quick & Medical.
 *
 * Run: node tests/platform-fees.smoke.mjs
 *
 * Drives the real Food quote (calculateOrderPricing, through its validator) and
 * Quick's fee loader, so what is checked is what a customer is charged:
 *   - with nothing set in Master, each service charges its own fee, as before;
 *   - a Master fee reaches the bill, and its GST is worked on it;
 *   - a Master GST rate reaches Food's bill; Quick has no such line to change;
 *   - a per-service value beats the global one; clearing hands the fee back.
 */
import assert from 'node:assert/strict';
import { startFoodWorld, near } from './food-order-fixture.mjs';

const w = await startFoodWorld('platform_fees');
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

const resolver = await import('../src/core/config/resolver.service.js');
const fees = await import('../src/core/finance/platformFees.service.js');
const { FoodFeeSettings: QuickFeeSettings } = await import('../src/modules/quickCommerce/modules/food/admin/models/feeSettings.model.js');
const { loadActiveFeeSettings } = await import('../src/modules/quickCommerce/modules/food/orders/services/order-pricing.service.js');

const set = (key, value, vertical = null) =>
  resolver.set(key, vertical ? { level: 'vertical', scopeId: vertical, value } : { level: 'global', scopeId: '*', value });

await QuickFeeSettings.create({ deliveryFee: 0, deliveryFeeRanges: [], platformFee: 4, isActive: true });
const foodOwn = await w.m.FoodFeeSettings.findOne({ isActive: true }).lean();
const buyer = await w.makeUser();
const quote = () => w.quote(buyer._id, { items: [w.appLine(w.dish)] });

console.log('\nNothing set in Master');
await check('Food charges its own fee with its own GST', async () => {
  const p = await quote();
  assert.ok(near(p.platformFee, foodOwn.platformFee), `fee ${p.platformFee} vs own ${foodOwn.platformFee}`);
  assert.ok(near(p.platformFeeGst, foodOwn.platformFee * 0.18), `gst ${p.platformFeeGst}`);
});
await check('Quick charges its own fee', async () => {
  assert.equal((await loadActiveFeeSettings()).platformFee, 4);
});

console.log('\nSet once in Master');
await check('a global fee reaches the Food bill, GST worked on it', async () => {
  await set('fees.platformFee', 15);
  const p = await quote();
  assert.ok(near(p.platformFee, 15), `fee ${p.platformFee}`);
  assert.ok(near(p.platformFeeGst, 2.7), `gst ${p.platformFeeGst}`);
});
await check('and Quick\'s', async () => {
  assert.equal((await loadActiveFeeSettings()).platformFee, 15);
});
await check('a Master GST rate reaches Food\'s bill', async () => {
  await set('fees.platformFeeGstRate', 5);
  const p = await quote();
  assert.ok(near(p.platformFeeGst, 0.75), `gst ${p.platformFeeGst}`);
  assert.equal(p.platformFeeGstRate, 5);
});
await check('Quick gets the Master GST rate on its platform fee too', async () => {
  assert.equal((await loadActiveFeeSettings()).platformFeeGstRate, 5);
});

console.log('\nPer service');
await check('a Quick-only fee leaves Food on the global one', async () => {
  await set('fees.platformFee', 7, 'quickCommerce');
  assert.equal((await loadActiveFeeSettings()).platformFee, 7);
  assert.ok(near((await quote()).platformFee, 15));
});
await check('0 for Food charges no platform fee there', async () => {
  await set('fees.platformFee', 0, 'food');
  const p = await quote();
  assert.ok(near(p.platformFee, 0));
  assert.ok(near(p.platformFeeGst, 0));
});
await check('the overview says what each charges and who set it', async () => {
  const { services } = await fees.platformFeesOverview();
  const by = Object.fromEntries(services.map((s) => [s.vertical, s]));
  assert.deepEqual(by.food.platformFee, { value: 0, from: 'master' });
  assert.deepEqual(by.food.platformFeeGstRate, { value: 5, from: 'master' });
  assert.deepEqual(by.quickCommerce.platformFee, { value: 7, from: 'master' });
  assert.deepEqual(by.quickCommerce.platformFeeGstRate, { value: 5, from: 'master' });
});

console.log('\nClearing');
await check('clearing Master hands each service its own fee back', async () => {
  await set('fees.platformFee', null);
  await set('fees.platformFee', null, 'food');
  await set('fees.platformFee', null, 'quickCommerce');
  await set('fees.platformFeeGstRate', null);
  const p = await quote();
  assert.ok(near(p.platformFee, foodOwn.platformFee));
  assert.ok(near(p.platformFeeGst, foodOwn.platformFee * 0.18));
  assert.equal((await loadActiveFeeSettings()).platformFee, 4);
});

console.log('\nThe order');
await check('a placed order is charged the fee it was quoted', async () => {
  await set('fees.platformFee', 12);
  const q = await quote();
  const order = await w.saved(await w.place(buyer._id, { items: [w.appLine(w.dish)], pricing: q }));
  assert.ok(near(order.pricing.platformFee, 12), `order fee ${order.pricing.platformFee}`);
  assert.ok(near(order.pricing.total, q.total), `order ${order.pricing.total} vs quote ${q.total}`);
  await set('fees.platformFee', null);
});

await w.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll platform fee checks passed');
process.exit(failed ? 1 : 0);
