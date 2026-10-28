/**
 * Quick-commerce returns: an approved return is actually paid, once, within what the
 * customer paid, and the seller's ledger is debited for goods it failed to supply.
 *
 * Run: node tests/qc-return-payout.smoke.mjs
 *
 * Reproduced with the real return and ledger services on an in-memory Mongo:
 *
 *  - refundReturn() required a core Payment document for the order. Nothing on the
 *    quick-commerce order path writes one, so every refund failed with 409 -- wallet,
 *    Razorpay and COD orders alike. Approved returns could never be paid.
 *
 *  - The refund cap counted only returns already REFUNDED, and the amount was fixed
 *    when the return was requested. Two seller-fault returns opened before either was
 *    paid each refunded the fees in full: 163.40 + 156.90 against a 268.40 order.
 *
 *  - Returns never touched the ledger, so the seller kept its full payout for goods
 *    it had failed to supply, and the books still showed the refunded money as earned.
 *
 * Order: Atta 100 at 18% + Salt 100 at the 5% fallback, 30 delivery + 5.40 GST,
 * 10 platform fee, rider paid 25 => 268.40.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'qc_return_payout' });

const BASE = '../src/modules/quickCommerce/modules/food';
// The order ledger model first: quickCommerce/core/payments/models/transaction.model.js
// registers the same 'QCTransaction' name, and whichever loads first wins.
const { FoodTransaction } = await import(`${BASE}/orders/models/foodTransaction.model.js`);
const returns = await import(`${BASE}/returns/services/return.service.js`);
const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);
const { createInitialTransaction } = await import(`${BASE}/orders/services/foodTransaction.service.js`);
const { FoodUserWallet } = await import(`${BASE}/user/models/userWallet.model.js`);
const { QCReturn } = await import(`${BASE}/returns/models/qcReturn.model.js`);

const id = () => new mongoose.Types.ObjectId();
const ATTA = String(id());
const SALT = String(id());

const makeOrder = async (payment) => {
    const order = await FoodOrder.create({
        userId: id(),
        restaurantId: id(),
        items: [
            { itemId: ATTA, name: 'Atta 1kg', quantity: 1, price: 100, variantPrice: 100, gstRate: 18 },
            { itemId: SALT, name: 'Salt 1kg', quantity: 1, price: 100, variantPrice: 100, gstRate: null },
        ],
        deliveryAddress: {
            street: '1 MG Road', city: 'Bengaluru', state: 'KA',
            location: { type: 'Point', coordinates: [77.61, 12.91] },
        },
        pricing: {
            subtotal: 200, tax: 23, deliveryFee: 30, deliveryFeeGst: 5.4, platformFee: 10,
            discount: 0, total: 268.4, gstFallbackRate: 5,
        },
        payment: { amountDue: 268.4, ...payment },
        riderEarning: 25,
        orderStatus: 'delivered',
        deliveryState: { currentPhase: 'delivered', deliveredAt: new Date() },
    });
    await createInitialTransaction(order.toObject());
    return order;
};

/** Request a return and walk it to inspected, ready for money to move. */
const openReturn = async (order, itemId, reasonCode) => {
    const doc = await returns.requestReturn({
        userId: order.userId, orderId: order._id, lines: [{ itemId, quantity: 1 }], reasonCode,
    });
    return doc;
};
const inspect = async (doc) => {
    await returns.decideReturn({ returnId: doc._id, approve: true });
    const scheduled = await returns.schedulePickup({ returnId: doc._id });
    await returns.markPickedUp({ returnId: doc._id, otp: scheduled.pickup.otp });
    await returns.inspectReturn({ returnId: doc._id, conditions: [] });
};

const walletBalance = async (userId) => Number((await FoodUserWallet.findOne({ userId }).lean())?.balance || 0);
const ledger = async (orderId) => (await FoodTransaction.findOne({ orderId }).lean()).amounts;
const ledgerBalances = (a) => r2(a.restaurantShare + a.riderShare + a.platformNetProfit + a.taxAmount);

console.log('\n[1] Two seller-fault returns opened before either is paid (wallet order)');

const walletOrder = await makeOrder({ method: 'wallet', status: 'paid' });
const atta = await openReturn(walletOrder, ATTA, 'damaged');
const salt = await openReturn(walletOrder, SALT, 'damaged');
await check('each was quoted its fees in full when requested', async () => {
    assert.equal(atta.refund.total, 163.4);
    assert.equal(salt.refund.total, 150.4);
});
await inspect(atta);
await inspect(salt);

const settled = await Promise.allSettled([
    returns.refundReturn({ returnId: atta._id }),
    returns.refundReturn({ returnId: salt._id }),
]);

await check('both refunds go through', async () => {
    const errors = settled.filter((s) => s.status === 'rejected').map((s) => s.reason?.message);
    assert.deepEqual(errors, []);
});

await check('the customer gets back exactly what was paid, not 313.80', async () => {
    const credited = await walletBalance(walletOrder.userId);
    assert.equal(credited, 268.4, `wallet credited ${credited}`);
    const docs = await QCReturn.find({ orderId: walletOrder._id }).lean();
    assert.equal(r2(docs.reduce((s, d) => s + d.refund.total, 0)), 268.4, 'the returns record what was paid');
    for (const d of docs) {
        assert.equal(d.status, 'refunded');
        assert.equal(r2(d.items.reduce((s, l) => s + l.refundAmount, 0)), d.refund.total, 'credit-note lines sum to the refund');
    }
});

await check('the seller is debited both goods it failed to supply', async () => {
    const a = await ledger(walletOrder._id);
    assert.equal(a.restaurantShare, 0, `seller still holds ${a.restaurantShare}`);
    assert.equal(a.refundedAmount, 268.4);
    assert.equal(a.taxAmount, 0, 'the GST refunded is no longer owed');
    assert.equal(ledgerBalances(a), r2(a.totalCustomerPaid - a.refundedAmount), 'every rupee kept is credited once');
});

await check('replaying a paid refund moves no more money', async () => {
    await returns.refundReturn({ returnId: atta._id });
    assert.equal(await walletBalance(walletOrder.userId), 268.4);
});

console.log('\n[2] A COD order refunds to the wallet; customer fault leaves the seller whole');

const codOrder = await makeOrder({ method: 'cash', status: 'paid' });
const remorse = await openReturn(codOrder, ATTA, 'changed_mind');
await inspect(remorse);
await check('the refund is paid to the wallet, once, however many times Refund is pressed', async () => {
    await Promise.allSettled([
        returns.refundReturn({ returnId: remorse._id }),
        returns.refundReturn({ returnId: remorse._id }),
    ]);
    assert.equal(await walletBalance(codOrder.userId), 118);
});
await check('the ledger records it without debiting the seller', async () => {
    const a = await ledger(codOrder._id);
    assert.equal(a.restaurantShare, 200);
    assert.equal(a.refundedAmount, 118);
    assert.equal(a.taxAmount, r2(28.4 - 18));
    assert.equal(ledgerBalances(a), r2(a.totalCustomerPaid - a.refundedAmount));
});

console.log('\n[3] A Razorpay refund that fails leaves the return payable');

const cardOrder = await makeOrder({ method: 'razorpay', status: 'paid', razorpay: { paymentId: 'pay_TEST123' } });
const broken = await openReturn(cardOrder, ATTA, 'damaged');
await inspect(broken);
await check('the gateway failure is reported, not recorded as paid', async () => {
    // No Razorpay keys in the test environment, so the gateway refund cannot succeed.
    await assert.rejects(() => returns.refundReturn({ returnId: broken._id }));
    const doc = await QCReturn.findById(broken._id).lean();
    assert.equal(doc.status, 'inspected');
    assert.equal((await ledger(cardOrder._id)).refundedAmount || 0, 0);
});
await check('it can then be paid to the wallet instead', async () => {
    await returns.refundReturn({ returnId: broken._id, refundTo: 'wallet' });
    assert.equal(await walletBalance(cardOrder.userId), 163.4);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
