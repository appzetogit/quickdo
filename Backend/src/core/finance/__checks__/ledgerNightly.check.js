/**
 * The nightly ledger run's clock and its streak, without a database.
 *
 * Run: node src/core/finance/__checks__/ledgerNightly.check.js
 *
 * The streak is the number the plan waits fourteen nights on, so the rules that
 * could inflate it are pinned here: a dirty night resets it, a skipped night resets
 * it, and a night on which nothing was actually checked is not clean.
 */
import assert from 'node:assert/strict';
import { nightKey, isDue, nextStreak, verdict } from '../ledgerNightly.js';

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

check('the night is the IST date, not the UTC one', () => {
    // 20:00 UTC on the 16th is 01:30 IST on the 17th.
    assert.equal(nightKey(new Date('2026-09-16T20:00:00Z')), '2026-09-17');
    assert.equal(nightKey(new Date('2026-09-16T18:29:00Z')), '2026-09-16');
});

check('due from 03:00 IST, not before', () => {
    assert.equal(isDue(new Date('2026-09-16T21:29:00Z')), false, '02:59 IST');
    assert.equal(isDue(new Date('2026-09-16T21:30:00Z')), true, '03:00 IST');
    assert.equal(isDue(new Date('2026-09-17T12:00:00Z')), true, 'later that day still due, so a missed 03:00 catches up');
});

check('a clean night after a clean yesterday extends the streak', () => {
    const previous = { night: '2026-09-16', status: 'done', clean: true, cleanStreak: 6 };
    assert.equal(nextStreak({ previous, night: '2026-09-17', clean: true }), 7);
});

check('across a month boundary too', () => {
    const previous = { night: '2026-09-30', status: 'done', clean: true, cleanStreak: 3 };
    assert.equal(nextStreak({ previous, night: '2026-10-01', clean: true }), 4);
});

check('a dirty night resets to 0', () => {
    const previous = { night: '2026-09-16', status: 'done', clean: true, cleanStreak: 13 };
    assert.equal(nextStreak({ previous, night: '2026-09-17', clean: false }), 0);
});

check('a skipped night breaks the streak: the next clean night starts again at 1', () => {
    const previous = { night: '2026-09-15', status: 'done', clean: true, cleanStreak: 13 };
    assert.equal(nextStreak({ previous, night: '2026-09-17', clean: true }), 1);
});

check('a clean night after a dirty or unfinished one starts at 1', () => {
    assert.equal(nextStreak({ previous: { night: '2026-09-16', status: 'done', clean: false }, night: '2026-09-17', clean: true }), 1);
    assert.equal(nextStreak({ previous: { night: '2026-09-16', status: 'running', clean: true, cleanStreak: 5 }, night: '2026-09-17', clean: true }), 1);
    assert.equal(nextStreak({ previous: null, night: '2026-09-17', clean: true }), 1);
});

check('a night is clean only if every part that ran is clean', () => {
    assert.equal(verdict({ a: { clean: true }, b: { skipped: true } }), true);
    assert.equal(verdict({ a: { clean: true }, b: { clean: false } }), false);
    assert.equal(verdict({ a: { clean: false, error: 'boom' } }), false);
});

check('a night on which nothing ran is NOT clean -- it checked nothing', () => {
    assert.equal(verdict({ a: { skipped: true }, b: { skipped: true } }), false);
    assert.equal(verdict({}), false);
});

console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
