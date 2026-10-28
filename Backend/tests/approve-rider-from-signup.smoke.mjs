/**
 * Approving a rider sets them up from what they chose at sign-up.
 *
 * Run: node tests/approve-rider-from-signup.smoke.mjs
 *
 * Found 2026-10-01: an option-1 rider ("Food + Daily needs + Medical + Bike
 * parcel") was approved with a stale pre-tick, the driver record got neither
 * their sign-up choice nor a usable vehicle type (the vehicle's catalogue id
 * landed in vehicleType), so the app could not pick the right toggle and
 * parcel matching by 'bike' missed them.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
await mongoose.connect(replSet.getUri(), { dbName: 'approve_rider' });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
};

const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');
const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
const admin = await import('../src/modules/food/admin/services/admin.service.js');

const scooty = new mongoose.Types.ObjectId();
await Vehicle.collection.insertOne({ _id: scooty, name: 'Scooty', icon_types: 'bike', transport_type: 'taxi' });

const signUp = (phone, intents) => FoodDeliveryPartner.collection.insertOne({
  name: 'Rider', phone, status: 'pending', driverClass: 'two_wheeler',
  serviceIntents: intents, vehicleType: String(scooty), createdAt: new Date(),
}).then((r) => r.insertedId);

const option1 = await signUp('9811100001', ['food_daily_medical_parcel']);
const bikeTaxi = await signUp('9811100002', ['bike_taxi_parcel']);

await check('the join-request list suggests what each option entitles', async () => {
  const { requests } = await admin.getDeliveryJoinRequests({ status: 'pending' });
  const byId = new Map(requests.map((r) => [String(r._id), r]));
  assert.deepEqual(byId.get(String(option1)).requestedCapabilities.sort(), ['delivery', 'parcel', 'quickCommerce']);
  assert.deepEqual(byId.get(String(bikeTaxi)).requestedCapabilities, ['taxi']);
});

await check('approving option 1 (no list sent): food, quick, parcel; mode all; choice and vehicle copied', async () => {
  await admin.approveDeliveryPartner(String(option1));
  const p = await FoodDeliveryPartner.findById(option1).lean();
  const d = await Driver.findById(p.driverId).lean();
  assert.deepEqual([...d.serviceCapabilities].sort(), ['delivery', 'parcel', 'quickCommerce']);
  assert.equal(d.workMode, 'all');
  assert.deepEqual(d.serviceIntents, ['food_daily_medical_parcel']);
  assert.equal(d.driverClass, 'two_wheeler');
  assert.equal(d.vehicleType, 'bike');
  assert.equal(String(d.vehicleTypeId), String(scooty));
});

await check('approving Bike Taxi: passengers only, mode taxi', async () => {
  await admin.approveDeliveryPartner(String(bikeTaxi));
  const p = await FoodDeliveryPartner.findById(bikeTaxi).lean();
  const d = await Driver.findById(p.driverId).lean();
  assert.deepEqual(d.serviceCapabilities, ['taxi']);
  assert.equal(d.workMode, 'taxi');
  assert.equal(d.vehicleType, 'bike');
});

await mongoose.disconnect();
await replSet.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
