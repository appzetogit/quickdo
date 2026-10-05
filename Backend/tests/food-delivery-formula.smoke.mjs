/**
 * A food order priced by the Master delivery formula.
 *
 * Run: node tests/food-delivery-formula.smoke.mjs
 *
 * Through the real quote and placement: with no formula the module's band table
 * prices the order (Rs 30 delivery, rider paid the Rs 30 share); once a formula
 * is saved the customer pays its fee and the rider is paid its own figure, not
 * a share of the fee; a quick-commerce override leaves food alone; clearing it
 * restores the old table.
 */
import { startFoodWorld, makeChecker } from './food-order-fixture.mjs';

const w = await startFoodWorld('food_delivery_formula');
const { check, summary } = makeChecker();
let failed = 1;
try {
  const { set, invalidateCache } = await import('../src/core/config/resolver.service.js');
  const buyer = await w.makeUser();
  const items = [w.appLine(w.dish)];
  const order = async () => {
    const pricing = await w.quote(buyer._id, { items });
    return { pricing, saved: await w.saved(await w.place(buyer._id, { items, pricing })) };
  };

  const before = await order();
  check('no formula: the band table prices delivery', before.pricing.deliveryFee === 30, before.pricing.deliveryFee);
  check('no formula: the rider is paid the fee share', before.saved.riderEarning === 30, before.saved.riderEarning);

  // Base covers 50 km so the fixture's distance does not matter.
  const formula = {
    mode: 'simple',
    customer: { base: 45, includedKm: 50, perKm: 9 },
    rider: { base: 33, includedKm: 50, perKm: 7 },
  };
  await set('earnings.formula', { level: 'global', value: formula });
  invalidateCache();
  const after = await order();
  check('formula saved: the customer pays its fee', after.pricing.deliveryFee === 45, after.pricing.deliveryFee);
  check('formula saved: the rider earns its own figure', after.saved.riderEarning === 33, after.saved.riderEarning);
  check('the bill records where the fee came from',
    after.saved.pricing?.deliveryFeeBreakdown?.source === 'delivery_formula'
      || after.pricing?.deliveryFeeBreakdown?.source === 'delivery_formula');

  await set('earnings.formula', { level: 'vertical', scopeId: 'quickCommerce', value: { ...formula, customer: { base: 99, includedKm: 50, perKm: 0 } } });
  invalidateCache();
  const other = await order();
  check('a quick-commerce override leaves food on the global formula', other.pricing.deliveryFee === 45, other.pricing.deliveryFee);

  await set('earnings.formula', { level: 'global', value: null });
  invalidateCache();
  const cleared = await order();
  check('cleared: back to the band table', cleared.pricing.deliveryFee === 30 && cleared.saved.riderEarning === 30,
    `${cleared.pricing.deliveryFee}/${cleared.saved.riderEarning}`);
  failed = summary();
} finally {
  await w.stop();
}
process.exit(failed ? 1 : 0);
