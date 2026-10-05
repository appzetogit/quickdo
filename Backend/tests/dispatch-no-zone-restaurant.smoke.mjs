/**
 * A rider is never offered an order from another city -- even when the
 * restaurant was saved without a zone, or the rider's location is old.
 *
 * Run: node tests/dispatch-no-zone-restaurant.smoke.mjs
 *
 * Reported live (22 Sep): a rider in Indore was offered "Taj", a Palampur
 * restaurant. Dispatch skipped the zone rule when the restaurant had no zoneId,
 * kept riders with stale or missing GPS as "999km away", and its nobody-in-range
 * fallback returned every online rider on the platform.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());
process.env.NODE_ENV = 'test';

const { FoodZone } = await import('../src/modules/food/admin/models/zone.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { clearZoneCache } = await import('../src/modules/food/shared/zoneMatching.js');
const { __testables } = await import('../src/modules/food/orders/services/order-dispatch.service.js');
const pick = __testables.listNearbyOnlineDeliveryPartners;

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); } catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

const square = (lat0, lng0, lat1, lng1) => [
  { latitude: lat0, longitude: lng0 }, { latitude: lat0, longitude: lng1 },
  { latitude: lat1, longitude: lng1 }, { latitude: lat1, longitude: lng0 },
];
await FoodZone.collection.insertMany([
  { name: 'Indore', isActive: true, coordinates: square(22.60, 75.75, 22.85, 76.00) },
  { name: 'Palampur', isActive: true, coordinates: square(32.00, 76.45, 32.20, 76.65) },
]);
clearZoneCache();

// "Taj" in Palampur, saved WITHOUT a zone.
const taj = (await FoodRestaurant.collection.insertOne({
  restaurantName: 'Taj', status: 'approved',
  location: { type: 'Point', coordinates: [76.5401, 32.1100] },
})).insertedId;

const now = new Date();
const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
const rider = (name, lat, lng, at) => ({ name, phone: String(Math.random()).slice(2, 12), status: 'approved', availabilityStatus: 'online', lastLat: lat, lastLng: lng, lastLocationAt: at });

await check('a rider in Indore is not offered a Palampur order', async () => {
  await FoodDeliveryPartner.collection.insertOne(rider('Indore now', 22.7282, 75.8843, now));
  const { partners } = await pick(taj, { maxKm: 60 });
  assert.equal(partners.length, 0);
});
await check('nor is a rider whose location is unknown', async () => {
  await FoodDeliveryPartner.collection.insertOne({ ...rider('No GPS', null, null, null) });
  const { partners } = await pick(taj, { maxKm: 60 });
  assert.equal(partners.length, 0);
});
await check('nor a rider whose last Palampur position is hours old', async () => {
  await FoodDeliveryPartner.collection.insertOne(rider('Stale Palampur', 32.1101, 76.5402, old));
  const { partners } = await pick(taj, { maxKm: 60 });
  assert.equal(partners.length, 0);
});
await check('a rider in Palampur right now is offered it', async () => {
  const id = (await FoodDeliveryPartner.collection.insertOne(rider('Palampur now', 32.1105, 76.5410, now))).insertedId;
  const { partners } = await pick(taj, { maxKm: 15 });
  assert.deepEqual(partners.map((p) => String(p.partnerId)), [String(id)]);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
