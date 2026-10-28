/**
 * Prescription-only orders: the customer can place one, and the pharmacist can price it.
 *
 * Run: node tests/qc-prescription-order.smoke.mjs
 *
 * Both halves were broken end to end, reproduced with the real services on an
 * in-memory Mongo:
 *
 *  - createPrescriptionOrder() saves an order with no items -- that is the whole point
 *    of it -- and the order schema refused any order with no items. No prescription
 *    order could ever be placed.
 *
 *  - fillPrescriptionOrder() stored the whole { deliveryFee, distanceKm, source }
 *    object from resolveUserDeliveryFee() as the delivery fee, so its GST came out 0,
 *    the total NaN and the save failed. Past that, it charged no item GST and booked
 *    no seller commission, where a catalogue order of the same goods pays both.
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
await mongoose.connect(mongo.getUri(), { dbName: 'qc_prescription_order' });

const BASE = '../src/modules/quickCommerce/modules/food';
const rx = await import(`${BASE}/orders/services/prescriptionOrder.service.js`);
const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);
const { FoodRestaurant } = await import(`${BASE}/restaurant/models/restaurant.model.js`);
// Medical draws its own zones now: a prescription order resolves against
// medical_zones, so a fixture in qc_zones would be invisible to it.
const { MedicalZone } = await import(`${BASE}/admin/models/medicalZone.model.js`);
const { FoodFeeSettings } = await import(`${BASE}/admin/models/feeSettings.model.js`);
const { FoodRestaurantCommission } = await import(`${BASE}/admin/models/restaurantCommission.model.js`);

const id = () => new mongoose.Types.ObjectId();
const zoneId = id();
const restaurantId = id();
const userId = id();

await MedicalZone.collection.insertOne({
    _id: zoneId,
    name: 'Central',
    isActive: true,
    coordinates: [
        { latitude: 12.8, longitude: 77.5 },
        { latitude: 12.8, longitude: 77.8 },
        { latitude: 13.1, longitude: 77.8 },
        { latitude: 13.1, longitude: 77.5 },
    ],
});
await FoodRestaurant.collection.insertOne({
    _id: restaurantId,
    restaurantName: 'City Pharmacy',
    status: 'approved',
    storeType: 'pharmacy',
    zoneId,
    isActive: true,
    isAcceptingOrders: true,
    location: { type: 'Point', coordinates: [77.6, 12.9], latitude: 12.9, longitude: 77.6 },
});
// Flat 30 delivery, 10 platform fee, 5% GST on lines with no slab of their own.
await FoodFeeSettings.create({ deliveryFee: 30, deliveryFeeRanges: [], platformFee: 10, gstRate: 5, isActive: true });
await FoodRestaurantCommission.create({
    restaurantId, defaultCommission: { type: 'percentage', value: 10 }, status: true,
});

const address = {
    street: '1 MG Road', city: 'Bengaluru', state: 'KA', phone: '9000000000',
    latitude: 12.95, longitude: 77.62,
    location: { type: 'Point', coordinates: [77.62, 12.95] },
};

console.log('\n[1] the customer can place a prescription order');

let placed = null;
await check('an order with a prescription photo and no items is accepted', async () => {
    placed = await rx.createPrescriptionOrder(String(userId), {
        restaurantId: String(restaurantId),
        address,
        prescriptionImage: 'https://cdn.example/rx/1.jpg',
        customerName: 'Asha',
    });
    const stored = await FoodOrder.findById(placed._id || placed.id).lean();
    assert.ok(stored, 'not saved');
    assert.equal(stored.prescriptionOnly, true);
    assert.equal(stored.items.length, 0);
});

await check('an ordinary order with no items is still refused', async () => {
    const empty = new FoodOrder({
        userId, restaurantId, items: [], deliveryAddress: address,
        pricing: { subtotal: 0, total: 0 }, payment: { method: 'cash' },
    });
    await assert.rejects(() => empty.validate(), /items/);
});

console.log('\n[2] the pharmacist can price it, taxed and commissioned like any order');

// Seeded directly so the pricing half is tested even while placement is broken.
const seeded = id();
await FoodOrder.collection.insertOne({
    _id: seeded,
    order_id: 'FOD-RX-TEST',
    orderId: 'FOD-RX-TEST',
    userId, restaurantId, zoneId,
    prescriptionOnly: true,
    prescription: { required: true, imageUrl: 'https://cdn.example/rx/2.jpg', status: 'pending_review' },
    items: [],
    deliveryAddress: address,
    pricing: { subtotal: 0, tax: 0, deliveryFee: 0, deliveryFeeGst: 0, platformFee: 0, total: 0 },
    payment: { method: 'cash', status: 'cod_pending' },
    orderStatus: 'created',
    statusHistory: [],
    createdAt: new Date(),
});

let priced = null;
await check('pricing the order saves', async () => {
    await rx.fillPrescriptionOrder(String(seeded), String(restaurantId), {
        items: [
            { name: 'Paracetamol 500mg', price: 100, quantity: 2 },
            { name: 'Cough syrup', price: 50, quantity: 1, gstRate: 12 },
        ],
    });
    priced = await FoodOrder.findById(seeded).lean();
    assert.ok(priced.items.length === 2, 'items not saved');
});

// Medical orders carry no GST (business rule, 2026-09-29): not on the
// medicines, not on delivery.
await check('the delivery fee is a number, and no GST is charged on it', async () => {
    assert.equal(priced?.pricing?.deliveryFee, 30, JSON.stringify(priced?.pricing?.deliveryFee));
    assert.equal(priced.pricing.deliveryFeeGst, 0);
});

await check('no GST on the medicines', async () => {
    assert.equal(priced?.pricing?.tax, 0);
});

await check('the seller commission is booked: 10% of 250', async () => {
    assert.equal(priced?.pricing?.restaurantCommission, 25);
});

await check('the total is medicines 250 + delivery 30 + platform fee 10 = 290', async () => {
    assert.equal(priced?.pricing?.total, 290);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
