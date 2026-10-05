/**
 * The admin dish form opens with the shelf and free-delivery boxes as they are.
 *
 * Run: node tests/admin-food-shelf-flags.smoke.mjs
 *
 * The admin food list never returned showIn99Store or freeDelivery, so the edit
 * form opened with both boxes clear on every dish. Saving then took the dish off
 * the shelf and recorded that as a deliberate exclusion. These checks hold the
 * round trip together.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

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
process.env.MONGODB_URI = mongo.getUri('shelf_flags');
await mongoose.connect(mongo.getUri('shelf_flags'));

const admin = await import('../src/modules/food/admin/services/admin.service.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');

const restaurant = await FoodRestaurant.create({
    restaurantName: 'Shelf Test', ownerName: 'O', ownerPhone: '9000000071', status: 'approved',
});

const create = (name, price, extra = {}) => admin.createFood({
    restaurantId: String(restaurant._id),
    categoryName: 'Mains',
    name,
    basePrice: price,
    price,
    foodType: 'Veg',
    ...extra,
});

const listed = async (name) => {
    const { foods } = await admin.getFoods({ restaurantId: String(restaurant._id), limit: 100 });
    return foods.find((f) => f.name === name);
};

console.log('\ncreating');

await check('a dish at or under the shelf price joins the shelf', async () => {
    await create('Cheap Dal', 80);
    const doc = await FoodItem.findOne({ name: 'Cheap Dal' }).lean();
    assert.equal(doc.showIn99Store, true);
});

await check('unticked while creating: kept off, and remembered as a decision', async () => {
    await create('Cheap But Off', 70, { showIn99Store: false });
    const doc = await FoodItem.findOne({ name: 'Cheap But Off' }).lean();
    assert.equal(doc.showIn99Store, false);
    assert.equal(doc.ninetyNineStoreExcluded, true);
});

await check('above the shelf price, an unticked create is not an exclusion', async () => {
    await create('Dear Thali', 250, { showIn99Store: false });
    const doc = await FoodItem.findOne({ name: 'Dear Thali' }).lean();
    assert.equal(doc.showIn99Store, false);
    assert.notEqual(doc.ninetyNineStoreExcluded, true, 'a later cap rise would never bring it in');
});

await check('free delivery ticked while creating is saved', async () => {
    await create('Free Ride Roll', 120, { freeDelivery: true });
    assert.equal((await FoodItem.findOne({ name: 'Free Ride Roll' }).lean()).freeDelivery, true);
});

console.log('\nwhat the edit form is given');

await check('THE BUG: the list returns the shelf flag', async () => {
    assert.equal((await listed('Cheap Dal')).showIn99Store, true);
});

await check('  and the exclusion, so the form does not re-tick it', async () => {
    const row = await listed('Cheap But Off');
    assert.equal(row.showIn99Store, false);
    assert.equal(row.ninetyNineStoreExcluded, true);
});

await check('  and free delivery', async () => {
    assert.equal((await listed('Free Ride Roll')).freeDelivery, true);
});

await check('saving without sending the flag leaves the shelf alone', async () => {
    const row = await listed('Cheap Dal');
    await admin.updateFood(String(row.id), { name: 'Cheap Dal', description: 'edited' });
    const doc = await FoodItem.findById(row.id).lean();
    assert.equal(doc.showIn99Store, true);
    assert.notEqual(doc.ninetyNineStoreExcluded, true);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
