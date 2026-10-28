/**
 * The delivery ledger projector's planning, without a database.
 *
 * Run: node src/core/finance/__checks__/deliveryLedgerProjector.check.js
 *
 * The projector appends target - held for every item. These checks pin the two
 * properties that make that safe to run nightly against production: a second run
 * plans nothing, and every way the source state can change -- undelivered,
 * rejected, edited, reassigned -- is closed by a correcting entry, never by
 * rewriting one.
 */
import assert from 'node:assert/strict';
import { targetsFor, planProjection, foldProjected, PROJECTOR } from '../deliveryLedgerProjector.js';
import { kindOf } from '../idempotencyKeys.js';

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

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const order = (over = {}) => ({
    _id: 'o1', orderStatus: 'delivered', riderEarning: 50,
    payment: { method: 'razorpay' }, pricing: { total: 400 }, dispatch: { deliveryPartnerId: A }, ...over,
});

// What the ledger would hold after appending a plan: entries carry cashBefore/After
// the way ledger.append writes them.
const applied = (plan, prior = []) => [
    ...prior,
    ...plan.entries.map((e) => ({ ...e, cashBefore: 0, cashAfter: e.cashDelta })),
];

const run = (sources, existing = [], ownerId = A, vertical = 'food') =>
    planProjection({ ownerId, vertical, targets: targetsFor({ ownerId, vertical, ...sources }), existing });

// --- targets ------------------------------------------------------------------
check('a delivered online order earns its riderEarning and no cash', () => {
    const [t] = targetsFor({ ownerId: A, vertical: 'food', orders: [order()] });
    assert.equal(t.amount, 50);
    assert.equal(t.cash, 0);
    assert.equal(t.type, 'EARNING');
});

check('a delivered cash order also puts its total in the rider\'s hand', () => {
    const [t] = targetsFor({ ownerId: A, vertical: 'food', orders: [order({ payment: { method: 'cash' } })] });
    assert.equal(t.cash, 400);
});

check('an undelivered order targets nothing', () => {
    const [t] = targetsFor({ ownerId: A, vertical: 'food', orders: [order({ orderStatus: 'picked_up' })] });
    assert.equal(t.amount, 0);
    assert.equal(t.cash, 0);
});

check('pending AND approved withdrawals are held; rejected is not -- as riderFinance subtracts them', () => {
    const w = (status) => ({ _id: `w_${status}`, amount: 100, status, deliveryPartnerId: A });
    const ts = targetsFor({ ownerId: A, vertical: 'food', withdrawals: [w('pending'), w('approved'), w('rejected')] });
    assert.deepEqual(ts.map((t) => t.amount), [-100, -100, 0]);
});

check('only Completed deposits settle cash', () => {
    const d = (status) => ({ _id: `d_${status}`, amount: 80, status, deliveryPartnerId: A });
    const ts = targetsFor({ ownerId: A, vertical: 'food', deposits: [d('Completed'), d('Pending'), d('Failed')] });
    assert.deepEqual(ts.map((t) => t.cash), [-80, 0, 0]);
    assert.ok(ts.every((t) => t.amount === 0), 'a deposit moves cash, never the balance');
});

check('keys carry the owner and a real key kind, and QC rows name QC collections', () => {
    const [t] = targetsFor({ ownerId: A, vertical: 'food', orders: [order()] });
    assert.equal(t.key, `order_rider_earning:o1@${A}`);
    assert.equal(kindOf(t.key), 'order_rider_earning');
    const [q] = targetsFor({
        ownerId: A, vertical: 'quickCommerce',
        withdrawals: [{ _id: 'w1', amount: 1, status: 'pending', deliveryPartnerId: A }],
    });
    assert.equal(q.key, `source_row:qc_delivery_withdrawals:w1@${A}`);
});

// --- planning -----------------------------------------------------------------
check('first run appends one entry per item that moved money', () => {
    const plan = run({ orders: [order(), order({ _id: 'o2', orderStatus: 'cancelled' })] });
    assert.equal(plan.entries.length, 1, 'the cancelled order has nothing to record');
    assert.equal(plan.entries[0].metadata.projector, PROJECTOR);
    assert.equal(plan.entries[0].idempotencyKey, `order_rider_earning:o1@${A}`);
});

check('a second run over the same state plans nothing', () => {
    const sources = {
        orders: [order({ payment: { method: 'cash' } })],
        bonuses: [{ _id: 'b1', amount: 25, deliveryPartnerId: A }],
        withdrawals: [{ _id: 'w1', amount: 30, status: 'approved', deliveryPartnerId: A }],
        deposits: [{ _id: 'd1', amount: 100, status: 'Completed', deliveryPartnerId: A }],
    };
    const ledger = applied(run(sources));
    assert.equal(run(sources, ledger).entries.length, 0);
});

check('a rejected withdrawal is given back by a correction, not by editing the first entry', () => {
    const w = { _id: 'w1', amount: 30, status: 'pending', deliveryPartnerId: A };
    const ledger = applied(run({ withdrawals: [w] }));
    const plan = run({ withdrawals: [{ ...w, status: 'rejected' }] }, ledger);
    assert.equal(plan.entries.length, 1);
    assert.equal(plan.entries[0].amount, 30);
    assert.equal(plan.entries[0].idempotencyKey, `source_row:food_delivery_withdrawals:w1@${A}#rev1`);
    assert.equal(plan.corrections, 1);
});

check('an earning edited after delivery is corrected by the difference', () => {
    const ledger = applied(run({ orders: [order()] }));
    const plan = run({ orders: [order({ riderEarning: 65.5 })] }, ledger);
    assert.equal(plan.entries[0].amount, 15.5);
});

check('an order that stops being delivered reverses both its earning and its cash', () => {
    const cod = order({ payment: { method: 'cash' } });
    const ledger = applied(run({ orders: [cod] }));
    const plan = run({ orders: [{ ...cod, orderStatus: 'cancelled' }] }, ledger);
    assert.equal(plan.entries[0].amount, -50);
    assert.equal(plan.entries[0].cashDelta, -400);
});

check('an order reassigned to another rider is reversed for the first and earned by the second, without colliding', () => {
    const ledgerA = applied(run({ orders: [order()] }));
    const moved = order({ dispatch: { deliveryPartnerId: B } });

    // Rider A no longer holds it: their query does not even return it.
    const planA = run({ orders: [] }, ledgerA, A);
    assert.equal(planA.entries.length, 1);
    assert.equal(planA.entries[0].amount, -50);
    assert.equal(planA.entries[0].type, 'EARNING', 'the reversal keeps the original type');

    const planB = run({ orders: [moved] }, [], B);
    assert.equal(planB.entries[0].amount, 50);
    assert.notEqual(planB.entries[0].idempotencyKey, planA.entries[0].idempotencyKey);
});

check('a revision after a revision keeps numbering, so every key is new', () => {
    const w = { _id: 'w1', amount: 30, status: 'pending', deliveryPartnerId: A };
    let ledger = applied(run({ withdrawals: [w] }));
    ledger = applied(run({ withdrawals: [{ ...w, status: 'rejected' }] }, ledger), ledger);
    const third = run({ withdrawals: [{ ...w, amount: 40 }] }, ledger);
    assert.equal(third.entries[0].idempotencyKey, `source_row:food_delivery_withdrawals:w1@${A}#rev2`);
    assert.equal(third.entries[0].amount, -40);
});

check('the fold equals riderFinance\'s pocket and cash formulas', () => {
    const sources = {
        orders: [order(), order({ _id: 'o2', riderEarning: 20, payment: { method: 'cash' }, pricing: { total: 300 } })],
        bonuses: [{ _id: 'b1', amount: 25, deliveryPartnerId: A }],
        withdrawals: [
            { _id: 'w1', amount: 30, status: 'approved', deliveryPartnerId: A },
            { _id: 'w2', amount: 10, status: 'pending', deliveryPartnerId: A },
            { _id: 'w3', amount: 99, status: 'rejected', deliveryPartnerId: A },
        ],
        deposits: [{ _id: 'd1', amount: 120, status: 'Completed', deliveryPartnerId: A }],
    };
    const folded = foldProjected(applied(run(sources)));
    // earned 70 + bonus 25 - withdrawn 30 - pending 10
    assert.equal(folded.balance, 55);
    // collected 300 - deposited 120
    assert.equal(folded.cash, 180);
});

console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
