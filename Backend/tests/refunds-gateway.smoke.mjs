/**
 * Gateway refunds (SOW plan 2.5) and the finance P0s closed with them (2.8).
 *
 * Run: node tests/refunds-gateway.smoke.mjs
 *
 * Isolated in-memory MongoDB replica set. Razorpay is NEVER called: the refund API
 * is replaced through refund.service's test hook (this repo's .env holds LIVE keys),
 * and webhooks are signed locally with a test secret.
 *
 *   - refundGatewayPayment: one Refund row and ONE gateway call per idempotency key,
 *     sequential or concurrent; a failed refund can be retried and only then calls
 *     the gateway again;
 *   - service-provider admin refunds go through it (real razorpayService.refundPayment);
 *   - food / quick-commerce / returns / late-capture call sites no longer call the
 *     helper that bypassed it;
 *   - refund.processed / refund.failed webhooks update the row; a duplicate delivery
 *     (same x-razorpay-event-id) is acknowledged and ignored (P0-5);
 *   - wallet refunds are unchanged, and now idempotent too;
 *   - the BullMQ payment processor retries failed credits safely and dead-letters
 *     only on the last attempt (P0-3), with idempotent credits (P0-4).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const require = createRequire(import.meta.url);
const SECRET = 'refund-webhook-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
    }
};
const oid = () => new mongoose.Types.ObjectId();
let seq = 0;

const mockRes = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
};
const signedReq = (body, { eventId } = {}) => {
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
    return { headers: { 'x-razorpay-signature': signature, ...(eventId ? { 'x-razorpay-event-id': eventId } : {}) }, body, rawBody };
};

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'refunds_gateway' });

    const refunds = await import('../src/core/payments/refund.service.js');
    const { Refund } = await import('../src/core/payments/models/refund.model.js');
    const { Payment } = await import('../src/core/payments/models/payment.model.js');
    const { Transaction } = await import('../src/core/payments/models/transaction.model.js');
    const { WebhookEvent } = await import('../src/core/payments/models/webhookEvent.model.js');
    const { FailedFinancialOperation } = await import('../src/core/finance/failedFinancialOperation.model.js');
    const { handleRazorpayWebhook } = await import('../src/core/payments/controllers/razorpayWebhook.controller.js');
    const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
    for (const M of [Refund, Transaction, WebhookEvent]) await M.init();

    /** The Razorpay stand-in. */
    const gatewayCalls = [];
    let gatewayMode = 'ok';
    refunds.__setRefundGatewayForTests(async (req) => {
        gatewayCalls.push(req);
        await new Promise((r) => setTimeout(r, 20)); // a real round trip takes time; races need the gap
        if (gatewayMode === 'fail') throw new Error('BAD_REQUEST_ERROR: The refund amount is invalid');
        return { id: `rfnd_${++seq}`, status: 'pending', payment_id: req.gatewayPaymentId, amount: req.amountPaise };
    });
    const callsFor = (paymentId) => gatewayCalls.filter((c) => c.gatewayPaymentId === paymentId).length;

    console.log('\nrefundGatewayPayment');
    await check('one refund, one Refund row, Razorpay asked in paise with the key in notes', async () => {
        const r = await refunds.refundGatewayPayment({ vertical: 'food', gatewayPaymentId: 'pay_A', amount: 249.5, idempotencyKey: 'food:order_refund:A', orderRef: 'FOD-1', reason: 'Order cancelled' });
        assert.equal(r.success, true);
        assert.equal(r.duplicate, false);
        assert.match(r.refundId, /^rfnd_/);
        assert.equal(gatewayCalls.at(-1).amountPaise, 24950);
        assert.equal(gatewayCalls.at(-1).notes.refund_key, 'food:order_refund:A');
        const row = await Refund.findOne({ idempotencyKey: 'food:order_refund:A' }).lean();
        assert.equal(row.refundTo, 'gateway');
        assert.equal(row.gatewayStatus, 'pending');
        assert.equal(row.status, 'processed', 'accepted by the gateway');
        assert.equal(row.gatewayRefundId, r.refundId);
    });
    await check('the same key again does NOT call Razorpay and returns the first refund', async () => {
        const first = await Refund.findOne({ idempotencyKey: 'food:order_refund:A' }).lean();
        const r = await refunds.refundGatewayPayment({ vertical: 'food', gatewayPaymentId: 'pay_A', amount: 249.5, idempotencyKey: 'food:order_refund:A' });
        assert.equal(r.duplicate, true);
        assert.equal(r.refundId, first.gatewayRefundId);
        assert.equal(callsFor('pay_A'), 1);
        assert.equal(await Refund.countDocuments({ idempotencyKey: 'food:order_refund:A' }), 1);
    });
    await check('8 concurrent requests with one key make exactly one gateway call', async () => {
        await Promise.all(Array.from({ length: 8 }, () => refunds.refundGatewayPayment({ vertical: 'quickCommerce', gatewayPaymentId: 'pay_B', amount: 100, idempotencyKey: 'qc:order_refund:B' })));
        assert.equal(callsFor('pay_B'), 1);
        assert.equal(await Refund.countDocuments({ idempotencyKey: 'qc:order_refund:B' }), 1);
    });
    await check('a gateway failure is recorded as failed, and a retry with the same key calls again once', async () => {
        gatewayMode = 'fail';
        const r = await refunds.refundGatewayPayment({ vertical: 'food', gatewayPaymentId: 'pay_C', amount: 50, idempotencyKey: 'food:order_refund:C' });
        assert.equal(r.success, false);
        assert.match(r.error, /refund amount is invalid/);
        let row = await Refund.findOne({ idempotencyKey: 'food:order_refund:C' }).lean();
        assert.equal(row.status, 'failed');
        assert.match(row.failureReason, /invalid/);
        gatewayMode = 'ok';
        const again = await refunds.refundGatewayPayment({ vertical: 'food', gatewayPaymentId: 'pay_C', amount: 50, idempotencyKey: 'food:order_refund:C' });
        assert.equal(again.success, true);
        assert.equal(callsFor('pay_C'), 2);
        row = await Refund.findOne({ idempotencyKey: 'food:order_refund:C' }).lean();
        assert.equal(row.attempts, 2);
        await refunds.refundGatewayPayment({ vertical: 'food', gatewayPaymentId: 'pay_C', amount: 50, idempotencyKey: 'food:order_refund:C' });
        assert.equal(callsFor('pay_C'), 2, 'not a third time');
    });
    await check('no key, no refund: the key is mandatory', async () => {
        await assert.rejects(refunds.refundGatewayPayment({ gatewayPaymentId: 'pay_D', amount: 10 }), /idempotencyKey is required/);
    });

    console.log('\nservice provider admin refund');
    await check('razorpayService.refundPayment goes through the platform refund service', async () => {
        const { refundPayment } = require('../src/modules/serviceProvider/services/razorpayService.js');
        const bookingId = String(oid());
        const r1 = await refundPayment('pay_SP1', 300, { reason: 'Booking cancellation' }, { idempotencyKey: `sp:admin_refund:${bookingId}`, bookingId, bookingNumber: 'BK-9', source: 'admin_refund' });
        const r2 = await refundPayment('pay_SP1', 300, { reason: 'Booking cancellation' }, { idempotencyKey: `sp:admin_refund:${bookingId}`, bookingId, bookingNumber: 'BK-9', source: 'admin_refund' });
        assert.equal(r1.success, true);
        assert.match(r1.refund.id, /^rfnd_/);
        assert.equal(r2.refund.id, r1.refund.id);
        assert.equal(callsFor('pay_SP1'), 1);
        const row = await Refund.findOne({ idempotencyKey: `sp:admin_refund:${bookingId}` }).lean();
        assert.equal(row.vertical, 'serviceProvider');
        assert.equal(row.orderRef, 'BK-9');
    });
    await check('the SP admin refund controller passes a per-booking idempotency key', async () => {
        const src = readFileSync(new URL('../src/modules/serviceProvider/controllers/paymentControllers/paymentController.js', import.meta.url), 'utf8');
        assert.match(src, /idempotencyKey: `sp:admin_refund:\$\{booking\._id\}`/);
    });

    console.log('\nevery online refund call site uses it');
    await check('food, quick-commerce cancel, QC returns and the late-capture webhook no longer call initiateRazorpayRefund', async () => {
        for (const file of [
            '../src/modules/food/orders/services/order.service.js',
            '../src/modules/quickCommerce/modules/food/orders/services/order.service.js',
            '../src/modules/quickCommerce/modules/food/returns/services/return.service.js',
            '../src/core/payments/controllers/razorpayWebhook.controller.js',
        ]) {
            const src = readFileSync(new URL(file, import.meta.url), 'utf8');
            assert.ok(!/initiateRazorpayRefund\(/.test(src), `${file} still calls initiateRazorpayRefund`);
            assert.match(src, /refundGatewayPayment\(\{/, `${file} does not call refundGatewayPayment`);
            assert.match(src, /idempotencyKey:/, `${file} passes no idempotency key`);
        }
    });

    console.log('\nwebhooks: refund.processed / refund.failed');
    const deliver = async (body, eventId) => {
        const res = mockRes();
        await handleRazorpayWebhook(signedReq(body, { eventId }), res);
        return res;
    };
    await check('refund.processed marks the refund row processed and syncs the food order', async () => {
        const orderId = oid();
        await FoodOrder.collection.insertOne({ _id: orderId, orderId: 'FOD-77', orderStatus: 'cancelled_by_user', pricing: { total: 120 }, payment: { method: 'razorpay', status: 'paid', razorpay: { orderId: 'order_77', paymentId: 'pay_F77' }, refund: { status: 'pending', amount: 120 } }, statusHistory: [] });
        const r = await refunds.refundGatewayPayment({ vertical: 'food', gatewayPaymentId: 'pay_F77', amount: 120, idempotencyKey: `food:order_refund:${orderId}`, orderId });
        const res = await deliver({ event: 'refund.processed', payload: { refund: { entity: { id: r.refundId, payment_id: 'pay_F77', amount: 12000, status: 'processed' } } } }, 'evt_rp_1');
        assert.equal(res.statusCode, 200);
        const row = await Refund.findOne({ gatewayRefundId: r.refundId }).lean();
        assert.equal(row.gatewayStatus, 'processed');
        assert.equal(row.status, 'processed');
        const order = await FoodOrder.collection.findOne({ _id: orderId });
        assert.equal(order.payment.status, 'refunded');
        assert.equal(order.payment.refund.status, 'processed');
        assert.equal(order.payment.refund.refundId, r.refundId);
    });
    await check('a duplicate delivery (same event id) is acknowledged and ignored', async () => {
        const before = await WebhookEvent.findById('razorpay:evt_rp_1').lean();
        assert.equal(before.status, 'processed');
        const res = await deliver({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_whatever', payment_id: 'pay_F77', amount: 12000 } } } }, 'evt_rp_1');
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.duplicate, true);
        const after = await WebhookEvent.findById('razorpay:evt_rp_1').lean();
        assert.equal(after.attempts, 1);
    });
    await check('refund.failed marks the row failed, keeps the reason, and dead-letters it for follow-up', async () => {
        const r = await refunds.refundGatewayPayment({ vertical: 'serviceProvider', gatewayPaymentId: 'pay_SPF', amount: 75, idempotencyKey: 'sp:admin_refund:F1', orderRef: 'BK-F1' });
        const res = await deliver({ event: 'refund.failed', payload: { refund: { entity: { id: r.refundId, payment_id: 'pay_SPF', amount: 7500, status: 'failed', error_description: 'Card account closed' } } } }, 'evt_rf_1');
        assert.equal(res.statusCode, 200);
        const row = await Refund.findOne({ gatewayRefundId: r.refundId }).lean();
        assert.equal(row.status, 'failed');
        assert.equal(row.gatewayStatus, 'failed');
        assert.equal(row.failureReason, 'Card account closed');
        assert.equal(await FailedFinancialOperation.countDocuments({ operation: 'gateway_refund_failed', paymentId: 'pay_SPF' }), 1);
    });
    await check('a failed refund can be retried from the admin path (processGatewayRefund), once', async () => {
        const row = await Refund.findOne({ idempotencyKey: 'sp:admin_refund:F1' }).lean();
        const before = callsFor('pay_SPF');
        await refunds.processGatewayRefund(row._id);
        await refunds.processGatewayRefund(row._id);
        assert.equal(callsFor('pay_SPF'), before + 1);
        assert.equal((await Refund.findById(row._id).lean()).status, 'processed');
    });
    await check('a late refund.failed never downgrades a refund Razorpay already processed', async () => {
        const row = await Refund.findOne({ idempotencyKey: 'food:order_refund:A' }).lean();
        await deliver({ event: 'refund.processed', payload: { refund: { entity: { id: row.gatewayRefundId, payment_id: 'pay_A', amount: 24950 } } } }, 'evt_rp_A');
        await deliver({ event: 'refund.failed', payload: { refund: { entity: { id: row.gatewayRefundId, payment_id: 'pay_A', amount: 24950 } } } }, 'evt_rf_A');
        const after = await Refund.findById(row._id).lean();
        assert.equal(after.gatewayStatus, 'processed');
        assert.equal(after.status, 'processed');
    });
    await check('a delivery whose handler failed is retried on redelivery, not ignored', async () => {
        await WebhookEvent.create({ _id: 'razorpay:evt_retry', event: 'refund.processed', status: 'failed' });
        const res = await deliver({ event: 'refund.created', payload: { refund: { entity: { id: 'rfnd_none', payment_id: 'pay_none', amount: 100 } } } }, 'evt_retry');
        assert.equal(res.statusCode, 200);
        assert.notEqual(res.body.duplicate, true);
        const ev = await WebhookEvent.findById('razorpay:evt_retry').lean();
        assert.equal(ev.status, 'processed');
        assert.equal(ev.attempts, 2);
    });

    console.log('\nwallet refunds (unchanged path, now idempotent)');
    await check('initiateRefund to wallet credits once per idempotency key', async () => {
        const userId = oid();
        const payment = await Payment.create({ orderId: oid(), userId, amount: 200, method: 'wallet', gateway: 'none', status: 'success' });
        const args = { paymentId: String(payment._id), orderId: String(payment.orderId), userId: String(userId), amount: 200, refundTo: 'wallet', idempotencyKey: `refund:order_cancelled:${payment.orderId}` };
        const a = await refunds.initiateRefund(args);
        await Payment.updateOne({ _id: payment._id }, { $set: { status: 'success' } }); // as if a replayed job saw it unrefunded
        const b = await refunds.initiateRefund(args);
        assert.equal(String(a._id), String(b._id));
        assert.equal(a.status, 'processed');
        assert.equal(await Transaction.countDocuments({ entityId: userId, category: 'order_refund' }), 1);
        assert.equal(gatewayCalls.filter((c) => c.amountPaise === 20000).length, 0, 'no gateway call for a wallet refund');
    });

    console.log('\npayment processor (P0-3 / P0-4)');
    const { processPaymentJob } = await import('../src/queues/processors/payment.processor.js');
    const job = (data, { attempts = 3, attemptsMade = 0 } = {}) => ({ id: `job${++seq}`, data, opts: { attempts }, attemptsMade });
    await check('delivery_completed run twice credits each party once', async () => {
        const orderMongoId = String(oid());
        const data = { action: 'delivery_completed', orderMongoId, orderId: 'FOD-P1', restaurantId: String(oid()), deliveryPartnerId: String(oid()), riderEarning: 40, platformProfit: 15, commissionAmount: 200 };
        await processPaymentJob(job(data));
        await processPaymentJob(job(data));
        const rows = await Transaction.find({ orderId: orderMongoId }).lean();
        assert.equal(rows.length, 3);
        assert.deepEqual(rows.map((r) => r.amount).sort((x, y) => x - y), [15, 40, 200]);
        assert.ok(rows.every((r) => r.idempotencyKey));
    });
    await check('a failed credit with retries left FAILS the job (BullMQ retries) and dead-letters nothing yet', async () => {
        const data = { action: 'delivery_completed', orderMongoId: String(oid()), orderId: 'FOD-P2', restaurantId: 'not-an-object-id', commissionAmount: 99 };
        const before = await FailedFinancialOperation.countDocuments({ orderId: 'FOD-P2' });
        await assert.rejects(processPaymentJob(job(data, { attempts: 3, attemptsMade: 0 })), /retrying/);
        assert.equal(await FailedFinancialOperation.countDocuments({ orderId: 'FOD-P2' }), before);
    });
    await check('on the last attempt it is dead-lettered instead of swallowed', async () => {
        const data = { action: 'delivery_completed', orderMongoId: String(oid()), orderId: 'FOD-P3', restaurantId: 'not-an-object-id', commissionAmount: 99 };
        await processPaymentJob(job(data, { attempts: 3, attemptsMade: 2 }));
        assert.equal(await FailedFinancialOperation.countDocuments({ orderId: 'FOD-P3', operation: 'credit_restaurant_commission' }), 1);
    });
    await check('recordTransaction with one key from parallel callers moves the money once', async () => {
        const { creditWallet } = await import('../src/core/payments/wallet.service.js');
        const restaurantId = String(oid());
        const results = await Promise.allSettled(Array.from({ length: 6 }, () => creditWallet({ entityType: 'restaurant', entityId: restaurantId, amount: 10, category: 'commission', idempotencyKey: `order_commission:X:${restaurantId}` })));
        assert.ok(results.some((r) => r.status === 'fulfilled'));
        assert.equal(await Transaction.countDocuments({ idempotencyKey: `order_commission:X:${restaurantId}` }), 1);
        const { FoodRestaurantWallet } = await import('../src/modules/food/restaurant/models/restaurantWallet.model.js');
        const wallet = await FoodRestaurantWallet.findOne({ restaurantId }).lean();
        assert.equal(wallet.balance, 10);
    });

    refunds.__setRefundGatewayForTests(null);
    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
