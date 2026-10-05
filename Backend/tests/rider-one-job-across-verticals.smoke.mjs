/**
 * A rider carries one job at a time across Food and Quick/Medical.
 *
 * Run: node tests/rider-one-job-across-verticals.smoke.mjs
 *
 * Found in review: each side's busy check only looked at its own orders, and
 * the cross-service lock is a no-op for riders with no unified driver record
 * (everyone who signed up through the Food app). A rider on a Food order could
 * be offered, and accept, a Medical order -- and the reverse.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'rider_one_job' });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
};

const { FoodDeliveryPartner: FoodRider } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder: QcOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const link = await import('../src/core/delivery/qcRiderLink.js');
const foodDelivery = await import('../src/modules/food/orders/services/order-delivery.service.js');
const ctrl = await import('../src/modules/food/orders/controllers/order.controller.js');

const oid = () => new mongoose.Types.ObjectId();
const food = await FoodRider.create({ name: 'Rider', phone: '9876511111', status: 'approved', availabilityStatus: 'online' });
const foodId = String(food._id);
const qcId = await link.qcRiderIdForFoodRider(foodId);

const address = { street: '12 MG Road', city: 'Indore', state: 'MP', location: { type: 'Point', coordinates: [75.88, 22.72] } };
const foodOrder = async (fields) => (await FoodOrder.collection.insertOne({
  order_id: `FOD-${Math.floor(Math.random() * 1e7)}`, orderStatus: 'preparing',
  userId: oid(), restaurantId: oid(), items: [{ itemId: oid(), name: 'Thali', price: 150, quantity: 1 }],
  pricing: { subtotal: 150, total: 150 }, payment: { method: 'razorpay', status: 'paid' },
  deliveryAddress: address, createdAt: new Date(), updatedAt: new Date(), ...fields,
})).insertedId;
const medOrder = async (fields) => (await QcOrder.collection.insertOne({
  order_id: `MED-${Math.floor(Math.random() * 1e9)}`, orderStatus: 'preparing',
  userId: oid(), restaurantId: oid(), items: [{ itemId: oid(), name: 'Paracetamol', price: 25, quantity: 1 }],
  pricing: { subtotal: 25, total: 25 }, payment: { method: 'razorpay', status: 'paid' },
  prescription: { required: true, status: 'approved', bill: { status: 'approved' } },
  deliveryAddress: address, createdAt: new Date(), updatedAt: new Date(), ...fields,
})).insertedId;

const acceptViaApp = (orderId) => new Promise((resolve) => {
  const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); return this; } };
  ctrl.acceptOrderDeliveryController({ params: { orderId: String(orderId) }, user: { userId: foodId, role: 'DELIVERY_PARTNER' }, body: {} }, res,
    (err) => resolve({ code: err?.statusCode || 500, body: { message: err?.message } }));
});

// The rider is carrying a Food order.
const carrying = await foodOrder({ dispatch: { status: 'accepted', deliveryPartnerId: food._id } });

await check('on a Food order: Quick dispatch counts them busy', async () => {
  assert.ok((await link.qcRidersOnFoodJobs([qcId])).has(qcId));
});
await check('on a Food order: a Medical order offered to them cannot be accepted', async () => {
  const med = await medOrder({ dispatch: { status: 'unassigned', offeredTo: [{ partnerId: new mongoose.Types.ObjectId(qcId), at: new Date(), action: 'offered' }] } });
  const out = await acceptViaApp(med);
  assert.notEqual(out.code, 200, 'was accepted');
  assert.match(String(out.body?.message), /another job/);
  const row = await QcOrder.collection.findOne({ _id: med });
  assert.notEqual(row.dispatch.status, 'accepted');
});

// Food order delivered: free again.
await FoodOrder.collection.updateOne({ _id: carrying }, { $set: { orderStatus: 'delivered' } });
await check('after the Food order is delivered: free for Quick again', async () => {
  assert.equal((await link.qcRidersOnFoodJobs([qcId])).size, 0);
  assert.equal(await link.qcRiderHasFoodJob(qcId), false);
});

// Now carrying a Medical order.
await medOrder({ dispatch: { status: 'accepted', deliveryPartnerId: new mongoose.Types.ObjectId(qcId) } });
await check('on a Medical order: Food dispatch counts them busy', async () => {
  assert.ok((await link.foodRidersOnQcJobs([foodId])).has(foodId));
});
await check('on a Medical order: a Food order offered to them cannot be accepted', async () => {
  const f = await foodOrder({ orderStatus: 'confirmed', dispatch: { status: 'unassigned', offeredTo: [{ partnerId: food._id, at: new Date(), action: 'offered' }] } });
  const err = await foodDelivery.acceptOrderDelivery(String(f), foodId).then(() => null, (e) => e);
  assert.ok(err, 'was accepted');
  assert.match(err.message, /another job/);
  const row = await FoodOrder.collection.findOne({ _id: f });
  assert.notEqual(row.dispatch.status, 'accepted');
});
await check('a cancelled Medical order does not count', async () => {
  await QcOrder.collection.updateMany({ 'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(qcId) }, { $set: { orderStatus: 'cancelled_by_admin' } });
  assert.equal(await link.foodRiderHasQcJob(foodId), false);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
