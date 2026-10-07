/**
 * Deleting a rider from the admin list deactivates them for real.
 *
 * Run: node tests/admin-deactivate-rider.smoke.mjs
 *
 * Found 2026-10-01: the Delete button on /admin/food/delivery-partners called
 * adminAPI.deleteDeliveryPartner, which did not exist, and the Food admin API
 * had no route for it, so the rider stayed on the list and kept working.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'deactivate_rider' });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
};

const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const admin = await import('../src/modules/food/admin/services/admin.service.js');

const drivers = mongoose.connection.db.collection('taxidrivers');
const driverId = new mongoose.Types.ObjectId();
await drivers.insertOne({ _id: driverId, name: 'R', phone: '+919822200001', isOnline: true, approve: true, vehicleType: 'bike' });
const rider = await FoodDeliveryPartner.create({
  name: 'Rider', phone: '9822200001', status: 'approved', availabilityStatus: 'online',
  driverId, fcmTokens: ['web-token'], fcmTokenMobile: ['phone-token'],
});
const busy = await FoodDeliveryPartner.create({ name: 'Busy', phone: '9822200002', status: 'approved', availabilityStatus: 'online' });
await FoodOrder.collection.insertOne({ order_id: 'FOD-1', orderStatus: 'picked_up', dispatch: { status: 'accepted', deliveryPartnerId: busy._id }, createdAt: new Date() });

await check('a rider carrying an order is not deactivated', async () => {
  const err = await admin.deactivateDeliveryPartner(String(busy._id)).then(() => null, (e) => e);
  assert.match(String(err?.message), /carrying an order/);
  assert.equal((await FoodDeliveryPartner.findById(busy._id).lean()).status, 'approved');
});

await check('deactivating: off the list, offline everywhere, push tokens gone, record kept', async () => {
  const out = await admin.deactivateDeliveryPartner(String(rider._id));
  assert.equal(out.status, 'deactivated');
  const p = await FoodDeliveryPartner.findById(rider._id).lean();
  assert.ok(p, 'record deleted instead of kept');
  assert.equal(p.status, 'deactivated');
  assert.equal(p.availabilityStatus, 'offline');
  assert.deepEqual(p.fcmTokens, []);
  assert.deepEqual(p.fcmTokenMobile, []);
  const d = await drivers.findOne({ _id: driverId });
  assert.equal(d.isOnline, false);
  assert.equal(d.approve, false);
  const { deliveryPartners } = await admin.getDeliveryPartners({});
  assert.ok(!(deliveryPartners || []).some((x) => String(x._id) === String(rider._id)), 'still listed');
});

await check('an unknown id is a 404, not a crash', async () => {
  assert.equal(await admin.deactivateDeliveryPartner(String(new mongoose.Types.ObjectId())), null);
});

await check('a driver deleted the old way signs up again as a NEW account; the old one is gone', async () => {
  const { registerDeliveryPartner } = await import('../src/modules/food/delivery/services/delivery.service.js');
  const again = await registerDeliveryPartner({
    name: 'Rider Again', phone: '9822200001', city: 'Indore', state: 'MP', vehicleType: 'bike',
    vehicleNumber: 'MP09AB1234', drivingLicenseNumber: 'DL123', panNumber: 'ABCDE1234F', aadharNumber: '123412341234',
    vehicleRcPhoto: 'https://example.com/rc.jpg', // a motorised vehicle needs its RC (plan §4.11)
  }, {});
  const id = String(again?._id || again?.partner?._id || again?.deliveryPartner?._id || '');
  assert.ok(id && id !== String(rider._id), 'the deleted account was reused, bringing its old records back');
  assert.equal(await FoodDeliveryPartner.findById(rider._id).lean(), null);
  assert.equal(await drivers.findOne({ _id: driverId }), null);
  const p = await FoodDeliveryPartner.findById(id).lean();
  assert.equal(p.status, 'pending');
  assert.equal(p.name, 'Rider Again');
  const { requests } = await admin.getDeliveryJoinRequests({ status: 'pending' });
  assert.ok(requests.some((r) => String(r._id) === id), 'not in Join Requests');
});

await check('the OTP login sends a deleted driver to sign-up, not "pending verification"', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/core/auth/auth.service.js', import.meta.url), 'utf8');
  assert.match(src, /status === "deactivated"\) \{\s*return \{ needsRegistration: true/);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
