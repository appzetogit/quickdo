/**
 * One customer inbox across Food, Quick & Medical, Taxi and Services.
 *
 * Run: node tests/customer-inbox.smoke.mjs
 *
 * Drives the real push senders, then reads the inbox the app reads
 * (getInboxNotifications, ownerType USER, the platform user id):
 *   - every customer push is filed, even with no device registered;
 *   - Quick and Services ids are filed under the customer's platform account
 *     (platformUserId, else the same phone), whichever sender carried them;
 *   - a customer with no platform account is not filed anywhere unreadable;
 *   - the same update twice is filed once; restaurants and riders are not
 *     customers; skipInbox is honoured;
 *   - the inbox shows all four services, newest first.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

let failed = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
  }
};

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.MONGODB_URI = mongod.getUri();
await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection;

const core = await import('../src/core/notifications/firebase.service.js');
const quick = await import('../src/modules/quickCommerce/core/notifications/firebase.service.js');
const taxi = await import('../src/modules/taxi/services/pushNotificationService.js');
const { getInboxNotifications } = await import('../src/core/notifications/notification.service.js');
const { FoodNotification } = await import('../src/core/notifications/models/notification.model.js');
const require = createRequire(import.meta.url);
const { mirrorNotification } = require('../src/modules/serviceProvider/utils/mirrorNotification.js');

const oid = () => new mongoose.Types.ObjectId();

// Asha has one platform account, and her own row in Quick and in Services.
const asha = oid();
const ashaQuickLinked = oid();
const ashaQuickByPhone = oid();
const ashaServices = oid();
const stranger = oid();
await db.collection('users').insertOne({ _id: asha, name: 'Asha', phone: '9876543210' });
await db.collection('qc_users').insertMany([
  { _id: ashaQuickLinked, phone: '9876543210', platformUserId: asha },
  { _id: ashaQuickByPhone, phone: '+91 98765 43210' },
]);
await db.collection('sp_users').insertOne({ _id: ashaServices, phone: '9876543210', platformUserId: asha });
await db.collection('qc_users').insertOne({ _id: stranger, phone: '9000000000' }); // no platform account

const inbox = async () => (await getInboxNotifications({ ownerType: 'USER', ownerId: String(asha), limit: 50 })).items;
const push = (sender, ownerId, title, body, data = {}, extra = {}) =>
  sender.sendNotificationToOwner({ ownerType: 'USER', ownerId: String(ownerId), payload: { title, body, data, ...extra } });

console.log('\nFiled from every sender');
await check('Food: filed under the platform account, though Asha has no device registered', async () => {
  await push(core, asha, 'Order accepted', 'Joy is preparing your order', { type: 'order_status', orderId: 'FOD-1' });
  const n = (await inbox()).find((x) => x.title === 'Order accepted');
  assert.ok(n, 'not in inbox');
  assert.equal(n.vertical, 'food');
  assert.equal(n.source, 'ORDER');
  assert.equal(n.metadata.data.orderId, 'FOD-1');
});
await check('Quick: a Quick id is filed under her platform account', async () => {
  await push(quick, ashaQuickLinked, 'Out for delivery', 'Your groceries are on the way', { orderId: 'QC-1' });
  const n = (await inbox()).find((x) => x.title === 'Out for delivery');
  assert.ok(n, 'not in inbox');
  assert.equal(n.vertical, 'quickCommerce');
  assert.equal(n.metadata.serviceUserId, String(ashaQuickLinked));
});
await check('Quick id sent through Food\'s sender is still recognised as Quick', async () => {
  await push(core, ashaQuickLinked, 'Store replied', 'Your ticket has an answer');
  const n = (await inbox()).find((x) => x.title === 'Store replied');
  assert.equal(n?.vertical, 'quickCommerce');
});
await check('a Quick row with no link is matched by phone', async () => {
  await push(quick, ashaQuickByPhone, 'Refund issued', 'Rs 120 is on its way', { type: 'refund' });
  const n = (await inbox()).find((x) => x.title === 'Refund issued');
  assert.ok(n, 'not in inbox');
  assert.equal(n.source, 'PAYMENT');
});
await check('Taxi: a ride update to a rider is filed', async () => {
  await taxi.sendPushNotificationToEntities({ userIds: [String(asha)], title: 'Driver arriving', body: 'Ravi is 2 minutes away', data: { rideId: 'R1' } });
  const n = (await inbox()).find((x) => x.title === 'Driver arriving');
  assert.ok(n, 'not in inbox');
  assert.equal(n.vertical, 'taxi');
  assert.equal(n.source, 'RIDE');
});
await check('Services: its mirror now files under the platform account', async () => {
  await mirrorNotification({ _id: oid(), userId: ashaServices, title: 'Professional has reached', message: 'Your electrician is at the door', type: 'booking_update' });
  const n = (await inbox()).find((x) => x.title === 'Professional has reached');
  assert.ok(n, 'not in inbox');
  assert.equal(n.vertical, 'serviceProvider');
  assert.equal(n.source, 'BOOKING');
  assert.equal(await FoodNotification.countDocuments({ ownerId: ashaServices }), 0);
});

console.log('\nWhat is not filed');
await check('a customer with no platform account is not filed anywhere unreadable', async () => {
  await push(quick, stranger, 'Hello', 'Nobody reads this');
  assert.equal(await FoodNotification.countDocuments({ title: 'Hello' }), 0);
});
await check('a Services customer with no platform account keeps the old copy', async () => {
  const orphan = oid();
  await db.collection('sp_users').insertOne({ _id: orphan, phone: '9111111111' });
  await mirrorNotification({ _id: oid(), userId: orphan, title: 'Booking received', message: 'We got it', type: 'booking' });
  assert.equal(await FoodNotification.countDocuments({ ownerId: orphan }), 1);
});
await check('the same update twice is filed once', async () => {
  await push(core, asha, 'Order accepted', 'Joy is preparing your order', { orderId: 'FOD-1' });
  assert.equal((await inbox()).filter((x) => x.title === 'Order accepted').length, 1);
});
await check('restaurants and riders are not filed as customers', async () => {
  const shop = oid();
  await core.sendNotificationToOwner({ ownerType: 'RESTAURANT', ownerId: String(shop), payload: { title: 'New order', body: 'Accept it' } });
  await core.sendNotificationToOwner({ ownerType: 'DELIVERY_PARTNER', ownerId: String(asha), payload: { title: 'New trip', body: 'Pick up' } });
  assert.equal(await FoodNotification.countDocuments({ title: { $in: ['New order', 'New trip'] } }), 0);
});
await check('skipInbox is honoured', async () => {
  await push(core, asha, 'Silent', 'Background refresh', {}, { skipInbox: true });
  assert.equal(await FoodNotification.countDocuments({ title: 'Silent' }), 0);
});

console.log('\nThe inbox the app reads');
await check('shows all four services together, newest first', async () => {
  const items = await inbox();
  assert.deepEqual([...new Set(items.map((x) => x.vertical))].sort(), ['food', 'quickCommerce', 'serviceProvider', 'taxi']);
  assert.equal(items[0].title, 'Professional has reached');
  assert.equal(items.length, 6);
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll customer inbox checks passed');
process.exit(failed ? 1 : 0);
