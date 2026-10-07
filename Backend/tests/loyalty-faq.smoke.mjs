/**
 * Loyalty points and FAQs, shared by every vertical (plan §5.7, §5.8).
 *
 * Run: node tests/loyalty-faq.smoke.mjs
 *
 * Loyalty: off by default; earn on a delivered order once however often the
 * hook runs; redemption clamped to the balance and to the admin's share of the
 * order; points expire; a cancelled order gives its points back once; and a
 * quick-commerce checkout really takes the points off the bill.
 *
 * FAQs: the public list carries one vertical's active questions plus the
 * general ones, in the admin's order, and nothing else.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.DELIVERY_DISTANCE_SOURCE = 'straight';
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

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri('loyalty_faq'));

const loyalty = await import('../src/core/loyalty/loyalty.service.js');
const { LoyaltyLedger } = await import('../src/core/loyalty/loyaltyLedger.model.js');
const config = await import('../src/core/config/resolver.service.js');
const faq = await import('../src/core/faq/faq.service.js');

const { FoodUser: PlatformUser } = await import('../src/core/users/user.model.js');
const { FoodUser: QcUser } = await import('../src/modules/quickCommerce/core/users/user.model.js');

const platform = await PlatformUser.create({ name: 'Meera', phone: '9876503456' });
const qcSelf = await QcUser.create({ name: 'Meera', phone: '9876503456', platformUserId: platform._id });
const orderId = () => String(new mongoose.Types.ObjectId());

console.log('\n[1] loyalty rules');

await check('off by default: nothing is earned or redeemable', async () => {
    const r = await loyalty.earnForOrder({ customerId: String(qcSelf._id), vertical: 'quickCommerce', orderId: orderId(), amount: 500 });
    assert.equal(r.earned, 0);
    const q = await loyalty.quoteRedemption({ customerId: String(qcSelf._id), vertical: 'quickCommerce', points: 10, orderValue: 500 });
    assert.equal(q.points, 0);
});

await loyalty.saveLoyaltySettings({ enabled: true, pointsPerRupee: 0.1, rupeesPerPoint: 1, maxRedeemPercent: 10, expiryDays: 30 });

const earnId = orderId();
await check('earn on delivery: 1 point per Rs 10, idempotent per order', async () => {
    const a = await loyalty.earnForOrder({ customerId: String(qcSelf._id), vertical: 'quickCommerce', orderId: earnId, amount: 1000 });
    const b = await loyalty.earnForOrder({ customerId: String(qcSelf._id), vertical: 'quickCommerce', orderId: earnId, amount: 1000 });
    assert.equal(a.earned, 100);
    assert.equal(b.duplicate, true);
    assert.equal(await LoyaltyLedger.countDocuments({ type: 'earn' }), 1);
    assert.equal(await loyalty.balanceOf(String(qcSelf._id)), 100);
});

await check('points belong to the platform account: Food sees what Quick earned', async () => {
    assert.equal(await loyalty.balanceOf(String(platform._id)), 100);
});

await check('redemption is capped at the admin share of the order and at the balance', async () => {
    const capped = await loyalty.quoteRedemption({ customerId: String(qcSelf._id), vertical: 'quickCommerce', points: 80, orderValue: 300 });
    assert.equal(capped.points, 30, '10% of 300 at Rs 1 a point');
    assert.equal(capped.discount, 30);
    assert.equal(capped.capped, true);
    const byBalance = await loyalty.quoteRedemption({ customerId: String(qcSelf._id), vertical: 'quickCommerce', points: 500, orderValue: 100000 });
    assert.equal(byBalance.points, 100);
});

await check('a burn is all-or-nothing and idempotent; a reversal returns the points once', async () => {
    await assert.rejects(() => loyalty.burnPoints({ customerId: String(qcSelf._id), vertical: 'quickCommerce', points: 500, key: 'too-much' }), /Not enough/);
    assert.equal(await loyalty.balanceOf(String(qcSelf._id)), 100, 'a failed burn takes nothing');
    await loyalty.burnPoints({ customerId: String(qcSelf._id), vertical: 'quickCommerce', points: 40, key: 'o1' });
    const again = await loyalty.burnPoints({ customerId: String(qcSelf._id), vertical: 'quickCommerce', points: 40, key: 'o1' });
    assert.equal(again.duplicate, true);
    assert.equal(await loyalty.balanceOf(String(qcSelf._id)), 60);
    await loyalty.reverseBurn({ customerId: String(qcSelf._id), vertical: 'quickCommerce', points: 40, key: 'o1' });
    await loyalty.reverseBurn({ customerId: String(qcSelf._id), vertical: 'quickCommerce', points: 40, key: 'o1' });
    assert.equal(await loyalty.balanceOf(String(qcSelf._id)), 100);
});

await check('points expire after the admin\'s days, once', async () => {
    const other = await PlatformUser.create({ name: 'Old', phone: '9876503999' });
    const longAgo = new Date(Date.now() - 40 * 86400000);
    await loyalty.earnForOrder({ customerId: String(other._id), vertical: 'food', orderId: orderId(), amount: 500, now: longAgo });
    assert.equal(await loyalty.balanceOf(String(other._id)), 0);
    assert.equal(await LoyaltyLedger.countDocuments({ userId: other._id, type: 'expire' }), 1);
    await loyalty.balanceOf(String(other._id));
    assert.equal(await LoyaltyLedger.countDocuments({ userId: other._id, type: 'expire' }), 1, 'expired once');
    await assert.rejects(() => loyalty.burnPoints({ customerId: String(other._id), vertical: 'food', points: 1, key: 'old-1' }), /Not enough/);
});

console.log('\n[2] loyalty at a quick-commerce checkout');

const BASE = '../src/modules/quickCommerce/modules/food';
const { FoodRestaurant } = await import(`${BASE}/restaurant/models/restaurant.model.js`);
const { FoodItem } = await import(`${BASE}/admin/models/food.model.js`);
const { FoodFeeSettings } = await import(`${BASE}/admin/models/feeSettings.model.js`);
const { QCZone } = await import(`${BASE}/admin/models/zone.model.js`);
const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);
const orders = await import(`${BASE}/orders/services/order.service.js`);
const { awardQcOrderLoyalty } = await import(`${BASE}/orders/services/order-loyalty.service.js`);

const zone = await QCZone.create({
    name: 'Indore', country: 'India', isActive: true,
    coordinates: [
        { latitude: 22.6, longitude: 75.7 }, { latitude: 22.6, longitude: 76.0 },
        { latitude: 22.9, longitude: 76.0 }, { latitude: 22.9, longitude: 75.7 },
    ],
});
await FoodFeeSettings.create({ deliveryFee: 20, deliveryFeeRanges: [], platformFee: 0, gstRate: 0, isActive: true });
const shop = await FoodRestaurant.create({
    restaurantName: 'Corner Kirana', ownerName: 'Owner', ownerPhone: '9000000301', status: 'approved', zoneId: zone._id,
    isAcceptingOrders: true, isActive: true, openingTime: '00:00', closingTime: '23:59',
    openDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    location: { type: 'Point', coordinates: [75.88, 22.72], latitude: 22.72, longitude: 75.88 },
});
const oil = await FoodItem.create({ restaurantId: shop._id, name: 'Oil 1L', price: 200, gstRate: 0, approvalStatus: 'approved' });

let placed;
await check('asking for 50 points on a Rs 200 basket uses 20 (10%) and takes Rs 20 off', async () => {
    placed = await orders.createOrder(String(qcSelf._id), {
        restaurantId: String(shop._id),
        items: [{ itemId: String(oil._id), name: 'Oil 1L', price: 200, quantity: 1 }],
        address: { street: '1 MG Road', city: 'Indore', state: 'MP', location: { type: 'Point', coordinates: [75.881, 22.721] } },
        paymentMethod: 'cash',
        loyaltyPoints: 50,
    });
    const row = await FoodOrder.findById(placed.order.orderMongoId).lean();
    assert.equal(row.pricing.loyaltyPoints, 20);
    assert.equal(row.pricing.loyaltyDiscount, 20);
    assert.equal(row.pricing.total, 204, 'Rs 203.60 charged to the rupee');
    assert.equal(row.pricing.roundOff, 0.4);
    assert.equal(await loyalty.balanceOf(String(qcSelf._id)), 80);
});

await check('delivering it earns points once (on the value after points)', async () => {
    await FoodOrder.updateOne({ _id: placed.order.orderMongoId }, { $set: { orderStatus: 'delivered' } });
    const row = await FoodOrder.findById(placed.order.orderMongoId).lean();
    await awardQcOrderLoyalty(row);
    await awardQcOrderLoyalty(row);
    assert.equal(await LoyaltyLedger.countDocuments({ type: 'earn', orderId: row._id }), 1);
    assert.equal(await loyalty.balanceOf(String(qcSelf._id)), 98, '80 + 18 (Rs 180 at 0.1)');
    await FoodOrder.updateOne({ _id: row._id }, { $set: { orderStatus: 'created' } });
});

await check('a cancelled order gives the points back', async () => {
    const next = await orders.createOrder(String(qcSelf._id), {
        restaurantId: String(shop._id),
        items: [{ itemId: String(oil._id), name: 'Oil 1L', price: 200, quantity: 1 }],
        address: { street: '1 MG Road', city: 'Indore', state: 'MP', location: { type: 'Point', coordinates: [75.881, 22.721] } },
        paymentMethod: 'cash',
        loyaltyPoints: 20,
    });
    assert.equal(await loyalty.balanceOf(String(qcSelf._id)), 78);
    await orders.cancelOrder(next.order.orderMongoId, String(qcSelf._id), 'test');
    assert.equal(await loyalty.balanceOf(String(qcSelf._id)), 98);
});

console.log('\n[3] FAQs');

await check('the public list is one vertical plus general, active only, in order', async () => {
    await faq.createFaqAdmin({ vertical: 'quickCommerce', category: 'Orders', question: 'Q2', answer: 'A2', sortOrder: 2 });
    await faq.createFaqAdmin({ vertical: 'quickCommerce', category: 'Orders', question: 'Q1', answer: 'A1', sortOrder: 1 });
    await faq.createFaqAdmin({ vertical: 'quickCommerce', category: 'Orders', question: 'Hidden', answer: 'x', isActive: false });
    await faq.createFaqAdmin({ vertical: 'general', category: 'Account', question: 'G1', answer: 'g' });
    await faq.createFaqAdmin({ vertical: 'taxi', category: 'Rides', question: 'T1', answer: 't' });

    const quick = await faq.listPublicFaqs({ vertical: 'quick' });
    const qs = quick.faqs.map((f) => f.question);
    assert.deepEqual(qs.filter((q) => q.startsWith('Q')), ['Q1', 'Q2']);
    assert.ok(qs.includes('G1'));
    assert.ok(!qs.includes('Hidden'));
    assert.ok(!qs.includes('T1'));
    const only = await faq.listPublicFaqs({ vertical: 'quickCommerce', includeGeneral: false });
    assert.ok(!only.faqs.some((f) => f.question === 'G1'));
    assert.equal(only.categories[0].name, 'Orders');
});

await check('an unknown vertical is refused; edits and deletes work', async () => {
    await assert.rejects(() => faq.listPublicFaqs({ vertical: 'moon' }), /Unknown vertical/);
    const [first] = await faq.listFaqsAdmin({ vertical: 'taxi' });
    await faq.updateFaqAdmin(String(first._id), { isActive: false });
    assert.equal((await faq.listPublicFaqs({ vertical: 'taxi' })).faqs.some((f) => f.question === 'T1'), false);
    await faq.deleteFaqAdmin(String(first._id));
    assert.equal((await faq.listFaqsAdmin({ vertical: 'taxi' })).length, 0);
});

void config;
await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
