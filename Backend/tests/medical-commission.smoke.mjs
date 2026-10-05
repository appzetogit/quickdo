/**
 * Pharmacy commission (admin: Medical, Commission).
 *
 * Run: node tests/medical-commission.smoke.mjs
 *
 *   - a pharmacy with no rate of its own pays the medical default;
 *   - a pharmacy's own rate (percent or flat) beats the default;
 *   - a grocery seller never pays the medical default;
 *   - rates are validated, and only pharmacies can be given one here.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());

const svc = await import('../src/modules/quickCommerce/modules/food/admin/services/medicalCommission.service.js');
const tx = await import('../src/modules/quickCommerce/modules/food/orders/services/foodTransaction.service.js');
const { FoodRestaurant } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');

const col = FoodRestaurant.collection;
const pharmacy = (await col.insertOne({ restaurantName: 'Care Pharmacy', storeType: 'pharmacy', status: 'approved' })).insertedId;
const pharmacy2 = (await col.insertOne({ restaurantName: 'Plus Pharmacy', storeType: 'pharmacy', status: 'approved' })).insertedId;
const grocery = (await col.insertOne({ restaurantName: 'Fresh Mart', storeType: 'grocery', status: 'approved' })).insertedId;
const order = (restaurantId, subtotal = 1000) => ({ restaurantId, pricing: { subtotal } });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); } catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

await check('no default yet: nothing is charged', async () => {
  assert.equal((await tx.getRestaurantCommissionSnapshot(order(pharmacy))).commissionAmount, 0);
});
await check('a pharmacy with no rate pays the default', async () => {
  await svc.setMedicalDefaultCommission({ type: 'percentage', value: 10 });
  assert.equal((await tx.getRestaurantCommissionSnapshot(order(pharmacy))).commissionAmount, 100);
});
await check('a grocery seller never pays the medical default', async () => {
  assert.equal((await tx.getRestaurantCommissionSnapshot(order(grocery))).commissionAmount, 0);
});
await check('the list shows every pharmacy and where its rate comes from', async () => {
  await svc.setShopCommission(pharmacy2, { type: 'amount', value: 25 });
  const list = await svc.listMedicalCommissions();
  assert.equal(list.shops.length, 2);
  const plus = list.shops.find((s) => s.name === 'Plus Pharmacy');
  assert.equal(plus.source, 'own');
  assert.deepEqual(plus.rate, { type: 'amount', value: 25 });
  assert.equal(list.shops.find((s) => s.name === 'Care Pharmacy').source, 'default');
});
await check('rates are validated and only pharmacies take one', async () => {
  await assert.rejects(svc.setMedicalDefaultCommission({ type: 'percentage', value: 120 }));
  await assert.rejects(svc.setShopCommission(pharmacy, { type: 'amount', value: -1 }));
  await assert.rejects(svc.setShopCommission(grocery, { type: 'percentage', value: 5 }));
});
await check('"Use default" puts the pharmacy back on the default', async () => {
  const r = await svc.clearShopCommission(pharmacy2);
  assert.equal(r.source, 'default');
  assert.equal((await svc.listMedicalCommissions()).shops.find((s) => s.name === 'Plus Pharmacy').source, 'default');
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
