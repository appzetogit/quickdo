/**
 * "You are already on another job" must mean a job that is still going.
 *
 * Run: node tests/stale-hold-accept.smoke.mjs
 *
 * A rider's busy-hold stayed on a Food order that was then deleted, so every
 * later accept was refused. Accept now clears holds on finished or missing jobs
 * and tries once more; a hold on a live job still refuses.
 */
process.env.UNIFIED_DISPATCH_ENABLED = 'true';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
await mongoose.connect(replSet.getUri(), { dbName: 'stale_hold' });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
const { FoodDeliveryPartner: QcRider } = await import('../src/modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder: QcOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { claimAssignment } = await import('../src/core/assignment/assignment.service.js');
const qcDelivery = await import('../src/modules/quickCommerce/modules/food/orders/services/order-delivery.service.js');

let seq = 9200000000;
const setup = async () => {
  const driver = await Driver.create({
    name: 'Rider', phone: `+91${seq++}`, password: 'secret123', vehicleType: 'bike',
    location: { type: 'Point', coordinates: [75.88, 22.72] },
    workMode: 'all', serviceCapabilities: ['delivery', 'quickCommerce'],
  });
  const rider = await QcRider.create({ name: 'Rider', phone: String(seq), status: 'approved', driverId: driver._id });
  return { driver, rider };
};
const medOrder = async (riderId, n) => {
  const { insertedId } = await QcOrder.collection.insertOne({
    order_id: `MED-20000000${n}`, orderId: `MED-20000000${n}`, orderStatus: 'preparing',
    userId: new mongoose.Types.ObjectId(), restaurantId: new mongoose.Types.ObjectId(),
    items: [{ itemId: new mongoose.Types.ObjectId(), name: 'Paracetamol', price: 25, quantity: 1 }],
    pricing: { subtotal: 25, total: 25 }, payment: { method: 'online', status: 'paid' },
    dispatch: { status: 'unassigned', offeredTo: [{ partnerId: riderId, at: new Date(), action: 'offered' }] },
    createdAt: new Date(), updatedAt: new Date(),
  });
  return String(insertedId);
};
const foodOrder = async (status) => (await FoodOrder.collection.insertOne({
  order_id: `FOD-${seq++}`, orderStatus: status, createdAt: new Date(),
})).insertedId;

await check('a hold on a DELETED Food order no longer blocks accepting a Medical order', async () => {
  const { driver, rider } = await setup();
  const gone = await foodOrder('preparing');
  assert.equal((await claimAssignment(driver._id, { vertical: 'food', jobId: gone })).claimed, true);
  await FoodOrder.collection.deleteOne({ _id: gone });
  const id = await medOrder(rider._id, 1);
  await qcDelivery.acceptOrderDelivery(id, String(rider._id));
  const row = await QcOrder.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
  assert.equal(row.dispatch.status, 'accepted');
  const d = await Driver.findById(driver._id).lean();
  assert.deepEqual(d.activeAssignments.map((a) => String(a.jobId)), [id]);
});

await check('a hold on a LIVE Food order still refuses: "already on another job"', async () => {
  const { driver, rider } = await setup();
  const live = await foodOrder('picked_up');
  assert.equal((await claimAssignment(driver._id, { vertical: 'food', jobId: live })).claimed, true);
  const id = await medOrder(rider._id, 2);
  await assert.rejects(() => qcDelivery.acceptOrderDelivery(id, String(rider._id)), /another job/);
  const row = await QcOrder.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
  assert.equal(row.dispatch.status, 'unassigned');
});

await mongoose.disconnect();
await replSet.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall stale-hold checks passed');
process.exit(failed ? 1 : 0);
