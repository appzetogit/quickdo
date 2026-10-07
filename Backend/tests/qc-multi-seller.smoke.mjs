/**
 * Quick commerce multi-seller cart (plan §5.1).
 *
 * Run: node tests/qc-multi-seller.smoke.mjs
 *
 * One basket with items from two stores, against the real createOrder on an
 * in-memory Mongo:
 *  - the shared delivery fee, platform fee and coupon are split by item value
 *    to the paisa, kept on each child, and add back to the parent exactly;
 *  - one parent, one child per store, each its own order (store acceptance,
 *    rider, tracking); a single-store basket keeps the old shape;
 *  - one coupon claim and one wallet debit for the whole checkout;
 *  - cancelling one child refunds exactly that child's share, once, through
 *    the shared idempotent refundGatewayPayment, and leaves the other alone;
 *  - the customer's list groups the children under the parent on request.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.DELIVERY_DISTANCE_SOURCE = 'straight';
process.env.RAZORPAY_WEBHOOK_SECRET = 'multi-seller-webhook-secret';
process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
    }
};

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
await mongoose.connect(replSet.getUri('qc_multi_seller'));

const BASE = '../src/modules/quickCommerce/modules/food';
const { splitProRata, splitProRataInt } = await import('../src/core/orders/proRata.js');
const { ParentOrder } = await import('../src/core/orders/parentOrder.model.js');
const { FoodRestaurant } = await import(`${BASE}/restaurant/models/restaurant.model.js`);
const { FoodItem } = await import(`${BASE}/admin/models/food.model.js`);
const { FoodFeeSettings } = await import(`${BASE}/admin/models/feeSettings.model.js`);
const { QCZone } = await import(`${BASE}/admin/models/zone.model.js`);
const { FoodOffer } = await import(`${BASE}/admin/models/offer.model.js`);
const { FoodOfferUsage } = await import(`${BASE}/admin/models/offerUsage.model.js`);
const { FoodUser } = await import('../src/modules/quickCommerce/core/users/user.model.js');
const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);
const orders = await import(`${BASE}/orders/services/order.service.js`);
const multi = await import(`${BASE}/orders/services/order-multistore.service.js`);
const refunds = await import('../src/core/payments/refund.service.js');
const { Refund } = await import('../src/core/payments/models/refund.model.js').catch(async () => ({ Refund: mongoose.models.Refund }));

const gatewayCalls = [];
let seq = 0;
refunds.__setRefundGatewayForTests(async (req) => {
    gatewayCalls.push(req);
    return { id: `rfnd_${++seq}`, status: 'processed', payment_id: req.gatewayPaymentId, amount: req.amountPaise };
});

console.log('\n[1] pro-rata split');

await check('splits to the paisa and adds back exactly', async () => {
    assert.deepEqual(splitProRata(10, [1, 1, 1]), [3.34, 3.33, 3.33]);
    assert.deepEqual(splitProRata(30, [300, 100]), [22.5, 7.5]);
    const parts = splitProRata(17.03, [123.45, 67.8, 9.99]);
    assert.equal(Math.round(parts.reduce((a, b) => a + b, 0) * 100), 1703);
});
await check('zero weights split evenly; a zero total splits to zeros', async () => {
    assert.deepEqual(splitProRata(1, [0, 0]), [0.5, 0.5]);
    assert.deepEqual(splitProRata(0, [5, 7]), [0, 0]);
    assert.deepEqual(splitProRataInt(7, [1, 1]), [4, 3]);
});

// ---------------------------------------------------------------- fixtures
const HERE = { lat: 22.72, lng: 75.88 };
const point = ({ lat, lng }) => ({ type: 'Point', coordinates: [lng, lat] });
const zone = await QCZone.create({
    name: 'Indore', country: 'India', isActive: true,
    coordinates: [
        { latitude: 22.6, longitude: 75.7 }, { latitude: 22.6, longitude: 76.0 },
        { latitude: 22.9, longitude: 76.0 }, { latitude: 22.9, longitude: 75.7 },
    ],
});
await FoodFeeSettings.create({ deliveryFee: 30, deliveryFeeRanges: [], platformFee: 6, gstRate: 0, isActive: true });

const allDay = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const store = (name, phone, lng) => FoodRestaurant.create({
    restaurantName: name, ownerName: 'Owner', ownerPhone: phone, status: 'approved', zoneId: zone._id,
    isAcceptingOrders: true, isActive: true, openingTime: '00:00', closingTime: '23:59', openDays: allDay,
    location: { type: 'Point', coordinates: [lng, HERE.lat], latitude: HERE.lat, longitude: lng, addressLine1: `${name} road` },
});
const kirana = await store('Corner Kirana', '9000000101', 75.881);
const dairy = await store('Fresh Dairy', '9000000102', 75.882);
const rice = await FoodItem.create({ restaurantId: kirana._id, name: 'Rice 5kg', price: 300, gstRate: 0, approvalStatus: 'approved' });
const milk = await FoodItem.create({ restaurantId: dairy._id, name: 'Milk 1L', price: 100, gstRate: 0, approvalStatus: 'approved' });

const customer = await FoodUser.create({ name: 'Asha', phone: '9876501234' });
const uid = String(customer._id);
const address = {
    label: 'Home', street: '12 MG Road', city: 'Indore', state: 'MP', phone: '9876501234',
    location: point({ lat: HERE.lat + 0.01, lng: HERE.lng }),
};
const basket = (extra = {}) => ({
    items: [
        { itemId: String(rice._id), name: 'Rice 5kg', price: 300, quantity: 1, storeId: String(kirana._id) },
        { itemId: String(milk._id), name: 'Milk 1L', price: 100, quantity: 1, storeId: String(dairy._id) },
    ],
    address,
    paymentMethod: 'cash',
    ...extra,
});

await FoodOffer.create({
    couponCode: 'SAVE40', title: 'Save 40', discountType: 'flat-price', discountValue: 40, status: 'active',
    minOrderValue: 0, perUserLimit: 1, usageLimit: 0, createdByRole: 'ADMIN', showInCart: true,
}).catch((err) => console.log('  (offer fixture)', err.message));

console.log('\n[2] cash checkout across two stores');

let cashResult;
await check('one parent, one child per store', async () => {
    cashResult = await orders.createOrder(uid, basket({ couponCode: 'SAVE40' }));
    assert.equal(cashResult.parentOrder?.isMultiStore, true, JSON.stringify(cashResult).slice(0, 300));
    assert.equal(cashResult.orders.length, 2);
    const kids = await FoodOrder.find({ parentOrderId: cashResult.parentOrder.parentOrderId }).lean();
    assert.equal(kids.length, 2);
    assert.deepEqual(kids.map((k) => String(k.restaurantId)).sort(), [String(kirana._id), String(dairy._id)].sort());
    for (const k of kids) {
        assert.equal(k.orderStatus, 'created', 'each child waits for its own store');
        assert.equal(k.dispatch.status, 'unassigned');
    }
});

await check('delivery fee, platform fee and coupon split 3:1 by item value, kept on each child', async () => {
    const kids = await FoodOrder.find({ parentOrderId: cashResult.parentOrder.parentOrderId }).lean();
    const k = kids.find((x) => String(x.restaurantId) === String(kirana._id));
    const d = kids.find((x) => String(x.restaurantId) === String(dairy._id));
    assert.equal(k.pricing.deliveryFee, 22.5);
    assert.equal(d.pricing.deliveryFee, 7.5);
    assert.equal(k.pricing.platformFee, 4.5);
    assert.equal(d.pricing.platformFee, 1.5);
    assert.equal(k.pricing.discount, 30);
    assert.equal(d.pricing.discount, 10);
    assert.equal(k.parentSplit.discount, 30);
    assert.equal(d.parentSplit.deliveryFee, 7.5);
    assert.equal(k.pricing.couponCode, 'SAVE40');
});

await check('the parent adds up its children exactly and holds the one coupon', async () => {
    const parent = await ParentOrder.findById(cashResult.parentOrder.parentOrderId).lean();
    const kids = await FoodOrder.find({ parentOrderId: parent._id }).lean();
    const sum = kids.reduce((a, k) => a + k.pricing.total, 0);
    assert.equal(parent.pricing.total, Math.round(sum * 100) / 100);
    assert.equal(parent.pricing.deliveryFee, 30, 'one delivery fee for the basket');
    assert.equal(parent.pricing.discount, 40);
    assert.equal(parent.split.length, 2);
    assert.equal(parent.payment.status, 'cod_pending');
    const usage = await FoodOfferUsage.findOne({ userId: customer._id }).lean();
    assert.equal(usage?.count, 1, 'the coupon is used once, not once per store');
    const offer = await FoodOffer.findOne({ couponCode: 'SAVE40' }).lean();
    assert.equal(offer.usedCount, 1);
});

await check('a single-store basket keeps the old shape (no parent)', async () => {
    const single = await orders.createOrder(uid, {
        restaurantId: String(kirana._id),
        items: [{ itemId: String(rice._id), name: 'Rice 5kg', price: 300, quantity: 1 }],
        address, paymentMethod: 'cash',
    });
    assert.ok(single.order.orderMongoId);
    assert.ok(!single.parentOrder);
    const row = await FoodOrder.findById(single.order.orderMongoId).lean();
    assert.equal(row.parentOrderId, null);
    assert.equal(row.pricing.deliveryFee, 30);
});

await check('the customer list groups the children under the parent on request', async () => {
    const flat = await orders.listOrdersUser(uid, { limit: 20 });
    const rows = flat.data || flat.docs || flat.items || [];
    assert.ok(rows.some((r) => r.parentOrderId), 'children still listed with parentOrderId');
    const grouped = await orders.listOrdersUser(uid, { limit: 20, groupByParent: 'true' });
    const g = grouped.data || grouped.docs || grouped.items || [];
    const entry = g.find((r) => r.isMultiStore);
    assert.ok(entry, JSON.stringify(g).slice(0, 300));
    assert.equal(entry.children.length, 2);
    const detail = await multi.getParentOrderForUser(uid, entry.parentOrderId);
    assert.equal(detail.children.length, 2);
});

console.log('\n[3] one online payment, per-child refund');

let online;
await check('an online checkout leaves every child waiting for the one payment', async () => {
    online = await orders.createOrder(uid, basket({ paymentMethod: 'razorpay' }));
    const kids = await FoodOrder.find({ parentOrderId: online.parentOrder.parentOrderId }).lean();
    assert.equal(kids.length, 2);
    for (const k of kids) assert.equal(k.orderStatus, 'pending_payment');
});

await check('settling the parent marks every child paid with the shared payment id', async () => {
    const parent = await ParentOrder.findById(online.parentOrder.parentOrderId);
    parent.payment.razorpay = { orderId: 'order_multi_1', paymentId: '', signature: '' };
    await parent.save();
    await multi.settleParentPayment(parent, { razorpayPaymentId: 'pay_multi_1', userId: uid });
    const kids = await FoodOrder.find({ parentOrderId: parent._id }).lean();
    for (const k of kids) {
        assert.equal(k.payment.status, 'paid');
        assert.equal(k.payment.razorpay.paymentId, 'pay_multi_1');
        assert.equal(k.orderStatus, 'created');
    }
    const again = await multi.handleParentCapture({ rzOrderId: 'order_multi_1', rzPaymentId: 'pay_multi_1', amountPaise: Math.round(parent.pricing.total * 100) });
    assert.equal(again, true, 'a redelivered capture is recognised and changes nothing');
});

await check('cancelling one child refunds exactly its share, once; the other child is untouched', async () => {
    const kids = await FoodOrder.find({ parentOrderId: online.parentOrder.parentOrderId }).lean();
    const dairyChild = kids.find((x) => String(x.restaurantId) === String(dairy._id));
    const kiranaChild = kids.find((x) => String(x.restaurantId) === String(kirana._id));
    await orders.cancelOrder(String(dairyChild._id), uid, 'changed my mind');
    const calls = gatewayCalls.filter((c) => c.gatewayPaymentId === 'pay_multi_1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].amountPaise, Math.round(dairyChild.pricing.total * 100));
    const after = await FoodOrder.findById(dairyChild._id).lean();
    assert.equal(after.payment.status, 'refunded');
    const other = await FoodOrder.findById(kiranaChild._id).lean();
    assert.equal(other.payment.status, 'paid');
    assert.equal(other.orderStatus, 'created');
    const row = await mongoose.connection.collection('refunds').findOne({ idempotencyKey: `qc:order_refund:${dairyChild._id}` });
    assert.ok(row, 'the refund row is keyed on the child');
    assert.equal(row.amount, dairyChild.pricing.total);
});

await check('refunding the same child again does not call the gateway again', async () => {
    const kids = await FoodOrder.find({ parentOrderId: online.parentOrder.parentOrderId }).lean();
    const dairyChild = kids.find((x) => String(x.restaurantId) === String(dairy._id));
    const before = gatewayCalls.length;
    const r = await refunds.refundGatewayPayment({
        vertical: 'quickCommerce', gatewayPaymentId: 'pay_multi_1', amount: dairyChild.pricing.total,
        idempotencyKey: `qc:order_refund:${dairyChild._id}`, orderId: dairyChild._id,
    });
    assert.equal(gatewayCalls.length, before);
    assert.ok(r.success || r.inProgress || r.alreadyProcessed || r.refundId, JSON.stringify(r));
});

await check('the Razorpay webhook settles a parent: every child paid, nothing marked failed', async () => {
    const { handleRazorpayWebhook } = await import('../src/core/payments/controllers/razorpayWebhook.controller.js');
    const res2 = await orders.createOrder(uid, basket({ paymentMethod: 'razorpay' }));
    const parent = await ParentOrder.findById(res2.parentOrder.parentOrderId);
    parent.payment.razorpay = { orderId: 'order_multi_hook', paymentId: '', signature: '' };
    await parent.save();
    const body = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_multi_hook', order_id: 'order_multi_hook', amount: Math.round(parent.pricing.total * 100) } } } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
    const out = await new Promise((resolve) => {
        const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); return this; }, send(b) { resolve({ code: this.statusCode, body: b }); return this; } };
        handleRazorpayWebhook({ headers: { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'evt_multi_1' }, body, rawBody }, res);
    });
    assert.equal(out.code, 200, JSON.stringify(out.body));
    const kids = await FoodOrder.find({ parentOrderId: parent._id }).lean();
    for (const k of kids) {
        assert.equal(k.payment.status, 'paid');
        assert.equal(k.orderStatus, 'created');
    }
    assert.equal((await ParentOrder.findById(parent._id).lean()).payment.status, 'paid');
});

await check('abandoning the payment sheet cancels every waiting child and the parent', async () => {
    const res3 = await orders.createOrder(uid, basket({ paymentMethod: 'razorpay' }));
    const out = await orders.abandonOnlinePaymentOrder(uid, res3.parentOrder.orderNumber);
    assert.equal(out.deleted, true);
    const kids = await FoodOrder.find({ parentOrderId: res3.parentOrder.parentOrderId }).lean();
    for (const k of kids) assert.equal(k.orderStatus, 'cancelled_by_user');
    assert.equal((await ParentOrder.findById(res3.parentOrder.parentOrderId).lean()).status, 'cancelled');
});

console.log('\n[4] wallet: one debit for the whole checkout');

await check('a wallet checkout debits the parent total once', async () => {
    const { FoodUserWallet } = await import(`${BASE}/user/models/userWallet.model.js`);
    const wallets = await import(`${BASE}/user/services/userWallet.service.js`);
    await wallets.refundWalletBalance(uid, 1000, 'test top-up');
    const before = (await wallets.getUserWallet(uid)).balance;
    const res = await orders.createOrder(uid, basket({ paymentMethod: 'wallet' }));
    const after = (await wallets.getUserWallet(uid)).balance;
    const parent = await ParentOrder.findById(res.parentOrder.parentOrderId).lean();
    assert.equal(Math.round((before - after) * 100), Math.round(parent.pricing.total * 100));
    assert.equal(parent.payment.status, 'paid');
    const kids = await FoodOrder.find({ parentOrderId: parent._id }).lean();
    for (const k of kids) assert.equal(k.payment.status, 'paid');
    void FoodUserWallet;
});

await check('a store that cannot take the order rolls the whole checkout back', async () => {
    await FoodRestaurant.updateOne({ _id: dairy._id }, { $set: { isAcceptingOrders: false } });
    const before = await FoodOrder.countDocuments({});
    await assert.rejects(() => orders.createOrder(uid, basket()), /offline|closed|not taking/i);
    const live = await FoodOrder.countDocuments({ orderStatus: { $nin: ['cancelled_by_user'] } });
    const created = await FoodOrder.countDocuments({});
    assert.ok(created - before <= 1);
    assert.ok(live <= before, 'no live child left behind');
    const failedParent = await ParentOrder.findOne({ status: 'failed' }).lean();
    assert.ok(failedParent);
    await FoodRestaurant.updateOne({ _id: dairy._id }, { $set: { isAcceptingOrders: true } });
});

void Refund;
refunds.__setRefundGatewayForTests(null);
await mongoose.disconnect();
await replSet.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
