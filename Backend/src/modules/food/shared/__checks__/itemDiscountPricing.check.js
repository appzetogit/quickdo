/**
 * Base price + discount pricing.
 *
 * The cases that matter are the ones where a wrong answer is money: the
 * client's own worked example (50 at 20% is 40), rows written before the
 * feature existed, and partial edits from the two item forms, which PATCH one
 * field at a time and must not recompute the other into something the
 * restaurant never typed.
 *
 * Run: node src/modules/food/shared/__checks__/itemDiscountPricing.check.js
 */
import assert from 'node:assert';
import {
    computeSellingPrice,
    computeDiscountPercent,
    normalizeDiscountPricingInput,
    resolveItemDisplayPricing,
    computeRestaurantTakeHome,
} from '../itemDiscountPricing.js';

let failures = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    } catch (error) {
        failures += 1;
        console.log(`  FAIL  ${label} -- ${error.message}`);
    }
};

// ---- the client's worked example -------------------------------------------
check("50 at 20% off is 40", () => {
    assert.equal(computeSellingPrice(50, 20), 40);
});

check("that item's take-home at 20% commission is 32", () => {
    const r = computeRestaurantTakeHome(40, 20);
    assert.equal(r.commissionAmount, 8);
    assert.equal(r.takeHome, 32);
});

// ---- selling price ---------------------------------------------------------
check('no discount leaves the price alone', () => {
    assert.equal(computeSellingPrice(50, 0), 50);
    assert.equal(computeSellingPrice(50, null), 50);
    assert.equal(computeSellingPrice(50, undefined), 50);
});

check('100% off is free, not negative', () => {
    assert.equal(computeSellingPrice(50, 100), 0);
});

check('a discount beyond 100 still cannot go below zero', () => {
    assert.equal(computeSellingPrice(50, 150), 0);
});

check('a negative discount does not raise the price', () => {
    assert.equal(computeSellingPrice(50, -20), 50);
});

check('prices are rounded to paise, not left as float noise', () => {
    // 99.99 * 0.67 is 66.9933 in binary floating point.
    assert.equal(computeSellingPrice(99.99, 33), 66.99);
});

check('a non-numeric base price yields null rather than NaN', () => {
    assert.equal(computeSellingPrice('abc', 20), null);
    assert.equal(computeSellingPrice(null, 20), null);
});

// ---- implied discount ------------------------------------------------------
check('the implied discount inverts the calculation', () => {
    assert.equal(computeDiscountPercent(50, 40), 20);
});

check('a selling price at or above base implies no discount', () => {
    assert.equal(computeDiscountPercent(50, 50), 0);
    assert.equal(computeDiscountPercent(50, 60), 0);
});

check('a zero base price cannot divide by zero', () => {
    assert.equal(computeDiscountPercent(0, 0), 0);
});

// ---- normalising form input ------------------------------------------------
check('base and discount together produce the selling price', () => {
    assert.deepEqual(normalizeDiscountPricingInput({ basePrice: 50, discountPercent: 20 }), {
        basePrice: 50,
        discountPercent: 20,
        price: 40,
    });
});

check('editing only the discount keeps the stored base price', () => {
    const r = normalizeDiscountPricingInput({ discountPercent: 50 }, { basePrice: 50, discountPercent: 20 });
    assert.equal(r.basePrice, 50);
    assert.equal(r.price, 25);
});

check('editing only the base price keeps the stored discount', () => {
    const r = normalizeDiscountPricingInput({ basePrice: 80 }, { basePrice: 50, discountPercent: 20 });
    assert.equal(r.discountPercent, 20);
    assert.equal(r.price, 64);
});

check('a row with no basePrice adopts its price as the base', () => {
    // The pre-feature shape. Adopting price (not 0) is what stops an untouched
    // legacy item from being discounted down to free on its next edit.
    const r = normalizeDiscountPricingInput({ discountPercent: 20 }, { price: 50 });
    assert.equal(r.basePrice, 50);
    assert.equal(r.price, 40);
});

check('a bare price still works, and means no discount', () => {
    // Bulk upload and older clients send only price.
    assert.deepEqual(normalizeDiscountPricingInput({ price: 250 }), {
        basePrice: 250,
        discountPercent: 0,
        price: 250,
    });
});

check('a body mentioning none of the three returns null', () => {
    // So a PATCH of just the name does not rewrite pricing.
    assert.equal(normalizeDiscountPricingInput({ name: 'Missi Roti' }, { price: 50 }), null);
});

check('an out-of-range discount is rejected, not clamped', () => {
    // Clamping would silently save something other than what was typed.
    assert.throws(() => normalizeDiscountPricingInput({ basePrice: 50, discountPercent: 120 }), /between 0 and 100/);
    assert.throws(() => normalizeDiscountPricingInput({ basePrice: 50, discountPercent: -5 }), /between 0 and 100/);
});

check('a negative base price is rejected', () => {
    assert.throws(() => normalizeDiscountPricingInput({ basePrice: -1 }), /0 or more/);
});

// ---- display ---------------------------------------------------------------
check('a discounted item exposes a strike price', () => {
    const d = resolveItemDisplayPricing({ price: 40, basePrice: 50, discountPercent: 20 });
    assert.equal(d.strikePrice, 50);
    assert.equal(d.discountPercent, 20);
    assert.equal(d.savings, 10);
});

check('an undiscounted item exposes no strike price', () => {
    // Otherwise the client renders "Rs.40  Rs.40".
    const d = resolveItemDisplayPricing({ price: 40, basePrice: 40, discountPercent: 0 });
    assert.equal(d.strikePrice, null);
    assert.equal(d.savings, 0);
});

check('a pre-feature row renders as undiscounted rather than free', () => {
    const d = resolveItemDisplayPricing({ price: 50 });
    assert.equal(d.price, 50);
    assert.equal(d.basePrice, 50);
    assert.equal(d.strikePrice, null);
});

check('a base price below the selling price is not shown as a discount', () => {
    // Bad data should not render as "was 30, now 50".
    const d = resolveItemDisplayPricing({ price: 50, basePrice: 30 });
    assert.equal(d.strikePrice, null);
});

// ---- take-home -------------------------------------------------------------
check('zero commission returns the whole price', () => {
    assert.equal(computeRestaurantTakeHome(40, 0).takeHome, 40);
});

check('commission is charged on the discounted price, not the base', () => {
    // The load-bearing claim of the whole design.
    const onDiscounted = computeRestaurantTakeHome(computeSellingPrice(50, 20), 20);
    assert.equal(onDiscounted.commissionAmount, 8);
    assert.notEqual(onDiscounted.commissionAmount, 10);
});

console.log(failures ? `\n${failures} FAILED` : '\nall item discount pricing checks passed');
process.exit(failures ? 1 : 0);
