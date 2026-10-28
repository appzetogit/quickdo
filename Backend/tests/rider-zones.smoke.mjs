/**
 * Delivery partners by zone, for zone-limited sub-admins.
 *
 * Run: node tests/rider-zones.smoke.mjs
 *
 *   - a rider who delivered in the zone, or whose last location is inside it, is
 *     in the sub-admin's list; one elsewhere, or with neither, is not;
 *   - an admin without a zone limit still sees every rider;
 *   - the /delivery/:id guard answers 404 outside the zone;
 *   - a delivery records the zone on the rider, once;
 *   - a zone Mongo cannot use as a shape falls back instead of failing the list.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`); }
};

const { FoodZone } = await import('../src/modules/food/admin/models/zone.model.js');
const { FoodDeliveryPartner: Rider } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { safeRiderZoneFilter, riderInZoneGuard, addRiderZone } = await import('../src/core/zones/riderZones.js');
await Rider.syncIndexes();

const oid = () => new mongoose.Types.ObjectId();
const square = (lat, lng, d = 0.05) => [
  { latitude: lat - d, longitude: lng - d }, { latitude: lat - d, longitude: lng + d },
  { latitude: lat + d, longitude: lng + d }, { latitude: lat + d, longitude: lng - d },
];
const indore = oid();
const bhopal = oid();
await FoodZone.collection.insertMany([
  { _id: indore, name: 'Indore', isActive: true, coordinates: square(22.72, 75.86) },
  { _id: bhopal, name: 'Bhopal', isActive: true, coordinates: square(23.26, 77.41) },
]);
const at = (lat, lng) => ({ type: 'Point', coordinates: [lng, lat] });
const rider = async (name, over) => {
  const _id = oid();
  await Rider.collection.insertOne({ _id, name, phone: String(Math.random()).slice(2, 12), status: 'approved', zoneIds: [], ...over });
  return _id;
};
const delivered = await rider('delivered in Indore', { zoneIds: [indore] });
const located = await rider('standing in Indore', { lastLocation: at(22.73, 75.87) });
const elsewhere = await rider('in Bhopal', { zoneIds: [bhopal], lastLocation: at(23.26, 77.41) });
const unknown = await rider('no zone, no location', {});

const visible = async (scope) => {
  const zone = await safeRiderZoneFilter('food', scope, Rider);
  const rows = await Rider.find({ status: 'approved', ...(zone ? { $and: [zone] } : {}) }).select('name').lean();
  return rows.map((r) => r.name).sort();
};

await check('an Indore sub-admin sees riders who delivered or are located in Indore', async () => {
  assert.deepEqual(await visible([String(indore)]), ['delivered in Indore', 'standing in Indore']);
});
await check('a Bhopal sub-admin sees only the Bhopal rider', async () => {
  assert.deepEqual(await visible([String(bhopal)]), ['in Bhopal']);
});
await check('an admin without a zone limit sees every rider', async () => {
  assert.equal((await visible(undefined)).length, 4);
});
await check('the rider detail guard: 404 outside the zone, through inside it', async () => {
  const guard = riderInZoneGuard('food', async () => Rider);
  const run = (id) => new Promise((resolve, reject) => {
    const res = { status(c) { this.code = c; return this; }, json() { resolve(this.code); return this; } };
    guard({ params: { id: String(id) }, query: { scopeZoneIds: [String(indore)] } }, res, (e) => (e ? reject(e) : resolve('next')));
  });
  assert.equal(await run(located), 'next');
  assert.equal(await run(elsewhere), 404);
  assert.equal(await run(unknown), 404);
});
await check('a delivery records the zone on the rider, once', async () => {
  await addRiderZone(Rider, unknown, indore);
  await addRiderZone(Rider, unknown, indore);
  const doc = await Rider.findById(unknown).lean();
  assert.deepEqual(doc.zoneIds.map(String), [String(indore)]);
});
await check('a zone with a shape Mongo rejects falls back to delivered-in zones', async () => {
  const bowtie = oid();
  await FoodZone.collection.insertOne({
    _id: bowtie, name: 'Bad shape', isActive: true,
    coordinates: [
      { latitude: 0, longitude: 0 }, { latitude: 1, longitude: 1 },
      { latitude: 0, longitude: 1 }, { latitude: 1, longitude: 0 },
    ],
  });
  await Rider.collection.insertOne({ _id: oid(), name: 'delivered in bad zone', status: 'approved', zoneIds: [bowtie] });
  assert.deepEqual(await visible([String(bowtie)]), ['delivered in bad zone']);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall rider zone checks passed');
process.exit(failed ? 1 : 0);
