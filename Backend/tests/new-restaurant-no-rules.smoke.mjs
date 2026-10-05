/**
 * A restaurant that has just onboarded is priced by nobody but itself.
 *
 * Run: node tests/new-restaurant-no-rules.smoke.mjs
 *
 * A dish typed at Rs 200 by a brand-new restaurant went live struck through at
 * Rs 290: the seed widened to a platform-wide median when the menu had no
 * figures of its own, so another kitchen's ratio was copied onto it. Nobody had
 * applied an adjustment to that restaurant -- the platform advertised a saving
 * on its behalf that its owner had never offered and could not explain.
 *
 * What a restaurant's own dishes carry still seeds its next dish: that is its
 * own pricing carried forward, which is the one thing it did decide.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri();
await mongoose.connect(server.getUri(), { dbName: 'new_restaurant' });

const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodFeeSettings } = await import('../src/modules/food/admin/models/feeSettings.model.js');
const { FoodCategory } = await import('../src/modules/food/admin/models/category.model.js');
const { createRestaurantFood } = await import('../src/modules/food/restaurant/services/restaurantFood.service.js');
const { resolveStandingAdjustment } = await import('../src/modules/food/admin/services/priceAdjustment.service.js');
const seed = await import('../src/modules/food/shared/otherPlatformSeed.service.js');

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

await FoodFeeSettings.create({
    isActive: true,
    otherPlatformPrice: { isEnabled: true, markupPercent: 20, label: 'Other platforms' },
});
const category = await FoodCategory.create({ name: 'Mains', approvalStatus: 'approved', foodTypeScope: 'Both' });

let phone = 9100000000;
const restaurant = async (name) => FoodRestaurant.create({
    restaurantName: name, ownerName: 'Owner', status: 'approved',
    email: `${name.replace(/\W/g, '')}${Date.now()}@example.com`, phone: String(phone++),
});

// An established restaurant whose menu advertises a 45% mark-up comparison.
const established = await restaurant('Established Kitchen');
for (let i = 0; i < 3; i += 1) {
    await FoodItem.create({
        restaurantId: established._id, name: `Old ${i}`, price: 100, basePrice: 100,
        otherPrice: 145, approvalStatus: 'approved',
    });
}

const fresh = await restaurant('Brand New Kitchen');
const addDish = (r, name, basePrice) => createRestaurantFood(String(r._id), {
    name, basePrice, foodType: 'Veg', categoryId: String(category._id), categoryName: 'Mains',
});

console.log('\nthe first dish of a restaurant that just onboarded');
const first = await addDish(fresh, 'First Dish', 200);
await check('THE BUG: no comparison price is invented from another kitchen', () => {
    assert.equal(Number(first.otherPrice) || 0, 0, `otherPrice ${first.otherPrice} came from somewhere else`);
});
await check('it is sold at exactly the price the restaurant typed', () => {
    assert.equal(first.price, 200);
    assert.equal(first.basePrice, 200);
});
await check('and carries no markup, no discount and nothing struck through', () => {
    assert.equal(Number(first.formulationPercent) || 0, 0);
    assert.equal(Number(first.formulationMarkupPercent) || 0, 0);
    assert.equal(Number(first.formulationDiscountPercent) || 0, 0);
    assert.ok(!first.formulationStrikePrice, `strike ${first.formulationStrikePrice}`);
});
await check('no standing adjustment is claimed for it either', async () => {
    const standing = await resolveStandingAdjustment(String(fresh._id));
    assert.equal(standing.markupPercent, 0);
    assert.equal(standing.discountPercent, 0);
});

console.log('\nwhat the restaurant decides for itself still carries forward');
await check('a dish added after it set its own comparison inherits ITS ratio, not the platform\'s', async () => {
    // The owner sets a comparison on the first dish: Rs 200 against Rs 240.
    await FoodItem.updateOne({ _id: first._id }, { $set: { otherPrice: 240 } });
    const second = await addDish(fresh, 'Second Dish', 100);
    // 1.2x its own menu, not the 1.45x next door.
    assert.equal(Number(second.otherPrice), 120, `seeded ${second.otherPrice}`);
});

console.log('\nthe established restaurant is untouched by any of this');
await check('its own dishes still seed each other', async () => {
    const another = await addDish(established, 'Another Old Dish', 100);
    assert.equal(Number(another.otherPrice), 145);
});

console.log('\nthe seed helper itself');
await check('a restaurant with no dishes seeds nothing, whatever the platform carries', async () => {
    const empty = await restaurant('Empty Kitchen');
    assert.equal(await seed.resolveSeedOtherPriceForRestaurant(String(empty._id), 500), 0);
    assert.equal(await seed.resolveSeedRatioForRestaurant(String(empty._id)), 0);
});
await check('an unknown restaurant seeds nothing rather than borrowing a median', async () => {
    assert.equal(await seed.resolveSeedOtherPriceForRestaurant(String(new mongoose.Types.ObjectId()), 500), 0);
});

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} FAILED\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
