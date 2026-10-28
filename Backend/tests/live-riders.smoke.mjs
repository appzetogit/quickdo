/**
 * Master > Live Drivers: everyone online, one row per person, with status and
 * whether their position is fresh.
 *
 * Run: node tests/live-riders.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'live_riders' });
const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { listLiveRiders, FRESH_MS } = await import('../src/core/delivery/liveRiders.js');

let failures = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  ok   ${label}`); }
  catch (err) { failures += 1; console.log(`  FAIL ${label}\n       ${err.message}`); }
};
const oid = () => new mongoose.Types.ObjectId();
const now = Date.now();
const raw = (Model, doc) => Model.collection.insertOne({ _id: oid(), ...doc });

// jk: taxi + food, the same person (partner.driverId), on a ride, fresh.
const jk = (await raw(Driver, { name: 'jk', phone: '9000006961', isOnline: true, isOnRide: true, activeAssignment: { type: 'ride', id: oid() }, vehicleType: 'bike', location: { type: 'Point', coordinates: [76.54, 32.11] }, updatedAt: new Date(now - 60_000) })).insertedId;
await raw(FoodDeliveryPartner, { name: 'jk', phone: '9000006961', status: 'approved', availabilityStatus: 'online', driverId: jk, lastLat: 32.111, lastLng: 76.541, lastLocationAt: new Date(now - 30_000) });
// Anil: taxi only, free, last seen 17 hours ago.
await raw(Driver, { name: 'Anil kumar', phone: '9000007210', isOnline: true, isOnRide: false, activeAssignment: null, location: { type: 'Point', coordinates: [76.536, 32.11] }, updatedAt: new Date(now - 17 * 3600_000) });
// Ravi: food only, free, fresh, no linked driver.
await raw(FoodDeliveryPartner, { name: 'Ravi', phone: '9000001111', status: 'approved', availabilityStatus: 'online', lastLat: 32.1, lastLng: 76.5, lastLocationAt: new Date(now - 120_000) });
// Mohan: online for taxi, delivery toggle off (a partner record, offline).
const mohan = (await raw(Driver, { name: 'Mohan', phone: '9000002222', isOnline: true, isOnRide: false, location: { type: 'Point', coordinates: [75, 31] }, updatedAt: new Date(now - 60_000) })).insertedId;
await raw(FoodDeliveryPartner, { name: 'Mohan', phone: '9000002222', status: 'approved', availabilityStatus: 'offline', driverId: mohan });
// Not shown: offline driver, suspended driver, pending partner.
await raw(Driver, { name: 'Off', phone: '9000000001', isOnline: false, location: { type: 'Point', coordinates: [76, 32] } });
await raw(Driver, { name: 'Suspended', phone: '9000000002', isOnline: true, approve: false, location: { type: 'Point', coordinates: [76, 32] } });
await raw(FoodDeliveryPartner, { name: 'Pending', status: 'pending', availabilityStatus: 'online' });

// Zones: a taxi polygon around jk and Anil, a food circle around Ravi only.
const { Zone } = await import('../src/modules/taxi/driver/models/Zone.js');
const { FoodZone } = await import('../src/modules/food/admin/models/zone.model.js');
const palampur = (await raw(Zone, { name: 'Palampur', active: true, geometry: { type: 'Polygon', coordinates: [[[76.52, 32.10], [76.56, 32.10], [76.56, 32.12], [76.52, 32.12], [76.52, 32.10]]] } })).insertedId;
const raviZone = (await raw(FoodZone, { name: 'Ravi Food', isActive: true, boundary_mode: 'circle', circle_center: { lat: 32.1, lng: 76.5 }, circle_radius_meters: 500 })).insertedId;
await raw(Zone, { name: 'Switched off', active: false, geometry: { type: 'Polygon', coordinates: [[[76, 32], [77, 32], [77, 33], [76, 33], [76, 32]]] } });

const result = await listLiveRiders({ now });
const byName = Object.fromEntries(result.riders.map((r) => [r.name, r]));

await check('only online, approved people are listed, once each', async () => {
  assert.deepEqual(result.riders.map((r) => r.name).sort(), ['Anil kumar', 'Mohan', 'Ravi', 'jk']);
});
await check('someone online on taxi and food is one row, on both services', async () => {
  assert.deepEqual(byName.jk.services, ['taxi', 'delivery']);
  assert.equal(byName.jk.status, 'on_ride');
});
await check('the newer position wins (the food app pinged after the driver record)', async () => {
  assert.deepEqual([byName.jk.lat, byName.jk.lng], [32.111, 76.541]);
  assert.equal(byName.jk.live, true);
});
await check('a position older than the fresh window is marked stale', async () => {
  assert.equal(byName['Anil kumar'].live, false);
  assert.equal(byName['Anil kumar'].status, 'free');
  assert.equal(FRESH_MS, 5 * 60 * 1000);
});
await check('a food-only rider is listed with their own position', async () => {
  assert.deepEqual(byName.Ravi.services, ['delivery']);
  assert.deepEqual([byName.Ravi.lat, byName.Ravi.lng, byName.Ravi.live], [32.1, 76.5, true]);
});
await check('a rider whose app stopped checking in is not counted online', async () => {
  assert.equal(byName['Anil kumar'].live, false);
  assert.equal(result.stats.online, result.riders.filter((r) => r.live).length);
});
await check('the counts add up, live ones listed first', async () => {
  assert.deepEqual(
    [result.stats.online, result.stats.free, result.stats.onRide, result.stats.onDelivery, result.stats.live, result.stats.stale],
    [3, 2, 1, 0, 3, 1],
  );
  assert.equal(result.riders[result.riders.length - 1].name, 'Anil kumar');
});

await check('each online toggle is reported, null where not registered', async () => {
  assert.deepEqual(byName.jk.toggles, { taxi: true, delivery: true });
  assert.deepEqual(byName.Mohan.toggles, { taxi: true, delivery: false });
  assert.deepEqual(byName['Anil kumar'].toggles, { taxi: true, delivery: null });
  assert.deepEqual(byName.Ravi.toggles, { taxi: null, delivery: true });
});
await check('each rider is tagged with the zones their position is inside', async () => {
  assert.deepEqual(byName.jk.zones, [`taxi:${palampur}`]);
  assert.deepEqual(byName['Anil kumar'].zones, [`taxi:${palampur}`]);
  assert.deepEqual(byName.Ravi.zones, [`food:${raviZone}`]);
});
await check('the zone list has active zones only, with how many riders are in each', async () => {
  const z = Object.fromEntries(result.zones.map((x) => [x.name, x]));
  assert.deepEqual(Object.keys(z).sort(), ['Palampur', 'Ravi Food']);
  assert.deepEqual([z.Palampur.kind, z.Palampur.online, z['Ravi Food'].online], ['Taxi', 1, 1]);
  assert.equal(z.Palampur.outline.paths[0][0][0], 32.10);
});

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
