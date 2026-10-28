/**
 * What GST is charged on when a coupon is involved.
 *
 * Run: node tests/gst-on-funded-discount.smoke.mjs
 *
 * GST is charged on the full food price before any coupon, whoever funded the
 * coupon (business decision, 2026-09-29). The customer still pays the
 * discounted food price; only the tax base is the pre-coupon value.
 */
import assert from 'node:assert/strict';
import { computeBill, billAddsUp } from '../src/modules/food/shared/billing.js';

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  PASS  ${label}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

// Rs 500 of food, a Rs 100 coupon, 5% GST, nothing else on the bill.
const base = {
  itemAmount: 500,
  discount: 100,
  gstRate: 5,
  deliveryFee: 0,
  platformFee: 0,
  platformFeeGstRate: 0,
  packagingFee: 0,
  tip: 0,
};

for (const funded of [false, true]) {
  const who = funded ? 'platform' : 'restaurant';
  check(`a ${who}-funded coupon: GST on the full price, food at the discounted price`, () => {
    const b = computeBill({ ...base, discountFundedByPlatform: funded });
    assert.equal(b.taxableAmount, 500);
    assert.equal(b.gstOnItems, 25);
    assert.equal(b.gstOnPreDiscountValue, true);
    assert.equal(b.netItemAmount, 400);
    assert.equal(b.grandTotal, 425);
    assert.ok(billAddsUp(b));
  });
}

check('the GST does not change when a coupon is applied', () => {
  const without = computeBill({ ...base, discount: 0 });
  const withCoupon = computeBill({ ...base });
  assert.equal(without.gstOnItems, 25);
  assert.equal(withCoupon.gstOnItems, 25);
  assert.equal(without.gstOnPreDiscountValue, false, 'no coupon, nothing pre-discount');
});

check('inclusive menu: nothing added, tax is the part inside the full Rs 500 listed, before the coupon', () => {
  const b = computeBill({ ...base, pricesIncludeGst: true });
  // Client rule 2026-09-29: the coupon comes off last. 500 incl. 5% holds 23.81
  // of GST whatever the coupon; the customer still pays 500 - 100.
  assert.ok(Math.abs(b.gstOnItems - (500 - 500 / 1.05)) < 0.02);
  assert.equal(b.discountOnNet, 100, 'the whole coupon comes off, none of it off the tax');
  assert.equal(b.grandTotal, 400);
  assert.ok(billAddsUp(b));
});

check('Rainbow Restro cart: Rs 600 incl. GST, Rs 100 coupon -> GST 28.57 (not 23.81), pay 639', () => {
  const args = { itemAmount: 600, deliveryFee: 127.30, platformFee: 10, platformFeeGstRate: 18, gstRate: 5, pricesIncludeGst: true };
  const withCoupon = computeBill({ ...args, discount: 100 });
  const without = computeBill(args);
  assert.equal(withCoupon.gstOnItems, 28.57);
  assert.equal(without.gstOnItems, 28.57, 'same GST with or without the coupon');
  assert.equal(withCoupon.grandTotal, 639);
  assert.equal(without.grandTotal, 739);
  assert.ok(billAddsUp(withCoupon));
});

check('delivery, surge and tip are never taxed', () => {
  const b = computeBill({ ...base, deliveryFee: 40, surgeAmount: 15, tip: 30 });
  assert.equal(b.gstOnItems, 25);
  assert.equal(b.grandTotal, 400 + 25 + 40 + 15 + 30);
  // The surge is printed inside the delivery fee, not as its own line.
  assert.equal(b.deliveryFee, 55);
  assert.equal(b.surgeAmount, 0);
  assert.equal(b.surgeIncludedInDeliveryFee, 15);
  assert.ok(billAddsUp(b));
});

check('free delivery keeps the surge on its own line so it is not hidden behind FREE', () => {
  const b = computeBill({ ...base, deliveryFee: 0, surgeAmount: 15 });
  assert.equal(b.deliveryFee, 0);
  assert.equal(b.surgeAmount, 15);
  assert.equal(b.grandTotal, 400 + 25 + 15);
  assert.ok(billAddsUp(b));
});

// The client's worked examples (2026-09-29): food 200, packaging 5, GST 5%,
// platform fee 10 + 18% = 11.80, delivery 25, coupon 50.
const clientCase = {
  itemAmount: 200, packagingFee: 5, gstRate: 5, platformFee: 10, platformFeeGstRate: 18,
  deliveryFee: 25, discount: 50, tip: 0, packagingBelongsToRestaurant: true,
};
check('client example, prices EXCLUDE GST: 252.05 - 50 = 202.05, rounds to 202', () => {
  const b = computeBill({ ...clientCase, pricesIncludeGst: false });
  assert.equal(b.gstOnItems, 10.25);
  assert.equal(b.platformFee + b.platformFeeGst, 11.8);
  assert.equal(b.payableBeforeRounding, 202.05);
  assert.equal(b.grandTotal, 202);
  assert.ok(billAddsUp(b));
});
check('client example, prices INCLUDE GST: no GST added, 241.80 - 50 = 191.80, rounds to 192', () => {
  const b = computeBill({ ...clientCase, pricesIncludeGst: true });
  assert.equal(Math.round((b.netItemAmount + b.netPackagingFee + b.gstOnItems) * 100) / 100, 155, 'food + packaging = listed - coupon');
  assert.equal(b.payableBeforeRounding, 191.8);
  assert.equal(b.grandTotal, 192);
  assert.ok(billAddsUp(b));
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
