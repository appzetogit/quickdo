/**
 * Quick products: each size has its own GST and its own stock.
 *
 * Run: node tests/qc-variant-gst-stock.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'qc_variant_gst' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { FoodItem } = await import('../src/modules/quickCommerce/modules/food/admin/models/food.model.js');
const { normalizeFoodVariantsInput, serializeFoodVariants } = await import('../src/modules/quickCommerce/modules/food/admin/services/foodVariant.service.js');
const { resolveOrderCartItems } = await import('../src/modules/quickCommerce/modules/food/orders/helpers/order-cart-items.helper.js');

const store = new mongoose.Types.ObjectId();
const item = await FoodItem.create({
  restaurantId: store, name: 'Ghee', price: 300, gstRate: 12, approvalStatus: 'approved', variantsEnabled: true,
  variants: [
    { name: '500 ml', price: 300, gstRate: 5, stockQty: 2 },
    { name: '1 L', price: 560 }, // no own rate, no own stock
  ],
});
const [half, litre] = item.variants.map((v) => String(v._id));

await check('a size with its own GST is taxed at it; one without uses the product rate', async () => {
  const lines = await resolveOrderCartItems(store, [
    { itemId: String(item._id), variantId: half, quantity: 1 },
    { itemId: String(item._id), variantId: litre, quantity: 1 },
  ]);
  assert.deepEqual(lines.map((l) => l.gstRate), [5, 12]);
});

await check('a size with its own stock is checked against it at checkout', async () => {
  await assert.rejects(
    resolveOrderCartItems(store, [{ itemId: String(item._id), variantId: half, quantity: 3 }]),
    /Only 2 left of Ghee \(500 ml\)/,
  );
  const ok = await resolveOrderCartItems(store, [{ itemId: String(item._id), variantId: half, quantity: 2 }]);
  assert.equal(ok[0].quantity, 2);
});

await check('saving sizes keeps, sets and clears GST; a form that omits it keeps the saved one', async () => {
  const existing = item.toObject().variants;
  const kept = normalizeFoodVariantsInput([{ _id: half, name: '500 ml', price: 300 }], { existing });
  assert.equal(kept[0].gstRate, 5);
  const set = normalizeFoodVariantsInput([{ _id: half, name: '500 ml', price: 300, gstRate: 18 }], { existing });
  assert.equal(set[0].gstRate, 18);
  const cleared = normalizeFoodVariantsInput([{ _id: half, name: '500 ml', price: 300, gstRate: null }], { existing });
  assert.equal(cleared[0].gstRate, null);
  assert.throws(() => normalizeFoodVariantsInput([{ name: 'x', price: 1, gstRate: 140 }]), /GST rate/);
  assert.equal(serializeFoodVariants(existing)[0].gstRate, 5);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
