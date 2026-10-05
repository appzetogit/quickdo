/**
 * A taxi wallet top-up is credited once, to the wallet that started it.
 *
 * Run: node tests/taxi-wallet-topup-replay.smoke.mjs
 *
 * Found in review. The four verify endpoints (rider + driver, Razorpay +
 * PhonePe) credited ANY genuine payment on the merchant account, any number of
 * times, to whoever called them. The Razorpay signature proves a payment is
 * real, not whose top-up it is, and the duplicate check only looked at the
 * caller's own wallet rows. So one real payment, replayed from a second
 * account, was credited again -- as was a ride payment replayed as a top-up.
 * Driver wallet money is withdrawable.
 *
 * Drives the real controllers against an in-memory replica set (the driver
 * credit runs in a transaction), with the Razorpay and PhonePe HTTP APIs
 * replaced by an in-process fake behind global fetch. The file reads only
 * wallets and ledgers, never the guard itself, so it can also be run against
 * the pre-fix controllers to show the exploits land there.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Pinned before anything imports env.js, so dotenv cannot fill in real keys.
process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_smoke';
process.env.RAZORPAY_KEY_SECRET = 'smoke_secret';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

const { default: mongoose } = await import('mongoose');
const { MongoMemoryReplSet } = await import('mongodb-memory-server');

let failed = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${label}\n        ${err.message}`);
  }
};
const oid = () => new mongoose.Types.ObjectId();
const sign = (orderId, paymentId) =>
  crypto.createHmac('sha256', 'smoke_secret').update(`${orderId}|${paymentId}`).digest('hex');

/* ---------------- fake gateways behind global fetch ---------------- */
const rzpOrders = new Map();
const rzpPayments = new Map();
const phonePe = new Map(); // merchantTransactionId -> { state, amount, transactionId }
let seq = 0;
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const method = String(opts.method || 'GET').toUpperCase();
  if (u.hostname === 'api.razorpay.com') {
    const path = u.pathname.replace(/^\/v1/, '');
    if (method === 'POST' && path === '/orders') {
      const body = JSON.parse(opts.body);
      const order = { id: `order_${++seq}`, entity: 'order', created_at: Math.floor(Date.now() / 1000), ...body };
      rzpOrders.set(order.id, order);
      return json(200, order);
    }
    let m = /^\/orders\/([^/]+)$/.exec(path);
    if (m) return rzpOrders.has(decodeURIComponent(m[1])) ? json(200, rzpOrders.get(decodeURIComponent(m[1]))) : json(400, { error: { description: 'no such order' } });
    m = /^\/payments\/([^/]+)$/.exec(path);
    if (m) return rzpPayments.has(decodeURIComponent(m[1])) ? json(200, rzpPayments.get(decodeURIComponent(m[1]))) : json(400, { error: { description: 'no such payment' } });
    return json(404, { error: { description: `unmocked ${method} ${path}` } });
  }
  if (u.hostname.includes('phonepe.com')) {
    if (method === 'POST' && u.pathname.endsWith('/pg/v1/pay')) {
      const body = JSON.parse(Buffer.from(JSON.parse(opts.body).request, 'base64').toString());
      phonePe.set(body.merchantTransactionId, { state: 'PENDING', amount: body.amount, transactionId: `T${++seq}` });
      return json(200, { success: true, data: { instrumentResponse: { redirectInfo: { url: 'https://pay.example/x', method: 'GET' } } } });
    }
    const m = /\/pg\/v1\/status\/[^/]+\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const t = phonePe.get(decodeURIComponent(m[1]));
      if (!t) return json(400, { success: false, code: 'PAYMENT_ERROR', message: 'no such txn' });
      return json(200, { success: true, code: `PAYMENT_${t.state}`, data: { state: t.state, amount: t.amount, transactionId: t.transactionId } });
    }
  }
  throw new Error(`unmocked fetch ${method} ${url}`);
};

/** Pay a Razorpay order in full (the customer completing checkout). */
const payOrder = (orderId, { amount } = {}) => {
  const order = rzpOrders.get(orderId);
  const payment = { id: `pay_${++seq}`, entity: 'payment', order_id: orderId, amount: amount ?? order.amount, currency: 'INR', status: 'captured' };
  rzpPayments.set(payment.id, payment);
  return { razorpay_order_id: orderId, razorpay_payment_id: payment.id, razorpay_signature: sign(orderId, payment.id) };
};
/** An order some other part of the platform created (ride, rental...). */
const foreignOrder = (fields) => {
  const order = { id: `order_${++seq}`, entity: 'order', currency: 'INR', created_at: Math.floor(Date.now() / 1000), ...fields };
  rzpOrders.set(order.id, order);
  return order.id;
};

/* ---------------- calling controllers ---------------- */
const call = async (handler, { sub, body = {}, params = {}, query = {} }) => {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  const req = { auth: { sub: String(sub) }, body, params, query, protocol: 'http', get: () => 'localhost:5000' };
  try {
    await handler(req, res);
    return { status: res.statusCode, body: res.body };
  } catch (error) {
    return { status: error.statusCode || 500, error: error.message };
  }
};

const main = async () => {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'taxi_topup_replay' });

  const user = await import('../src/modules/taxi/user/controllers/userController.js');
  const driver = await import('../src/modules/taxi/driver/controllers/driverController.js');
  const { UserWallet } = await import('../src/modules/taxi/user/models/UserWallet.js');
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');
  const { AdminThirdPartySetting } = await import('../src/modules/taxi/admin/models/AdminThirdPartySetting.js');
  // Built up front so the unique index exists before concurrent verifies (production builds it at boot).
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => {})));

  await AdminThirdPartySetting.create({
    scope: 'default',
    payment: { phone_pay: { enabled: '1', environment: 'test', merchant_id: 'SMOKEMID', salt_key: 'smoke-salt', salt_index: '1' } },
  });

  const alice = oid();
  const mallory = oid();
  const driverA = oid();
  const driverB = oid();
  for (const [id, phone] of [[driverA, '+919700000001'], [driverB, '+919700000002']]) {
    await Driver.collection.insertOne({ _id: id, name: 'D', phone, wallet: { balance: 0, isBlocked: false } });
  }

  const userBalance = async (id) => Number((await UserWallet.findOne({ userId: id }).lean())?.balance || 0);
  const driverCredits = async (id) => {
    const rows = await WalletTransaction.find({ driverId: id, type: 'top_up' }).lean();
    return rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  };

  /* ---------------- rider, Razorpay ---------------- */
  console.log('\nrider wallet, Razorpay');
  const created = await call(user.createRazorpayWalletTopupOrder, { sub: alice, body: { amount: 100 } });
  const aliceOrder = created.body?.data?.orderId;
  const alicePay = payOrder(aliceOrder);

  await check('a legitimate top-up is credited once, same response shape', async () => {
    const r = await call(user.verifyRazorpayWalletTopup, { sub: alice, body: alicePay });
    assert.equal(r.status, 201, r.error);
    assert.equal(r.body.success, true);
    assert.equal(r.body.data.balance, 100);
    assert.equal(await userBalance(alice), 100);
  });

  await check('the same payment verified again (twice, concurrently) credits nothing more', async () => {
    const rs = await Promise.all([
      call(user.verifyRazorpayWalletTopup, { sub: alice, body: alicePay }),
      call(user.verifyRazorpayWalletTopup, { sub: alice, body: alicePay }),
    ]);
    for (const r of rs) assert.equal(r.status, 201, r.error);
    assert.equal(await userBalance(alice), 100);
  });

  await check("alice's payment replayed from mallory's account is refused, no credit", async () => {
    const r = await call(user.verifyRazorpayWalletTopup, { sub: mallory, body: alicePay });
    assert.ok(r.status >= 400, `expected a refusal, got ${r.status}`);
    assert.equal(await userBalance(mallory), 0);
    assert.equal(await userBalance(alice), 100);
  });

  await check('a ride payment (notes.type "ride") replayed as a top-up is refused', async () => {
    const rideOrder = foreignOrder({ amount: 45000, receipt: 'ride_1', notes: { type: 'ride', ownerType: 'user', ownerId: String(mallory), userId: String(mallory) } });
    const r = await call(user.verifyRazorpayWalletTopup, { sub: mallory, body: payOrder(rideOrder) });
    assert.ok(r.status >= 400, `expected a refusal, got ${r.status}`);
    assert.equal(await userBalance(mallory), 0);
  });

  await check('a rental advance (notes.userId = caller, no type) is refused', async () => {
    const rental = foreignOrder({ amount: 90000, receipt: `rentadv_x_${seq}`, notes: { userId: String(mallory), purpose: 'rental_advance_payment' } });
    const r = await call(user.verifyRazorpayWalletTopup, { sub: mallory, body: payOrder(rental) });
    assert.ok(r.status >= 400, `expected a refusal, got ${r.status}`);
    assert.equal(await userBalance(mallory), 0);
  });

  await check('a driver top-up order replayed on the rider endpoint is refused', async () => {
    const d = await call(driver.createDriverWalletTopupOrder, { sub: driverA, body: { amount: 600 } });
    const r = await call(user.verifyRazorpayWalletTopup, { sub: driverA, body: payOrder(d.body.data.orderId) });
    assert.ok(r.status >= 400, `expected a refusal, got ${r.status}`);
    assert.equal(await userBalance(driverA), 0);
  });

  await check('the amount credited is the payment the gateway captured', async () => {
    const c = await call(user.createRazorpayWalletTopupOrder, { sub: mallory, body: { amount: 500 } });
    const r = await call(user.verifyRazorpayWalletTopup, { sub: mallory, body: payOrder(c.body.data.orderId, { amount: 100 }) });
    assert.equal(r.status, 201, r.error);
    assert.equal(await userBalance(mallory), 1);
  });

  console.log('\nrider wallet, Razorpay, top-ups started before the fix (no typed notes)');
  await check("an in-flight legacy order (uwal_ receipt, notes.userId = caller, < 48h) still credits", async () => {
    const legacy = foreignOrder({ amount: 2500, receipt: `uwal_x_${seq}`, notes: { userId: String(alice) } });
    const r = await call(user.verifyRazorpayWalletTopup, { sub: alice, body: payOrder(legacy) });
    assert.equal(r.status, 201, r.error);
    assert.equal(await userBalance(alice), 125);
  });
  await check("someone else's legacy order is refused", async () => {
    const legacy = foreignOrder({ amount: 2500, receipt: `uwal_x_${seq}`, notes: { userId: String(alice) } });
    const r = await call(user.verifyRazorpayWalletTopup, { sub: mallory, body: payOrder(legacy) });
    assert.ok(r.status >= 400, `expected a refusal, got ${r.status}`);
    assert.equal(await userBalance(mallory), 1);
  });
  await check('a legacy order older than 48h is refused', async () => {
    const legacy = foreignOrder({ amount: 2500, receipt: `uwal_x_${seq}`, notes: { userId: String(alice) }, created_at: Math.floor(Date.now() / 1000) - 3 * 86400 });
    const r = await call(user.verifyRazorpayWalletTopup, { sub: alice, body: payOrder(legacy) });
    assert.ok(r.status >= 400, `expected a refusal, got ${r.status}`);
    assert.equal(await userBalance(alice), 125);
  });

  /* ---------------- driver, Razorpay ---------------- */
  console.log('\ndriver wallet, Razorpay');
  const dc = await call(driver.createDriverWalletTopupOrder, { sub: driverA, body: { amount: 700 } });
  const driverPay = payOrder(dc.body.data.orderId);

  await check('a legitimate driver top-up is credited once, same response shape', async () => {
    const r = await call(driver.verifyDriverWalletTopup, { sub: driverA, body: driverPay });
    assert.equal(r.status, 200, r.error);
    assert.ok(r.body.data.wallet && r.body.data.transaction, 'wallet + transaction returned');
    assert.equal(await driverCredits(driverA), 700);
  });
  await check('the same driver payment verified again (twice, concurrently) credits nothing more', async () => {
    const rs = await Promise.all([
      call(driver.verifyDriverWalletTopup, { sub: driverA, body: driverPay }),
      call(driver.verifyDriverWalletTopup, { sub: driverA, body: driverPay }),
    ]);
    for (const r of rs) assert.equal(r.status, 200, r.error);
    assert.equal(await driverCredits(driverA), 700);
  });
  await check("driver A's payment replayed by driver B is refused, no credit", async () => {
    const r = await call(driver.verifyDriverWalletTopup, { sub: driverB, body: driverPay });
    assert.ok(r.status >= 400, `expected a refusal, got ${r.status}`);
    assert.equal(await driverCredits(driverB), 0);
  });
  await check("a rider's top-up replayed on the driver endpoint is refused", async () => {
    const r = await call(driver.verifyDriverWalletTopup, { sub: driverB, body: alicePay });
    assert.ok(r.status >= 400, `expected a refusal, got ${r.status}`);
    assert.equal(await driverCredits(driverB), 0);
  });
  await check('a ride payment replayed as a driver top-up is refused', async () => {
    const rideOrder = foreignOrder({ amount: 80000, receipt: 'ride_2', notes: { type: 'ride', driverId: String(driverB) } });
    const r = await call(driver.verifyDriverWalletTopup, { sub: driverB, body: payOrder(rideOrder) });
    assert.ok(r.status >= 400, `expected a refusal, got ${r.status}`);
    assert.equal(await driverCredits(driverB), 0);
  });

  /* ---------------- PhonePe ---------------- */
  console.log('\nPhonePe (rider and driver)');
  const pc = await call(user.createPhonePeWalletTopupOrder, { sub: alice, body: { amount: 50 } });
  const aliceTxn = pc.body?.data?.merchantTransactionId;
  phonePe.get(aliceTxn).state = 'COMPLETED';

  await check("alice's completed PhonePe top-up checked by mallory is refused, no credit", async () => {
    const r = await call(user.verifyPhonePeWalletTopup, { sub: mallory, params: { merchantTransactionId: aliceTxn } });
    assert.ok(r.status >= 400, `expected a refusal, got ${r.status}`);
    assert.equal(await userBalance(mallory), 1);
  });
  await check('alice checking her own PhonePe top-up is credited once', async () => {
    const r1 = await call(user.verifyPhonePeWalletTopup, { sub: alice, params: { merchantTransactionId: aliceTxn } });
    const r2 = await call(user.verifyPhonePeWalletTopup, { sub: alice, params: { merchantTransactionId: aliceTxn } });
    assert.equal(r1.status, 200, r1.error);
    assert.equal(r1.body.data.status, 'paid');
    assert.equal(r2.body.data.status, 'paid');
    assert.equal(await userBalance(alice), 175);
  });

  const dpc = await call(driver.createDriverPhonePeWalletTopupOrder, { sub: driverA, body: { amount: 800 } });
  const driverTxn = dpc.body?.data?.merchantTransactionId;
  phonePe.get(driverTxn).state = 'COMPLETED';

  await check("driver A's PhonePe top-up checked by driver B is refused, no credit", async () => {
    const r = await call(driver.verifyDriverPhonePeWalletTopup, { sub: driverB, params: { merchantTransactionId: driverTxn } });
    assert.ok(r.status >= 400, `expected a refusal, got ${r.status}`);
    assert.equal(await driverCredits(driverB), 0);
  });
  await check("a rider's PhonePe top-up checked on the driver endpoint is refused", async () => {
    const r = await call(driver.verifyDriverPhonePeWalletTopup, { sub: driverB, params: { merchantTransactionId: aliceTxn } });
    assert.ok(r.status >= 400, `expected a refusal, got ${r.status}`);
    assert.equal(await driverCredits(driverB), 0);
  });
  await check('driver A checking their own PhonePe top-up is credited once', async () => {
    const r1 = await call(driver.verifyDriverPhonePeWalletTopup, { sub: driverA, params: { merchantTransactionId: driverTxn } });
    const r2 = await call(driver.verifyDriverPhonePeWalletTopup, { sub: driverA, params: { merchantTransactionId: driverTxn } });
    assert.equal(r1.status, 200, r1.error);
    assert.equal(r1.body.data.status, 'paid');
    assert.equal(r2.body.data.status, 'paid');
    assert.equal(await driverCredits(driverA), 1500);
  });
  await check('a PhonePe id never started here is refused', async () => {
    phonePe.set('SOMEOTHERTXN1', { state: 'COMPLETED', amount: 99900, transactionId: 'T-x' });
    const r = await call(user.verifyPhonePeWalletTopup, { sub: mallory, params: { merchantTransactionId: 'SOMEOTHERTXN1' } });
    assert.ok(r.status >= 400, `expected a refusal, got ${r.status}`);
    assert.equal(await userBalance(mallory), 1);
  });

  await mongoose.disconnect();
  await replSet.stop();
};

main()
  .catch((err) => { failed += 1; console.error(err); })
  .finally(() => {
    console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
    process.exit(failed ? 1 : 0);
  });
