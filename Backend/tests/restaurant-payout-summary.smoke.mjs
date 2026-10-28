/**
 * Restaurant app > Payouts: the cycle summary from the restaurant's side.
 *
 * The two orders are the worked example: Rs 100 of food at 5% GST and 10%
 * commission, once with GST inside the price and once added on top. The
 * restaurant is paid the food net of GST less commission; the GST is shown
 * apart because the platform pays it to the government.
 *
 * Run: node tests/restaurant-payout-summary.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'restaurant_payout_summary' });
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { FoodTransaction } = await import('../src/modules/food/orders/models/foodTransaction.model.js');
const { getRestaurantFinance } = await import('../src/modules/food/restaurant/services/restaurantFinance.service.js');

let failures = 0;
const check = async (label, fn) => {
    try { await fn(); console.log(`  ok   ${label}`); }
    catch (err) { failures += 1; console.log(`  FAIL ${label}\n       ${err.message}`); }
};
const oid = () => new mongoose.Types.ObjectId();

const rid = oid();
await FoodRestaurant.collection.insertOne({
    _id: rid, restaurantName: 'Test Kitchen', ownerName: 'Owner', ownerPhone: '9999999999',
    status: 'approved', location: { type: 'Point', coordinates: [76.53, 32.1] }, createdAt: new Date(),
});
const order = async (orderId, pricing, amounts) => {
    const _id = oid();
    await FoodOrder.collection.insertOne({ _id, orderId, restaurantId: rid, items: [], pricing, createdAt: new Date() });
    await FoodTransaction.collection.insertOne({
        _id: oid(), orderId: _id, restaurantId: rid, status: 'captured', amounts, createdAt: new Date(),
    });
};
// GST included: 100 holds 4.76 of GST; 10% of 95.24 is 9.52.
await order('INCL', { subtotal: 100, commissionableAmount: 95.24, pricesIncludeGst: true, gstRate: 5, restaurantCommission: 9.52, tax: 4.76, total: 130 },
    { restaurantShare: 85.72, restaurantCommission: 9.52, totalCustomerPaid: 130 });
// GST on top: 5 added; 10% of 100 is 10.
await order('EXCL', { subtotal: 100, commissionableAmount: 100, gstRate: 5, restaurantCommission: 10, tax: 5, total: 135 },
    { restaurantShare: 90, restaurantCommission: 10, totalCustomerPaid: 135 });

const finance = await getRestaurantFinance(String(rid));
const s = finance.invoiceSummary;
const rows = Object.fromEntries(finance.currentCycle.orders.map((o) => [o.orderId, o]));

await check('each order carries its food net of GST and the GST on it', async () => {
    assert.deepEqual([rows.INCL.foodValue, rows.INCL.gstOnFood, rows.INCL.payout], [95.24, 4.76, 85.72]);
    assert.deepEqual([rows.EXCL.foodValue, rows.EXCL.gstOnFood, rows.EXCL.payout], [100, 5, 90]);
});
await check('the summary is the restaurant\'s side and adds up to the payout', async () => {
    assert.deepEqual([s.foodSales, s.gstOnFood, s.commission, s.payout], [195.24, 9.76, 19.52, 175.72]);
    assert.equal(Math.round((s.foodSales + s.packaging - s.commission) * 100) / 100, s.payout);
});
await check('the customer-bill fields older app builds read are unchanged', async () => {
    assert.equal(s.gross, 265);
    assert.equal(s.count, 2);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
