/**
 * Parcel and ride offers reach the delivery app as data-only pushes.
 *
 * Run: node tests/parcel-offer-push.smoke.mjs
 *
 * Seen live 2026-10-01: parcel requests were "ignored". Ride/parcel offers went
 * out as notification pushes, which a locked phone shows silently in the tray
 * without waking the app, so its ringing full-screen alert never came; food
 * offers are data-only and do ring. And a rider whose taxi record links to the
 * delivery account only one way (partner.driverId) got no push at all.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'parcel_offer_push' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const sent = [];
const { __setFirebaseMessagingForTests } = await import('../src/config/firebase.js');
__setFirebaseMessagingForTests({
  sendEachForMulticast: async (msg) => {
    sent.push(msg);
    return { responses: msg.tokens.map(() => ({ success: true })) };
  },
});

const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { sendPushNotificationToEntities } = await import('../src/modules/taxi/services/pushNotificationService.js');
const drivers = mongoose.connection.db.collection('taxidrivers');

// Linked both ways (legacyDeliveryPartnerId) and only one way (partner.driverId).
const twoWay = new mongoose.Types.ObjectId();
const oneWay = new mongoose.Types.ObjectId();
const p1 = await FoodDeliveryPartner.create({ name: 'A', phone: '9600000001', status: 'approved', driverId: twoWay, fcmTokenMobile: ['tok-two-way'] });
await FoodDeliveryPartner.create({ name: 'B', phone: '9600000002', status: 'approved', driverId: oneWay, fcmTokenMobile: ['tok-one-way'] });
await drivers.insertMany([
  { _id: twoWay, name: 'A', phone: '+919600000001', legacyDeliveryPartnerId: p1._id },
  { _id: oneWay, name: 'B', phone: '+919600000002' },
]);

const offer = (dataOnly) => sendPushNotificationToEntities({
  driverIds: [String(twoWay), String(oneWay)],
  dataOnly,
  title: 'New parcel delivery',
  body: 'Pickup: 12 MG Road',
  data: { type: 'ride_request', rideId: 'r1', serviceType: 'parcel' },
});

await check('an offer reaches both riders, including the one linked only one way', async () => {
  sent.length = 0;
  const r = await offer(true);
  assert.equal(r.deliveredCount, 2, JSON.stringify(r));
  assert.deepEqual(sent.flatMap((m) => m.tokens).sort(), ['tok-one-way', 'tok-two-way']);
});

await check('the offer is data-only, high priority, title and body in the data', async () => {
  const msg = sent[0];
  assert.equal(msg.notification, undefined, 'a notification block makes Android show it silently');
  assert.equal(msg.android.priority, 'high');
  assert.equal(msg.data.type, 'ride_request');
  assert.equal(msg.data.serviceType, 'parcel');
  assert.equal(msg.data.title, 'New parcel delivery');
  assert.equal(msg.data.body, 'Pickup: 12 MG Road');
});

await check('other pushes keep their notification block', async () => {
  sent.length = 0;
  await offer(false);
  assert.ok(sent[0].notification, 'ordinary pushes unchanged');
});

await check('the dispatcher sends ride/parcel offers data-only', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/modules/taxi/services/dispatchService.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf("type: 'ride_request'") - 600, src.indexOf("type: 'ride_request'"));
  assert.match(block, /dataOnly: true/);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
