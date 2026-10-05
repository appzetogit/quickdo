/**
 * The ledger's one invariant, checked at the only point it can still be fixed.
 *
 * Run: node src/core/finance/__checks__/ledgerEntry.check.js
 *
 * No database: a mongoose document validates without one, and validation is
 * exactly what is under test.
 *
 * The equation `balanceAfter - balanceBefore === amount` is the whole value of
 * this collection. Break it and the balance is no longer reconstructible, which
 * means a discrepancy is no longer findable, which means the ledger is an
 * expensive log. The repo already contains a row that breaks it (a cash tip with
 * a non-zero amount and identical before/after), so this is a rule with a proven
 * need rather than a theoretical one.
 */
import assert from 'node:assert/strict';
import { LedgerEntry, LEDGER_ENTRY_TYPES, LEDGER_OWNER_TYPES } from '../ledgerEntry.model.js';
import { forRideSettlement, forOrderRiderEarning, kindOf } from '../idempotencyKeys.js';

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

const entry = (over = {}) => new LedgerEntry({
    ownerType: 'partner',
    ownerId: 'p1',
    vertical: 'food',
    type: 'EARNING',
    amount: 120,
    balanceBefore: 500,
    balanceAfter: 620,
    idempotencyKey: forOrderRiderEarning('order_1'),
    keyKind: 'order_rider_earning',
    actor: { kind: 'system', id: '' },
    ...over,
});

/** The validation error, or null when the document is valid. */
const errorOf = (doc) => {
    const err = doc.validateSync();
    return err ? (err.errors?.[Object.keys(err.errors)[0]]?.message || err.message) : null;
};

// --- the invariant -----------------------------------------------------------
console.log('\nthe balance-delta invariant');

check('a credit whose delta matches its amount validates', () => {
    assert.equal(errorOf(entry()), null);
});

check('a debit is a NEGATIVE amount, and validates', () => {
    assert.equal(errorOf(entry({ amount: -200, balanceBefore: 500, balanceAfter: 300 })), null);
});

check('THE BUG: a non-zero amount with an unchanged balance is REFUSED', () => {
    /*
     * The cash-tip row shape. Folding a collection containing these overstates
     * every driver's balance by their lifetime tips, and the reconciler flags every
     * tipped driver with no way to tell a real discrepancy from the noise.
     */
    const err = errorOf(entry({ amount: 50, balanceBefore: 500, balanceAfter: 500 }));
    assert.ok(err && /invariant violated/i.test(err), `expected an invariant error, got: ${err}`);
});

check('a movement that does not touch the wallet records amount 0', () => {
    // Still a fact worth recording -- it is just not a wallet movement.
    assert.equal(errorOf(entry({ type: 'NON_WALLET', amount: 0, balanceBefore: 500, balanceAfter: 500, metadata: { tipAmount: 50 } })), null);
});

check('an amount that disagrees with the delta by one paisa is refused', () => {
    assert.ok(errorOf(entry({ amount: 120, balanceBefore: 500, balanceAfter: 620.01 })));
});

check('floating-point totals do not trip the invariant', () => {
    // 0.1 + 0.2 === 0.30000000000000004. Comparing raw floats would reject a
    // perfectly correct row.
    assert.equal(errorOf(entry({ amount: 0.3, balanceBefore: 0.1, balanceAfter: 0.1 + 0.3 })), null);
});

// --- negative balances -------------------------------------------------------
console.log('\nnegative balances are recordable, not refused');

check('a debit that takes the balance below zero is RECORDED', () => {
    /*
     * `transaction.service.recordTransaction` throws here, which means it declines
     * to record a debt that genuinely exists -- the debt does not stop being real,
     * it just stops being visible. This table records it.
     */
    assert.equal(errorOf(entry({ amount: -250, balanceBefore: 100, balanceAfter: -150 })), null);
});

check('a balance that is already negative can go further negative', () => {
    assert.equal(errorOf(entry({ amount: -50, balanceBefore: -150, balanceAfter: -200 })), null);
});

check('a credit that brings a negative balance back up validates', () => {
    assert.equal(errorOf(entry({ amount: 300, balanceBefore: -150, balanceAfter: 150 })), null);
});

// --- what a row must always carry --------------------------------------------
console.log('\nwhat every row must carry');

check('an entry without an idempotency key is refused', () => {
    assert.ok(errorOf(entry({ idempotencyKey: undefined })));
});

check('an entry without a vertical is refused', () => {
    // Revenue-by-vertical is unanswerable the moment one row omits it.
    assert.ok(errorOf(entry({ vertical: undefined })));
});

check('an unknown vertical is refused rather than silently stored', () => {
    assert.ok(errorOf(entry({ vertical: 'crypto' })));
});

check('an unknown entry type is refused', () => {
    assert.ok(errorOf(entry({ type: 'VIBES' })));
});

check('an owner type outside the enum is refused', () => {
    assert.ok(errorOf(entry({ ownerType: 'goblin' })));
});

check('"platform" is a valid owner, and needs no ObjectId', () => {
    // ownerId is a string precisely so the platform's own wallet is expressible.
    assert.ok(LEDGER_OWNER_TYPES.includes('platform'));
    assert.equal(errorOf(entry({ ownerType: 'platform', ownerId: 'platform' })), null);
});

check('an amount of zero is allowed only when the balance did not move', () => {
    assert.equal(errorOf(entry({ amount: 0, balanceBefore: 10, balanceAfter: 10 })), null);
    assert.ok(errorOf(entry({ amount: 0, balanceBefore: 10, balanceAfter: 20 })));
});

// --- the key ties back to the taxonomy ---------------------------------------
console.log('\nkeys tie back to the taxonomy');

check('a minted key is accepted and its kind is recoverable', () => {
    const key = forRideSettlement('ride_9');
    const doc = entry({ idempotencyKey: key, keyKind: kindOf(key) });
    assert.equal(errorOf(doc), null);
    assert.equal(doc.keyKind, 'ride_settlement');
});

check('legacy keys from the backfill are accepted', () => {
    // Historical rows get `legacy:<id>` so the unique index can be built at all.
    assert.equal(errorOf(entry({ idempotencyKey: 'legacy:abc', keyKind: 'legacy' })), null);
    assert.equal(errorOf(entry({ idempotencyKey: 'legacy_ref:x', keyKind: 'legacy_ref' })), null);
});

check('an invented key kind is refused', () => {
    assert.ok(errorOf(entry({ keyKind: 'improvised' })));
});

check('every declared entry type is actually usable', () => {
    for (const type of LEDGER_ENTRY_TYPES) {
        assert.equal(errorOf(entry({ type })), null, `type ${type} failed validation`);
    }
});

// --- folding -----------------------------------------------------------------
console.log('\nthe collection folds back to the balance');

check('a sequence of entries folds to its final balance', () => {
    // The property the whole design exists for, asserted on the arithmetic.
    const moves = [120, -200, 300, -50];
    let balance = 0;
    const rows = moves.map((amount) => {
        const before = balance;
        balance = Math.round((balance + amount) * 100) / 100;
        return entry({ amount, balanceBefore: before, balanceAfter: balance });
    });
    for (const r of rows) assert.equal(errorOf(r), null);
    assert.equal(rows.reduce((sum, r) => sum + r.amount, 0), balance);
    assert.equal(balance, 170);
});

check('a fold that includes a non-wallet row is unaffected by it', () => {
    const rows = [
        entry({ amount: 100, balanceBefore: 0, balanceAfter: 100 }),
        entry({ type: 'NON_WALLET', amount: 0, balanceBefore: 100, balanceAfter: 100, metadata: { tipAmount: 50 } }),
        entry({ amount: 25, balanceBefore: 100, balanceAfter: 125 }),
    ];
    assert.equal(rows.reduce((s, r) => s + r.amount, 0), 125);
    assert.equal(rows[rows.length - 1].balanceAfter, 125);
});

console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
