/**
 * Dynamic UPI QR collection: food cash-on-delivery and taxi rides, against a
 * stand-in for Razorpay's QR Codes API (global fetch is replaced; no network).
 *
 * Run: node tests/dynamic-upi-qr.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.RAZORPAY_KEY_ID = 'rzp_test_QRTEST';
process.env.RAZORPAY_KEY_SECRET = 'qr_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';

// ---- fake Razorpay QR Codes API ------------------------------------------
const qrs = new Map();
const payments = new Map(); // qrId -> [payment]
const calls = [];
let seq = 0;
let qrFeatureOn = true;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname !== 'api.razorpay.com') return realFetch(url, opts);
  const method = String(opts.method || 'GET').toUpperCase();
  const path = u.pathname.replace(/^\/v1/, '');
  calls.push(`${method} ${path}`);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (!qrFeatureOn && path.startsWith('/payments/qr_codes')) {
    return json(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'The requested URL was not found on the server.' } });
  }
  let m;
  if (method === 'POST' && path === '/payments/qr_codes') {
    const body = JSON.parse(opts.body);
    const id = `qr_${++seq}`;
    const qr = {
      id, entity: 'qr_code', status: 'active', close_reason: null, usage: body.usage, fixed_amount: body.fixed_amount,
      payment_amount: body.payment_amount, payments_amount_received: 0, payments_count_received: 0,
      image_url: `https://rzp.io/i/${id}`, image_content: `upi://pay?pa=quickdrop@razorpay&am=${body.payment_amount / 100}&tr=${id}`,
      close_by: body.close_by, notes: body.notes,
    };
    qrs.set(id, qr);
    return json(200, qr);
  }
  if ((m = path.match(/^\/payments\/qr_codes\/([^/]+)\/close$/)) && method === 'POST') {
    const qr = qrs.get(m[1]);
    if (qr.status === 'closed') return json(400, { error: { description: 'QR code is already closed' } });
    Object.assign(qr, { status: 'closed', close_reason: 'on_demand' });
    return json(200, qr);
  }
  if ((m = path.match(/^\/payments\/qr_codes\/([^/]+)\/payments$/))) {
    return json(200, { entity: 'collection', items: payments.get(m[1]) || [] });
  }
  if ((m = path.match(/^\/payments\/qr_codes\/([^/]+)$/))) {
    return json(200, qrs.get(m[1]));
  }
  return json(404, { error: { description: `unexpected ${method} ${path}` } });
};
/** The customer scans and pays the QR in full. */
const pay = (qrId, paise) => {
  const qr = qrs.get(qrId);
  const amount = paise ?? qr.payment_amount;
  qr.payments_amount_received += amount;
  qr.payments_count_received += 1;
  Object.assign(qr, { status: 'closed', close_reason: 'paid' });
  payments.set(qrId, [...(payments.get(qrId) || []), { id: `mock_pay_${++seq}`, amount, status: 'captured' }]);
};
const postCount = () => calls.filter((c) => c === 'POST /payments/qr_codes').length;

// ---- harness ---------------------------------------------------------------
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
await mongoose.connect(replSet.getUri(), { dbName: 'dynamic_qr' });

await import('../src/core/users/user.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { FoodTransaction } = await import('../src/modules/food/orders/models/foodTransaction.model.js');
const orderPayment = await import('../src/modules/food/orders/services/order-payment.service.js');
const { handleQrCodeCredited } = await import('../src/core/payments/qrCreditWebhook.js');
const rq = await import('../src/core/payments/razorpayQr.js');
const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
const driverController = await import('../src/modules/taxi/driver/controllers/driverController.js');
const wallet = await import('../src/modules/taxi/driver/services/walletService.js');

let failures = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  ok   ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${label}\n       ${err.stack || err.message}`);
  }
};
const oid = () => new mongoose.Types.ObjectId();
const rider = oid();
// A real customer: the QR code reads the order's customer (populate), as in production.
const customerId = oid();
await mongoose.model('FoodUser').collection.insertOne({ _id: customerId, name: 'Asha', phone: '9800000000', email: 'asha@example.com' });
const newOrder = (total = 250, extra = {}) => FoodOrder.create({
  userId: customerId, restaurantId: oid(), orderStatus: 'picked_up',
  items: [{ itemId: oid(), name: 'Thali', price: total, quantity: 1 }],
  deliveryAddress: { street: 's', city: 'Palampur', state: 'HP', location: { type: 'Point', coordinates: [76.5, 32.1] } },
  pricing: { subtotal: total, total }, payment: { method: 'cash', status: 'cod_pending' },
  dispatch: { deliveryPartnerId: rider },
  ...extra,
});
const txOf = async (order) => (await FoodTransaction.findOne({ orderId: order._id }).lean())?.payment;

console.log('\nQR helper');
await check('amounts under Rs 1 or past the UPI limit are refused', async () => {
  assert.throws(() => rq.toQrPaise(0.5), /under Rs 1/);
  assert.throws(() => rq.toQrPaise(100001), /too much/);
  assert.equal(rq.toQrPaise(57.5), 5750);
});
await check('an account without QR Codes reports "unavailable" (so callers fall back)', async () => {
  qrFeatureOn = false;
  await assert.rejects(() => rq.createUpiQr({ amountPaise: 100, notes: {} }), (e) => e instanceof rq.RazorpayQrError && e.unavailable);
  qrFeatureOn = true;
});

console.log('\nfood cash-on-delivery');
await check('payment.captured for a QR payment (no Razorpay order) leaves cash orders alone', async () => {
  const crypto = await import('node:crypto');
  const { handleRazorpayWebhook } = await import('../src/core/payments/controllers/razorpayWebhook.controller.js');
  // First, while the only order is an unpaid cash order -- the one the bug matched.
  const cod = await newOrder(300);
  const body = { event: 'payment.captured', payload: { payment: { entity: { id: 'mock_pay_qr', amount: 100, order_id: null } } } };
  const raw = Buffer.from(JSON.stringify(body));
  let status;
  await handleRazorpayWebhook(
    { headers: { 'x-razorpay-signature': crypto.createHmac('sha256', 'whsec_test').update(raw).digest('hex') }, rawBody: raw, body },
    { status: (code) => { status = code; return { json: () => {}, send: () => {} }; } },
  );
  assert.equal(status, 200);
  const after = await FoodOrder.findById(cod._id).lean();
  assert.deepEqual([after.payment.status, after.payment.razorpay?.paymentId || ''], ['cod_pending', '']);
  // No order anywhere picked the payment up (it used to match the first order without one).
  assert.equal(await FoodOrder.countDocuments({ 'payment.razorpay.paymentId': 'mock_pay_qr' }), 0);
});
let order = await newOrder(250);
let firstQr;
await check('a single-use QR for exactly the amount due, with the UPI string to draw', async () => {
  const res = await orderPayment.createCollectQr(order._id, rider, {});
  assert.equal(res.kind, 'upi_qr');
  assert.match(res.upiString, /^upi:\/\/pay/);
  assert.equal(res.amount, 250);
  const qr = qrs.get(res.qrId);
  assert.equal(qr.payment_amount, 25000);
  assert.equal(qr.usage, 'single_use');
  assert.equal(qr.fixed_amount, true);
  assert.deepEqual([qr.notes.kind, qr.notes.refId], ['food_order', String(order._id)]);
  const p = await txOf(order);
  assert.deepEqual([p.method, p.status, p.qr.kind, p.qr.qrId, p.qr.amountPaise], ['razorpay_qr', 'pending_qr', 'upi_qr', res.qrId, 25000]);
  firstQr = res.qrId;
});
await check('asking again returns the same live QR -- never two payable at once', async () => {
  const before = postCount();
  const res = await orderPayment.createCollectQr(order._id, rider, {});
  assert.equal(res.qrId, firstQr);
  assert.equal(postCount(), before);
});
await check('the amount changes: the old QR is closed and a new one made', async () => {
  await FoodTransaction.updateOne({ orderId: order._id }, { $set: { 'payment.amountDue': 280 } });
  const res = await orderPayment.createCollectQr(order._id, rider, {});
  assert.notEqual(res.qrId, firstQr);
  assert.equal(qrs.get(firstQr).status, 'closed');
  assert.equal(qrs.get(res.qrId).payment_amount, 28000);
  assert.deepEqual((await txOf(order)).qr.previousQrIds, [firstQr]);
});
await check('not paid yet: the status poll says pending', async () => {
  const status = await orderPayment.getPaymentStatus(order._id, rider);
  assert.equal(status.payment.status, 'pending_qr');
});
await check('the customer pays: the poll (and so delivery completion) sees it paid, with the payment id', async () => {
  const current = (await txOf(order)).qr.qrId;
  pay(current);
  const status = await orderPayment.getPaymentStatus(order._id, rider);
  assert.equal(status.payment.status, 'paid');
  assert.match(status.payment.qr.paymentId, /^mock_pay_/);
  assert.equal((await FoodOrder.findById(order._id).lean()).payment.status, 'paid');
});
await check('a paid order cannot switch to cash (no paying twice)', async () => {
  await assert.rejects(() => orderPayment.switchToCash(order._id, rider), /already paid by UPI/);
});
await check('another rider cannot make a QR for this order', async () => {
  const other = await newOrder(120);
  await assert.rejects(() => orderPayment.createCollectQr(other._id, oid(), {}), /Not your order/);
});

console.log('\nswitching to cash');
await check('switching to cash closes the QR first, then resets to cash', async () => {
  const o = await newOrder(90);
  const res = await orderPayment.createCollectQr(o._id, rider, {});
  await orderPayment.switchToCash(o._id, rider);
  assert.equal(qrs.get(res.qrId).status, 'closed');
  const p = await txOf(o);
  assert.deepEqual([p.method, p.status], ['cash', 'cod_pending']);
  assert.deepEqual(p.qr.previousQrIds, [res.qrId], 'the closed QR stays traceable');
});
await check('paid a moment before the switch: refused, and the order is marked paid', async () => {
  const o = await newOrder(95);
  const res = await orderPayment.createCollectQr(o._id, rider, {});
  pay(res.qrId);
  await assert.rejects(() => orderPayment.switchToCash(o._id, rider), /already paid by UPI/);
  assert.equal((await txOf(o)).status, 'paid');
});

console.log('\nwebhook (qr_code.credited)');
const credited = (qrId) => handleQrCodeCredited({ qr_code: { entity: qrs.get(qrId) } });
await check('a credit on the current QR marks the order paid', async () => {
  const o = await newOrder(150);
  const res = await orderPayment.createCollectQr(o._id, rider, {});
  pay(res.qrId);
  assert.equal(await credited(res.qrId), 'synced');
  assert.equal((await txOf(o)).status, 'paid');
});
await check('a credit on a replaced QR of an already-paid order is refunded', async () => {
  const o = await newOrder(160);
  const a = await orderPayment.createCollectQr(o._id, rider, {});
  await FoodTransaction.updateOne({ orderId: o._id }, { $set: { 'payment.amountDue': 170 } });
  const b = await orderPayment.createCollectQr(o._id, rider, {});
  pay(b.qrId);
  await orderPayment.getPaymentStatus(o._id, rider);
  pay(a.qrId); // raced the close
  assert.equal(await credited(a.qrId), 'refunded');
});
await check('a credit on a replaced QR that covers an unpaid order is taken as its payment', async () => {
  const o = await newOrder(200);
  const a = await orderPayment.createCollectQr(o._id, rider, {});
  await orderPayment.switchToCash(o._id, rider); // rider switched to cash...
  pay(a.qrId); // ...but the customer had already approved the UPI payment
  assert.equal(await credited(a.qrId), 'adopted');
  const p = await txOf(o);
  assert.deepEqual([p.method, p.status], ['razorpay_qr', 'paid']);
});
await check('a credit for a cancelled order is refunded', async () => {
  const o = await newOrder(110);
  const a = await orderPayment.createCollectQr(o._id, rider, {});
  await FoodOrder.updateOne({ _id: o._id }, { $set: { orderStatus: 'cancelled_by_user' } });
  pay(a.qrId);
  assert.equal(await credited(a.qrId), 'refunded');
});
await check('a QR with no known order is left alone', async () => {
  assert.equal(await handleQrCodeCredited({ qr_code: { entity: { id: 'qr_x', notes: {} } } }), 'ignored');
});

console.log('\ntaxi rides and parcels');
const driver = oid();
const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');
// Collections exist before the wallet's transactions touch them (MongoDB
// cannot create one inside a transaction), and the driver is real.
// Same set-up as tests/ledger.mirror.smoke.mjs: a wallet adjustment also writes
// the finance ledger.
const { LedgerEntry } = await import('../src/core/finance/ledgerEntry.model.js');
const { PartnerBalance } = await import('../src/core/finance/partnerBalance.model.js');
const { FailedFinancialOperation } = await import('../src/core/finance/failedFinancialOperation.model.js');
await LedgerEntry.syncIndexes();
await PartnerBalance.syncIndexes();
await mongoose.model('TaxiDriver').init();
await WalletTransaction.init();
await FailedFinancialOperation.init();
await WalletTransaction.createCollection().catch(() => {});
await LedgerEntry.createCollection().catch(() => {});
await PartnerBalance.createCollection().catch(() => {});
await mongoose.model('TaxiDriver').collection.insertOne({ _id: driver, name: 'Ravi', phone: '9811111111', wallet: { balance: 0 } });
const mkRide = (extra = {}) => Ride.create({
  userId: oid(), driverId: driver, status: 'completed', liveStatus: 'completed',
  fare: 58, baseFare: 58, paymentMethod: 'cash',
  pickupLocation: { type: 'Point', coordinates: [76.5, 32.1] },
  dropLocation: { type: 'Point', coordinates: [76.6, 32.2] },
  ...extra,
});
const callCreate = async (ride, amount) => {
  let body;
  await driverController.createDriverPaymentQr(
    { body: { rideId: String(ride._id), amount }, auth: { sub: String(driver) } },
    { json: (b) => { body = b; } },
  );
  return body.data;
};
await check('the QR is for the ride\'s fare, whatever amount the app sends', async () => {
  const ride = await mkRide();
  const data = await callCreate(ride, 5);
  assert.equal(data.amount, 58);
  assert.equal(qrs.get(data.id).payment_amount, 5800);
  assert.match(data.upiString, /^upi:\/\/pay/);
  assert.equal(qrs.get(data.id).notes.kind, 'taxi_ride');
});
await check('asking twice returns the same QR; a fare change replaces it', async () => {
  const ride = await mkRide();
  const a = await callCreate(ride);
  assert.equal((await callCreate(ride)).id, a.id);
  await Ride.updateOne({ _id: ride._id }, { $set: { fare: 63 } });
  const b = await callCreate(await Ride.findById(ride._id));
  assert.notEqual(b.id, a.id);
  assert.equal(qrs.get(a.id).status, 'closed');
  assert.deepEqual((await Ride.findById(ride._id).lean()).driverPaymentCollection.previousProviderIds, [a.id]);
});
await check('a cancelled ride gets no QR', async () => {
  const ride = await mkRide({ status: 'cancelled', liveStatus: 'cancelled' });
  await assert.rejects(() => callCreate(ride), /cancelled/);
});
await check('a cash-settled ride paid by QR credits the driver the fare, once', async () => {
  // As cash settlement leaves it: settled, earnings stamped as credited.
  const ride = await mkRide({ walletSettledAt: new Date(), driverEarningsCreditedAt: new Date(), driverEarnings: 48 });
  const data = await callCreate(ride);
  pay(data.id);
  await driverController.refreshDriverPaymentCollection(await Ride.findById(ride._id));
  const after = await Ride.findById(ride._id).lean();
  assert.equal(after.paymentMethod, 'online');
  assert.ok(after.driverPaymentCollection.reclassifiedAt);
  assert.equal(await wallet.reclassifyCashRidePaidByQr({ rideId: ride._id }), null, 'second time: nothing');
  const credits = await WalletTransaction.find({ rideId: ride._id, type: 'ride_earning' }).lean();
  assert.equal(credits.length, 1);
  assert.equal(credits[0].amount, 58);
});

await mongoose.disconnect();
await replSet.stop();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
