/**
 * The Quick Commerce admin lists its stores, not the medical ones.
 *
 * Run: node tests/qc-admin-hides-medical-stores.smoke.mjs
 *
 * Seen live 2026-10-01: /admin/quick-commerce/restaurants listed every
 * pharmacy. A pharmacy is a quick-commerce seller with storeType 'pharmacy';
 * the Medical panel narrows to it, but the Quick panel sent no scope at all.
 * It now sends storeType=quick: every type except pharmacy.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'qc_hides_medical' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { FoodRestaurant } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');
const admin = await import('../src/modules/quickCommerce/modules/food/admin/services/admin.service.js');
const scope = await import('../src/modules/quickCommerce/modules/food/shared/storeScope.js');

const mk = (restaurantName, storeType) => FoodRestaurant.collection.insertOne({
  restaurantName, storeType, status: 'approved', isActive: true, createdAt: new Date(),
});
await mk('Fresh Mart', 'grocery');
await mk('Corner Kirana', 'kirana');
await mk('Old Store', undefined); // saved before store types existed
await mk('Apollo Pharmacy', 'pharmacy');

const names = (res) => (res.restaurants || res.data || res.items || res.list || []).map((r) => r.restaurantName || r.name).sort();

await check('the Quick panel (storeType=quick) lists every store except pharmacies', async () => {
  const res = await admin.getRestaurants({ storeType: 'quick' });
  assert.deepEqual(names(res), ['Corner Kirana', 'Fresh Mart', 'Old Store'], JSON.stringify(Object.keys(res)));
});

await check('the Medical panel (storeType=pharmacy) still lists only pharmacies', async () => {
  const res = await admin.getRestaurants({ storeType: 'pharmacy' });
  assert.deepEqual(names(res), ['Apollo Pharmacy']);
});

await check('seller-scoped lists (products, orders) exclude pharmacies under quick', async () => {
  const ids = await scope.sellerIdsOfStoreType(FoodRestaurant, 'quick');
  assert.equal(ids.length, 3);
});

await check('an unknown store type is still refused', async () => {
  assert.throws(() => scope.normalizeStoreTypeFilter('spaceship'));
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
