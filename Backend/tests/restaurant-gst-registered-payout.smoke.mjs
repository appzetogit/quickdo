/**
 * A GST-registered restaurant is paid the GST on its food; an unregistered one
 * is not (the platform remits it). Rs 100 incl. 5% GST at 10% commission:
 * registered 90.48, unregistered 85.72 (commission rounds to 9.52).
 *
 * Run: node tests/restaurant-gst-registered-payout.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'gst_registered_payout' });
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodTransaction } = await import('../src/modules/food/orders/models/foodTransaction.model.js');
const { FoodUser } = await import('../src/core/users/user.model.js').catch(() => ({ FoodUser: null }));
const { createInitialTransaction } = await import('../src/modules/food/orders/services/foodTransaction.service.js');
const { attachRestaurantPayout } = await import('../src/modules/food/shared/restaurantPayout.js');
await FoodTransaction.createCollection().catch(() => {});

let failures = 0;
const check = async (label, fn) => {
    try { await fn(); console.log(`  ok   ${label}`); }
    catch (err) { failures += 1; console.log(`  FAIL ${label}\n       ${err.message}`); }
};
const oid = () => new mongoose.Types.ObjectId();
const restaurant = async (gstRegistered) => (await FoodRestaurant.collection.insertOne({
    _id: oid(), restaurantName: gstRegistered ? 'Registered' : 'Unregistered', ownerPhone: String(Math.random()).slice(2, 12),
    status: 'approved', gstRegistered, createdAt: new Date(),
})).insertedId;
const userId = FoodUser ? (await FoodUser.collection.insertOne({ _id: oid(), phone: '9000000000' })).insertedId : oid();
const order = (restaurantId) => ({
    _id: oid(), orderId: `T${Math.random()}`.slice(0, 10), restaurantId, userId,
    pricing: { subtotal: 100, commissionableAmount: 95.24, pricesIncludeGst: true, gstRate: 5, restaurantCommission: 9.52, tax: 4.76, total: 100, packagingFee: 0 },
    payment: { method: 'cash', status: 'pending' },
});

const reg = order(await restaurant(true));
const unreg = order(await restaurant(false));
let regTx; let unregTx;
await check('the ledger pays a registered restaurant the food\'s GST, and not an unregistered one', async () => {
    regTx = await createInitialTransaction(reg);
    unregTx = await createInitialTransaction(unreg);
    assert.deepEqual([regTx.amounts.restaurantShare, regTx.amounts.restaurantGstPassThrough], [90.48, 4.76]);
    assert.deepEqual([unregTx.amounts.restaurantShare, unregTx.amounts.restaurantGstPassThrough], [85.72, 0]);
});
await check('the restaurant\'s bill shows the same payout as the ledger', async () => {
    const [a, b] = await attachRestaurantPayout([{ ...reg }, { ...unreg }]);
    assert.deepEqual([a.restaurantPayout.payoutWithoutGst, a.restaurantPayout.gstPaidToRestaurant, a.restaurantPayout.payout], [85.72, 4.76, 90.48]);
    assert.deepEqual([b.restaurantPayout.gstPaidToRestaurant, b.restaurantPayout.payout], [0, 85.72]);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
