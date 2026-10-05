/**
 * "Goes well with": a dish shows only the dishes paired with it, not the whole
 * restaurant menu.
 *
 * Run: node tests/suggested-items.smoke.mjs
 *
 * The app's cart guessed pairings from words in the dish name and fell back to
 * the whole menu, so every dish showed every other dish of its restaurant.
 * Pairings are now chosen per dish; this drives the real save paths and the
 * real menu builders.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri();
await mongoose.connect(server.getUri(), { dbName: 'suggested' });

const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { updateRestaurantFood } = await import('../src/modules/food/restaurant/services/restaurantFood.service.js');
const { updateFood, deleteFood } = await import('../src/modules/food/admin/services/admin.service.js');
const { getRestaurantMenu, getPublicApprovedRestaurantMenu } = await import('../src/modules/food/restaurant/services/restaurantMenu.service.js');

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
    assert.ok(threw, 'expected the save to be refused');
    assert.match(threw.message, pattern);
};

const makeRestaurant = (name) => FoodRestaurant.create({
    restaurantName: name, ownerName: 'Owner', status: 'approved',
    email: `${name.replace(/\W/g, '')}${Date.now()}@example.com`,
    phone: `9${String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-9)}`,
});
const r1 = await makeRestaurant('Pairing Kitchen');
const r2 = await makeRestaurant('Other Kitchen');
const dish = (restaurant, name) => FoodItem.create({
    restaurantId: restaurant._id, name, price: 100, basePrice: 100, approvalStatus: 'approved', isAvailable: true,
});
const burger = await dish(r1, 'Burger');
const fries = await dish(r1, 'Fries');
const coke = await dish(r1, 'Coke');
const pizza = await dish(r1, 'Pizza');
const elsewhere = await dish(r2, 'Someone else\'s dish');

const items = (menu) => (menu?.sections || []).flatMap((s) => [...(s.items || []), ...(s.subsections || []).flatMap((x) => x.items || [])]);
const suggestionsOf = async (loader, food) => {
    const found = items(await loader(String(r1._id))).find((i) => String(i.id || i._id) === String(food._id));
    assert.ok(found, `${food.name} is not on the menu`);
    return found.suggestedItemIds;
};
const customer = (food) => suggestionsOf(getPublicApprovedRestaurantMenu, food);
const portal = (food) => suggestionsOf(getRestaurantMenu, food);

console.log('\nthe restaurant pairs Burger with Fries and Coke');
await updateRestaurantFood(String(r1._id), String(burger._id), { suggestedItemIds: [String(fries._id), String(coke._id)] });

await check('Burger shows Fries and Coke, in the order picked', async () =>
    assert.deepEqual(await customer(burger), [String(fries._id), String(coke._id)]));
await check('THE BUG: Pizza, paired with nothing, shows nothing -- not the whole menu', async () =>
    assert.deepEqual(await customer(pizza), []));
await check('linked once, shown both ways: Fries shows Burger', async () =>
    assert.deepEqual(await customer(fries), [String(burger._id)]));
await check('the portal gets only Fries\' own picks, so a save cannot copy the reverse link in', async () =>
    assert.deepEqual(await portal(fries), []));
await check('a pairing-only save does not send the dish back for approval', async () =>
    assert.equal((await FoodItem.findById(burger._id).lean()).approvalStatus, 'approved'));

console.log('\nwhat a save refuses or cleans up');
await check('another restaurant\'s dish is refused', () =>
    rejects(updateRestaurantFood(String(r1._id), String(pizza._id), { suggestedItemIds: [String(elsewhere._id)] }), /do not belong/));
await check('more than 10 is refused', () =>
    rejects(updateRestaurantFood(String(r1._id), String(pizza._id), {
        suggestedItemIds: Array.from({ length: 11 }, () => String(new mongoose.Types.ObjectId())),
    }), /at most 10/));
await check('the dish itself and duplicates are dropped', async () => {
    await updateRestaurantFood(String(r1._id), String(pizza._id), {
        suggestedItemIds: [String(pizza._id), String(coke._id), String(coke._id)],
    });
    assert.deepEqual((await FoodItem.findById(pizza._id).lean()).suggestedItemIds.map(String), [String(coke._id)]);
});
await check('a save without the key leaves the pairings alone', async () => {
    await updateRestaurantFood(String(r1._id), String(pizza._id), { isRecommended: true });
    assert.deepEqual((await FoodItem.findById(pizza._id).lean()).suggestedItemIds.map(String), [String(coke._id)]);
});

console.log('\nthe admin pairs, and a paired dish is deleted');
await check('the admin can set pairings too', async () => {
    await updateFood(String(pizza._id), { suggestedItemIds: [String(fries._id)] });
    assert.deepEqual(await customer(pizza), [String(fries._id)]);
});
await check('a deleted dish drops out of every list', async () => {
    await deleteFood(String(fries._id));
    assert.deepEqual(await customer(burger), [String(coke._id)]);
    assert.deepEqual(await customer(pizza), []);
});

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} FAILED\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
