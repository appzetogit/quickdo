/**
 * The variants on/off toggle, at the pure seams.
 *
 * The rule everywhere: the toggle beats the array. Variants switched off stay
 * stored -- so switching back on costs nothing -- but must not drive pricing.
 * Absent flag = legacy row = sell by variants if any exist, which is what
 * every row written before the flag always did.
 *
 * Run: node src/modules/food/shared/__checks__/variantsToggle.check.js
 */
import assert from 'node:assert';
import {
    getFoodDisplayPrice,
    sellsByVariants,
} from '../../admin/services/foodVariant.service.js';

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

const VARIANTS = [
    { _id: 'a'.repeat(24), name: 'Small', price: 60 },
    { _id: 'b'.repeat(24), name: 'Large', price: 90 },
];

check('toggle on: display price is the cheapest variant', () => {
    assert.equal(getFoodDisplayPrice({ variantsEnabled: true, variants: VARIANTS, price: 50 }), 60);
});

check('toggle off: display price is the base, variants ignored', () => {
    // The whole point: variants stay stored but the base price is what shows
    // and what is charged.
    assert.equal(getFoodDisplayPrice({ variantsEnabled: false, variants: VARIANTS, price: 50 }), 50);
});

check('legacy row (no flag) with variants keeps pricing from them', () => {
    assert.equal(getFoodDisplayPrice({ variants: VARIANTS, price: 50 }), 60);
});

check('toggle off with a broken own price still does not invent one', () => {
    // price 0 on a toggled-off doc: fall through to the variants rather than
    // return 0 -- a dish must never display as free because of a bad field.
    assert.equal(getFoodDisplayPrice({ variantsEnabled: false, variants: VARIANTS, price: 0 }), 60);
});

check('bare {variants} shapes (write-path "from" computation) are unaffected', () => {
    assert.equal(getFoodDisplayPrice({ variants: VARIANTS }), 60);
});

check('sellsByVariants: toggle beats the array', () => {
    assert.equal(sellsByVariants({ variantsEnabled: false, variants: VARIANTS }), false);
    assert.equal(sellsByVariants({ variantsEnabled: true, variants: VARIANTS }), true);
    assert.equal(sellsByVariants({ variants: VARIANTS }), true);
    assert.equal(sellsByVariants({ variantsEnabled: true, variants: [] }), false);
    assert.equal(sellsByVariants({}), false);
});

console.log(failures ? `\n${failures} FAILED` : '\nall variants-toggle checks passed');
process.exit(failures ? 1 : 0);
