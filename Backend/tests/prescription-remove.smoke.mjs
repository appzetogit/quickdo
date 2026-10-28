/**
 * Removing an order from the admin prescription queue.
 *
 * Run: node tests/prescription-remove.smoke.mjs
 *
 *   - a finished order leaves the queue but stays in the database;
 *   - an order still in progress is refused;
 *   - removing twice is refused, not double-recorded.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'rx_remove' });
const { FoodRestaurant } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');
const { FoodOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
await import('../src/modules/quickCommerce/core/users/user.model.js');
const svc = await import('../src/modules/quickCommerce/modules/food/admin/services/prescriptionAdmin.service.js');

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const pharmacy = new mongoose.Types.ObjectId();
await FoodRestaurant.collection.insertOne({ _id: pharmacy, restaurantName: 'Rx', status: 'approved', storeType: 'pharmacy' });
const mk = async (orderStatus) => {
  // cash, unpaid, approved prescription and bill: a realistic order at the pharmacy
  const _id = new mongoose.Types.ObjectId();
  await FoodOrder.collection.insertOne({
    _id, order_id: `RX-${String(_id).slice(-6)}`, restaurantId: pharmacy, orderStatus,
    prescription: { required: true, status: 'approved', bill: { status: 'approved', amount: 100 } }, pricing: { subtotal: 100, total: 100 }, payment: { method: 'cash', status: 'cod_pending' }, userId: new mongoose.Types.ObjectId(), items: [{ itemId: new mongoose.Types.ObjectId(), name: 'Paracetamol', price: 100, quantity: 1 }], deliveryAddress: { label: 'Home', street: 'Test', city: 'Indore', state: 'MP', zipCode: '452001', phone: '9000000000', location: { type: 'Point', coordinates: [75.86, 22.72] } }, createdAt: new Date(),
  });
  return String(_id);
};
const done = await mk('delivered');
const live = await mk('picked_up');
const waiting = await mk('ready_for_pickup');
const ids = async () => (await svc.listPrescriptionOrders({})).orders.map((o) => o.id);

await check('both show in the queue to begin with', async () => {
  const list = await ids();
  assert.ok(list.includes(done) && list.includes(live));
});
await check('a finished order leaves the queue but stays in the database', async () => {
  await svc.removePrescriptionOrder(done, { reason: 'test order' });
  assert.ok(!(await ids()).includes(done));
  const row = await FoodOrder.collection.findOne({ _id: new mongoose.Types.ObjectId(done) });
  assert.ok(row && row.prescription.adminRemovedAt instanceof Date);
});
await check('an order a rider is carrying is refused', async () => {
  await assert.rejects(() => svc.removePrescriptionOrder(live), /rider is delivering/);
  assert.ok((await ids()).includes(live));
});
await check('an order still at the pharmacy is cancelled by admin, then removed', async () => {
  const r = await svc.removePrescriptionOrder(waiting, { reason: 'test' });
  assert.equal(r.cancelledFirst, true);
  const row = await FoodOrder.collection.findOne({ _id: new mongoose.Types.ObjectId(waiting) });
  assert.equal(row.orderStatus, 'cancelled_by_admin');
  assert.ok(!(await ids()).includes(waiting));
});
await check('removing twice is refused', async () => {
  await assert.rejects(() => svc.removePrescriptionOrder(done), /not found/i);
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall prescription remove checks passed');
process.exit(failed ? 1 : 0);
