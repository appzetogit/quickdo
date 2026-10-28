/**
 * A driver created on the Taxi side logs into the partner app without
 * onboarding again.
 *
 * Run: node tests/taxi-driver-delivery-login.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'taxi_driver_login' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { partnerForExistingDriver } = await import('../src/core/identity/driverCapabilities.service.js');
const at = { type: 'Point', coordinates: [75.88, 22.72] };

const cab = await Driver.create({
  name: 'Cab Driver', phone: '+919600000001', password: 'secret123', vehicleType: 'car', location: at,
  serviceCapabilities: ['taxi'], driverClass: 'passenger_taxi', serviceIntents: ['taxi'], approve: true, status: 'approved',
  vehicleNumber: 'MP09CA1234',
});
await Driver.create({ name: 'New', phone: '9600000002', password: 'secret123', vehicleType: 'bike', location: at, approve: false, status: 'pending' });

await check('an approved taxi driver gets an approved, linked partner record', async () => {
  const p = await partnerForExistingDriver('9600000001');
  assert.equal(p.status, 'approved');
  assert.equal(p.name, 'Cab Driver');
  assert.equal(String(p.driverId), String(cab._id));
  assert.equal(p.driverClass, 'passenger_taxi');
  assert.equal(p.vehicleNumber, 'MP09CA1234');
  const d = await Driver.findById(cab._id).lean();
  assert.equal(String(d.legacyDeliveryPartnerId), String(p._id));
  assert.deepEqual(d.serviceCapabilities, ['taxi'], 'no delivery work granted');
});

await check('a second login reuses it', async () => {
  await partnerForExistingDriver('+91 96000 00001');
  assert.equal(await FoodDeliveryPartner.countDocuments({ phone: { $regex: '9600000001$' } }), 1);
});

await check('a driver under review stays under review', async () => {
  assert.equal((await partnerForExistingDriver('9600000002')).status, 'pending');
});

await check('no taxi driver: nothing created (onboarding as before)', async () => {
  assert.equal(await partnerForExistingDriver('9600000099'), null);
  assert.equal(await FoodDeliveryPartner.countDocuments({ phone: '9600000099' }), 0);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
