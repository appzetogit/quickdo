/**
 * Delete on the rider list removes the rider for good; past orders stay.
 *
 * Run: node tests/admin-delete-rider-permanent.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'delete_rider' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const db = mongoose.connection.db;
const oid = () => new mongoose.Types.ObjectId();
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const admin = await import('../src/modules/food/admin/services/admin.service.js');

const driverId = oid();
await db.collection('taxidrivers').insertOne({ _id: driverId, name: 'R', phone: '+919833300001', approve: true });
const rider = await FoodDeliveryPartner.create({ name: 'Rider', phone: '9833300001', status: 'approved', driverId, vehicleNumber: 'MP09ZZ0001' });
const qcCopy = oid();
await db.collection('qc_delivery_partners').insertOne({ _id: qcCopy, name: 'Rider', phone: '9833300001', status: 'approved' });
await db.collection('food_delivery_wallets').insertOne({ deliveryPartnerId: rider._id, balance: 0 });
await db.collection('qc_delivery_wallets').insertOne({ deliveryPartnerId: qcCopy, balance: 0 });
await db.collection('food_delivery_profiles').insertOne({ driverId, legacyDeliveryPartnerId: rider._id });
await FoodOrder.collection.insertOne({ order_id: 'FOD-OLD', orderStatus: 'delivered', dispatch: { status: 'accepted', deliveryPartnerId: rider._id }, createdAt: new Date() });

await check('a rider with money on the account is not deleted without a second yes', async () => {
  const rich = await FoodDeliveryPartner.create({ name: 'Rich', phone: '9833300009', status: 'approved' });
  await admin.addDeliveryPartnerBonus({ deliveryPartnerId: String(rich._id), amount: 150, reference: 'test' }, null);
  const first = await admin.deleteDeliveryPartnerPermanently(String(rich._id));
  assert.equal(first.needsConfirm, true);
  assert.equal(first.walletBalance, 150);
  assert.ok(await FoodDeliveryPartner.findById(rich._id).lean(), 'deleted without confirmation');
  const forced = await admin.deleteDeliveryPartnerPermanently(String(rich._id), { force: true });
  assert.equal(forced.deleted, true);
  assert.equal(await FoodDeliveryPartner.findById(rich._id).lean(), null);
});

await check('delete removes the rider, its Quick copy, taxi record, wallets and profile; orders stay', async () => {
  const out = await admin.deleteDeliveryPartnerPermanently(String(rider._id));
  assert.equal(out.deleted, true);
  assert.equal(await FoodDeliveryPartner.findById(rider._id).lean(), null);
  assert.equal(await db.collection('qc_delivery_partners').findOne({ _id: qcCopy }), null);
  assert.equal(await db.collection('taxidrivers').findOne({ _id: driverId }), null);
  assert.equal(await db.collection('food_delivery_wallets').countDocuments({ deliveryPartnerId: rider._id }), 0);
  assert.equal(await db.collection('qc_delivery_wallets').countDocuments({ deliveryPartnerId: qcCopy }), 0);
  assert.equal(await db.collection('food_delivery_profiles').countDocuments({ legacyDeliveryPartnerId: rider._id }), 0);
  assert.ok(await FoodOrder.collection.findOne({ order_id: 'FOD-OLD' }), 'past order was removed');
});

await check('signing up again on the same number and bike is a clean new account', async () => {
  const { registerDeliveryPartner } = await import('../src/modules/food/delivery/services/delivery.service.js');
  const again = await registerDeliveryPartner({
    name: 'Rider New', phone: '9833300001', city: 'Indore', state: 'MP', vehicleType: 'bike',
    vehicleNumber: 'MP09ZZ0001', drivingLicenseNumber: 'DL1', panNumber: 'ABCDE1234F', aadharNumber: '123412341234',
    vehicleRcPhoto: 'https://example.com/rc.jpg', // a motorised vehicle needs its RC (plan §4.11)
  }, {});
  const id = String(again?._id || again?.partner?._id || again?.deliveryPartner?._id || '');
  assert.ok(id && id !== String(rider._id));
  assert.equal(await FoodOrder.collection.countDocuments({ 'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(id) }), 0);
});

await check('an unknown id is a 404', async () => {
  assert.equal(await admin.deleteDeliveryPartnerPermanently(String(oid())), null);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
