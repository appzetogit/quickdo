/**
 * The other-platform comparison price.
 *
 * The property that matters: it is DERIVED from the selling price, so a global
 * price adjustment moves it automatically and it can never fall out of step
 * with the price it sits beside. The checks below pin that, plus the cases
 * where striking a number through would mislead rather than inform.
 *
 * Run: node src/modules/food/shared/__checks__/otherPlatformPricing.check.js
 */
import assert from 'node:assert';
import {
    computeOtherPlatformPrice,
    normalizeOtherPlatformInput,
    normalizeOtherPlatformSettings,
    resolveComparisonPrice,
    MAX_MARKUP_PERCENT,
} from '../otherPlatformPricing.js';

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

const ON = { isEnabled: true, markupPercent: 25 };

// ---- the derived figure ----------------------------------------------------
check('a 25% markup on 40 is 50', () => {
    assert.equal(computeOtherPlatformPrice(40, ON), 50);
});

check('it tracks the price it is derived from', () => {
    // The whole point: raise the menu 10% and this rises with it, with no
    // stored number to go stale.
    const before = computeOtherPlatformPrice(40, ON);
    const after = computeOtherPlatformPrice(44, ON);
    assert.equal(before, 50);
    assert.equal(after, 55);
    // The ratio is preserved exactly, which is what "moves with it" means.
    assert.equal(Math.round((after / 44) * 100), Math.round((before / 40) * 100));
});

check('a cut moves it down too', () => {
    assert.equal(computeOtherPlatformPrice(20, ON), 25);
});

check('disabled yields nothing', () => {
    assert.equal(computeOtherPlatformPrice(40, { isEnabled: false, markupPercent: 25 }), null);
});

check('a zero markup yields nothing', () => {
    // Otherwise it would strike through the same number it sits beside.
    assert.equal(computeOtherPlatformPrice(40, { isEnabled: true, markupPercent: 0 }), null);
});

check('a zero or negative price yields nothing', () => {
    assert.equal(computeOtherPlatformPrice(0, ON), null);
    assert.equal(computeOtherPlatformPrice(-10, ON), null);
    assert.equal(computeOtherPlatformPrice(null, ON), null);
});

check('rounded to paise, not float noise', () => {
    assert.equal(computeOtherPlatformPrice(33.33, { isEnabled: true, markupPercent: 17 }), 39);
});

// ---- settings --------------------------------------------------------------
check('absent settings read as off', () => {
    const s = normalizeOtherPlatformSettings({});
    assert.equal(s.isEnabled, false);
    assert.equal(s.markupPercent, 0);
});

check('enabling without a markup is rejected', () => {
    // Switching it on and seeing nothing change would look broken.
    assert.throws(
        () => normalizeOtherPlatformInput({ otherPlatformPrice: { isEnabled: true, markupPercent: 0 } }),
        /markup above 0/i,
    );
});

check('an absurd markup is rejected', () => {
    assert.throws(
        () => normalizeOtherPlatformInput({ otherPlatformPrice: { isEnabled: true, markupPercent: MAX_MARKUP_PERCENT + 1 } }),
        /between 0 and/,
    );
});

check('a body not mentioning it leaves the setting alone', () => {
    assert.equal(normalizeOtherPlatformInput({ platformFee: 5 }), undefined);
});

check('the label round-trips and falls back', () => {
    const a = normalizeOtherPlatformInput({ otherPlatformPrice: { isEnabled: true, markupPercent: 20, label: 'Elsewhere' } });
    assert.equal(a.otherPlatformPrice.label, 'Elsewhere');
    const b = normalizeOtherPlatformInput({ otherPlatformPrice: { isEnabled: true, markupPercent: 20, label: '  ' } });
    assert.equal(b.otherPlatformPrice.label, 'Other platforms');
});

// ---- which number gets struck through --------------------------------------
check('with only a discount, our own base price is struck', () => {
    const r = resolveComparisonPrice({ price: 40, basePrice: 50 });
    assert.equal(r.strikePrice, 50);
    assert.equal(r.strikeSource, 'basePrice');
});

check('with only a comparison price, that is struck and labelled', () => {
    const r = resolveComparisonPrice({ price: 40, otherPlatformPrice: 50, label: 'Other platforms' });
    assert.equal(r.strikePrice, 50);
    assert.equal(r.strikeSource, 'otherPlatform');
    assert.equal(r.strikeLabel, 'Other platforms');
});

check('with both, the higher one wins', () => {
    // Two struck-through numbers is noise; the lower one understates the saving.
    const r = resolveComparisonPrice({ price: 40, basePrice: 50, otherPlatformPrice: 60, label: 'Other platforms' });
    assert.equal(r.strikePrice, 60);
    assert.equal(r.strikeSource, 'otherPlatform');
});

check('with both, our base price wins when it is higher', () => {
    const r = resolveComparisonPrice({ price: 40, basePrice: 70, otherPlatformPrice: 60 });
    assert.equal(r.strikePrice, 70);
    assert.equal(r.strikeSource, 'basePrice');
});

check('nothing above the selling price means nothing is struck', () => {
    const r = resolveComparisonPrice({ price: 40, basePrice: 40, otherPlatformPrice: 35 });
    assert.equal(r.strikePrice, null);
    assert.equal(r.savings, 0);
});

check('savings and percent are reported off the struck figure', () => {
    const r = resolveComparisonPrice({ price: 40, otherPlatformPrice: 50 });
    assert.equal(r.savings, 10);
    assert.equal(r.savingsPercent, 20);
});

check('no comparison at all is safe to render', () => {
    const r = resolveComparisonPrice({ price: 40 });
    assert.equal(r.strikePrice, null);
    assert.equal(r.strikeLabel, '');
});

console.log(failures ? `\n${failures} FAILED` : '\nall other-platform pricing checks passed');
process.exit(failures ? 1 : 0);
