/**
 * Quick-commerce order pricing: item GST in paise, and the "price changed" notice.
 *
 * Run: node tests/qc-order-pricing.smoke.mjs
 *
 * Two findings from the September audit, both reproduced against the real
 * calculateOrderPricing() on an in-memory Mongo:
 *
 *  - computeItemsTax() rounded item GST to the whole rupee while every other figure
 *    on the bill is to the paisa. Oil at 105 and 5% was charged 5, not 5.25; three
 *    bottles were charged 16 while three unit returns refund 15.75.
 *
 *  - The shipped app sends each line's price WITHOUT its add-ons, and the server
 *    compared that against its price WITH them, so any line carrying an add-on got a
 *    "price changed" notice on every checkout although nothing had changed.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

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

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'qc_order_pricing' });

const BASE = '../src/modules/quickCommerce/modules/food';
const { computeItemsTax, calculateOrderPricing } = await import(`${BASE}/orders/services/order-pricing.service.js`);
const { FoodItem } = await import(`${BASE}/admin/models/food.model.js`);
const { FoodAddon } = await import(`${BASE}/restaurant/models/foodAddon.model.js`);
const { FoodFeeSettings } = await import(`${BASE}/admin/models/feeSettings.model.js`);

const id = () => new mongoose.Types.ObjectId();
const restaurantId = id();
const restaurant = {
    _id: restaurantId,
    restaurantName: 'Corner Kirana',
    status: 'approved',
    location: { type: 'Point', coordinates: [77.6, 12.9], latitude: 12.9, longitude: 77.6 },
};
const deliveryAddress = {
    street: '1 MG Road', city: 'Bengaluru', state: 'KA',
    location: { type: 'Point', coordinates: [77.61, 12.91] },
};

await FoodFeeSettings.create({ deliveryFee: 0, deliveryFeeRanges: [], platformFee: 0, gstRate: 5, isActive: true });
const oil = await FoodItem.create({ restaurantId, name: 'Oil 1L', price: 105, gstRate: 5, approvalStatus: 'approved' });
const chips = await FoodItem.create({ restaurantId, name: 'Chips', price: 50, gstRate: 0, approvalStatus: 'approved' });
const masala = await FoodAddon.collection.insertOne({
    restaurantId,
    draft: { name: 'Extra Masala', price: 20 },
    published: { name: 'Extra Masala', price: 20 },
    approvalStatus: 'approved',
    isAvailable: true,
    isDeleted: false,
});

const price = (items) => calculateOrderPricing(String(id()), {
    restaurantId: String(restaurantId), items, deliveryAddress,
}, { restaurant, skipAvailabilityCheck: true });

console.log('\n[1] item GST is charged to the paisa');

check('one bottle of oil at 105 and 5% carries 5.25 GST', () => {
    const tax = computeItemsTax([{ price: 105, quantity: 1, gstRate: 5 }], { subtotal: 105 });
    assert.equal(tax, 5.25, `tax ${tax}`);
});

check('three bottles carry 15.75, the sum three unit returns refund', () => {
    const tax = computeItemsTax([{ price: 105, quantity: 3, gstRate: 5 }], { subtotal: 315 });
    assert.equal(tax, 15.75, `tax ${tax}`);
});

const threeOil = await price([{ itemId: String(oil._id), quantity: 3, price: 105 }]);
check('the priced order bills 315 + 15.75 = 330.75, charged to the rupee as 331 (+0.25)', () => {
    assert.equal(threeOil.pricing.tax, 15.75, `tax ${threeOil.pricing.tax}`);
    assert.equal(threeOil.pricing.total, 331, `total ${threeOil.pricing.total}`);
    assert.equal(threeOil.pricing.roundOff, 0.25, `roundOff ${threeOil.pricing.roundOff}`);
});

check('the order records the fallback GST rate it priced untagged lines at', () => {
    // Returns refund an untagged line at this rate; without it they must work it back
    // out of the order's tax.
    assert.equal(threeOil.pricing.gstFallbackRate, 5);
});

console.log('\n[2] "price changed" compares like with like');

const addonLine = (sentPrice) => ({
    itemId: String(chips._id), quantity: 1, price: sentPrice,
    addons: [{ addonId: String(masala.insertedId), id: String(masala.insertedId), name: 'Extra Masala' }],
});

const shipped = await price([addonLine(50)]);
check('a line with an add-on, sent at its own price as the shipped app does, is not "changed"', () => {
    assert.equal(shipped.items[0].price, 70, 'the server still bills the add-on');
    assert.deepEqual(shipped.priceChanges, [], JSON.stringify(shipped.priceChanges));
});

const corrected = await price([addonLine(70)]);
check('a client that sends the price with add-ons included is not "changed" either', () => {
    assert.deepEqual(corrected.priceChanges, [], JSON.stringify(corrected.priceChanges));
});

const stale = await price([addonLine(45)]);
check('a genuine change is still reported, in the terms the app sent', () => {
    assert.equal(stale.priceChanges.length, 1);
    assert.equal(stale.priceChanges[0].previousPrice, 45);
    assert.equal(stale.priceChanges[0].price, 50);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
