/**
 * Quick commerce: what GST is charged on when a coupon is involved.
 *
 * Run: node tests/qc-gst-on-funded-discount.smoke.mjs
 *
 * The same rule as food (tests/gst-on-funded-discount.smoke.mjs), but the maths
 * here is per line rather than per bill: groceries sit in different slabs, so a
 * basket-level coupon is spread across lines in proportion to their share.
 *
 *   SELLER-funded  -- a supplier discount at the time of supply. It comes out of
 *   the taxable value, so each line is taxed on its share after the coupon.
 *
 *   PLATFORM-funded -- the seller is paid in full, part by the customer and part
 *   by the platform, so the basket is still worth its full value and the tax is
 *   due on that. Spreading the coupon across the lines here under-collects GST.
 *
 * The last check is the one that matters most: a return must refund the tax that
 * was actually charged. If the order taxed the full value and the refund taxes
 * the discounted value, the order never reconciles.
 */
import assert from 'node:assert/strict';

const { computeItemsTax } = await import(
  '../src/modules/quickCommerce/modules/food/orders/services/order-pricing.service.js'
);

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  PASS  ${label}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

// A basket spanning two slabs: flour at 0%, biscuits at 18%.
const items = [
  { price: 100, quantity: 2, gstRate: 0 },   // 200 of flour, untaxed
  { price: 150, quantity: 2, gstRate: 18 },  // 300 of biscuits at 18%
];
const subtotal = 500;

check('no coupon: the funder makes no difference', () => {
  const a = computeItemsTax(items, { subtotal, discount: 0, discountFundedByPlatform: true });
  const b = computeItemsTax(items, { subtotal, discount: 0, discountFundedByPlatform: false });
  assert.equal(a, 54, '18% of the 300 of biscuits');
  assert.equal(a, b);
});

check('a seller-funded coupon reduces the taxable value', () => {
  // 100 off a 500 basket leaves 80% of every line taxable.
  const tax = computeItemsTax(items, { subtotal, discount: 100, discountFundedByPlatform: false });
  assert.equal(tax, 43.2, '18% of 300 x 0.8');
});

check('a platform-funded coupon does not', () => {
  const tax = computeItemsTax(items, { subtotal, discount: 100, discountFundedByPlatform: true });
  assert.equal(tax, 54, 'the seller was paid in full, so the full value is taxed');
});

check('the untaxed line stays untaxed either way', () => {
  const onlyFlour = [{ price: 100, quantity: 2, gstRate: 0 }];
  assert.equal(computeItemsTax(onlyFlour, { subtotal: 200, discount: 50, discountFundedByPlatform: true }), 0);
});

check('a line with no slab of its own still falls back', () => {
  const untagged = [{ price: 100, quantity: 1, gstRate: null }];
  const seller = computeItemsTax(untagged, { subtotal: 100, discount: 50, fallbackRate: 5, discountFundedByPlatform: false });
  const platform = computeItemsTax(untagged, { subtotal: 100, discount: 50, fallbackRate: 5, discountFundedByPlatform: true });
  assert.equal(seller, 2.5, '5% of the 50 left after the coupon');
  assert.equal(platform, 5, '5% of the full 100');
});

check('a caller that says nothing gets the old behaviour', () => {
  const before = computeItemsTax(items, { subtotal, discount: 100 });
  const explicit = computeItemsTax(items, { subtotal, discount: 100, discountFundedByPlatform: false });
  assert.equal(before, explicit);
  assert.equal(before, 43.2);
  // Anything other than a literal true is "not platform funded".
  for (const v of [undefined, null, 0, '', 'true', 1]) {
    assert.equal(computeItemsTax(items, { subtotal, discount: 100, discountFundedByPlatform: v }), 43.2, String(v));
  }
});

check('an empty basket is not a division by zero', () => {
  assert.equal(computeItemsTax([], { subtotal: 0, discount: 0, discountFundedByPlatform: true }), 0);
  assert.equal(computeItemsTax(items, { subtotal: 0, discount: 100, discountFundedByPlatform: true }), 0);
});

check('a return refunds the tax the order charged', () => {
  // What returnRefund.service.js does per line, in the two cases. A full return
  // of the biscuits must give back exactly the biscuit tax that was collected.
  const biscuitsGrossPaise = 30000;           // Rs 300
  const discountSharePaise = 6000;            // its share of a Rs 100 basket coupon
  const rate = 18;

  const refundWhenSellerFunded = Math.round(((biscuitsGrossPaise - discountSharePaise) * rate) / 100);
  const refundWhenPlatformFunded = Math.round((biscuitsGrossPaise * rate) / 100);

  const chargedSeller = computeItemsTax(items, { subtotal, discount: 100, discountFundedByPlatform: false });
  const chargedPlatform = computeItemsTax(items, { subtotal, discount: 100, discountFundedByPlatform: true });

  assert.equal(refundWhenSellerFunded / 100, chargedSeller, 'seller-funded: refund matches the charge');
  assert.equal(refundWhenPlatformFunded / 100, chargedPlatform, 'platform-funded: refund matches the charge');
  // And the two are genuinely different, so the flag has to be read.
  assert.notEqual(refundWhenSellerFunded, refundWhenPlatformFunded);
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
