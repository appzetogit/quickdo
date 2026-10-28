/**
 * The admin food editor sets a dish's own min/max order quantity, the same pair
 * the restaurant's item form has.
 *
 * Run: node tests/admin-food-quantity.smoke.mjs
 *
 * Admin create/update and the admin list never carried these, so a dish sold at
 * one price could not be given a minimum from admin at all.
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
await mongoose.connect(mongo.getUri(), { dbName: 'admin_food_quantity' });

const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
const q = await import('../src/modules/food/admin/services/adminFoodQuantity.service.js');

const id = new mongoose.Types.ObjectId();
await FoodItem.collection.insertOne({ _id: id, name: 'Rasgulla', restaurantId: new mongoose.Types.ObjectId(), price: 20, minOrderQuantity: 1, maxOrderQuantity: 0 });

await check('the list rows carry each dish\'s limits', async () => {
    const [row] = await q.withFoodQuantityLimits([{ _id: id, name: 'Rasgulla' }]);
    assert.equal(row.minOrderQuantity, 1);
    assert.equal(row.maxOrderQuantity, 0);
});

await check('saving min 4 / max 20 stores them', async () => {
    const limits = await q.prepareFoodQuantityLimits({ name: 'Rasgulla', minOrderQuantity: '4', maxOrderQuantity: '20' }, { foodId: id });
    await q.saveFoodQuantityLimits(id, limits);
    const doc = await FoodItem.findById(id).lean();
    assert.equal(doc.minOrderQuantity, 4);
    assert.equal(doc.maxOrderQuantity, 20);
});

await check('a max below the min is refused before anything is written', async () => {
    await assert.rejects(() => q.prepareFoodQuantityLimits({ name: 'Rasgulla', minOrderQuantity: 10, maxOrderQuantity: 5 }, { foodId: id }), /greater than or equal to the minimum/);
    // Only the max sent: checked against the stored minimum of 4.
    await assert.rejects(() => q.prepareFoodQuantityLimits({ name: 'Rasgulla', maxOrderQuantity: 2 }, { foodId: id }), /minimum \(4\)/);
    const doc = await FoodItem.findById(id).lean();
    assert.equal(doc.maxOrderQuantity, 20);
});

await check('0 means none; above the platform limit is refused; not sending them changes nothing', async () => {
    assert.deepEqual(await q.prepareFoodQuantityLimits({ minOrderQuantity: 0, maxOrderQuantity: 0 }), { minOrderQuantity: 0, maxOrderQuantity: 0 });
    await assert.rejects(() => q.prepareFoodQuantityLimits({ maxOrderQuantity: 500 }), /at most 99/);
    assert.equal(await q.prepareFoodQuantityLimits({ name: 'x' }), undefined);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
