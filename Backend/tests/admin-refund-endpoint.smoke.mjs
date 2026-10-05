/**
 * The food admin refund controller answers instead of crashing.
 *
 * Run: node tests/admin-refund-endpoint.smoke.mjs
 *
 * admin.controller.js processRefund called adminService.processRefund, which has
 * never existed -- every call threw "is not a function" into the error handler.
 * The only real refund path on the food side (processOrderRefundOnce in
 * orders/order.service.js) is private, full-amount only and tied to cancellation,
 * so there is no correct target to wire this to. The controller now says so with
 * a 501 and, above all, no longer tells the customer a refund was processed.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

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
const mockRes = () => ({
    code: 200,
    body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
});

const main = async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'admin_refund' });

    const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
    const controller = await import('../src/modules/food/admin/controllers/admin.controller.js');

    const orderId = new mongoose.Types.ObjectId();
    await FoodOrder.collection.insertOne({
        _id: orderId, orderId: 'FOD-TEST', userId: new mongoose.Types.ObjectId(), orderStatus: 'delivered',
        payment: { method: 'razorpay', status: 'paid' }, pricing: { total: 300 }, createdAt: new Date(),
    });

    const res = mockRes();
    let error = null;
    await controller.processRefund({ params: { orderId: String(orderId) }, body: { refundAmount: 300 } }, res, (e) => { error = e; });

    await check('does not throw into the error handler', async () => {
        assert.equal(error, null, `threw: ${error?.message}`);
    });
    await check('answers 501 Not Implemented', async () => {
        assert.equal(res.code, 501, `status ${res.code}`);
        assert.equal(res.body?.success, false);
    });
    await check('the order is untouched', async () => {
        const o = await FoodOrder.findById(orderId).lean();
        assert.equal(o.payment.status, 'paid');
        assert.equal(o.payment.refund, undefined);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
