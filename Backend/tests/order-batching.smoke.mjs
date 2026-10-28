/**
 * Order batching: a second order joins a rider's trip only when it fits.
 *
 * Run: node tests/order-batching.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'order_batching' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const db = mongoose.connection.db;
const oid = () => new mongoose.Types.ObjectId();
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { FoodOrder: QcOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const batching = await import('../src/core/delivery/batching.js');
const config = await import('../src/core/config/resolver.service.js');

// Two stores 300 m apart in Indore, a third 4 km away.
const storeA = oid(); const storeB = oid(); const storeFar = oid(); const pharmacy = oid();
await db.collection('food_restaurants').insertMany([
  { _id: storeA, restaurantName: 'A', location: { type: 'Point', coordinates: [75.8800, 22.7200] } },
  { _id: storeB, restaurantName: 'B', location: { type: 'Point', coordinates: [75.8829, 22.7200] } },
  { _id: storeFar, restaurantName: 'Far', location: { type: 'Point', coordinates: [75.9200, 22.7200] } },
]);
await db.collection('qc_restaurants').insertOne({ _id: pharmacy, restaurantName: 'Med', location: { type: 'Point', coordinates: [75.8805, 22.7203] } });
const drop = (lng, lat) => ({ location: { type: 'Point', coordinates: [lng, lat] } });

const rider = await FoodDeliveryPartner.create({ name: 'R', phone: '9500000001', status: 'approved' });
const free = await FoodDeliveryPartner.create({ name: 'F', phone: '9500000002', status: 'approved' });
const first = (await FoodOrder.collection.insertOne({
  order_id: 'FOD-1', orderStatus: 'preparing', restaurantId: storeA, deliveryAddress: drop(75.8900, 22.7300),
  dispatch: { status: 'accepted', deliveryPartnerId: rider._id, acceptedAt: new Date() }, deliveryState: { currentPhase: 'en_route_to_pickup' }, createdAt: new Date(),
})).insertedId;
const near = { _id: oid(), restaurantId: storeB, deliveryAddress: drop(75.8910, 22.7310) };
const farDrop = { _id: oid(), restaurantId: storeB, deliveryAddress: drop(75.9500, 22.8000) };
const farStore = { _id: oid(), restaurantId: storeFar, deliveryAddress: drop(75.8910, 22.7310) };
const medical = { _id: oid(), restaurantId: pharmacy, deliveryAddress: drop(75.8905, 22.7305) };

await check('batching off: a rider on a trip gets no second order; a free rider still does', async () => {
  const v = await batching.canAddToTrip({ foodRiderId: rider._id, order: near, vertical: 'food' });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'one_order_at_a_time');
  assert.equal((await batching.canAddToTrip({ foodRiderId: free._id, order: near, vertical: 'food' })).ok, true);
  const blocked = await batching.foodRidersBlockedFor([rider._id, free._id], near, 'food');
  assert.deepEqual([...blocked], [String(rider._id)]);
});

await config.set('batching.enabled', { level: 'global', value: true });

await check('batching on: nearby store and drop join the trip', async () => {
  const v = await batching.canAddToTrip({ foodRiderId: rider._id, order: near, vertical: 'food' });
  assert.deepEqual(v, { ok: true, batched: true });
  assert.equal((await batching.foodRidersBlockedFor([rider._id], near, 'food')).size, 0);
});

await check('a Medical order from a store next door joins a Food trip', async () => {
  assert.equal((await batching.canAddToTrip({ foodRiderId: rider._id, order: medical, vertical: 'quickCommerce' })).ok, true);
});

await check('too far apart: drop or store', async () => {
  assert.equal((await batching.canAddToTrip({ foodRiderId: rider._id, order: farDrop, vertical: 'food' })).reason, 'drops_apart');
  assert.equal((await batching.canAddToTrip({ foodRiderId: rider._id, order: farStore, vertical: 'food' })).reason, 'stores_apart');
});

await check('trip full at the limit (2)', async () => {
  const second = (await FoodOrder.collection.insertOne({
    order_id: 'FOD-2', orderStatus: 'preparing', restaurantId: storeB, deliveryAddress: drop(75.8910, 22.7310),
    dispatch: { status: 'accepted', deliveryPartnerId: rider._id, acceptedAt: new Date() }, createdAt: new Date(),
  })).insertedId;
  assert.equal((await batching.canAddToTrip({ foodRiderId: rider._id, order: near, vertical: 'food' })).reason, 'trip_full');
  await FoodOrder.collection.deleteOne({ _id: second });
});

await check('nothing joins once the first order is picked up, or after the wait window', async () => {
  await FoodOrder.collection.updateOne({ _id: first }, { $set: { orderStatus: 'picked_up', 'deliveryState.pickedUpAt': new Date() } });
  assert.equal((await batching.canAddToTrip({ foodRiderId: rider._id, order: near, vertical: 'food' })).reason, 'already_picked_up');
  await FoodOrder.collection.updateOne({ _id: first }, { $set: { orderStatus: 'preparing', 'deliveryState.pickedUpAt': null, 'dispatch.acceptedAt': new Date(Date.now() - 20 * 60000) } });
  assert.equal((await batching.canAddToTrip({ foodRiderId: rider._id, order: near, vertical: 'food' })).reason, 'first_order_waiting');
});

await check('the trip list returns every order the rider carries', async () => {
  await FoodOrder.collection.updateOne({ _id: first }, { $set: { 'dispatch.acceptedAt': new Date() } });
  await FoodOrder.collection.insertOne({
    order_id: 'FOD-3', orderStatus: 'confirmed', restaurantId: storeB, deliveryAddress: drop(75.8910, 22.7310),
    dispatch: { status: 'accepted', deliveryPartnerId: rider._id, acceptedAt: new Date(Date.now() + 1000) }, createdAt: new Date(),
  });
  const { getCurrentTripsDelivery } = await import('../src/modules/food/orders/services/order-delivery.service.js');
  const list = await getCurrentTripsDelivery(String(rider._id));
  assert.deepEqual(list.map((o) => o.order_id), ['FOD-1', 'FOD-3']);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
