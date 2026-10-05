/**
 * A prescription order is not prepared until the customer has agreed to the
 * pharmacy's bill, and paid it if they are paying online.
 *
 * Run: node tests/prescription-bill-payment.smoke.mjs
 *
 * A prescription order is placed with no price: the customer photographs a
 * prescription and the pharmacist decides what it comes to. That leaves an
 * order everyone is committed to at a figure the customer has never seen --
 * the pharmacist could price it, accept it and send a rider, and the customer
 * would first learn the amount when the medicines arrived.
 *
 * The bill closes that gap: the pharmacist submits the paper bill and its
 * total, and the order cannot be prepared until the customer approves it.
 * Paying online approves it only when the payment verifies, so an abandoned
 * payment sheet commits nobody.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri();
await mongoose.connect(server.getUri(), { dbName: 'prescription_bill' });

const { FoodOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const { FoodRestaurant } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');
const bill = await import('../src/modules/quickCommerce/modules/food/orders/services/prescriptionOrder.service.js');
const rules = await import('../src/modules/quickCommerce/modules/food/shared/prescriptionOrder.js');
const orders = await import('../src/modules/quickCommerce/modules/food/orders/services/order.service.js');

let failures = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  ok   ${label}`);
    } catch (err) {
        failures += 1;
        console.log(`  FAIL ${label}\n       ${err.message}`);
    }
};
const rejects = async (promise, pattern) => {
    let threw = null;
    try { await promise; } catch (err) { threw = err; }
    assert.ok(threw, 'expected this to be refused');
    assert.match(threw.message, pattern);
    return threw;
};

const pharmacy = await FoodRestaurant.create({
    restaurantName: 'City Chemist', ownerName: 'Owner', status: 'approved', storeType: 'pharmacy',
    email: `chemist${Date.now()}@example.com`, phone: `9${String(Date.now()).slice(-9)}`,
    location: { type: 'Point', coordinates: [75.88, 22.72] },
});
const userId = new mongoose.Types.ObjectId();

let seq = 0;
/** An order as createPrescriptionOrder leaves it: a photo, no items, no price. */
const placeOrder = async (overrides = {}) => {
    const _id = new mongoose.Types.ObjectId();
    await FoodOrder.collection.insertOne({
        _id,
        order_id: `QC-RX-${++seq}`,
        userId,
        restaurantId: pharmacy._id,
        items: [],
        prescriptionOnly: true,
        prescription: {
            required: true,
            imageUrl: 'https://example.com/rx.jpg',
            uploadedAt: new Date(),
            status: 'approved',
            bill: { status: 'none', amount: 0, imageUrl: '' },
        },
        pricing: { subtotal: 0, total: 0 },
        payment: { method: 'cash', status: 'cod_pending', amountDue: 0 },
        orderStatus: 'created',
        deliveryAddress: { street: 'A', city: 'Indore', state: 'MP', zipCode: '452001', phone: '9999999999' },
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    });
    return _id;
};
const load = (id) => FoodOrder.findById(id).lean();
const submit = (id, dto) => bill.submitPrescriptionBill(String(id), String(pharmacy._id), dto);
const goodBill = { billImageUrl: 'https://example.com/bill.jpg', billAmount: 850 };

console.log('\nthe pharmacist submits the paper bill');
const cashOrder = await placeOrder();
await submit(cashOrder, goodBill);
await check('the bill and its photo are stored against the order', async () => {
    const doc = await load(cashOrder);
    assert.equal(doc.prescription.bill.amount, 850);
    assert.equal(doc.prescription.bill.imageUrl, 'https://example.com/bill.jpg');
    assert.equal(doc.prescription.bill.status, 'submitted');
});
await check('the medicines are the bill total, and the order now has a payable amount', async () => {
    const doc = await load(cashOrder);
    assert.equal(doc.pricing.subtotal, 850);
    assert.ok(doc.pricing.total >= 850, `total ${doc.pricing.total} is below the bill`);
});
await check('a bill with no photo is refused -- a typed figure with no document is one person\'s word', async () =>
    rejects(submit(await placeOrder(), { billAmount: 500 }), /photo of the pharmacy bill/));
await check('a bill with no amount is refused', async () =>
    rejects(submit(await placeOrder(), { billImageUrl: 'https://example.com/b.jpg' }), /Enter the bill amount/));
await check('a mistyped row of zeros is refused rather than charged', async () =>
    rejects(submit(await placeOrder(), { billImageUrl: 'x', billAmount: 8500000 }), /raised with support/));
await check('a prescription that was never verified cannot be billed', async () => {
    const unverified = await placeOrder({
        prescription: { required: true, imageUrl: 'x', status: 'pending_review', bill: { status: 'none' } },
    });
    await rejects(submit(unverified, goodBill), /Verify the prescription/);
});

console.log('\nTHE GATE: what the pharmacy may do before the customer answers');
await check('the order cannot be accepted while the bill is unanswered', async () => {
    const doc = await load(cashOrder);
    assert.throws(() => rules.assertBillApproved(doc, 'confirmed'), /has not approved the bill/);
});
await check('nor prepared, nor marked ready', async () => {
    const doc = await load(cashOrder);
    for (const next of ['preparing', 'ready_for_pickup']) {
        assert.throws(() => rules.assertBillApproved(doc, next), /has not approved/, `status ${next}`);
    }
});
await check('cancelling stays available, so an unaffordable bill is never a trap', async () => {
    const doc = await load(cashOrder);
    assert.doesNotThrow(() => rules.assertBillApproved(doc, 'cancelled_by_user'));
});

console.log('\nthe customer approves it, paying cash');
await bill.approvePrescriptionBill(String(cashOrder), String(userId), { paymentMethod: 'cash' });
await check('the bill is approved and the order may now be prepared', async () => {
    const doc = await load(cashOrder);
    assert.equal(doc.prescription.bill.status, 'approved');
    assert.ok(doc.prescription.bill.approvedAt);
    assert.doesNotThrow(() => rules.assertBillApproved(doc, 'confirmed'));
});
await check('approving twice changes nothing -- a double tap is not a second agreement', async () => {
    const before = await load(cashOrder);
    await bill.approvePrescriptionBill(String(cashOrder), String(userId), { paymentMethod: 'cash' });
    const after = await load(cashOrder);
    assert.equal(String(after.prescription.bill.approvedAt), String(before.prescription.bill.approvedAt));
});
await check('the pharmacy cannot re-bill an approved order at a new amount', async () =>
    rejects(submit(cashOrder, { billImageUrl: 'x', billAmount: 9000 }), /already been approved/));

console.log('\nthe customer declines a bill');
const declined = await placeOrder();
await submit(declined, goodBill);
await bill.declinePrescriptionBill(String(declined), String(userId), { reason: 'Too expensive' });
await check('the order is cancelled with the reason kept', async () => {
    const doc = await load(declined);
    assert.equal(doc.prescription.bill.status, 'rejected');
    assert.equal(doc.orderStatus, 'cancelled_by_user');
    assert.equal(doc.prescription.bill.declineReason, 'Too expensive');
});
await check('and it still cannot be prepared', async () => {
    const doc = await load(declined);
    assert.throws(() => rules.assertBillApproved(doc, 'confirmed'), /declined the bill/);
});

console.log('');
console.log('an order from a pharmacy still on the old app build');
await check('priced the old way with no bill, it is not stranded by the new gate', async () => {
    // fill() prices without a bill. Refusing those here would freeze every
    // order placed before this shipped, and every order from an un-updated
    // pharmacy after it -- while assertPrescriptionOrderPriced still refuses
    // an order nobody has priced at all.
    const legacy = { prescriptionOnly: true, items: [{ name: 'Medicine', quantity: 1, price: 100 }],
        pricing: { total: 140 }, prescription: { status: 'approved', bill: { status: 'none' } } };
    assert.doesNotThrow(() => rules.assertBillApproved(legacy, 'confirmed'));
    assert.throws(
        () => rules.assertPrescriptionOrderPriced({ ...legacy, items: [], pricing: { total: 0 } }, 'confirmed'),
        /Enter the medicines and price/,
    );
});

console.log('\nwhat an unpaid online approval does NOT do');
const onlineOrder = await placeOrder();
await submit(onlineOrder, goodBill);
await check('THE POINT: opening the payment sheet does not approve the bill', async () => {
    // No gateway is configured in a test run, which is the same refusal a
    // customer meets when it is down -- either way nothing may be approved
    // without a verified payment.
    try {
        await bill.approvePrescriptionBill(String(onlineOrder), String(userId), { paymentMethod: 'razorpay' });
    } catch { /* gateway unavailable here; the assertion below is the point */ }
    const doc = await load(onlineOrder);
    assert.notEqual(doc.prescription.bill.status, 'approved');
    assert.throws(() => rules.assertBillApproved(doc, 'confirmed'), /has not approved|Upload the pharmacy/);
});

console.log('\nan ordinary catalogue order is untouched by any of this');
await check('it has no bill to approve, and the gate lets it through', () => {
    const catalogueOrder = { prescriptionOnly: false, prescription: { bill: { status: 'none' } } };
    assert.doesNotThrow(() => rules.assertBillApproved(catalogueOrder, 'confirmed'));
});

console.log('');
console.log('the customer opens the payment sheet and wanders off');
await check('THE BUG: the order is put back, not deleted with the prescription in it', async () => {
    const abandoned = await placeOrder();
    await submit(abandoned, goodBill);
    // Exactly what an abandoned online approval leaves behind.
    await FoodOrder.collection.updateOne(
        { _id: abandoned },
        {
            $set: {
                orderStatus: 'pending_payment',
                'payment.method': 'razorpay',
                'payment.status': 'created',
                'payment.razorpay': { orderId: 'order_stale', paymentId: '', signature: '' },
            },
        },
    );
    await orders.expirePendingPaymentOrder({ _id: abandoned, prescriptionOnly: true });

    const doc = await load(abandoned);
    assert.ok(doc, 'the order was deleted -- the prescription and the bill went with it');
    assert.equal(doc.orderStatus, 'created');
    assert.equal(doc.prescription.status, 'approved', 'the verification survived');
    assert.equal(doc.prescription.bill.status, 'submitted', 'the bill is still waiting to be answered');
    assert.equal(doc.prescription.bill.amount, 850);
    // The stale gateway order is cleared so the next attempt mints a fresh one
    // rather than reusing an order the gateway has since expired.
    assert.equal(doc.payment.razorpay.orderId, '');
});
await check('an ordinary abandoned cart order is still deleted', async () => {
    const cartOrder = new mongoose.Types.ObjectId();
    await FoodOrder.collection.insertOne({
        _id: cartOrder,
        order_id: 'QC-CART-1',
        userId,
        restaurantId: pharmacy._id,
        items: [{ name: 'Thing', quantity: 1, price: 50 }],
        prescriptionOnly: false,
        pricing: { subtotal: 50, total: 50 },
        payment: { method: 'razorpay', status: 'created', razorpay: { orderId: 'order_x' } },
        orderStatus: 'pending_payment',
        createdAt: new Date(),
        updatedAt: new Date(),
    });
    await orders.expirePendingPaymentOrder({
        _id: cartOrder,
        orderStatus: 'pending_payment',
        payment: { status: 'created' },
        prescriptionOnly: false,
    });
    assert.equal(await FoodOrder.findById(cartOrder).lean(), null);
});

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} FAILED\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
