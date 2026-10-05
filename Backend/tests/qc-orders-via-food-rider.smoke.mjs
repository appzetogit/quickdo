/**
 * Quick & Medical orders reach riders who work through the Food side.
 *
 * Run: node tests/qc-orders-via-food-rider.smoke.mjs
 *
 * The delivery app signs in, goes online and acts only through the Food rider
 * endpoints. These checks: the Food rider gets a linked Quick rider record,
 * going online carries over, Quick dispatch counts them, and accepting a
 * Medical order through the Food accept endpoint assigns it to them.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'qc_via_food' });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};

const { FoodDeliveryPartner: FoodRider } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodDeliveryPartner: QcRider } = await import('../src/modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder: QcOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const link = await import('../src/core/delivery/qcRiderLink.js');
const { updateDeliveryAvailability } = await import('../src/modules/food/delivery/services/delivery.service.js');

const food = await FoodRider.create({ name: 'Rishi Dogne', phone: '9876500001', status: 'approved' });
const foodId = String(food._id);

await check('a Food rider gets one linked Quick rider record (created once)', async () => {
  const a = await link.qcRiderIdForFoodRider(foodId);
  const b = await link.qcRiderIdForFoodRider(foodId);
  assert.ok(a);
  assert.equal(a, b);
  assert.equal(await QcRider.countDocuments({ phone: { $regex: '9876500001$' } }), 1);
  assert.equal(await link.foodRiderIdForQcRider(a), foodId);
});

await check('going online in the Food app also puts the Quick record online, with position', async () => {
  await updateDeliveryAvailability(foodId, { status: 'online', latitude: 22.7262, longitude: 75.8885 });
  await new Promise((r) => setTimeout(r, 200));
  const qc = await QcRider.findById(await link.qcRiderIdForFoodRider(foodId)).lean();
  assert.equal(qc.availabilityStatus, 'online');
  assert.equal(qc.lastLat, 22.7262);
});

await check('Quick dispatch counts online Food riders as Quick candidates', async () => {
  const c = await link.onlineFoodRidersAsQcCandidates();
  assert.equal(c.length, 1);
  assert.equal(String(c[0]._id), await link.qcRiderIdForFoodRider(foodId));
  assert.equal(c[0].foodRiderId, foodId);
});

const qcRiderId = await link.qcRiderIdForFoodRider(foodId);
// The pharmacy, so the trip steps have a store to send back.
const pharmacyId = new mongoose.Types.ObjectId();
await mongoose.connection.db.collection('qc_restaurants').insertOne({ _id: pharmacyId, restaurantName: 'Quick Medical', storeType: 'pharmacy', location: { type: 'Point', coordinates: [75.88, 22.72], addressLine1: '17/C, New Palasia' } });
const medOrder = await QcOrder.collection.insertOne({
  order_id: 'MED-1000000001', orderId: 'MED-1000000001', orderStatus: 'preparing',
  userId: new mongoose.Types.ObjectId(), restaurantId: pharmacyId,
  items: [{ itemId: new mongoose.Types.ObjectId(), name: 'Paracetamol', price: 25, quantity: 1 }],
  pricing: { subtotal: 25, total: 25 }, payment: { method: 'cash', status: 'cod_pending' },
  prescription: { required: true, status: 'approved', bill: { status: 'approved' } },
  dispatch: { status: 'unassigned', offeredTo: [{ partnerId: new mongoose.Types.ObjectId(qcRiderId), at: new Date(), action: 'offered' }] },
  deliveryAddress: { street: '12 MG Road', city: 'Indore', state: 'MP', location: { type: 'Point', coordinates: [75.88, 22.72] } },
  createdAt: new Date(), updatedAt: new Date(),
});
const medId = String(medOrder.insertedId);

await check('a Quick order id is recognised; a Food one is not', async () => {
  assert.equal(await link.isQcOrderId(medId), true);
  assert.equal(await link.isQcOrderId('MED-1000000001'), true);
  const f = await FoodOrder.collection.insertOne({ order_id: 'FOD-1', createdAt: new Date() });
  assert.equal(await link.isQcOrderId(String(f.insertedId)), false);
});

await check('accepting the Medical order through the FOOD accept endpoint assigns it', async () => {
  const ctrl = await import('../src/modules/food/orders/controllers/order.controller.js');
  const out = await new Promise((resolve, reject) => {
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); return this; } };
    ctrl.acceptOrderDeliveryController({ params: { orderId: medId }, user: { userId: foodId, role: 'DELIVERY_PARTNER' }, body: {} }, res, reject);
  });
  assert.equal(out.code, 200, JSON.stringify(out.body).slice(0, 300));
  const row = await QcOrder.collection.findOne({ _id: new mongoose.Types.ObjectId(medId) });
  assert.equal(row.dispatch.status, 'accepted');
  assert.equal(String(row.dispatch.deliveryPartnerId), qcRiderId);
  // The app knows only its Food id: the response names the rider by it.
  const sent = JSON.stringify(out.body);
  assert.ok(!sent.includes(qcRiderId), 'response still carries the Quick rider id');
  assert.ok(sent.includes(foodId), 'response should name the Food rider');
});

// The rest of the rider's flow, every step through the FOOD endpoints the app calls.
const call = async (name, req) => {
  const ctrl = await import('../src/modules/food/orders/controllers/order.controller.js');
  return new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); return this; } };
    ctrl[name]({ params: { orderId: medId }, user: { userId: foodId, role: 'DELIVERY_PARTNER' }, body: {}, query: {}, ...req }, res,
      (err) => resolve({ code: err?.statusCode || 500, body: { message: err?.message } }));
  });
};
const step = (label, name, req = {}) => check(label, async () => {
  const out = await call(name, req);
  assert.equal(out.code, 200, `${name}: ${out.code} ${JSON.stringify(out.body).slice(0, 300)}`);
  return out;
});

await check('bill photo: another rider is refused, a non-image is refused', async () => {
  const other = await FoodRider.create({ name: 'Other', phone: '9876500002', status: 'approved' });
  const ctrl = await import('../src/modules/food/orders/controllers/order.controller.js');
  const hit = (userId, body) => new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); return this; } };
    ctrl.uploadPickupBillPhotoController({ params: { orderId: medId }, user: { userId }, body }, res, (e) => resolve({ code: 500, body: e?.message }));
  });
  assert.equal((await hit(String(other._id), { base64: Buffer.from('x').toString('base64') })).code, 403);
  assert.equal((await hit(foodId, { base64: Buffer.from('not an image at all, just text').toString('base64') })).code, 400);
});
await check('reached pickup: the response still names the pharmacy (the app shows it)', async () => {
  const out = await call('confirmReachedPickupDeliveryController', {});
  assert.equal(out.code, 200, JSON.stringify(out.body).slice(0, 300));
  assert.match(JSON.stringify(out.body), /Quick Medical/);
});
await step('picked up (with the pharmacy bill photo)', 'confirmPickupDeliveryController', { body: { billImageUrl: 'https://example.com/bill.jpg' } });
await check('reached drop: the response still names the pharmacy (the app shows it)', async () => {
  const out = await call('confirmReachedDropDeliveryController', {});
  assert.equal(out.code, 200, JSON.stringify(out.body).slice(0, 300));
  assert.match(JSON.stringify(out.body), /Quick Medical/);
});
await check('drop OTP', async () => {
  const row = await QcOrder.collection.findOne({ _id: new mongoose.Types.ObjectId(medId) });
  const otp = row.deliveryVerification?.dropOtp?.code || row.deliveryOtp || row.deliveryVerification?.dropOtp?.otp;
  assert.ok(otp, `no OTP stored: ${JSON.stringify(row.deliveryVerification)}`);
  const out = await call('verifyDropOtpDeliveryController', { body: { otp: String(otp) } });
  assert.equal(out.code, 200, JSON.stringify(out.body).slice(0, 300));
});
await step('collect cash (was not routed to Medical before)', 'switchToCashController');
await step('payment status (was not routed to Medical before)', 'getPaymentStatusController');
await step('complete', 'completeDeliveryController');
await check('the order is delivered', async () => {
  const row = await QcOrder.collection.findOne({ _id: new mongoose.Types.ObjectId(medId) });
  assert.equal(row.orderStatus, 'delivered');
});
await step('rate customer does not fail on a Medical order', 'rateCustomerDeliveryController', { body: { rating: 5 } });

await mongoose.disconnect();
await server.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall quick-via-food-rider checks passed');
process.exit(failed ? 1 : 0);
