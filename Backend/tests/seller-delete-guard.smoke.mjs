/**
 * A seller cannot delete its own account mid-order, with a payout waiting, or
 * while still owed money.
 *
 * Run: node tests/seller-delete-guard.smoke.mjs
 *
 * Deleting a restaurant is permanent and nothing stopped it: a kitchen could
 * delete itself with a customer's order cooking, or with the platform still
 * owing it its earnings. Uses the real Food payout figure.
 */
import assert from 'node:assert/strict';

const { default: mongoose } = await import('mongoose');
const { MongoMemoryServer } = await import('mongodb-memory-server');

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

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'seller_delete_guard' });

const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { FoodTransaction } = await import('../src/modules/food/orders/models/foodTransaction.model.js');
const { FoodRestaurantWithdrawal } = await import('../src/modules/food/restaurant/models/foodRestaurantWithdrawal.model.js');
const { getRestaurantPayoutPosition } = await import('../src/modules/food/restaurant/services/restaurantFinance.service.js');
const { assertSellerCanDelete } = await import('../src/core/sellerDeleteGuard.js');

const oid = () => new mongoose.Types.ObjectId();
const guard = (id) => assertSellerCanDelete(id, {
    Order: FoodOrder,
    Withdrawal: FoodRestaurantWithdrawal,
    owedToSeller: async (rid) => (await getRestaurantPayoutPosition(rid)).available,
});
const order = (restaurantId, orderStatus) => FoodOrder.collection.insertOne({ _id: oid(), restaurantId, orderStatus, createdAt: new Date() });

await check('an order being prepared blocks the delete', async () => {
    const r = oid();
    await order(r, 'preparing');
    await assert.rejects(() => guard(r), /1 order in progress/);
});

await check('delivered, cancelled and never-paid orders do not', async () => {
    const r = oid();
    await order(r, 'delivered');
    await order(r, 'cancelled_by_user');
    await order(r, 'pending_payment');
    await guard(r);
});

await check('a payout request waiting blocks the delete', async () => {
    const r = oid();
    await FoodRestaurantWithdrawal.collection.insertOne({ _id: oid(), restaurantId: r, amount: 500, status: 'pending' });
    await assert.rejects(() => guard(r), /payout request waiting/);
});

await check('money still owed blocks the delete, with the amount', async () => {
    const r = oid();
    await FoodTransaction.collection.insertOne({ _id: oid(), restaurantId: r, orderId: oid(), status: 'captured', amounts: { restaurantShare: 420 } });
    await assert.rejects(() => guard(r), /Rs 420 is still owed/);
});

await check('once that money is paid out, the delete goes ahead', async () => {
    const r = oid();
    await FoodTransaction.collection.insertOne({ _id: oid(), restaurantId: r, orderId: oid(), status: 'captured', amounts: { restaurantShare: 420 } });
    await FoodRestaurantWithdrawal.collection.insertOne({ _id: oid(), restaurantId: r, amount: 420, status: 'approved' });
    await guard(r);
});

await check('a balance that cannot be read refuses rather than deletes', async () => {
    await assert.rejects(
        () => assertSellerCanDelete(oid(), { Order: FoodOrder, Withdrawal: FoodRestaurantWithdrawal, owedToSeller: async () => { throw new Error('db down'); } }),
        /Could not check your balance/,
    );
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
