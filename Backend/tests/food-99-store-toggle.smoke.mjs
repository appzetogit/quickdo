/**
 * Admin Food List's thumbs-up: adds a dish to the Rs 99 store or takes it off,
 * and refuses a dish priced above the store's cap.
 *
 * Run: node tests/food-99-store-toggle.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'food_99_toggle' });
const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
const { setFoodInNinetyNineStore } = await import('../src/modules/food/admin/services/ninetyNineShelf.service.js');
const { getNinetyNineCap } = await import('../src/modules/food/shared/ninetyNineStoreCap.js');

let failures = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  ok   ${label}`); }
  catch (err) { failures += 1; console.log(`  FAIL ${label}\n       ${err.message}`); }
};
const dish = (name, price) => FoodItem.create({ restaurantId: new mongoose.Types.ObjectId(), name, price, foodType: 'Veg', approvalStatus: 'approved', ninetyNineStoreExcluded: true });
const flags = async (id) => { const d = await FoodItem.findById(id).lean(); return [d.showIn99Store, d.ninetyNineStoreExcluded]; };
const cap = await getNinetyNineCap();

await check('thumbs up adds a dish within the cap (ticked, no longer removed)', async () => {
  const d = await dish('Veg Soup', Math.min(80, cap));
  assert.equal((await setFoodInNinetyNineStore(d._id, true)).inStore, true);
  assert.deepEqual(await flags(d._id), [true, false]);
});
await check('thumbs up again takes it off (unticked, marked removed)', async () => {
  const d = await dish('Coke Can', Math.min(50, cap));
  await setFoodInNinetyNineStore(d._id, true);
  assert.equal((await setFoodInNinetyNineStore(d._id, 'false')).inStore, false);
  assert.deepEqual(await flags(d._id), [false, true]);
});
await check('a dish above the cap is refused, with the reason', async () => {
  const d = await dish('Paneer Tikka', cap + 100);
  await assert.rejects(() => setFoodInNinetyNineStore(d._id, true), /only lists dishes up to/);
  assert.deepEqual(await flags(d._id), [false, true]);
});
await check('a bad or unknown id is refused', async () => {
  await assert.rejects(() => setFoodInNinetyNineStore('x', true), /Invalid food id/);
  await assert.rejects(() => setFoodInNinetyNineStore(new mongoose.Types.ObjectId(), true), /not found/);
});

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
