/**
 * Self-check for MRP and the discount it implies.
 * Run: node src/modules/food/shared/__checks__/mrpPricing.check.js
 */
import assert from 'node:assert/strict';
import { assertPriceWithinMrp, computeMrpDiscount, normalizeMrpInput, normalizeOtherPriceInput, resolveComparePrice } from '../mrpPricing.js';

const throws = (fn, re) => assert.throws(fn, (e) => e.name === 'ValidationError' && (!re || re.test(e.message)));

// --- normalization --------------------------------------------------------
assert.equal(normalizeMrpInput({}), undefined);                 // untouched on a partial update
assert.deepEqual(normalizeMrpInput({ mrp: null }), { mrp: null });   // explicitly cleared
assert.deepEqual(normalizeMrpInput({ mrp: '' }), { mrp: null });
assert.deepEqual(normalizeMrpInput({ mrp: '  ' }), { mrp: null });
assert.deepEqual(normalizeMrpInput({ mrp: 120 }), { mrp: 120 });
assert.deepEqual(normalizeMrpInput({ mrp: '120' }), { mrp: 120 });
assert.deepEqual(normalizeMrpInput({ mrp: 99.5 }), { mrp: 99.5 });
throws(() => normalizeMrpInput({ mrp: -1 }), /MRP is invalid/);
throws(() => normalizeMrpInput({ mrp: 'abc' }), /MRP is invalid/);

// --- the constraint: never sell above MRP --------------------------------
assertPriceWithinMrp(80, 100);            // under
assertPriceWithinMrp(100, 100);           // exactly at MRP is legal
throws(() => assertPriceWithinMrp(101, 100), /Price cannot be above the MRP of 100/);

// No MRP recorded means nothing to enforce -- most existing rows.
assertPriceWithinMrp(999, null);
assertPriceWithinMrp(999, undefined);
assertPriceWithinMrp(999, 0);
assertPriceWithinMrp(999, '');

// --- variants are checked, not just the base price -----------------------
assertPriceWithinMrp(50, 100, [{ price: 80 }, { price: 100 }]);
throws(
    () => assertPriceWithinMrp(50, 100, [{ price: 80 }, { price: 150 }]),
    /above the MRP of 100/
);
// A cheap base with an expensive large size is the case that would slip through
// if only the base price were validated.
throws(() => assertPriceWithinMrp(10, 100, [{ price: 101 }]), /above the MRP of 100/);
// Junk variant prices are ignored rather than treated as 0 or NaN.
assertPriceWithinMrp(50, 100, [{ price: 'abc' }, {}, null]);

// --- discount for display -------------------------------------------------
{
    const d = computeMrpDiscount(80, 100);
    assert.equal(d.hasDiscount, true);
    assert.equal(d.mrp, 100);
    assert.equal(d.discountPercent, 20);
    assert.equal(d.savings, 20);
}
// Floored, not rounded: 19.6% must not be shown as 20% OFF.
assert.equal(computeMrpDiscount(80.4, 100).discountPercent, 19);
assert.equal(computeMrpDiscount(1, 3).discountPercent, 66);

// Nothing honest to show -> hasDiscount false, and the client renders on that alone.
for (const [price, mrp] of [[100, 100], [120, 100], [80, null], [80, 0], [80, undefined], ['abc', 100]]) {
    const d = computeMrpDiscount(price, mrp);
    assert.equal(d.hasDiscount, false, `expected no discount for price=${price} mrp=${mrp}`);
    assert.equal(d.discountPercent, 0);
    assert.equal(d.savings, 0);
}
// An MRP is still reported when present, so the UI can show it even at 0% off.
assert.equal(computeMrpDiscount(100, 100).mrp, 100);
assert.equal(computeMrpDiscount(80, null).mrp, null);

// Money is not left with floating-point dust.
assert.equal(computeMrpDiscount(33.33, 99.99).savings, 66.66);

// --- other-platform (compare-at) price ------------------------------------
// Deliberately NOT constrained against price: being cheaper than the rival price
// you typed is the normal case and the whole point of showing it.
assert.equal(normalizeOtherPriceInput({}), undefined);
assert.deepEqual(normalizeOtherPriceInput({ otherPrice: null }), { otherPrice: 0 });
assert.deepEqual(normalizeOtherPriceInput({ otherPrice: '' }), { otherPrice: 0 });
assert.deepEqual(normalizeOtherPriceInput({ otherPrice: 150 }), { otherPrice: 150 });
assert.deepEqual(normalizeOtherPriceInput({ otherPrice: '150' }), { otherPrice: 150 });
throws(() => normalizeOtherPriceInput({ otherPrice: -1 }), /Other platform price is invalid/);
throws(() => normalizeOtherPriceInput({ otherPrice: 'abc' }), /Other platform price is invalid/);
// A compare-at BELOW the selling price is accepted and simply not shown.
assert.deepEqual(normalizeOtherPriceInput({ otherPrice: 10 }), { otherPrice: 10 });

// resolveComparePrice: only shown when it is higher
assert.equal(resolveComparePrice(134, 150), 150);   // the screenshot's case
assert.equal(resolveComparePrice(134, 134), 0);     // equal: nothing to strike
assert.equal(resolveComparePrice(134, 100), 0);     // lower: nothing to strike
assert.equal(resolveComparePrice(134, 0), 0);
assert.equal(resolveComparePrice(134, null), 0);
assert.equal(resolveComparePrice(134, undefined), 0);
assert.equal(resolveComparePrice(134, 'abc'), 0);

console.log('All MRP pricing checks passed.');
