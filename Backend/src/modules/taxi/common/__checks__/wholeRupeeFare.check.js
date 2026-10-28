/**
 * Self-check: a ride's fare is always whole rupees -- the priced fare, a surge,
 * and a percentage promo -- so a rider never sees a fare like Rs 30.30.
 * Run: node src/modules/taxi/common/__checks__/wholeRupeeFare.check.js
 */
import assert from 'node:assert/strict';
import { computeRideFare } from '../rideFare.js';
import { computePromoDiscount } from '../../services/promoService.js';

// Palampur Bike / Scooty / EV Scooty as priced on 2026-10-26.
const palampur = { base_price: 40, base_distance: 2, price_per_distance: 10, time_price: 0, service_tax: 5, admin_commision: 10, admin_commision_type: 1 };

// The fares the call's examples were checked against.
for (const [km, expected] of [[1, 46], [2, 46], [2.44, 51], [3, 58], [5, 81], [8.75, 124], [10, 138]]) {
  assert.equal(computeRideFare({ pricingRule: palampur, distanceMeters: km * 1000 }).total, expected, `${km} km`);
}

// Every distance from 0 to 30 km in 10 m steps, with a surge typed with paise.
for (let m = 0; m <= 30000; m += 10) {
  const f = computeRideFare({ pricingRule: palampur, distanceMeters: m, durationMinutes: m / 400, surgeAmount: 7.35 });
  assert.ok(Number.isInteger(f.total), `${m} m gave ${f.total}`);
  assert.equal(f.surge, 7);
}

// A percentage promo comes off in whole rupees, nearest rupee, never past a cap.
const promo = (fare, p, userCounter) => computePromoDiscount({ fare, promo: p, userCounter });
assert.equal(promo(51, { discount_percentage: 10 }).discount_amount, 5);
assert.equal(promo(51, { discount_percentage: 10 }).fare_after_discount, 46);
assert.equal(promo(58, { discount_percentage: 10 }).discount_amount, 6);
assert.equal(promo(124, { discount_percentage: 50, maximum_discount_amount: 40.5 }).discount_amount, 40);
assert.equal(promo(124, { discount_percentage: 50, cumulative_max_discount_amount: 100 }, { cumulative_discount_amount: 75.5 }).discount_amount, 24);
assert.equal(promo(3, { discount_percentage: 100 }).fare_after_discount, 0);
for (let fare = 0; fare <= 500; fare += 1) {
  for (const pct of [5, 10, 12.5, 15, 33]) {
    const r = promo(fare, { discount_percentage: pct, maximum_discount_amount: 60 });
    assert.ok(Number.isInteger(r.fare_after_discount) && r.discount_amount <= 60 && r.fare_after_discount >= 0, `${pct}% of ${fare}`);
  }
}

console.log('wholeRupeeFare: all checks passed');
process.exit(0);
