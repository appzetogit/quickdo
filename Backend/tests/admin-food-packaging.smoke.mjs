/**
 * The admin's food form can set and edit an item's packaging charge per N units.
 *
 * Run: node tests/admin-food-packaging.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'admin_food_packaging' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
const admin = await import('../src/modules/food/admin/services/admin.service.js');

const r = await FoodRestaurant.create({ restaurantName: 'R', ownerName: 'O', ownerPhone: '9700000001', pureVegRestaurant: false, status: 'approved' });
const item = await FoodItem.create({ restaurantId: r._id, name: 'Biryani', price: 200, foodType: 'Non-Veg', approvalStatus: 'approved' });

await check('admin sets packaging: Rs 10 per 3 units', async () => {
  await admin.updateFood(String(item._id), { packagingCharge: { isEnabled: true, amount: 10, unitsPerCharge: 3 } });
  const doc = await FoodItem.findById(item._id).lean();
  assert.deepEqual({ ...doc.packagingCharge }, { isEnabled: true, amount: 10, unitsPerCharge: 3 });
});

await check('an edit without units keeps 3; switching off keeps the amount', async () => {
  await admin.updateFood(String(item._id), { packagingCharge: { isEnabled: false, amount: 10 } });
  const doc = await FoodItem.findById(item._id).lean();
  assert.equal(doc.packagingCharge.isEnabled, false);
  assert.equal(doc.packagingCharge.unitsPerCharge, 3);
});

await check('bad values are refused', async () => {
  await assert.rejects(admin.updateFood(String(item._id), { packagingCharge: { isEnabled: true, amount: 0 } }), /packaging/i);
  await assert.rejects(admin.updateFood(String(item._id), { packagingCharge: { isEnabled: true, amount: 5, unitsPerCharge: 0 } }), /1 to 999/);
});

await check('the admin list hands the form the charge', async () => {
  const res = await admin.getFoods({ restaurantId: String(r._id) });
  const rows = res.foods || res.data || res.items || res;
  const row = (Array.isArray(rows) ? rows : []).find((f) => String(f.id || f._id) === String(item._id));
  assert.ok(row, 'item listed');
  assert.deepEqual(row.packagingCharge, { isEnabled: false, amount: 10, unitsPerCharge: 3 });
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
