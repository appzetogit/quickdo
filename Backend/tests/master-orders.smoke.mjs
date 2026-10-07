/**
 * Master > Orders lists every order on the platform, per tab.
 *
 * Run: node tests/master-orders.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'master_orders' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { FoodOrder: QcOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
const { listMasterOrders } = await import('../src/core/orders/masterOrders.service.js');
const db = mongoose.connection.db;

const oid = () => new mongoose.Types.ObjectId();
const t = (min) => new Date(Date.now() - min * 60000);
const foodUser = oid(); const qcUser = oid(); const rider = oid(); const store = oid(); const pharmacy = oid();
await db.collection('users').insertOne({ _id: foodUser, name: 'Asha', phone: '9000000001' });
await db.collection('qc_users').insertOne({ _id: qcUser, name: 'Ravi', phone: '9000000002' });
await db.collection('food_restaurants').insertOne({ _id: store, restaurantName: 'Rainbow Restaurant' });
await db.collection('qc_restaurants').insertOne({ _id: pharmacy, restaurantName: 'Quick Medical' });
await db.collection('food_delivery_partners').insertOne({ _id: rider, name: 'Rishi', phone: '9000000003' });

await FoodOrder.collection.insertMany([
  { order_id: 'FOD-1', orderStatus: 'preparing', userId: foodUser, restaurantId: store, pricing: { total: 250 }, payment: { method: 'cash' }, dispatch: { status: 'unassigned' }, createdAt: t(1) },
  { order_id: 'FOD-2', orderStatus: 'delivered', userId: foodUser, restaurantId: store, pricing: { total: 120 }, dispatch: { status: 'accepted', deliveryPartnerId: rider }, createdAt: t(50) },
]);
await QcOrder.collection.insertMany([
  { order_id: 'QC-1', orderStatus: 'confirmed', userId: qcUser, pricing: { total: 80 }, createdAt: t(3) },
  { order_id: 'MED-1', orderStatus: 'preparing', userId: qcUser, restaurantId: pharmacy, prescriptionOnly: true, pricing: { total: 325 }, createdAt: t(2) },
]);
await Ride.collection.insertMany([
  { userId: foodUser, serviceType: 'ride', liveStatus: 'completed', status: 'completed', fare: 90, pickupAddress: 'A', dropAddress: 'B', createdAt: t(4) },
  { userId: foodUser, serviceType: 'parcel', liveStatus: 'searching', status: 'searching', fare: 54, pickupAddress: 'C', dropAddress: 'D', createdAt: t(5) },
]);

await check('All: every order, newest first, with counts per service', async () => {
  const r = await listMasterOrders({ tab: 'all' });
  assert.deepEqual(r.orders.map((o) => o.orderId).slice(0, 4), ['FOD-1', 'MED-1', 'QC-1', r.orders[3].orderId]);
  assert.equal(r.total, 6);
  // The old MED- (pharmacy) order is a Quick order now: no Medical tab.
  // The old parcel trip is a ride now: no Parcel tab.
  assert.deepEqual(r.counts, { food: 2, quick: 2, taxi: 2, services: 0 });
});

await check('each tab shows only its service', async () => {
  await assert.rejects(() => listMasterOrders({ tab: 'medical' }), /Unknown tab/);
  await assert.rejects(() => listMasterOrders({ tab: 'parcel' }), /Unknown tab/);
  assert.deepEqual((await listMasterOrders({ tab: 'quick' })).orders.map((o) => o.orderId), ['MED-1', 'QC-1']);
  const taxi = (await listMasterOrders({ tab: 'taxi' })).orders;
  assert.equal(taxi.length, 2);
  assert.ok(taxi.every((o) => o.source === 'taxi' && o.orderId.startsWith('RIDE-')));
});

await check('rows carry names, store, rider, and the API vertical for assigning', async () => {
  const { orders } = await listMasterOrders({ tab: 'all' });
  const fod2 = orders.find((o) => o.orderId === 'FOD-2');
  assert.equal(fod2.customerName, 'Asha');
  assert.equal(fod2.storeName, 'Rainbow Restaurant');
  assert.equal(fod2.riderName, 'Rishi');
  assert.equal(fod2.vertical, 'food');
  const med = orders.find((o) => o.orderId === 'MED-1');
  assert.equal(med.storeName, 'Quick Medical');
  assert.equal(med.customerName, 'Ravi');
  assert.equal(med.vertical, 'quickCommerce');
  assert.equal(med.source, 'quick');
});

await check('status filter and order-number search', async () => {
  assert.deepEqual((await listMasterOrders({ tab: 'food', status: 'delivered' })).orders.map((o) => o.orderId), ['FOD-2']);
  const active = await listMasterOrders({ tab: 'all', status: 'active' });
  assert.ok(!active.orders.some((o) => ['FOD-2'].includes(o.orderId)));
  // The searching (old parcel) trip is active.
  assert.ok(active.orders.some((o) => o.source === 'taxi'));
  assert.deepEqual((await listMasterOrders({ tab: 'all', search: 'med-1' })).orders.map((o) => o.orderId), ['MED-1']);
});

await check('paging across services', async () => {
  const p1 = await listMasterOrders({ tab: 'all', limit: 4, page: 1 });
  const p2 = await listMasterOrders({ tab: 'all', limit: 4, page: 2 });
  assert.equal(p1.orders.length, 4);
  assert.equal(p2.orders.length, 2);
  assert.equal(new Set([...p1.orders, ...p2.orders].map((o) => o._id)).size, 6);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
