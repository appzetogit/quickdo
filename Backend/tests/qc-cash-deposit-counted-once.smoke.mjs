/**
 * The quick-commerce copy of the rider cash-deposit flow counts one payment once.
 *
 * Run: node tests/qc-cash-deposit-counted-once.smoke.mjs
 *
 * Same race as cash-deposit-counted-once.smoke.mjs: look up, find nothing, create
 * a Completed row, with no unique index on razorpayPaymentId. This copy also wrote
 * the CLIENT's amount (not the gateway's) when it completed an existing row.
 *
 * Razorpay is deliberately unconfigured here -- quick commerce then skips the
 * signature and gateway calls, which is the path this file can drive offline.
 */
import assert from 'node:assert/strict';

// Pinned empty before env.js loads, so dotenv cannot fill in real keys.
process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';

const { default: mongoose } = await import('mongoose');
const { MongoMemoryServer } = await import('mongodb-memory-server');

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
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'qc_cash_deposit_once' });

    const { FoodDeliveryPartner: QCPartner } = await import('../src/modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js');
    const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
    const { FoodDeliveryCashDeposit: QCDeposit } = await import('../src/modules/quickCommerce/modules/food/delivery/models/foodDeliveryCashDeposit.model.js');
    const finance = await import('../src/modules/quickCommerce/modules/food/delivery/services/deliveryFinance.service.js');
    await QCDeposit.syncIndexes();

    const rider = new mongoose.Types.ObjectId();
    await QCPartner.collection.insertOne({ _id: rider, name: 'QC Rider', phone: '9000000011', status: 'approved' });
    // Cash-in-hand is read from the unified rider finance, which reads food_orders.
    await FoodOrder.collection.insertOne({
        _id: new mongoose.Types.ObjectId(), orderStatus: 'delivered', dispatch: { deliveryPartnerId: rider },
        payment: { method: 'cash' }, pricing: { total: 302 }, riderEarning: 0, createdAt: new Date(),
    });

    const p = { razorpayOrderId: 'order_dev_1', razorpayPaymentId: 'pay_dev_1', razorpaySignature: 'x', amount: 200 };
    const completed = () => QCDeposit.countDocuments({ deliveryPartnerId: rider, status: 'Completed' });

    console.log('\none Rs 200 payment verified twice at once');
    const results = await Promise.allSettled([
        finance.verifyDeliveryCashDepositPayment(rider, p),
        finance.verifyDeliveryCashDepositPayment(rider, p),
    ]);
    await check('neither call errors', async () => {
        const errs = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message);
        assert.equal(errs.length, 0, `errors: ${errs.join('; ')}`);
    });
    await check('exactly one Completed deposit row', async () => {
        assert.equal(await completed(), 1, `rows ${await completed()}`);
    });
    await check('a sequential replay adds nothing', async () => {
        await finance.verifyDeliveryCashDepositPayment(rider, p);
        assert.equal(await completed(), 1);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
