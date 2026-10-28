/**
 * The Razorpay webhook, end to end, against a real replica set.
 * Isolated in-memory MongoDB replica set; never touches Atlas.
 *
 * Run:  node tests/webhook.razorpay.smoke.mjs
 *
 * This handler is the one place on this branch where production behaviour changed,
 * twice, and neither change had a test that exercised it:
 *
 *   P0-13  the food handler marked an order paid for ANY captured amount. A Rs 1
 *          capture cleared a Rs 900 order. It now refuses a mismatch.
 *
 *   P0-14  there were two handlers for one Razorpay account, each reading its own
 *          vertical's collection, and Razorpay delivers each event to one URL. So
 *          whichever was not configured never ran. The single handler now resolves
 *          which collection owns the order.
 *
 * signature.smoke.mjs and security.bypass.smoke.mjs cover the signature compare by
 * reading source. Nothing drove an actual event through the handler and looked at
 * the order afterwards. This does.
 *
 * The handler is called directly with a request and response shaped like express's.
 * Going through HTTP would add the whole app to the test and prove nothing more
 * about the handler.
 */
import assert from 'assert';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const SECRET = 'webhook-test-secret';
// Set before the handler is imported: config reads it once, at load.
process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`  PASS  ${name}`); }
  catch (err) { results.push({ name, ok: false, err }); console.log(`  FAIL  ${name}\n        ${err.message}`); }
};
const oid = () => new mongoose.Types.ObjectId();
let seq = 0;

/** A response object that records what the handler did with it. */
const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  return res;
};

/** A signed request, exactly as Razorpay would send it. */
const signedReq = (body, { secret = SECRET, tamper = false } = {}) => {
  const rawBody = Buffer.from(JSON.stringify(body));
  let signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (tamper) signature = (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1);
  return { headers: { 'x-razorpay-signature': signature }, body, rawBody };
};

const captured = (rzOrderId, amountPaise, paymentId = `pay_${++seq}`) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: paymentId, order_id: rzOrderId, amount: amountPaise } } },
});

const refunded = (paymentId, amountPaise) => ({
  event: 'refund.processed',
  payload: { refund: { entity: { id: `rfnd_${++seq}`, payment_id: paymentId, amount: amountPaise } } },
});

async function main() {
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  console.log('Booting in-memory MongoDB replica set…');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'webhook' });
  console.log('Connected.\n');

  const { handleRazorpayWebhook } = await import('../src/core/payments/controllers/razorpayWebhook.controller.js');
  const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
  const { FoodOrder: QCOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');

  /*
   * Orders are inserted raw rather than through the models: only the fields the
   * handler reads matter here, and satisfying every required field of a 130-field
   * order schema would bury what is actually under test.
   */
  const seedOrder = async (Model, { total = 900, status = 'pending', paymentId = null } = {}) => {
    const rzOrderId = `order_${++seq}`;
    const _id = oid();
    await Model.collection.insertOne({
      _id,
      orderId: `T${seq}`,
      orderStatus: 'pending_payment',
      pricing: { total },
      payment: { method: 'razorpay', status, razorpay: { orderId: rzOrderId, ...(paymentId ? { paymentId } : {}) } },
      statusHistory: [],
    });
    return { _id, rzOrderId };
  };
  const readOrder = (Model, _id) => Model.collection.findOne({ _id });

  const deliver = async (body, opts) => {
    const res = mockRes();
    await handleRazorpayWebhook(signedReq(body, opts), res);
    return res;
  };

  // --- signature ------------------------------------------------------------
  console.log('the signature');

  await test('a tampered signature is refused and the order is untouched', async () => {
    const { _id, rzOrderId } = await seedOrder(FoodOrder);
    const res = await deliver(captured(rzOrderId, 90000), { tamper: true });
    assert.equal(res.statusCode, 400);
    assert.equal((await readOrder(FoodOrder, _id)).payment.status, 'pending');
  });

  await test('a signature made with a different secret is refused', async () => {
    const { _id, rzOrderId } = await seedOrder(FoodOrder);
    const res = await deliver(captured(rzOrderId, 90000), { secret: 'not-the-secret' });
    assert.equal(res.statusCode, 400);
    assert.equal((await readOrder(FoodOrder, _id)).payment.status, 'pending');
  });

  await test('a missing signature header is refused', async () => {
    const { rzOrderId } = await seedOrder(FoodOrder);
    const req = signedReq(captured(rzOrderId, 90000));
    delete req.headers['x-razorpay-signature'];
    const res = mockRes();
    await handleRazorpayWebhook(req, res);
    assert.equal(res.statusCode, 400);
  });

  // --- P0-13 ----------------------------------------------------------------
  console.log('\nP0-13: the captured amount has to match');

  await test('an exact capture marks a food order paid', async () => {
    const { _id, rzOrderId } = await seedOrder(FoodOrder, { total: 900 });
    const res = await deliver(captured(rzOrderId, 90000));
    assert.equal(res.statusCode, 200);
    const order = await readOrder(FoodOrder, _id);
    assert.equal(order.payment.status, 'paid');
    assert.equal(order.orderStatus, 'created');
  });

  await test('THE BUG: a Rs 1 capture does NOT settle a Rs 900 food order', async () => {
    const { _id, rzOrderId } = await seedOrder(FoodOrder, { total: 900 });
    const res = await deliver(captured(rzOrderId, 100));
    const order = await readOrder(FoodOrder, _id);
    assert.notEqual(order.payment.status, 'paid', 'an underpaid order was marked paid');
    assert.equal(order.payment.status, 'failed');
    assert.equal(order.orderStatus, 'pending_payment', 'the order must not advance to the restaurant');
    // 200 on purpose: anything else makes Razorpay retry an event that can never succeed.
    assert.equal(res.statusCode, 200);
  });

  await test('an overpayment is refused too', async () => {
    const { _id, rzOrderId } = await seedOrder(FoodOrder, { total: 900 });
    await deliver(captured(rzOrderId, 95000));
    assert.notEqual((await readOrder(FoodOrder, _id)).payment.status, 'paid');
  });

  await test('a fractional total settles on its exact paise', async () => {
    const { _id, rzOrderId } = await seedOrder(FoodOrder, { total: 899.99 });
    await deliver(captured(rzOrderId, 89999));
    assert.equal((await readOrder(FoodOrder, _id)).payment.status, 'paid');
  });

  await test('a mismatch never DOWNGRADES an order another path already paid', async () => {
    // /verify can win the race. A late mismatched webhook must not undo it.
    const { _id, rzOrderId } = await seedOrder(FoodOrder, { total: 900, status: 'paid' });
    await deliver(captured(rzOrderId, 100));
    assert.equal((await readOrder(FoodOrder, _id)).payment.status, 'paid');
  });

  // --- P0-14 ----------------------------------------------------------------
  console.log('\nP0-14: one handler, whichever vertical owns the order');

  await test('THE BUG: a quick-commerce order is settled by the single handler', async () => {
    /*
     * Before, the master handler read only food_orders. If the dashboard pointed
     * at that URL, this event found nothing and the QC payment reconciled only if
     * the customer's app happened to call /verify.
     */
    const { _id, rzOrderId } = await seedOrder(QCOrder, { total: 450 });
    const res = await deliver(captured(rzOrderId, 45000));
    assert.equal(res.statusCode, 200);
    const order = await readOrder(QCOrder, _id);
    assert.equal(order.payment.status, 'paid');
    assert.equal(order.orderStatus, 'created');
  });

  await test('the amount rule applies to quick-commerce orders too', async () => {
    const { _id, rzOrderId } = await seedOrder(QCOrder, { total: 450 });
    await deliver(captured(rzOrderId, 100));
    assert.notEqual((await readOrder(QCOrder, _id)).payment.status, 'paid');
  });

  await test('settling a QC order does not touch any food order', async () => {
    const food = await seedOrder(FoodOrder, { total: 450 });
    const qc = await seedOrder(QCOrder, { total: 450 });
    await deliver(captured(qc.rzOrderId, 45000));
    assert.equal((await readOrder(FoodOrder, food._id)).payment.status, 'pending');
  });

  await test('an event for an order in NO vertical is acknowledged and changes nothing', async () => {
    const res = await deliver(captured('order_does_not_exist', 90000));
    assert.equal(res.statusCode, 200);
  });

  await test('a refund on a quick-commerce payment is recorded against the QC order', async () => {
    const paymentId = `pay_qc_refund_${++seq}`;
    const { _id } = await seedOrder(QCOrder, { total: 450, status: 'paid', paymentId });
    await deliver(refunded(paymentId, 45000));
    const order = await readOrder(QCOrder, _id);
    assert.equal(order.payment.status, 'refunded');
    assert.equal(order.payment.refund.status, 'processed');
    assert.equal(order.payment.refund.amount, 450);
  });

  // --- replays --------------------------------------------------------------
  console.log('\nreplays');

  await test('the same captured event twice advances the order once', async () => {
    const { _id, rzOrderId } = await seedOrder(FoodOrder, { total: 900 });
    const body = captured(rzOrderId, 90000, `pay_replay_${++seq}`);
    await deliver(body);
    await deliver(body);
    const order = await readOrder(FoodOrder, _id);
    assert.equal(order.payment.status, 'paid');
    assert.equal(order.statusHistory.length, 1, 'a replay must not append a second history entry');
  });

  await test('concurrent duplicate deliveries advance the order once', async () => {
    // Razorpay retries can overlap with the original delivery.
    const { _id, rzOrderId } = await seedOrder(QCOrder, { total: 300 });
    const body = captured(rzOrderId, 30000, `pay_conc_${++seq}`);
    const responses = await Promise.all(Array.from({ length: 6 }, () => deliver(body)));
    assert.ok(responses.every((r) => r.statusCode === 200));
    const order = await readOrder(QCOrder, _id);
    assert.equal(order.payment.status, 'paid');
    assert.equal(order.statusHistory.length, 1);
  });

  await test('a refund replayed does not re-record the refund', async () => {
    const paymentId = `pay_refund_replay_${++seq}`;
    const { _id } = await seedOrder(FoodOrder, { total: 200, status: 'paid', paymentId });
    const body = refunded(paymentId, 20000);
    await deliver(body);
    const first = (await readOrder(FoodOrder, _id)).payment.refund.processedAt;
    await deliver(body);
    const second = (await readOrder(FoodOrder, _id)).payment.refund.processedAt;
    assert.equal(second.getTime(), first.getTime(), 'the refund was processed a second time');
  });

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length
    ? `\n${failed.length} of ${results.length} checks failed\n`
    : `\nall ${results.length} checks passed\n`);

  await mongoose.disconnect().catch(() => {});
  await replSet.stop().catch(() => {});
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`HARNESS FAILED: ${err.stack || err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
