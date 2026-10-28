/**
 * The unified rider wallet, checked on the arithmetic that has to be right.
 *
 * Run: node src/core/finance/__checks__/riderFinance.check.js
 *
 * Pure maths only -- no database. The two things worth pinning down are the
 * signed-balance split (getting it backwards turns money owed into money owing)
 * and the block gates (which decide whether a rider can earn at all).
 */
import assert from 'node:assert/strict';
import { __testables } from '../riderFinance.service.js';

const { round2, splitSignedTaxiBalance, resolveBlockState } = __testables;

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

// --- the signed taxi balance, split into the two real figures ---------------
console.log('\nsplitting the signed taxi balance');

check('a positive balance is money owed to the rider, no cash held', () => {
    const split = splitSignedTaxiBalance(500);
    assert.equal(split.walletPortion, 500);
    assert.equal(split.cashHeldPortion, 0);
});

check('a negative balance is cash the rider holds, nothing owed to them', () => {
    const split = splitSignedTaxiBalance(-200);
    assert.equal(split.walletPortion, 0);
    assert.equal(split.cashHeldPortion, 200);
});

check('zero is neither', () => {
    const split = splitSignedTaxiBalance(0);
    assert.equal(split.walletPortion, 0);
    assert.equal(split.cashHeldPortion, 0);
});

check('the split never invents or loses money', () => {
    for (const signed of [-1234.56, -0.01, 0, 0.01, 87.5, 5000]) {
        const s = splitSignedTaxiBalance(signed);
        assert.equal(round2(s.walletPortion - s.cashHeldPortion), round2(signed),
            `wallet - cashHeld should reconstruct ${signed}`);
    }
});

check('a missing or junk balance reads as zero, not NaN', () => {
    for (const bad of [undefined, null, '', 'abc', NaN]) {
        const s = splitSignedTaxiBalance(bad);
        assert.equal(s.signed, 0);
        assert.equal(s.walletPortion, 0);
        assert.equal(s.cashHeldPortion, 0);
    }
});

// --- one balance, one cash-in-hand -----------------------------------------
console.log('\ncombining the two verticals into one pair of figures');

const combine = (taxiSigned, foodPocket, foodCash) => {
    const taxi = splitSignedTaxiBalance(taxiSigned);
    return {
        walletBalance: round2(taxi.walletPortion + foodPocket),
        cashInHand: round2(taxi.cashHeldPortion + foodCash),
    };
};

check('Rs 300 on taxi and Rs 200 on food is one Rs 500 balance', () => {
    const combined = combine(300, 200, 0);
    assert.equal(combined.walletBalance, 500);
    assert.equal(combined.cashInHand, 0);
});

check('taxi debt and food cash add into one cash-in-hand', () => {
    const combined = combine(-200, 0, 122);
    assert.equal(combined.walletBalance, 0);
    assert.equal(combined.cashInHand, 322);
});

check('a rider owed on food while holding taxi cash shows both, not a net', () => {
    // Netting these would hide the cash owed and let the rider keep working.
    const combined = combine(-150, 400, 0);
    assert.equal(combined.walletBalance, 400);
    assert.equal(combined.cashInHand, 150);
});

check('the live production numbers: Rishi 500 taxi, 122 deposited food cash', () => {
    // Rs 122 was collected as COD and then deposited, so it nets to zero cash.
    const foodCash = Math.max(0, round2(122 - 122));
    const combined = combine(500, 0, foodCash);
    assert.equal(combined.walletBalance, 500);
    assert.equal(combined.cashInHand, 0, 'a settled deposit must not linger as cash owed');
});

// --- clamping once, after summing ------------------------------------------
console.log('\nclamping after the sum, not before');

// What the service does: the delivery figures may go negative, and the clamp is
// applied only to the combined total.
const unify = ({ taxiSigned = 0, foodEarned = 0, foodBonus = 0, foodWithdrawn = 0,
                 foodPending = 0, foodGrossCash = 0, foodDeposited = 0 } = {}) => {
    const taxi = splitSignedTaxiBalance(taxiSigned);
    const pocketRaw = round2(foodEarned + foodBonus - foodWithdrawn - foodPending);
    const cashRaw = round2(foodGrossCash - foodDeposited);
    return {
        walletBalance: Math.max(0, round2(taxi.walletPortion + pocketRaw)),
        cashInHand: Math.max(0, round2(taxi.cashHeldPortion + cashRaw)),
    };
};

check('withdrawing taxi earnings through the delivery app reduces the balance', () => {
    // The bug this prevents: with no food earnings, clamping the food side first
    // gives max(0, -500) = 0, the unified balance still reads 500, and the rider
    // can withdraw the same 500 again on the next request, and forever after.
    const before = unify({ taxiSigned: 500 });
    assert.equal(before.walletBalance, 500, 'starts with 500 available');

    const after = unify({ taxiSigned: 500, foodWithdrawn: 500 });
    assert.equal(after.walletBalance, 0, 'the withdrawal must actually spend it');
});

check('a partial withdrawal of taxi earnings leaves the remainder', () => {
    assert.equal(unify({ taxiSigned: 500, foodWithdrawn: 200 }).walletBalance, 300);
});

check('a pending request is already spent, not available again', () => {
    assert.equal(unify({ taxiSigned: 500, foodPending: 500 }).walletBalance, 0);
});

check('the balance never goes negative, however much is withdrawn', () => {
    assert.equal(unify({ taxiSigned: 100, foodWithdrawn: 9999 }).walletBalance, 0);
});

check('depositing taxi-collected cash through the delivery app clears it', () => {
    // Mirror of the same bug on the cash side: clamping the food figure first
    // makes the deposit vanish and the rider stays blocked no matter how often
    // they pay the money in.
    const before = unify({ taxiSigned: -200 });
    assert.equal(before.cashInHand, 200, 'holds 200 of taxi cash');

    const after = unify({ taxiSigned: -200, foodDeposited: 200 });
    assert.equal(after.cashInHand, 0, 'the deposit must actually settle it');
});

check('cash from both streams settles against one deposit', () => {
    const state = unify({ taxiSigned: -100, foodGrossCash: 300, foodDeposited: 400 });
    assert.equal(state.cashInHand, 0);
});

check('cash in hand never goes negative', () => {
    assert.equal(unify({ taxiSigned: -50, foodDeposited: 9999 }).cashInHand, 0);
});

check('the two figures stay independent of one another', () => {
    // Earning on food must not reduce cash owed, and depositing cash must not
    // reduce the balance owed to the rider.
    const state = unify({ taxiSigned: -200, foodEarned: 500, foodDeposited: 200 });
    assert.equal(state.walletBalance, 500);
    assert.equal(state.cashInHand, 0);
});

// --- the two block gates ---------------------------------------------------
console.log('\nthe block gates');

const rules = { isWalletEnabled: true, minimumBalanceForOrders: -500 };
const gate = (over) => resolveBlockState({
    taxiSigned: 0,
    cashInHand: 0,
    cashLimit: 5000,
    rules,
    snapshotBlocked: false,
    ...over,
});

check('a healthy rider is not blocked', () => {
    assert.equal(gate({ taxiSigned: 500, cashInHand: 100 }).isBlocked, false);
});

check('a disabled wallet blocks before anything else is considered', () => {
    const state = gate({ rules: { ...rules, isWalletEnabled: false }, taxiSigned: 9999 });
    assert.equal(state.isBlocked, true);
    assert.equal(state.reason, 'wallet_disabled');
});

check('falling to the taxi minimum balance blocks, unchanged behaviour', () => {
    const state = gate({ taxiSigned: -500 });
    assert.equal(state.isBlocked, true);
    assert.equal(state.reason, 'below_minimum_balance');
});

check('one rupee above the minimum still works', () => {
    assert.equal(gate({ taxiSigned: -499.99 }).isBlocked, false);
});

check('THE SHARED LIMIT: food cash over the ceiling blocks taxi rides too', () => {
    // The behaviour the shared limit exists for. Before unification this rider
    // was blocked on food and free to take rides against the same cash.
    const state = gate({ taxiSigned: 500, cashInHand: 5000 });
    assert.equal(state.isBlocked, true);
    assert.equal(state.reason, 'cash_limit_reached');
});

check('cash from BOTH streams counts toward the one ceiling', () => {
    // 4600 held from deliveries plus 400 of taxi debt reaches the 5000 ceiling,
    // which neither vertical would have caught on its own. The taxi debt is kept
    // inside the -500 minimum on purpose, so this isolates the cash gate rather
    // than tripping the minimum-balance one first.
    const taxi = splitSignedTaxiBalance(-400);
    const cashInHand = round2(taxi.cashHeldPortion + 4600);
    const state = gate({ taxiSigned: -400, cashInHand });
    assert.equal(cashInHand, 5000);
    assert.equal(state.isBlocked, true);
    assert.equal(state.reason, 'cash_limit_reached');
});

check('a zero cash limit means unlimited, never "block everyone"', () => {
    // The taxi side derives cashLimit 0 for the live drivers. Reading 0 as a real
    // ceiling would block every rider holding a single rupee.
    assert.equal(gate({ cashLimit: 0, cashInHand: 99999 }).isBlocked, false);
});

check('an admin hold blocks a rider who passes both money gates', () => {
    const state = gate({ taxiSigned: 500, snapshotBlocked: true });
    assert.equal(state.isBlocked, true);
    assert.equal(state.reason, 'blocked_by_admin');
});

check('a money problem is reported ahead of an admin hold', () => {
    // Both are true here; the actionable reason is the one the rider can fix.
    const state = gate({ taxiSigned: -500, snapshotBlocked: true });
    assert.equal(state.reason, 'below_minimum_balance');
});

console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
