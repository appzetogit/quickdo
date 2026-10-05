/**
 * The captured-amount gate, checked on the arithmetic that has to be right.
 *
 * Run: node src/core/payments/__checks__/capturedAmount.check.js
 *
 * Pure maths only -- no database, no provider. This is the rule that decides
 * whether a webhook may mark an order paid, so the cases worth pinning down are
 * the ones that used to let money through: a short capture, a missing amount,
 * and a total whose float representation does not round the way you expect.
 */
import assert from 'node:assert/strict';
import { capturedAmountMatches, toPaise } from '../capturedAmount.js';

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

// --- rupees to paise --------------------------------------------------------
console.log('\nconverting order totals to paise');

check('a whole-rupee total', () => {
    assert.equal(toPaise(900), 90000);
});

check('a fractional total rounds rather than truncating', () => {
    assert.equal(toPaise(899.99), 89999);
    assert.equal(toPaise(10.005), 1001);
});

check('a float that does not represent exactly still lands on the right paise', () => {
    // 0.1 + 0.2 === 0.30000000000000004. Comparing rupees as floats would reject
    // a correct payment on totals like this; comparing rounded paise does not.
    assert.equal(toPaise(0.1 + 0.2), 30);
});

check('a missing or unusable total is zero paise, not NaN', () => {
    assert.equal(toPaise(undefined), 0);
    assert.equal(toPaise(null), 0);
    assert.equal(toPaise('not a number'), 0);
});

// --- the gate itself --------------------------------------------------------
console.log('\ndeciding whether a capture settles an order');

check('an exact capture matches', () => {
    const v = capturedAmountMatches(90000, 900);
    assert.equal(v.matches, true);
    assert.equal(v.reason, null);
});

check('THE BUG: a Rs 1 capture does not settle a Rs 900 order', () => {
    // This is what the food handler accepted before this gate existed: any
    // captured amount marked the order paid, and the restaurant was dispatched
    // an order nobody had paid for.
    const v = capturedAmountMatches(100, 900);
    assert.equal(v.matches, false);
    assert.equal(v.reason, 'underpaid');
    assert.equal(v.expectedPaise, 90000);
});

check('one paise short is still short', () => {
    assert.equal(capturedAmountMatches(89999, 900).matches, false);
});

check('an overpayment is a mismatch too, not a windfall', () => {
    // It means the payment belongs to another order, or the total moved after
    // checkout. Settling it silently hides both.
    const v = capturedAmountMatches(95000, 900);
    assert.equal(v.matches, false);
    assert.equal(v.reason, 'overpaid');
});

check('a fractional total matches its exact capture', () => {
    assert.equal(capturedAmountMatches(89999, 899.99).matches, true);
});

check('a missing captured amount is refused, never treated as zero-and-equal', () => {
    const v = capturedAmountMatches(undefined, 900);
    assert.equal(v.matches, false);
    assert.equal(v.reason, 'captured_amount_missing');
});

check('a non-numeric captured amount is refused', () => {
    assert.equal(capturedAmountMatches('abc', 900).reason, 'captured_amount_missing');
});

check('a zero-total order is not settled by a real payment', () => {
    // A free order should never be reconciled by money arriving against it.
    assert.equal(capturedAmountMatches(100, 0).matches, false);
});

check('the verdict always reports both figures, so a mismatch is diagnosable', () => {
    const v = capturedAmountMatches(100, 900);
    assert.equal(v.capturedPaise, 100);
    assert.equal(v.expectedPaise, 90000);
});

console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
