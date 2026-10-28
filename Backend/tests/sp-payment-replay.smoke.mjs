/**
 * Service-provider payments are used once, by the account they were made for,
 * and a caller only touches their own notifications.
 *
 * Run: node tests/sp-payment-replay.smoke.mjs
 *
 * Found in review:
 *  - Wallet top-up verify credited any captured payment: a booking payment or
 *    another customer's top-up, replayed, became wallet balance.
 *  - Dues verify checked the owner only when the order notes named a worker, so
 *    any payment without one (a booking payment, a wallet top-up) cleared dues,
 *    and the same payment could also be credited as a top-up.
 *  - Notification handlers filtered by req.user.role (the account document's own
 *    field, absent or lowercase), so the owner filter dropped: anyone could mark
 *    read or delete anyone's notification, and mark-all-read hit the platform.
 *
 * Razorpay is stubbed at the service boundary; everything else is real code on a
 * replica set.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const require = createRequire(import.meta.url);

// Credentials present, so confirmGatewayPayment does NOT take its dev mock path.
process.env.RAZORPAY_KEY_ID = 'rzp_test_stub';
process.env.RAZORPAY_KEY_SECRET = 'stub_secret';

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

const main = async () => {
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'sp_replay' });

  const razorpay = require('../src/modules/serviceProvider/services/razorpayService.js');
  const orders = new Map(); // orderId -> notes
  const payments = new Map(); // paymentId -> { orderId, paise }
  razorpay.verifyPayment = () => true;
  razorpay.getPaymentDetails = async (id) => {
    const p = payments.get(id);
    return p ? { success: true, payment: { id, order_id: p.orderId, status: 'captured', amount: p.paise } } : { success: false };
  };
  razorpay.getOrderDetails = async (id) => (orders.has(id) ? { success: true, order: { id, notes: orders.get(id) } } : { success: false });

  const User = require('../src/modules/serviceProvider/models/User.js');
  const Worker = require('../src/modules/serviceProvider/models/Worker.js');
  const Transaction = require('../src/modules/serviceProvider/models/Transaction.js');
  const Notification = require('../src/modules/serviceProvider/models/Notification.js');
  const SpPaymentReceipt = require('../src/modules/serviceProvider/models/SpPaymentReceipt.js');
  for (const M of [User, Worker, Transaction, Notification, SpPaymentReceipt]) {
    await M.createCollection().catch(() => {});
    await M.init().catch(() => {});
  }

  const wallet = require('../src/modules/serviceProvider/controllers/userControllers/userWalletController.js');
  const dues = require('../src/modules/serviceProvider/controllers/workerControllers/workerWalletController.js');
  const notif = require('../src/modules/serviceProvider/controllers/notificationControllers/notificationController.js');

  const oid = () => new mongoose.Types.ObjectId();
  let seq = 9920000000;
  const call = async (handler, req) => {
    const res = {
      statusCode: 200, body: null,
      status(c) { this.statusCode = c; return this; },
      json(p) { this.body = p; return this; },
    };
    await handler({ params: {}, query: {}, body: {}, app: { get: () => null }, ...req }, res);
    return res;
  };
  const pay = (notes, rupees) => {
    const orderId = `order_${seq++}`;
    const paymentId = `pay_${seq++}`;
    orders.set(orderId, notes);
    payments.set(paymentId, { orderId, paise: rupees * 100 });
    return { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: 'sig' };
  };
  const newUser = async () => {
    const _id = oid();
    await User.collection.insertOne({ _id, name: 'U', email: `r${seq}@t.test`, phone: String(seq++), wallet: { balance: 0 } });
    return _id;
  };
  const newWorker = async (owed) => {
    const _id = oid();
    await Worker.collection.insertOne({ _id, name: 'W', email: `w${seq}@t.test`, phone: String(seq++), wallet: { dues: owed, isBlocked: false } });
    return _id;
  };
  // The token role is what auth sets on req.userRole; req.user is the account document (no role field).
  const asUser = (id) => ({ user: { id: String(id), _id: id }, userRole: 'USER' });
  const asWorker = (id) => ({ user: { id: String(id), _id: id }, userRole: 'WORKER' });
  const topup = (id, body) => call(wallet.verifyWalletTopup, { ...asUser(id), body });
  const payDues = (id, body) => call(dues.verifyDuesPayment, { ...asWorker(id), body });
  const balance = async (id) => (await User.findById(id).lean()).wallet.balance;
  const owed = async (id) => (await Worker.findById(id).lean()).wallet.dues;

  console.log('\nwallet top-up');
  const alice = await newUser();
  const mallory = await newUser();
  const aliceTopup = pay({ type: 'wallet_topup', userId: String(alice) }, 500);

  await check('a genuine top-up credits its owner once', async () => {
    const r = await topup(alice, aliceTopup);
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(await balance(alice), 500);
    const again = await topup(alice, aliceTopup);
    assert.equal(again.body?.success, true);
    assert.equal(await balance(alice), 500);
  });
  await check("alice's top-up replayed by mallory is refused", async () => {
    const r = await topup(mallory, aliceTopup);
    assert.ok(r.statusCode >= 400, `got ${r.statusCode}`);
    assert.equal(await balance(mallory), 0);
  });
  await check('a booking payment replayed as a top-up is refused', async () => {
    const r = await topup(mallory, pay({ userId: String(mallory), bookingId: String(oid()) }, 900));
    assert.equal(r.statusCode, 400, JSON.stringify(r.body));
    assert.equal(await balance(mallory), 0);
  });

  console.log('\nworker dues');
  const w1 = await newWorker(300);
  const w2 = await newWorker(300);

  await check('a booking payment (no workerId in its notes) does not clear dues', async () => {
    const r = await payDues(w2, pay({ userId: String(mallory), bookingId: String(oid()) }, 300));
    assert.equal(r.statusCode, 400, JSON.stringify(r.body));
    assert.equal(await owed(w2), 300);
  });
  await check("a customer's wallet top-up cannot also clear dues", async () => {
    const r = await payDues(w2, aliceTopup);
    assert.ok(r.statusCode >= 400, `got ${r.statusCode}`);
    assert.equal(await owed(w2), 300);
  });
  const w1Dues = pay({ type: 'worker_dues', workerId: String(w1) }, 300);
  await check("worker 1's dues payment replayed by worker 2 is refused", async () => {
    const r = await payDues(w2, w1Dues);
    assert.equal(r.statusCode, 403, JSON.stringify(r.body));
    assert.equal(await owed(w2), 300);
  });
  await check('a genuine dues payment clears its owner once', async () => {
    const r = await payDues(w1, w1Dues);
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(await owed(w1), 0);
    await Worker.updateOne({ _id: w1 }, { $set: { 'wallet.dues': 300 } });
    const again = await payDues(w1, w1Dues);
    assert.ok(again.statusCode >= 400, `replay got ${again.statusCode}`);
    assert.equal(await owed(w1), 300);
  });

  console.log('\nnotifications');
  const mk = (owner) => Notification.collection.insertOne({ _id: oid(), ...owner, type: 'general', title: 't', message: 'm', isRead: false, createdAt: new Date() }).then((r) => r.insertedId);
  const aliceNote = await mk({ userId: alice });
  const workerNote = await mk({ workerId: w1 });

  await check("mallory cannot mark alice's notification read", async () => {
    const r = await call(notif.markAsRead, { ...asUser(mallory), params: { id: String(aliceNote) } });
    assert.equal(r.statusCode, 404, JSON.stringify(r.body));
    assert.equal((await Notification.findById(aliceNote).lean()).isRead, false);
  });
  await check("mallory's mark-all-read touches only mallory's", async () => {
    await call(notif.markAllAsRead, asUser(mallory));
    assert.equal((await Notification.findById(aliceNote).lean()).isRead, false);
    assert.equal((await Notification.findById(workerNote).lean()).isRead, false);
  });
  await check("mallory cannot delete alice's notification", async () => {
    const r = await call(notif.deleteNotification, { ...asUser(mallory), params: { id: String(aliceNote) } });
    assert.equal(r.statusCode, 404, JSON.stringify(r.body));
    assert.ok(await Notification.findById(aliceNote).lean());
  });
  await check('a worker deleting all their notifications leaves the others', async () => {
    await call(notif.deleteAllNotifications, asWorker(w1));
    assert.equal(await Notification.findById(workerNote).lean(), null);
    assert.ok(await Notification.findById(aliceNote).lean());
  });
  await check('alice can still mark her own notification read', async () => {
    const r = await call(notif.markAsRead, { ...asUser(alice), params: { id: String(aliceNote) } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal((await Notification.findById(aliceNote).lean()).isRead, true);
  });
  await check('an unknown role is refused, not run unfiltered', async () => {
    const r = await call(notif.markAllAsRead, { user: { id: String(oid()) }, userRole: 'GUEST' });
    assert.equal(r.statusCode, 403);
  });

  await mongoose.disconnect();
  await replSet.stop();
};

main()
  .then(() => {
    console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
    process.exit(failed ? 1 : 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
