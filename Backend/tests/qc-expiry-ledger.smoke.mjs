/**
 * An order the seller never accepted is refunded AND the ledger says so.
 *
 * Run: node tests/qc-expiry-ledger.smoke.mjs
 *
 * expireUnacceptedOrders() cancels an order the seller let time out and refunds it,
 * but never told the ledger: the transaction stayed 'captured', so the admin
 * transaction report kept counting money that had already gone back to the customer.
 * Every other cancel path syncs the transaction; this one did not.
 *
 * Drives the real expireUnacceptedOrderById() against an in-memory Mongo.
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

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'qc_expiry_ledger' });

const BASE = '../src/modules/quickCommerce/modules/food';
const orders = await import(`${BASE}/orders/services/order.service.js`);
const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);
const { FoodTransaction } = await import(`${BASE}/orders/models/foodTransaction.model.js`);
const { createInitialTransaction } = await import(`${BASE}/orders/services/foodTransaction.service.js`);
const { FoodUserWallet } = await import(`${BASE}/user/models/userWallet.model.js`);

const id = () => new mongoose.Types.ObjectId();

const unaccepted = async (payment) => {
    const order = await FoodOrder.create({
        userId: id(),
        restaurantId: id(),
        items: [{ itemId: String(id()), name: 'Atta 1kg', quantity: 1, price: 200, variantPrice: 200 }],
        deliveryAddress: {
            street: '1 MG Road', city: 'Bengaluru', state: 'KA',
            location: { type: 'Point', coordinates: [77.61, 12.91] },
        },
        pricing: { subtotal: 200, tax: 10, deliveryFee: 30, deliveryFeeGst: 5.4, platformFee: 5, total: 250.4 },
        payment: { amountDue: 250.4, ...payment },
        riderEarning: 25,
        orderStatus: 'created',
        acceptanceDeadlineAt: new Date(Date.now() - 60_000),
    });
    await createInitialTransaction(order.toObject());
    return order;
};

console.log('\n[1] an online-paid order the seller let time out');

const paid = await unaccepted({ method: 'wallet', status: 'paid' });
await check('the ledger started out captured', async () => {
    assert.equal((await FoodTransaction.findOne({ orderId: paid._id }).lean()).status, 'captured');
});

await orders.expireUnacceptedOrderById(paid._id);

await check('the order is cancelled and the customer refunded', async () => {
    const o = await FoodOrder.findById(paid._id).lean();
    assert.equal(o.orderStatus, 'cancelled_by_restaurant');
    assert.equal(o.payment.status, 'refunded');
    const wallet = await FoodUserWallet.findOne({ userId: paid.userId }).lean();
    assert.equal(wallet?.balance, 250.4);
});

await check('the ledger is marked refunded, so reports stop counting it as earned', async () => {
    const tx = await FoodTransaction.findOne({ orderId: paid._id }).lean();
    assert.equal(tx.status, 'refunded', `transaction still ${tx.status}`);
    assert.ok(tx.history.some((h) => /not accepted/i.test(h.note || '')), 'no history entry for the expiry');
});

console.log('\n[2] a COD order the seller let time out');

const cod = await unaccepted({ method: 'cash', status: 'cod_pending' });
await orders.expireUnacceptedOrderById(cod._id);
await check('nothing was collected, so the ledger is closed as failed, not refunded', async () => {
    const tx = await FoodTransaction.findOne({ orderId: cod._id }).lean();
    assert.equal(tx.status, 'failed', `transaction ${tx.status}`);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
