/**
 * Checks for seeding a new dish's other-platform comparison figure.
 *
 * Run: node Backend/src/modules/food/shared/__checks__/otherPlatformSeed.check.js
 */
import assert from 'node:assert/strict';
import {
    resolveSeedOtherPrice,
    collectOtherPriceRatios,
} from '../otherPlatformPricing.js';

// --- collectOtherPriceRatios ------------------------------------------------
assert.deepEqual(
    collectOtherPriceRatios([{ price: 100, otherPrice: 130 }, { price: 200, otherPrice: 260 }]),
    [1.3, 1.3],
);
// Pairs that say nothing are dropped rather than counted as 1.
assert.deepEqual(collectOtherPriceRatios([{ price: 100, otherPrice: 0 }]), [], 'no stored figure');
assert.deepEqual(collectOtherPriceRatios([{ price: 100, otherPrice: 90 }]), [], 'below the price strikes nothing');
assert.deepEqual(collectOtherPriceRatios([{ price: 100, otherPrice: 100 }]), [], 'equal strikes nothing');
assert.deepEqual(collectOtherPriceRatios([{ price: 0, otherPrice: 130 }]), [], 'unpriced dish');
assert.deepEqual(collectOtherPriceRatios(null), [], 'a non-array is not a crash');

// --- resolveSeedOtherPrice --------------------------------------------------
// The Rainbow Restro case: every dish at the same ratio, so a new one matches.
assert.equal(resolveSeedOtherPrice({ price: 200, siblingRatios: [1.3068, 1.3068, 1.3068] }), 261.36);

// The median, not the mean: one outlier must not drag every future dish up.
// Mean here is 1.69; median is 1.725 vs a mean pulled by the 2.11.
assert.equal(
    resolveSeedOtherPrice({ price: 100, siblingRatios: [1.725, 1.725, 1.725, 2.108] }),
    172.5,
    'the odd high sibling does not move the median',
);
// An even count averages the middle pair.
assert.equal(resolveSeedOtherPrice({ price: 100, siblingRatios: [1.2, 1.4] }), 130);

// Nothing to go on: fall back to the blanket markup by seeding nothing.
assert.equal(resolveSeedOtherPrice({ price: 200, siblingRatios: [] }), 0, 'a fresh restaurant seeds nothing');
assert.equal(resolveSeedOtherPrice({ price: 200 }), 0);
assert.equal(resolveSeedOtherPrice({ price: 0, siblingRatios: [1.3] }), 0, 'an unpriced dish seeds nothing');
assert.equal(resolveSeedOtherPrice({ price: -5, siblingRatios: [1.3] }), 0);
assert.equal(resolveSeedOtherPrice({}), 0);

// Ratios at or below 1 are ignored, so they cannot produce a figure that
// strikes nothing through.
assert.equal(resolveSeedOtherPrice({ price: 100, siblingRatios: [0.9, 1] }), 0, 'nothing usable');
assert.equal(
    resolveSeedOtherPrice({ price: 100, siblingRatios: [0.9, 1.5] }),
    150,
    'the unusable one is dropped, not averaged in',
);

// Rounded to paise, like every other money figure here.
assert.equal(resolveSeedOtherPrice({ price: 98, siblingRatios: [1.5971] }), 156.52);

console.log('All other-platform seed checks passed.');
