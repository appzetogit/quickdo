/**
 * The idempotency key taxonomy, checked on the two ways it can go wrong.
 *
 * Run: node src/core/finance/__checks__/idempotencyKeys.check.js
 *
 * Pure string work -- no database. Every check here is really one of two
 * questions: does a retry produce the SAME key (or the money moves twice), and
 * do two genuinely different mutations produce DIFFERENT keys (or one of them is
 * silently swallowed)? The second failure is the quieter and the worse one: a
 * rider simply never gets paid and nothing logs an error.
 */
import assert from 'node:assert/strict';
import * as keys from '../idempotencyKeys.js';

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

// --- a retry must produce the same key --------------------------------------
console.log('\nretries collapse');

check('the same provider event twice is one key', () => {
    assert.equal(keys.forProviderEvent('evt_ABC'), keys.forProviderEvent('evt_ABC'));
});

check('an ObjectId and its string form agree', () => {
    // Callers pass mongoose ObjectIds in some paths and strings in others. If
    // those produced different keys, a retry through the other path would
    // double-credit.
    const oid = { toString: () => '65f0c0ffee0000000000001' };
    assert.equal(keys.forRideSettlement(oid), keys.forRideSettlement('65f0c0ffee0000000000001'));
});

check('surrounding whitespace does not make a new key', () => {
    assert.equal(keys.forProviderPayment(' pay_1 '), keys.forProviderPayment('pay_1'));
});

// --- different mutations must produce different keys ------------------------
console.log('\ndistinct mutations stay distinct');

check('the three payouts of one order are three keys', () => {
    // The failure this prevents: keying on the order alone, so crediting the
    // rider marks the restaurant's share and the platform fee as "already done".
    const orderId = 'order_1';
    const set = new Set([
        keys.forOrderRiderEarning(orderId),
        keys.forOrderCommission(orderId, 'rest_1'),
        keys.forOrderPlatformFee(orderId),
    ]);
    assert.equal(set.size, 3);
});

check('a withdrawal request and its approval are different keys', () => {
    // Same row, two real movements. One key would make the payout look like a
    // duplicate of the request and skip it.
    assert.notEqual(keys.forWithdrawal('w1', 'pending'), keys.forWithdrawal('w1', 'approved'));
});

check('a provider event id and a payment id do not collide', () => {
    assert.notEqual(keys.forProviderEvent('x1'), keys.forProviderPayment('x1'));
});

check('two rides settle under two keys', () => {
    assert.notEqual(keys.forRideSettlement('r1'), keys.forRideSettlement('r2'));
});

check('the same commission on two restaurants is two keys', () => {
    assert.notEqual(keys.forOrderCommission('o1', 'rest_1'), keys.forOrderCommission('o1', 'rest_2'));
});

check('two admins adjusting the same driver are two keys', () => {
    assert.notEqual(keys.forAdminAdjustment('a1', 'req_1'), keys.forAdminAdjustment('a2', 'req_1'));
});

check('one admin, two deliberate adjustments, two keys', () => {
    // The client supplies a fresh id per submission, so a genuine second
    // adjustment of the same amount is NOT swallowed as a double-click.
    assert.notEqual(keys.forAdminAdjustment('a1', 'req_1'), keys.forAdminAdjustment('a1', 'req_2'));
});

// --- malformed input must fail loudly, never silently -----------------------
console.log('\nbad input is refused, not quietly accepted');

check('a missing id throws rather than minting a blank key', () => {
    // A key like "ride_settlement:" would match every other blank one and
    // suppress unrelated mutations. Refuse to create it.
    assert.throws(() => keys.forRideSettlement(undefined), /missing a required part/);
    assert.throws(() => keys.forRideSettlement(''), /missing a required part/);
    assert.throws(() => keys.forRideSettlement('   '), /missing a required part/);
});

check('a half-supplied compound key throws', () => {
    assert.throws(() => keys.forWithdrawal('w1', ''), /missing a required part/);
    assert.throws(() => keys.forAdminAdjustment('a1', null), /missing a required part/);
});

check('an unknown kind cannot be minted', () => {
    assert.throws(() => keys.__testables.build('not_a_kind', 'x'), /Unknown idempotency key kind/);
});

// --- the key is readable back ------------------------------------------------
console.log('\na key says what made it');

check('kindOf recovers the kind for every key type', () => {
    assert.equal(keys.kindOf(keys.forProviderEvent('e1')), 'rzp_event');
    assert.equal(keys.kindOf(keys.forWithdrawal('w1', 'approved')), 'withdrawal');
    assert.equal(keys.kindOf(keys.forCashDeposit('pay_1')), 'cash_deposit');
});

check('kindOf refuses to invent a kind for junk', () => {
    assert.equal(keys.kindOf('something:else'), null);
    assert.equal(keys.kindOf(''), null);
    assert.equal(keys.kindOf(undefined), null);
});

check('every declared kind is reachable through a named helper', () => {
    // Guards against adding a kind to the list and forgetting the function, which
    // would leave a mutation with no way to name itself.
    const minted = [
        keys.forProviderEvent('a'),
        keys.forProviderPayment('a'),
        keys.forProviderRefund('a'),
        keys.forRideSettlement('a'),
        keys.forRideCancellationFee('a'),
        keys.forOrderRiderEarning('a'),
        keys.forOrderCommission('a', 'b'),
        keys.forOrderPlatformFee('a'),
        keys.forCashDeposit('a'),
        keys.forWithdrawal('a', 'b'),
        keys.forBonus('a'),
        keys.forAdminAdjustment('a', 'b'),
        keys.forSubscriptionCharge('a', 'b'),
        keys.forSourceRow('a', 'b'),
    ].map(keys.kindOf);
    assert.deepEqual([...new Set(minted)].sort(), [...keys.KEY_KINDS].sort());
});

check('a mirrored source row is named by its collection and row, not its business event', () => {
    // Two rows for one ride -- the old dedupe's double credit -- must stay two entries,
    // or the ledger would agree with what should have happened and hide the drift.
    assert.equal(keys.forSourceRow('wallettransactions', 'r1'), 'source_row:wallettransactions:r1');
    assert.notEqual(keys.forSourceRow('wallettransactions', 'r1'), keys.forSourceRow('wallettransactions', 'r2'));
    assert.notEqual(keys.forSourceRow('wallettransactions', 'r1'), keys.forSourceRow('qc_wallet', 'r1'));
    assert.throws(() => keys.forSourceRow('wallettransactions', ''), /missing a required part/);
});

console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
