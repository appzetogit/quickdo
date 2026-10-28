/**
 * Create Driver asks what the driver will do, sets their services like an app
 * sign-up would, and leaves them ready to log into the partner app.
 *
 * Run: node tests/admin-create-driver-signup.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'create_driver_signup' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const admin = await import('../src/modules/taxi/admin/services/adminService.js');
const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const base = (phone) => ({ name: 'D', phone, password: 'secret123', password_confirmation: 'secret123', transport_type: 'delivery', approve: true, status: 'approved' });

await check('food + daily needs + medical + bike parcel rider: those services, linked app account', async () => {
  await admin.createDriver({ ...base('9700000001'), driverClass: 'two_wheeler', serviceIntents: ['food_daily_medical_parcel'] });
  const d = await Driver.findOne({ phone: '9700000001' }).lean();
  assert.deepEqual([...d.serviceCapabilities].sort(), ['delivery', 'parcel', 'quickCommerce']);
  assert.deepEqual(d.serviceIntents, ['food_daily_medical_parcel']);
  const p = await FoodDeliveryPartner.findOne({ phone: { $regex: '9700000001$' } }).lean();
  assert.equal(p.status, 'approved');
  assert.equal(String(p.driverId), String(d._id));
});

await check('4-wheeler taxi driver: taxi only', async () => {
  await admin.createDriver({ ...base('9700000002'), transport_type: 'taxi', driverClass: 'passenger_taxi', serviceIntents: ['four_wheeler'] });
  const d = await Driver.findOne({ phone: '9700000002' }).lean();
  assert.deepEqual(d.serviceCapabilities, ['taxi']);
  assert.ok(await FoodDeliveryPartner.exists({ phone: { $regex: '9700000002$' } }));
});

await check('a class with no option chosen is refused', async () => {
  await assert.rejects(admin.createDriver({ ...base('9700000003'), driverClass: 'two_wheeler', serviceIntents: [] }), /what this driver will do/);
});

await check('the form gets the app\'s sign-up choices', async () => {
  const { listOnboardingOptions } = await import('../src/modules/food/delivery/services/onboardingRequirements.service.js');
  assert.equal(listOnboardingOptions().classes.length, 3);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
