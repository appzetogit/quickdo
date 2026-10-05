/**
 * A store saves a grocery product the way the seller app now sends it.
 *
 * Run: node tests/qc-seller-grocery-product.smoke.mjs
 *
 * The seller app's form now sends brand, pack size, MRP, GST, barcode, SKU,
 * expiry, and pack sizes (500 g / 1 kg) each with its own price and MRP. Each
 * size is checked against its own MRP (one product-level MRP cannot hold for
 * 500 g and 1 kg alike), and a size's stock survives an edit that keeps its id.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'qc_seller_grocery' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { FoodRestaurant } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');
const { FoodItem } = await import('../src/modules/quickCommerce/modules/food/admin/models/food.model.js');
const svc = await import('../src/modules/quickCommerce/modules/food/restaurant/services/restaurantFood.service.js');

const store = await FoodRestaurant.collection.insertOne({ restaurantName: 'Gupta Kirana', storeType: 'kirana', status: 'approved' });
const storeId = String(store.insertedId);

let atta;
await check('a product in one pack: brand, pack size, MRP, GST, codes, expiry are saved', async () => {
  const food = await svc.createRestaurantFood(storeId, {
    name: 'Sugar', foodType: 'Veg', price: 45, otherPrice: 50, mrp: 50,
    brand: 'Madhur', packSize: '1 kg', gstRate: 5, barcode: '8901234567890', sku: 'SUG-1',
    expiryDate: '2027-03-31T00:00:00.000Z',
  });
  const doc = await FoodItem.findById(food._id || food.id).lean();
  assert.equal(doc.brand, 'Madhur');
  assert.equal(doc.packSize, '1 kg');
  assert.equal(doc.mrp, 50);
  assert.equal(doc.gstRate, 5);
  assert.equal(doc.barcode, '8901234567890');
  assert.equal(doc.sku, 'SUG-1');
  assert.equal(new Date(doc.expiryDate).getUTCFullYear(), 2027);
});

await check('a selling price above the MRP is refused', async () => {
  const err = await svc.createRestaurantFood(storeId, { name: 'Salt', price: 30, mrp: 25 }).then(() => null, (e) => e);
  assert.match(String(err?.message), /above the MRP/);
});

await check('pack sizes, each with its own MRP, are saved and priced from the lowest', async () => {
  atta = await svc.createRestaurantFood(storeId, {
    name: 'Atta', foodType: 'Veg', brand: 'Aashirvaad', mrp: null,
    variants: [
      { name: '1 kg', price: 60, otherPrice: 65 },
      { name: '5 kg', price: 270, otherPrice: 299 },
    ],
  });
  const doc = await FoodItem.findById(atta._id || atta.id).lean();
  assert.equal(doc.variants.length, 2);
  assert.equal(doc.price, 60);
  assert.deepEqual(doc.variants.map((v) => [v.name, v.price, v.otherPrice]), [['1 kg', 60, 65], ['5 kg', 270, 299]]);
});

await check('a size priced above its own MRP is refused', async () => {
  const err = await svc.createRestaurantFood(storeId, {
    name: 'Rice', variants: [{ name: '1 kg', price: 90, otherPrice: 80 }],
  }).then(() => null, (e) => e);
  assert.match(String(err?.message), /1 kg: price cannot be above its MRP/);
});

await check('editing the sizes keeps the stock of a size that kept its id', async () => {
  const id = String(atta._id || atta.id);
  const before = await FoodItem.findById(id).lean();
  const oneKg = before.variants[0];
  await FoodItem.updateOne({ _id: id, 'variants._id': oneKg._id }, { $set: { 'variants.$.stockQty': 40 } });
  await svc.updateRestaurantFood(storeId, id, {
    variants: [
      { _id: String(oneKg._id), name: '1 kg', price: 58, otherPrice: 65 },
      { name: '10 kg', price: 520, otherPrice: 560 },
    ],
  });
  const after = await FoodItem.findById(id).lean();
  const kept = after.variants.find((v) => v.name === '1 kg');
  assert.equal(kept.price, 58);
  assert.equal(kept.stockQty, 40);
  assert.deepEqual(after.variants.map((v) => v.name).sort(), ['1 kg', '10 kg']);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
