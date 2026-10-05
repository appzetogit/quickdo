/**
 * Riders are offered a prescription order only after the customer agrees to
 * the pharmacy's bill (approved for cash, or paid online).
 * Run: node tests/qc-prescription-dispatch-waits.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'rx_dispatch' });
let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { FoodOrder: QcOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const dispatch = await import('../src/modules/quickCommerce/modules/food/orders/services/order-dispatch.service.js');

let n = 0;
const rxOrder = async ({ billStatus, paymentStatus = 'cod_pending', priced = true }) => {
  n += 1;
  const { insertedId } = await QcOrder.collection.insertOne({
    order_id: `MED-50000000${n}`, orderStatus: 'preparing', prescriptionOnly: true,
    userId: new mongoose.Types.ObjectId(), restaurantId: new mongoose.Types.ObjectId(),
    items: priced ? [{ itemId: new mongoose.Types.ObjectId(), name: 'Medicines as per pharmacy bill', price: 500, quantity: 1 }] : [],
    pricing: priced ? { subtotal: 500, total: 537 } : { subtotal: 0, total: 0 },
    payment: { method: 'cash', status: paymentStatus },
    prescription: { required: true, status: 'approved', bill: { status: billStatus, amount: priced ? 500 : 0 } },
    dispatch: { status: 'unassigned', offeredTo: [] },
    deliveryAddress: { street: '1', city: 'Indore', location: { type: 'Point', coordinates: [75.88, 22.72] } },
    createdAt: new Date(),
  });
  return insertedId;
};
const skipped = async (id) => {
  await dispatch.tryAutoAssign(id);
  const row = await QcOrder.collection.findOne({ _id: id });
  return { offered: (row.dispatch?.offeredTo || []).length, lockHeld: Boolean(row.dispatch?.dispatchingAt), status: row.dispatch?.status };
};
const heldBack = (r) => r.offered === 0 && !r.lockHeld;

await check('bill sent, customer has not answered -> held back, lock released', async () => {
  const r = await skipped(await rxOrder({ billStatus: 'submitted' }));
  assert.ok(heldBack(r), JSON.stringify(r));
});
await check('customer declined the bill -> held back', async () => {
  assert.ok(heldBack(await skipped(await rxOrder({ billStatus: 'rejected' }))));
});
await check('not priced yet -> held back', async () => {
  assert.ok(heldBack(await skipped(await rxOrder({ billStatus: 'none', priced: false }))));
});
const passedGate = async (id) => {
  // Past the gate the dispatcher looks for riders; with none online it records
  // nothing but must not have skipped at the bill check. Read the log line.
  const lines = [];
  const orig = console.log;
  const { logger } = await import('../src/utils/logger.js');
  const origInfo = logger.info.bind(logger);
  logger.info = (m, ...a) => { lines.push(String(m)); return origInfo(m, ...a); };
  try { await dispatch.tryAutoAssign(id); } catch { /* no riders / maps in test */ }
  logger.info = origInfo; console.log = orig;
  return !lines.some((l) => l.includes('not yet agreed by the customer'));
};
await check('bill approved (cash) -> goes to riders', async () => {
  assert.ok(await passedGate(await rxOrder({ billStatus: 'approved' })));
});
await check('paid online -> goes to riders', async () => {
  assert.ok(await passedGate(await rxOrder({ billStatus: 'submitted', paymentStatus: 'paid' })));
});
await check('older order priced with no bill status -> goes to riders as before', async () => {
  assert.ok(await passedGate(await rxOrder({ billStatus: 'none' })));
});

// The rider's "available orders" list and accept (how the premature order was
// actually reached: never offered, found in the list, accepted).
const delivery = await import('../src/modules/quickCommerce/modules/food/orders/services/order-delivery.service.js');
const { FoodDeliveryPartner: QcRider } = await import('../src/modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js');
const rider = await QcRider.create({ name: 'R', phone: '9400000001', status: 'approved' });
const listed = async () => ((await delivery.listOrdersAvailableDelivery(String(rider._id), { page: 1, limit: 50 }))?.data || []).map((o) => o.order_id);

const noBill = await rxOrder({ billStatus: 'none', priced: false });
const waiting = await rxOrder({ billStatus: 'submitted' });
const agreed = await rxOrder({ billStatus: 'approved' });
// Offered to this rider, so only the bill rule (not distance) decides what shows.
for (const id of [noBill, waiting, agreed]) {
  await QcOrder.collection.updateOne({ _id: id }, { $set: { 'dispatch.offeredTo': [{ partnerId: rider._id, at: new Date(), action: 'offered' }] } });
}
const idOf = async (id) => (await QcOrder.collection.findOne({ _id: id })).order_id;

await check('available list hides a prescription order with no bill yet, or a bill not yet agreed', async () => {
  const ids = await listed();
  assert.ok(!ids.includes(await idOf(noBill)), 'no-bill order listed');
  assert.ok(!ids.includes(await idOf(waiting)), 'unagreed order listed');
  assert.ok(ids.includes(await idOf(agreed)), `agreed order missing: ${ids}`);
});
await check('accepting a prescription order before the bill is agreed is refused', async () => {
  await assert.rejects(() => delivery.acceptOrderDelivery(String(noBill), String(rider._id)), /waiting for the customer to accept the pharmacy bill/);
  await assert.rejects(() => delivery.acceptOrderDelivery(String(waiting), String(rider._id)), /waiting for the customer to accept the pharmacy bill/);
});
await check('an agreed prescription order passes the bill check on accept', async () => {
  try { await delivery.acceptOrderDelivery(String(agreed), String(rider._id)); }
  catch (e) { assert.ok(!/pharmacy bill/.test(e.message), e.message); }
});

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall prescription dispatch checks passed');
process.exit(failed ? 1 : 0);
