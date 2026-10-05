/**
 * One rider cash deposit is counted once, however many times it is verified.
 *
 * Run: node tests/cash-deposit-counted-once.smoke.mjs
 *
 * Found in the finance audit. Verification looked the payment up, found nothing,
 * and created a Completed deposit -- two steps with a gap between them, and no
 * unique index on razorpayPaymentId behind them. Two verifications of ONE genuine
 * Rs 200 payment sent at the same moment both found nothing and both created a
 * row: cash-in-hand went 302 -> 0 instead of 102. A rider could replay one real
 * signature concurrently and clear all their COD cash for the price of one deposit.
 *
 * Drives the real food verifyDeliveryCashDepositPayment against an in-memory
 * Mongo. The quick-commerce copy lives in qc-cash-deposit-counted-once.smoke.mjs,
 * because the two verticals read Razorpay configuration once at import and this
 * file needs it switched on.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Pinned before anything imports env.js, so dotenv cannot fill in real keys.
process.env.RAZORPAY_KEY_ID = 'rzp_test_smoke';
process.env.RAZORPAY_KEY_SECRET = 'smoke_secret';

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
const sign = (orderId, paymentId) =>
    crypto.createHmac('sha256', 'smoke_secret').update(`${orderId}|${paymentId}`).digest('hex');

const main = async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'cash_deposit_once' });

    const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
    const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
    const { FoodDeliveryCashDeposit } = await import('../src/modules/food/delivery/models/foodDeliveryCashDeposit.model.js');
    const finance = await import('../src/modules/food/delivery/services/deliveryFinance.service.js');
    await FoodDeliveryCashDeposit.syncIndexes();

    const rider = new mongoose.Types.ObjectId();
    await FoodDeliveryPartner.collection.insertOne({ _id: rider, name: 'Rider', phone: '9000000001', status: 'approved' });
    // Rs 302 of COD cash collected and not yet paid in.
    await FoodOrder.collection.insertOne({
        _id: new mongoose.Types.ObjectId(),
        orderStatus: 'delivered',
        dispatch: { deliveryPartnerId: rider },
        payment: { method: 'cash' },
        pricing: { total: 302 },
        riderEarning: 0,
        createdAt: new Date(),
    });

    const payload = (orderId, paymentId) => ({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: sign(orderId, paymentId),
        amount: 200,
    });
    const completed = async () => FoodDeliveryCashDeposit.countDocuments({ deliveryPartnerId: rider, status: 'Completed' });
    const cashInHand = async () => (await finance.getDeliveryPartnerWalletEnhanced(rider)).cashInHand;

    console.log('\none Rs 200 payment verified twice at once');
    const p1 = payload('order_smoke_1', 'mock_pay_1');
    const results = await Promise.allSettled([
        finance.verifyDeliveryCashDepositPayment(rider, p1),
        finance.verifyDeliveryCashDepositPayment(rider, p1),
    ]);
    await check('neither call errors -- the replay is answered, not refused', async () => {
        const errs = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message);
        assert.equal(errs.length, 0, `errors: ${errs.join('; ')}`);
    });
    await check('exactly one Completed deposit row', async () => {
        assert.equal(await completed(), 1, `rows ${await completed()}`);
    });
    await check('cash in hand is 302 - 200 = 102, not 0', async () => {
        assert.equal(await cashInHand(), 102);
    });

    console.log('\nreplayed later, it is still counted once');
    await check('a sequential replay returns the same deposit and changes nothing', async () => {
        const again = await finance.verifyDeliveryCashDepositPayment(rider, p1);
        assert.equal(await completed(), 1);
        assert.equal(Number(again.deposit.amount), 200);
        assert.equal(await cashInHand(), 102);
    });

    console.log('\nanother rider cannot claim the same payment');
    await check("a second rider replaying this payment id is refused", async () => {
        const other = new mongoose.Types.ObjectId();
        await FoodDeliveryPartner.collection.insertOne({ _id: other, name: 'Other', phone: '9000000002', status: 'approved' });
        await FoodOrder.collection.insertOne({
            _id: new mongoose.Types.ObjectId(), orderStatus: 'delivered', dispatch: { deliveryPartnerId: other },
            payment: { method: 'cash' }, pricing: { total: 500 }, riderEarning: 0, createdAt: new Date(),
        });
        await assert.rejects(() => finance.verifyDeliveryCashDepositPayment(other, p1));
        assert.equal(await FoodDeliveryCashDeposit.countDocuments({ deliveryPartnerId: other, status: 'Completed' }), 0);
    });

    console.log('\na different genuine payment still settles');
    await check('a second Rs 100 payment brings cash in hand to 2', async () => {
        const p2 = { ...payload('order_smoke_2', 'mock_pay_2'), amount: 100 };
        await finance.verifyDeliveryCashDepositPayment(rider, p2);
        assert.equal(await completed(), 2);
        assert.equal(await cashInHand(), 2);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
