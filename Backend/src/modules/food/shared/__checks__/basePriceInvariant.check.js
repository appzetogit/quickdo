/**
 * The base price must not walk downwards.
 *
 * Run: node src/modules/food/shared/__checks__/basePriceInvariant.check.js
 *
 * The base is the restaurant's number. Global adjustments move percentages, and a
 * save that carries only a selling price must not be allowed to redefine it --
 * that is how Gajrela on production went from base 100 to base 90 while its
 * siblings from the same run stayed at 100.
 */
import assert from 'node:assert/strict';
import { normalizeDiscountPricingInput } from '../itemDiscountPricing.js';

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

// The shape Gajrela's healthy siblings have on production.
const discounted = { basePrice: 100, discountPercent: 10, price: 90 };

console.log('\na save that carries only the selling price');

check('the base survives, and the discount with it', () => {
    const out = normalizeDiscountPricingInput({ price: 90 }, discounted);
    assert.equal(out.basePrice, 100, 'base must not become the selling price');
    assert.equal(out.discountPercent, 10, 'the discount must not be cleared');
    assert.equal(out.price, 90);
});

check('saving repeatedly never moves the base', () => {
    // The actual reported symptom: base decreasing on every save.
    let state = { ...discounted };
    for (let i = 0; i < 5; i += 1) {
        const out = normalizeDiscountPricingInput({ price: state.price }, state);
        state = out;
    }
    assert.equal(state.basePrice, 100, `after 5 saves the base is ${state.basePrice}`);
    assert.equal(state.price, 90);
});

check('a genuinely higher selling price raises the base it implies', () => {
    // Selling at 99 on a 10% discount means a base of 110.
    const out = normalizeDiscountPricingInput({ price: 99 }, discounted);
    assert.equal(out.basePrice, 110);
    assert.equal(out.discountPercent, 10);
    assert.equal(out.price, 99);
});

check('an undiscounted dish is unaffected', () => {
    const out = normalizeDiscountPricingInput({ price: 250 }, { basePrice: 200, discountPercent: 0, price: 200 });
    assert.equal(out.basePrice, 250);
    assert.equal(out.discountPercent, 0);
    assert.equal(out.price, 250);
});

check('a brand new dish still prices off what was typed', () => {
    const out = normalizeDiscountPricingInput({ price: 150 }, {});
    assert.equal(out.basePrice, 150);
    assert.equal(out.discountPercent, 0);
});

console.log('\nan explicit base edit is still the admin\'s to make');

check('sending basePrice sets the base, including downwards', () => {
    // Deliberate repricing must still work -- the invariant is about saves that
    // never mentioned the base, not about forbidding edits.
    const out = normalizeDiscountPricingInput({ basePrice: 80 }, discounted);
    assert.equal(out.basePrice, 80);
    assert.equal(out.discountPercent, 10);
    assert.equal(out.price, 72);
});

check('base and discount together are both honoured', () => {
    const out = normalizeDiscountPricingInput({ basePrice: 200, discountPercent: 25 }, discounted);
    assert.equal(out.basePrice, 200);
    assert.equal(out.discountPercent, 25);
    assert.equal(out.price, 150);
});

console.log('\nedges');

check('a 100 percent discount does not divide by zero', () => {
    const out = normalizeDiscountPricingInput({ price: 0 }, { basePrice: 100, discountPercent: 100, price: 0 });
    assert.ok(Number.isFinite(out.basePrice), `basePrice was ${out.basePrice}`);
});

check('a save touching nothing priceable is a no-op', () => {
    assert.equal(normalizeDiscountPricingInput({ name: 'x' }, discounted), null);
});

check('a negative selling price is refused', () => {
    assert.throws(() => normalizeDiscountPricingInput({ price: -5 }, discounted));
});

console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
