/**
 * The product list the customer app's listings read carries what is on the pack.
 *
 * Run: node tests/qc-public-foods-pack-fields.smoke.mjs
 *
 * /restaurant/public/foods left out brand, packSize and MRP (the store menu
 * sent them), so listing cards showed "1 pack" and no MRP strike-through.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'qc_public_foods_pack' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { FoodRestaurant } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');
const { FoodItem } = await import('../src/modules/quickCommerce/modules/food/admin/models/food.model.js');
const { listPublicFoods } = await import('../src/modules/quickCommerce/modules/food/restaurant/services/publicFoods.service.js');
const { searchProducts } = await import('../src/modules/quickCommerce/modules/food/search/services/search.service.js');

const store = await FoodRestaurant.collection.insertOne({ restaurantName: 'Gupta Kirana', storeType: 'kirana', status: 'approved', isActive: true });
await FoodItem.collection.insertOne({
  restaurantId: store.insertedId, name: 'Sugar', price: 45, otherPrice: 0, mrp: 50,
  brand: 'Madhur', packSize: '1 kg', stockQty: 12, lowStockThreshold: 4, maxQtyPerOrder: 3,
  expiryDate: new Date('2027-03-31'), approvalStatus: 'approved', isAvailable: true, foodType: 'Veg', createdAt: new Date(),
});
await FoodItem.collection.insertOne({
  restaurantId: store.insertedId, name: 'Basmati Rice', price: 90, approvalStatus: 'approved', isAvailable: true, foodType: 'Veg', createdAt: new Date(),
  variants: [
    { _id: new mongoose.Types.ObjectId(), name: '1 kg', price: 90, otherPrice: 0, stockQty: 0 },
    { _id: new mongoose.Types.ObjectId(), name: '5 kg', price: 420, otherPrice: 0, stockQty: 3, lowStockThreshold: 5 },
  ],
});

await check('a listed product carries brand, pack size, MRP, stock, limit and expiry', async () => {
  const { foods } = await listPublicFoods({});
  const sugar = foods.find((f) => f.name === 'Sugar');
  assert.ok(sugar, JSON.stringify(foods));
  assert.equal(sugar.brand, 'Madhur');
  assert.equal(sugar.packSize, '1 kg');
  assert.equal(sugar.mrp, 50);
  assert.equal(sugar.stockQty, 12);
  assert.equal(sugar.maxQtyPerOrder, 3);
  assert.equal(sugar.lowStockThreshold, 4);
  assert.equal(new Date(sugar.expiryDate).getUTCFullYear(), 2027);
});

// The app reads stock per size; search used to send raw sizes with no id or inStock.
await check('every size in the list and in search carries its id, stock and inStock', async () => {
  const { foods } = await listPublicFoods({});
  const { products } = await searchProducts({ q: 'basmati' });
  for (const rice of [foods.find((f) => f.name === 'Basmati Rice'), products.find((p) => p.name === 'Basmati Rice')]) {
    assert.ok(rice, 'Basmati Rice missing');
    const [small, big] = rice.variants;
    assert.ok(small.id);
    assert.equal(small.stockQty, 0);
    assert.equal(small.inStock, false);
    assert.equal(big.stockQty, 3);
    assert.equal(big.inStock, true);
    assert.equal(big.lowStockThreshold, 5);
  }
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
