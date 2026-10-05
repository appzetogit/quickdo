/**
 * "Food + Daily needs + Medical + Bike parcel" riders get bike parcel requests;
 * "Bike Taxi" riders get passengers, not parcels.
 *
 * Run: node tests/bike-parcel-with-delivery.smoke.mjs
 *
 * Client, 2026-10-01: a 2-wheeler rider picks one of the two. Bike parcel goes
 * with the delivery rider; Bike Taxi (passengers) is the commercial option.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.UNIFIED_DISPATCH_ENABLED = 'true';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'bike_parcel' });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
};

const { buildDriverMatchFilters } = await import('../src/modules/taxi/services/matchingService.js');
const { coerceWorkMode } = await import('../src/core/identity/driverCapabilities.service.js');
const { capabilitiesForIntents, oneTwoWheelerIntent } = await import('../src/modules/taxi/shared/driverClasses.js');
const { setWorkMode } = await import('../src/modules/taxi/driver/controllers/driverController.js');
const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');

const drivers = mongoose.connection.db.collection('taxidrivers');
const base = { name: 'R', isOnline: true, isOnRide: false, approve: true, deletedAt: null, wallet: { isBlocked: false }, activeAssignment: null, vehicleType: 'bike' };
const deliveryCaps = capabilitiesForIntents(['food_daily_medical_parcel']);
const rider = { _id: new mongoose.Types.ObjectId(), ...base, phone: '+919800000001', registerFor: 'delivery', serviceCapabilities: deliveryCaps, workMode: coerceWorkMode('delivery', deliveryCaps) };
const bikeTaxi = { _id: new mongoose.Types.ObjectId(), ...base, phone: '+919800000002', registerFor: 'taxi', serviceCapabilities: capabilitiesForIntents(['bike_taxi_parcel']), workMode: 'taxi' };
await drivers.insertMany([rider, bikeTaxi]);

const match = async (serviceType, transportType) => {
  const filter = buildDriverMatchFilters({ vehicleTypeKeys: ['bike'], transportType, serviceType });
  return (await drivers.find(filter).toArray()).map((d) => String(d._id));
};

await check('option 1 is granted parcel, and its delivery mode is "all"', async () => {
  assert.ok(deliveryCaps.includes('parcel'));
  assert.ok(!deliveryCaps.includes('taxi'));
  assert.equal(rider.workMode, 'all');
});
await check('a bike parcel request reaches the option-1 rider (taxi or delivery transport)', async () => {
  assert.ok((await match('parcel', 'delivery')).includes(String(rider._id)));
  assert.ok((await match('parcel', 'taxi')).includes(String(rider._id)));
});
await check('a bike parcel request does not go to a Bike Taxi rider', async () => {
  assert.ok(!(await match('parcel', 'delivery')).includes(String(bikeTaxi._id)));
});
await check('a passenger ride goes to the Bike Taxi rider, never the option-1 rider', async () => {
  const got = await match('ride', 'taxi');
  assert.ok(got.includes(String(bikeTaxi._id)));
  assert.ok(!got.includes(String(rider._id)));
});
await check('the app switching an option-1 rider to "delivery" keeps them on "all"', async () => {
  await Driver.collection.updateOne({ _id: rider._id }, { $set: { workMode: 'delivery' } });
  const res = { json(b) { this.body = b; return this; } };
  await setWorkMode({ body: { workMode: 'delivery' }, auth: { sub: String(rider._id) } }, res);
  assert.equal(res.body.data.workMode, 'all');
});
await check('the two 2-wheeler options are one choice at sign-up', async () => {
  assert.deepEqual(oneTwoWheelerIntent(['bike_taxi_parcel', 'food_daily_medical_parcel']), ['bike_taxi_parcel']);
  assert.deepEqual(oneTwoWheelerIntent(['food_daily_medical_parcel']), ['food_daily_medical_parcel']);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
