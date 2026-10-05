/**
 * The formulation price, checked against the table the behaviour was agreed on.
 *
 * Run: node src/modules/food/shared/__checks__/formulationPricing.check.js
 */
import assert from 'node:assert/strict';
import {
    computeFormulationPrice,
    resolveFormulationPricing,
    formulationFieldsFor,
    formulationFieldsForVariant,
    inferFormulationPercent,
    normalizeFormulationPercent,
} from '../formulationPricing.js';

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

const shown = (base, percent) => resolveFormulationPricing({ basePrice: base, formulationPercent: percent });

// --- the agreed table -------------------------------------------------------
console.log('\nthe agreed table, a Rs 200 dish');
check('no adjustment: pays 200, nothing struck', () => {
    const r = shown(200, 0);
    assert.equal(r.price, 200);
    assert.equal(r.strikePrice, null);
    assert.equal(r.formulationPrice, 200);
});
check('+20%: pays 200, struck 240', () => {
    const r = shown(200, 20);
    assert.equal(r.price, 200);
    assert.equal(r.strikePrice, 240);
    assert.equal(r.discountPercent, 16.67);
});
check('an increase never moves the formulation price', () => {
    // The formulation price is what the customer pays. An increase changes the
    // struck-through comparison and nothing else, so a +20% run on a Rs 200
    // dish must still report a formulation price of 200, not 240.
    assert.equal(shown(200, 20).formulationPrice, 200);
    assert.equal(shown(200, 300).formulationPrice, 200);
});
check('a decrease does move it, and it equals what is charged', () => {
    assert.equal(shown(200, -20).formulationPrice, 160);
    assert.equal(shown(200, -20).price, 160);
});
check('-20%: pays 160, struck 200', () => {
    const r = shown(200, -20);
    assert.equal(r.price, 160);
    assert.equal(r.strikePrice, 200);
    assert.equal(r.discountPercent, 20);
});
check('-10%: pays 180, struck 200', () => {
    const r = shown(200, -10);
    assert.equal(r.price, 180);
    assert.equal(r.strikePrice, 200);
});
check('back to 0%: pays 200, nothing struck', () => {
    const r = shown(200, 0);
    assert.equal(r.price, 200);
    assert.equal(r.strikePrice, null);
});

// --- the property the whole design exists for -------------------------------
console.log('\nno run can inherit another');
check('+20% applied five times still charges 200', () => {
    // Applying a percent means STORING it, not multiplying. Five identical runs
    // store the same number, so there is nothing to compound.
    let fields = formulationFieldsFor(200, 20);
    for (let i = 0; i < 4; i += 1) fields = formulationFieldsFor(fields.basePrice, 20);
    assert.equal(fields.price, 200);
    assert.equal(fields.formulationPrice, 200, 'an increase never moves it');
    assert.equal(resolveFormulationPricing({ basePrice: 200, formulationPercent: 20 }).strikePrice, 240);
});
check('+20% then -10% measures from 200, not from 240', () => {
    const up = formulationFieldsFor(200, 20);
    const down = formulationFieldsFor(up.basePrice, -10);
    assert.equal(down.formulationPrice, 180);
    assert.equal(up.formulationPrice, 200, 'the increase left it alone');
    assert.equal(down.price, 180);
    assert.equal(down.basePrice, 200, 'the origin never moves');
});
check('the base price is never written by a percent change', () => {
    const a = formulationFieldsFor(153, -10);
    const b = formulationFieldsFor(a.basePrice, -50);
    const c = formulationFieldsFor(b.basePrice, 0);
    assert.equal(c.basePrice, 153);
    assert.equal(c.price, 153, 'zero percent returns the dish to its own price');
});

// --- legacy rows ------------------------------------------------------------
console.log('\nrows that predate the fields');
check('no basePrice falls back to the selling price', () => {
    const r = resolveFormulationPricing({ price: 250 });
    assert.equal(r.basePrice, 250);
    assert.equal(r.price, 250);
    assert.equal(r.strikePrice, null);
});
check('no formulationPercent reads as no adjustment', () => {
    const r = resolveFormulationPricing({ price: 100, basePrice: 100 });
    assert.equal(r.formulationPercent, 0);
    assert.equal(r.formulationPrice, 100);
});
check('an un-migrated row charges exactly what it charges today', () => {
    // The hazard this guards: these rows carry their adjustment in the gap
    // between basePrice and price. Deriving from the base alone would raise
    // every one of them the moment the change shipped.
    const r = resolveFormulationPricing({ price: 137.7, basePrice: 153 });
    assert.equal(r.price, 137.7, 'not raised to 153');
    assert.equal(r.strikePrice, 153);
    assert.equal(r.formulationPercent, -10);
});
check('bad data is not read as an increase', () => {
    // "was Rs 30, now Rs 50" is a broken row, not a +67% adjustment. Reading it
    // as one would charge Rs 30 for a Rs 50 dish.
    const r = resolveFormulationPricing({ price: 50, basePrice: 30 });
    assert.equal(r.price, 50);
    assert.equal(r.strikePrice, null);
});
check('an explicit zero percent beats inference', () => {
    // A migrated dish deliberately set back to 0 must return to its base price,
    // not silently re-infer the markdown it used to carry.
    const r = resolveFormulationPricing({ price: 137.7, basePrice: 153, formulationPercent: 0 });
    assert.equal(r.price, 153);
    assert.equal(r.strikePrice, null);
});
check('an unpriced dish yields no formulation price', () => {
    assert.equal(computeFormulationPrice(0, 20), null);
    assert.equal(computeFormulationPrice(null, 20), null);
    assert.equal(formulationFieldsFor(0, 20), null);
});

// --- bounds -----------------------------------------------------------------
console.log('\nbounds');
check('a percent beyond the bounds is clamped, not accepted', () => {
    assert.equal(normalizeFormulationPercent(5000), 300);
    assert.equal(normalizeFormulationPercent(-99), -90);
    assert.equal(normalizeFormulationPercent('abc'), 0);
    assert.equal(normalizeFormulationPercent(undefined), 0);
});
check('a 90% cut still leaves a chargeable price', () => {
    const r = shown(200, -90);
    assert.equal(r.price, 20);
    assert.equal(r.strikePrice, 200);
});

// --- rounding ---------------------------------------------------------------
console.log('\nrounding');
check('money is rounded to paise and the percent matches it', () => {
    const r = shown(153, -10);
    assert.equal(r.price, 137.7);
    assert.equal(r.strikePrice, 153);
    assert.equal(r.discountPercent, 10);
});
check('an awkward base still produces coherent figures', () => {
    const r = shown(88.2, -13);
    assert.equal(r.formulationPrice, 76.73);
    assert.equal(r.price, 76.73);
    assert.equal(r.strikePrice, 88.2);
    // The percentage shown is derived from the two figures actually stored, so
    // it describes them rather than the percent that was typed -- 13.00 here,
    // because 76.734 was rounded down to 76.73 before the saving was measured.
    assert.equal(r.discountPercent, 13);
});

// --- variants ---------------------------------------------------------------
console.log('\nvariants share the dish percent');
check('a variant is cut like the dish', () => {
    const v = formulationFieldsForVariant({ price: 120, basePrice: 120 }, -25);
    assert.equal(v.basePrice, 120);
    assert.equal(v.price, 90);
});
check('an increase leaves a variant price alone', () => {
    const v = formulationFieldsForVariant({ price: 120, basePrice: 120 }, 20);
    assert.equal(v.price, 120, 'an increase never raises what is charged');
    assert.equal(v.basePrice, 120);
});
check('a variant with no base adopts its own price', () => {
    const v = formulationFieldsForVariant({ price: 80 }, -10);
    assert.equal(v.basePrice, 80);
    assert.equal(v.price, 72);
});
check('repeat runs do not ratchet a variant down', () => {
    const once = formulationFieldsForVariant({ price: 120, basePrice: 120 }, -25);
    const twice = formulationFieldsForVariant(once, -25);
    assert.equal(twice.price, 90, 'still 25% off the same base');
    assert.equal(twice.basePrice, 120);
});

// --- migration helper -------------------------------------------------------
console.log('\nthe migration helper');
check('infers the percent a dish is already being sold at', () => {
    assert.equal(inferFormulationPercent(200, 160), -20);
    assert.equal(inferFormulationPercent(170, 137.7), -19);
    assert.equal(inferFormulationPercent(200, 200), 0);
});
check('inferring then applying reproduces the same price', () => {
    const percent = inferFormulationPercent(180, 144);
    assert.equal(formulationFieldsFor(180, percent).price, 144);
});

console.log(failed ? `\n${failed} FAILED\n` : '\nall formulation pricing checks passed\n');
process.exit(failed ? 1 : 0);
