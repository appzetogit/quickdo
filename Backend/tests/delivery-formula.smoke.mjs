/**
 * The delivery formula: customer fee and rider pay as two separate lines.
 *
 * Run: node tests/delivery-formula.smoke.mjs
 *
 * Checks the maths, the validation, that today's band tables translate into the
 * formula without changing a single price, and that quick commerce's fee and
 * rider-pay functions use the formula once it is set.
 */
import assert from 'node:assert/strict';
import { normalizeFormula, priceDelivery, formulaFromSlabs } from '../src/core/finance/deliveryFormula.js';
import { pickSlab, bandFee } from '../src/core/finance/deliveryEarnings.service.js';
import { coerce } from '../src/core/config/registry.js';

let failed = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${label}\n        ${err.message}`);
  }
};

const simple = normalizeFormula({
  mode: 'simple',
  customer: { base: 25, includedKm: 2, perKm: 8 },
  rider: { base: 20, includedKm: 2, perKm: 6 },
});

console.log('\nThe formula');
check('inside the base distance: base fee and base pay', () => {
  assert.deepEqual(
    [priceDelivery(simple, 1.5).customerFee, priceDelivery(simple, 1.5).riderPay],
    [25, 20],
  );
});
check('past it: per km on the extra distance only', () => {
  const p = priceDelivery(simple, 5);
  assert.equal(p.customerFee, 49); // 25 + 8 x 3
  assert.equal(p.riderPay, 38); // 20 + 6 x 3
  assert.equal(p.platformKeeps, 11);
});
check('minimum and maximum fee clamp the customer side only', () => {
  const f = normalizeFormula({ ...simple, minFee: 30, maxFee: 60 });
  assert.equal(priceDelivery(f, 1).customerFee, 30);
  assert.equal(priceDelivery(f, 20).customerFee, 60);
  assert.equal(priceDelivery(f, 20).riderPay, 20 + 6 * 18);
});
check('bands: each band measured from its own start; the last is open ended', () => {
  const f = normalizeFormula({
    mode: 'bands',
    bands: [
      { fromKm: 0, toKm: 3, customerFee: 20, customerPerKm: 0, riderPay: 15, riderPerKm: 0 },
      { fromKm: 3, toKm: null, customerFee: 30, customerPerKm: 10, riderPay: 25, riderPerKm: 7 },
    ],
  });
  assert.equal(priceDelivery(f, 2).customerFee, 20);
  assert.equal(priceDelivery(f, 5).customerFee, 50);
  assert.equal(priceDelivery(f, 5).riderPay, 39);
});

console.log('\nValidation');
check('negative numbers, gaps and a first band not at 0 are refused', () => {
  assert.throws(() => normalizeFormula({ customer: { base: -1 } }), /0 or more/);
  assert.throws(() => normalizeFormula({ mode: 'bands', bands: [{ fromKm: 1, toKm: 2 }] }), /start at 0/);
  assert.throws(() => normalizeFormula({
    mode: 'bands',
    bands: [{ fromKm: 0, toKm: 2 }, { fromKm: 3, toKm: null }],
  }), /must start where/);
  assert.throws(() => normalizeFormula({ ...simple, minFee: 50, maxFee: 40 }), /maximum/);
});
check('the settings registry validates through the same rules', () => {
  assert.equal(coerce('earnings.formula', simple).customer.perKm, 8);
  assert.equal(coerce('earnings.formula', null), null);
  assert.throws(() => coerce('earnings.formula', { mode: 'bands', bands: [] }));
});

console.log('\nSwitching over changes no price');
// Quick Drop's live global table on 26 Sep 2026: 0-2 km flat 25, 2-15 km 10/km.
const live = [
  { distanceRuleId: 'a', minDistance: 0, maxDistance: 2, userDeliveryFee: 25, commissionPerKm: 0, basePayout: 0, extraPerKm: 0 },
  { distanceRuleId: 'b', minDistance: 2, maxDistance: 15, userDeliveryFee: 0, commissionPerKm: 10, basePayout: 0, extraPerKm: 0 },
];
const distances = [0, 0.5, 1.9, 2, 2.5, 5, 9.99, 14.9, 15, 22];
check('customer fee: identical to the band table at every distance', () => {
  const f = normalizeFormula(formulaFromSlabs(live));
  for (const d of distances) {
    assert.equal(priceDelivery(f, d).customerFee, bandFee(pickSlab(live, d), d).fee, `at ${d} km`);
  }
});
check('food rider pay: base payout + fee less that band\'s commission %', () => {
  const withBase = live.map((b) => ({ ...b, basePayout: 5 }));
  const f = normalizeFormula(formulaFromSlabs(withBase, { commissionPercentByBand: { b: 20 } }));
  for (const d of distances) {
    const band = pickSlab(withBase, d);
    const fee = bandFee(band, d).fee;
    const pct = band.distanceRuleId === 'b' ? 20 : 0;
    const old = Math.round((5 + fee * (1 - pct / 100)) * 100) / 100;
    assert.equal(priceDelivery(f, d).riderPay, old, `at ${d} km`);
  }
});
check('a band with an extra per km translates exactly too', () => {
  const t = [
    { minDistance: 0, maxDistance: 6, userDeliveryFee: 40, commissionPerKm: 0, basePayout: 10, extraPerKm: 5 },
  ];
  const f = normalizeFormula(formulaFromSlabs(t));
  assert.equal(f.mode, 'simple');
  for (const d of [1, 6, 30]) assert.equal(priceDelivery(f, d).customerFee, bandFee(pickSlab(t, d), d).fee);
});

console.log('\nQuick commerce uses it once set');
const qc = await import('../src/modules/quickCommerce/modules/food/orders/services/order-pricing.service.js');
check('fee and rider pay come from the formula', () => {
  const feeSettings = { deliveryFeeRanges: [{ min: 0, max: 100, fee: 999, deliveryBoyBasePay: 999 }], deliveryFormula: { formula: simple } };
  assert.equal(qc.resolveUserDeliveryFee(feeSettings, { distanceKm: 5 }).deliveryFee, 49);
  assert.equal(qc.calculateRiderEarning(feeSettings, 5), 38);
  // Unmeasured trip: the base fee, as before.
  assert.equal(qc.resolveUserDeliveryFee(feeSettings, { distanceKm: null }).deliveryFee, 25);
});
check('without a formula the old band table still applies', () => {
  const feeSettings = { deliveryFeeRanges: [{ min: 0, max: 100, fee: 30, deliveryBoyBasePay: 22 }] };
  assert.equal(qc.resolveUserDeliveryFee(feeSettings, { distanceKm: 5 }).deliveryFee, 30);
  assert.equal(qc.calculateRiderEarning(feeSettings, 5), 22);
});

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll delivery formula checks passed');
process.exit(failed ? 1 : 0);
