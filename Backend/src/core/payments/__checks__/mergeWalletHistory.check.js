/**
 * One customer history out of two stores, checked on both ways it can go wrong.
 *
 * Run: node src/core/payments/__checks__/mergeWalletHistory.check.js
 *
 * The merge has two failure modes and they are not symmetric. Showing a
 * transaction twice is embarrassing; DELETING one from a customer's history
 * because it looked like a duplicate is a support incident about money. So the
 * checks below insist on collapsing genuine duplicates AND on keeping everything
 * that cannot be proven to be one.
 */
import assert from 'node:assert/strict';
import { mergeWalletHistory, __testables } from '../mergeWalletHistory.js';

const { identityOf } = __testables;

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

const ledger = (over = {}) => ({
    id: 'L1', _id: 'L1', type: 'addition', amount: 500, status: 'Completed',
    description: 'Wallet top-up', createdAt: '2026-01-02T10:00:00Z',
    orderId: 'order_1', balanceAfter: 1500, category: 'topup', ...over,
});

const embedded = (over = {}) => ({
    id: 'E1', _id: 'E1', type: 'addition', amount: 500, status: 'Completed',
    description: 'Wallet top-up', createdAt: '2026-01-02T10:00:01Z',
    metadata: { orderId: 'order_1' }, ...over,
});

// --- the duplicate it must collapse -----------------------------------------
console.log('\ncollapsing genuine duplicates');

check('THE BUG: one top-up written to both stores appears once', () => {
    // What stood here was a plain concatenation under a comment promising a merge.
    const out = mergeWalletHistory([ledger()], [embedded()]);
    assert.equal(out.length, 1);
});

check('the ledger row is the one kept', () => {
    // It carries balanceAfter and a category, so it is strictly more informative
    // than the embedded row it duplicates.
    const out = mergeWalletHistory([ledger()], [embedded()]);
    assert.equal(out[0].balanceAfter, 1500);
    assert.equal(out[0].category, 'topup');
});

check('ids are NOT used for matching', () => {
    // The two stores mint their own ids, so they never match; matching on them
    // would deduplicate nothing at all.
    const out = mergeWalletHistory([ledger({ _id: 'x', id: 'x' })], [embedded({ _id: 'y', id: 'y' })]);
    assert.equal(out.length, 1);
});

check('a duplicate is matched through the embedded row\'s metadata.orderId', () => {
    assert.equal(identityOf(embedded()), identityOf(ledger()));
});

// --- what it must NEVER remove ----------------------------------------------
console.log('\nkeeping everything that is not provably a duplicate');

check('a credit and a debit for the same order both survive', () => {
    // A payment and its refund. Same order, same amount, opposite direction.
    const out = mergeWalletHistory(
        [ledger({ type: 'addition' })],
        [embedded({ type: 'deduction', _id: 'E2' })],
    );
    assert.equal(out.length, 2);
});

check('two different amounts on one order both survive', () => {
    // A partial refund followed by the rest.
    const out = mergeWalletHistory([ledger({ amount: 500 })], [embedded({ amount: 200, _id: 'E2' })]);
    assert.equal(out.length, 2);
});

check('rows with NO order are always kept, even when identical', () => {
    /*
     * Two referral rewards of the same amount on the same day are two rewards.
     * Collapsing them would silently delete money from the customer's history --
     * the worse of the two failure modes.
     */
    const a = { _id: 'A', type: 'addition', amount: 50, createdAt: '2026-01-02T10:00:00Z', metadata: {} };
    const b = { _id: 'B', type: 'addition', amount: 50, createdAt: '2026-01-02T10:00:00Z', metadata: {} };
    assert.equal(mergeWalletHistory([a], [b]).length, 2);
    assert.equal(identityOf(a), null);
});

check('two DIFFERENT orders both survive', () => {
    const out = mergeWalletHistory(
        [ledger({ orderId: 'order_1' })],
        [embedded({ metadata: { orderId: 'order_2' }, _id: 'E2' })],
    );
    assert.equal(out.length, 2);
});

check('two genuine credits on the same order are not both lost', () => {
    // Same store, same event key: only cross-store duplicates are collapsed, and
    // within one store every row is real by construction.
    const out = mergeWalletHistory([ledger({ _id: 'L1' }), ledger({ _id: 'L2' })], []);
    assert.equal(out.length, 2);
});

// --- ordering and shape ------------------------------------------------------
console.log('\nordering and robustness');

check('newest first, across both stores', () => {
    const out = mergeWalletHistory(
        [ledger({ orderId: 'o_old', createdAt: '2026-01-01T00:00:00Z' })],
        [embedded({ metadata: { orderId: 'o_new' }, createdAt: '2026-03-01T00:00:00Z', _id: 'E2' })],
    );
    assert.equal(out.length, 2);
    assert.equal(out[0]._id, 'E2');
});

check('a row dated by `date` rather than `createdAt` still sorts', () => {
    const out = mergeWalletHistory(
        [{ _id: 'A', amount: 1, date: '2026-05-01T00:00:00Z' }],
        [{ _id: 'B', amount: 1, date: '2026-01-01T00:00:00Z' }],
    );
    assert.equal(out[0]._id, 'A');
});

check('an undated row does not crash the sort or vanish', () => {
    const out = mergeWalletHistory([{ _id: 'A', amount: 1 }], [{ _id: 'B', amount: 1 }]);
    assert.equal(out.length, 2);
});

check('missing or malformed inputs return an empty list, not a throw', () => {
    assert.deepEqual(mergeWalletHistory(), []);
    assert.deepEqual(mergeWalletHistory(null, undefined), []);
    assert.deepEqual(mergeWalletHistory('nope', 42), []);
});

check('an empty ledger returns the embedded history untouched', () => {
    const out = mergeWalletHistory([], [embedded(), embedded({ _id: 'E2', metadata: { orderId: 'order_2' } })]);
    assert.equal(out.length, 2);
});

check('amounts are compared in paise, so float totals still match', () => {
    assert.equal(
        identityOf(ledger({ amount: 0.1 + 0.2 })),
        identityOf(embedded({ amount: 0.3 })),
    );
});

console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
