/**
 * Recommended is one flag: Trending Now lists the recommended dishes in the
 * customer's zone (newest recommendation first, in the same shape as a
 * restaurant's menu), whether a restaurant or an admin switched it on.
 *
 * Run: node tests/trending-foods.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'trending_foods' });

const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
const svc = await import('../src/modules/food/restaurant/services/trendingFoods.service.js');

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

const palampur = new mongoose.Types.ObjectId();
const indore = new mongoose.Types.ObjectId();
const r1 = await FoodRestaurant.create({ restaurantName: 'Saini Dhaba', ownerName: 'O', ownerPhone: '9700000001', pureVegRestaurant: false, status: 'approved', zoneId: palampur });
const r2 = await FoodRestaurant.create({ restaurantName: 'Indore Cafe', ownerName: 'O', ownerPhone: '9700000002', pureVegRestaurant: false, status: 'approved', zoneId: indore });
const dish = (r, name, extra = {}) => FoodItem.create({ restaurantId: r._id, name, price: 120, foodType: 'Veg', approvalStatus: 'approved', ...extra });
const paneer = await dish(r1, 'Paneer Tikka');
const dal = await dish(r1, 'Dal Makhani');
const thali = await dish(r1, 'Thali', {
  variantsEnabled: true,
  variants: [{ name: 'Half', price: 90 }, { name: 'Full', price: 150 }],
});
const poha = await dish(r2, 'Poha');
const hidden = await dish(r1, 'Old Dish', { isActive: false });

console.log('\npicking dishes');
await check('nothing is trending until a dish is recommended', async () => {
  assert.equal((await svc.listTrendingFoods({ zoneId: String(palampur) })).total, 0);
});
await check('a dish the restaurant recommended shows too -- one flag for both', async () => {
  await FoodItem.updateOne({ _id: dal._id }, { $set: { isRecommended: true } });
  assert.deepEqual((await svc.listTrendingFoods({ zoneId: String(palampur) })).foods.map((f) => f.name), ['Dal Makhani']);
  await FoodItem.updateOne({ _id: dal._id }, { $set: { isRecommended: false } });
});
await check('the admin thumb switches the same flag the restaurant menu reads', async () => {
  await svc.setFoodTrending(dal._id, true);
  assert.equal((await FoodItem.findById(dal._id).lean()).isRecommended, true);
  await svc.setFoodTrending(dal._id, false);
  assert.equal((await FoodItem.findById(dal._id).lean()).isRecommended, false);
});
await check('a picked dish shows, newest pick first, with restaurant name and variants', async () => {
  await svc.setFoodTrending(paneer._id, true);
  await new Promise((r) => setTimeout(r, 5));
  await svc.setFoodTrending(thali._id, true);
  const { foods } = await svc.listTrendingFoods({ zoneId: String(palampur) });
  assert.deepEqual(foods.map((f) => f.name), ['Thali', 'Paneer Tikka']);
  assert.equal(foods[0].restaurantName, 'Saini Dhaba');
  assert.equal(foods[0].restaurantId, String(r1._id));
  assert.equal(foods[0].isTrending, true);
  assert.equal(foods[0].variations.length, 2);
});
await check('only the customer\'s zone', async () => {
  await svc.setFoodTrending(poha._id, true);
  assert.deepEqual((await svc.listTrendingFoods({ zoneId: String(indore) })).foods.map((f) => f.name), ['Poha']);
  assert.equal((await svc.listTrendingFoods({})).total, 3, 'no zone: every zone');
});
await check('a dish taken off the menu never shows, even if picked', async () => {
  await svc.setFoodTrending(hidden._id, true);
  assert.ok(!(await svc.listTrendingFoods({ zoneId: String(palampur) })).foods.some((f) => f.name === 'Old Dish'));
});
await check('removing a pick takes it off', async () => {
  await svc.setFoodTrending(paneer._id, 'false');
  assert.deepEqual((await svc.listTrendingFoods({ zoneId: String(palampur) })).foods.map((f) => f.name), ['Thali']);
});
await check('a bad or unknown id is refused', async () => {
  await assert.rejects(() => svc.setFoodTrending('nope', true), /Invalid food id/);
  await assert.rejects(() => svc.setFoodTrending(new mongoose.Types.ObjectId(), true), /not found/);
});

console.log('\nadmin list');
await check('each dish is stamped with its trending flag', async () => {
  const rows = await svc.withTrendingFlags([{ _id: thali._id }, { id: String(dal._id) }, { id: 'x' }]);
  assert.deepEqual(rows.map((r) => r.isTrending), [true, false, false]);
});

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
