/**
 * The customer app is told when no delivery partner is online in its zone.
 *
 * Run: node tests/app-services-riders-online.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'app_services_riders' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { FoodZone } = await import('../src/modules/food/admin/models/zone.model.js');
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const svc = await import('../src/core/appServices/appServices.service.js');

// A square around central Indore.
const ring = [
  { latitude: 22.70, longitude: 75.86 }, { latitude: 22.70, longitude: 75.91 },
  { latitude: 22.75, longitude: 75.91 }, { latitude: 22.75, longitude: 75.86 },
];
await FoodZone.collection.insertOne({ name: 'Indore', zoneName: 'Indore', isActive: true, coordinates: ring, createdAt: new Date() });
const here = { lat: 22.7282, lng: 75.8843 };
const food = async () => (await svc.resolveAppServicesAt(here)).services.find((s) => s.key === 'food');

await check('no rider online in the zone: the app is told, with a notice', async () => {
  // Online but outside the zone, and inside but offline: neither counts.
  await FoodDeliveryPartner.collection.insertMany([
    { name: 'Far', phone: '9700000001', status: 'approved', availabilityStatus: 'online', lastLat: 23.25, lastLng: 77.41, lastLocationAt: new Date() },
    { name: 'Off', phone: '9700000002', status: 'approved', availabilityStatus: 'offline', lastLat: 22.72, lastLng: 75.88, lastLocationAt: new Date() },
  ]);
  const f = await food();
  assert.equal(f.inZone, true);
  assert.equal(f.ridersAvailable, false);
  assert.equal(f.ridersOnline, 0);
  assert.match(f.notice, /No delivery partners/);
});

await check('a rider online inside the zone: available, no notice', async () => {
  await FoodDeliveryPartner.collection.insertOne({ name: 'Near', phone: '9700000003', status: 'approved', availabilityStatus: 'online', lastLat: 22.72, lastLng: 75.88, lastLocationAt: new Date() });
  await new Promise((r) => setTimeout(r, 31000)); // the count is cached for 30 s
  const f = await food();
  assert.equal(f.ridersAvailable, true);
  assert.equal(f.ridersOnline, 1);
  assert.equal(f.notice, null);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
