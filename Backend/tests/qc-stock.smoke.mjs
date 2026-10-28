/**
 * Quick-commerce stock, per variant and per store.
 *
 * Run: node tests/qc-stock.smoke.mjs
 *
 * What this guards:
 *   - buying takes stock off the exact variant bought, and only that one;
 *   - an order for more than is left is refused and leaves every count as it was;
 *   - two buyers cannot both get the last unit;
 *   - cancelling puts stock back on the same variant, once;
 *   - untracked products (every product made before stock) sell as before;
 *   - editing a product in the old forms, which never send stock, keeps it;
 *   - the product hides when the last variant sells out, and returns on restock;
 *   - a store cannot change another store's stock; every change is recorded.
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
await mongoose.connect(mongo.getUri('qc_stock'));

const base = '../src/modules/quickCommerce/modules/food';
const { FoodItem } = await import(`${base}/admin/models/food.model.js`);
const { FoodOrder } = await import(`${base}/orders/models/order.model.js`);
const { QCStockMovement } = await import(`${base}/admin/models/stockMovement.model.js`);
const inv = await import(`${base}/orders/services/inventory.service.js`);
const stock = await import(`${base}/admin/services/stock.service.js`);
const { normalizeFoodVariantsInput } = await import(`${base}/admin/services/foodVariant.service.js`);

const storeA = new mongoose.Types.ObjectId();
const storeB = new mongoose.Types.ObjectId();

const butter = await FoodItem.create({
  restaurantId: storeA, name: 'Amul Butter', price: 60, isAvailable: true,
  variants: [
    { name: '100 g', price: 60, stockQty: 5 },
    { name: '500 g', price: 280, stockQty: 1 },
  ],
});
const [small, large] = butter.variants;
const rice = await FoodItem.create({ restaurantId: storeA, name: 'Rice', price: 90, isAvailable: true });
const milk = await FoodItem.create({ restaurantId: storeB, name: 'Milk', price: 30, stockQty: 10, isAvailable: true });

const fresh = (id) => FoodItem.findById(id).lean();
const v = (doc, variant) => doc.variants.find((x) => String(x._id) === String(variant._id)).stockQty;

await check('buying takes stock off the variant bought, and only that one', async () => {
  await inv.reserveStockForItems([{ itemId: butter._id, variantId: small._id, quantity: 2 }]);
  const doc = await fresh(butter._id);
  assert.equal(v(doc, small), 3);
  assert.equal(v(doc, large), 1);
});

await check('asking for more than is left is refused, and nothing changes', async () => {
  await assert.rejects(
    inv.reserveStockForItems([
      { itemId: butter._id, variantId: small._id, quantity: 1 },
      { itemId: butter._id, variantId: large._id, quantity: 2 },
    ]),
    /Only 1 left of Amul Butter \(500 g\)/,
  );
  const doc = await fresh(butter._id);
  assert.equal(v(doc, small), 3, 'the line that succeeded was put back');
  assert.equal(v(doc, large), 1);
});

await check('two buyers cannot both get the last unit', async () => {
  const results = await Promise.allSettled([
    inv.reserveStockForItems([{ itemId: butter._id, variantId: large._id, quantity: 1 }]),
    inv.reserveStockForItems([{ itemId: butter._id, variantId: large._id, quantity: 1 }]),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(v(await fresh(butter._id), large), 0);
});

await check('untracked products sell without limit', async () => {
  const taken = await inv.reserveStockForItems([{ itemId: rice._id, quantity: 500 }]);
  assert.equal(taken.length, 0);
  assert.equal((await fresh(rice._id)).stockQty, null);
});

await check('cancelling puts stock back on the same variant, once', async () => {
  const order = await FoodOrder.collection.insertOne({
    stockReservedAt: new Date(), stockRestoredAt: null,
    items: [{ itemId: butter._id, variantId: String(large._id), quantity: 1 }],
  });
  const o = { _id: order.insertedId, stockReservedAt: new Date() };
  assert.equal(await inv.restoreOrderStock(o), true);
  assert.equal(await inv.restoreOrderStock(o), false);
  assert.equal(v(await fresh(butter._id), large), 1);
});

await check('the product hides when every variant is out, and returns on restock', async () => {
  await stock.adjustStock({ itemId: butter._id, variantId: small._id, mode: 'set', value: 0 });
  await inv.reserveStockForItems([{ itemId: butter._id, variantId: large._id, quantity: 1 }]);
  assert.equal((await fresh(butter._id)).isAvailable, false);
  await stock.adjustStock({ itemId: butter._id, variantId: large._id, mode: 'add', value: 4 });
  const doc = await fresh(butter._id);
  assert.equal(doc.isAvailable, true);
  assert.equal(v(doc, large), 4);
});

await check('a store switched off by hand stays off after a restock', async () => {
  await FoodItem.updateOne({ _id: milk._id }, { $set: { isAvailable: false, stockOffMode: 'manual' } });
  await stock.adjustStock({ itemId: milk._id, mode: 'add', value: 5 });
  assert.equal((await fresh(milk._id)).isAvailable, false);
});

await check('old edit forms that never send stock keep it', async () => {
  const doc = await fresh(butter._id);
  const next = normalizeFoodVariantsInput(
    [{ _id: String(small._id), name: '100 g', price: 65 }, { name: '500 g', price: 290 }],
    { existing: doc.variants },
  );
  assert.equal(next[0].stockQty, 0);
  assert.equal(next[1].stockQty, 4, 'matched by name when the form dropped the id');
  assert.equal(String(next[1]._id), String(large._id));
});

await check('a store cannot change another store\'s stock', async () => {
  await assert.rejects(
    stock.adjustStock({ itemId: milk._id, mode: 'set', value: 1, restaurantId: storeA }),
    /another store/,
  );
});

await check('the list shows one row per variant, with status and totals', async () => {
  const res = await stock.listStock({ restaurantId: String(storeA) });
  assert.equal(res.rows.length, 3);
  const row = res.rows.find((r) => r.variantName === '100 g');
  assert.equal(row.status, 'out');
  assert.equal(res.summary.out, 1);
  const attention = await stock.listStock({ restaurantId: String(storeA), status: 'attention' });
  assert.equal(attention.rows.length, 1);
});

await check('the Quick Commerce panel lists every store but pharmacies, Medical only pharmacies', async () => {
  await mongoose.connection.collection('qc_restaurants').insertMany([
    { _id: storeA, restaurantName: 'Kirana', storeType: 'kirana' },
    { _id: storeB, restaurantName: 'Chemist', storeType: 'pharmacy' },
  ]);
  const quick = await stock.listStock({ storeType: 'quick' });
  assert.deepEqual([...new Set(quick.rows.map((r) => r.restaurantId))], [String(storeA)]);
  const medical = await stock.listStock({ storeType: 'pharmacy' });
  assert.deepEqual(medical.rows.map((r) => r.itemName), ['Milk']);
  // A pharmacy picked under Quick Commerce is out of scope: nothing, not everything.
  assert.equal((await stock.listStock({ storeType: 'quick', restaurantId: String(storeB) })).rows.length, 0);
  await mongoose.connection.collection('qc_restaurants').deleteMany({});
});

await check('bulk upload by SKU, with a per-row report', async () => {
  await FoodItem.updateOne({ _id: butter._id, 'variants._id': small._id }, { $set: { 'variants.$.sku': 'AB-100' } });
  const out = await stock.bulkAdjust(
    [{ sku: 'AB-100', value: 12 }, { sku: 'NOPE', value: 1 }],
    { restaurantId: String(storeA), reason: 'import' },
  );
  assert.equal(out.updated, 1);
  assert.equal(out.failed, 1);
  assert.equal(v(await fresh(butter._id), small), 12);
});

await check('every change is recorded with its reason', async () => {
  const history = await stock.stockHistory({ itemId: String(butter._id), variantId: String(small._id) });
  const reasons = history.map((h) => h.reason);
  assert.ok(reasons.includes('sale'));
  assert.ok(reasons.includes('manual'));
  assert.ok(reasons.includes('import'));
  assert.equal(history[0].after, 12);
  assert.ok((await QCStockMovement.countDocuments({ reason: 'cancel' })) >= 1);
});

await check('the store is told once when a size runs low, and when it runs out', async () => {
  const { FoodNotification } = await import('../src/modules/quickCommerce/core/notifications/models/notification.model.js');
  const tea = await FoodItem.create({
    restaurantId: storeA, name: 'Tea', price: 50, isAvailable: true,
    variants: [{ name: '250 g', price: 50, stockQty: 6, lowStockThreshold: 3 }],
  });
  const v250 = tea.variants[0];
  const alerts = () => FoodNotification.find({ ownerId: storeA, source: 'STOCK_ALERT', 'metadata.itemId': String(tea._id) }).lean();
  const settle = () => new Promise((r) => setTimeout(r, 300));
  await inv.reserveStockForItems([{ itemId: tea._id, variantId: v250._id, quantity: 2 }]); // 6 -> 4
  await settle();
  assert.equal((await alerts()).length, 0, 'still above the warning level');
  await inv.reserveStockForItems([{ itemId: tea._id, variantId: v250._id, quantity: 1 }]); // 4 -> 3
  await settle();
  let list = await alerts();
  assert.equal(list.length, 1);
  assert.match(list[0].message, /Only 3 left of Tea \(250 g\)/);
  await inv.reserveStockForItems([{ itemId: tea._id, variantId: v250._id, quantity: 1 }]); // 3 -> 2
  await settle();
  assert.equal((await alerts()).length, 1, 'no repeat while it stays low');
  await inv.reserveStockForItems([{ itemId: tea._id, variantId: v250._id, quantity: 2 }]); // 2 -> 0
  await settle();
  list = await alerts();
  assert.equal(list.length, 2);
  assert.ok(list.some((n) => n.title === 'Out of stock'));
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
