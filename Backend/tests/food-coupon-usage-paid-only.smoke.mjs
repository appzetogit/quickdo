/**
 * A coupon is used up only by an order that happened.
 *
 * Run: node tests/food-coupon-usage-paid-only.smoke.mjs
 *
 * Found in the audit: an online checkout abandoned at the payment sheet stays in
 * pending_payment for good. It still counted as the customer's "first order",
 * so a first-order coupon was gone after one failed payment. The coupon's use
 * (the offer's usedCount and the customer's FoodOfferUsage) was bumped at order
 * creation and never given back. Cancelled orders kept their use too.
 *
 * Drives the real validators, createOrder, verifyPayment (mock gateway, test
 * env only) and cancelOrder against an in-memory Mongo.
 */
import { startFoodWorld, makeChecker, near } from './food-order-fixture.mjs';

const w = await startFoodWorld('coupon_usage_paid_only');
const { check, summary } = makeChecker();
let failed = 1;

try {
    const { countCouponUseOnPayment } = await import('../src/modules/food/orders/services/couponUsage.service.js');
    const items = [w.appLine(w.dish)];
    const offerOf = (code) => w.m.FoodOffer.findOne({ couponCode: code }).lean();
    const usageOf = async (code, userId) => {
        const offer = await offerOf(code);
        const row = await w.m.FoodOfferUsage.findOne({ offerId: offer._id, userId }).lean();
        return row?.count || 0;
    };

    await w.m.FoodOffer.create({
        couponCode: 'FIRST50', discountType: 'flat-price', discountValue: 50,
        customerScope: 'first-time', perUserLimit: 1, usageLimit: 100, status: 'active',
    });
    const buyer = await w.makeUser();

    console.log('\nan online checkout, abandoned at the payment sheet');
    const q1 = await w.quote(buyer._id, { items, couponCode: 'FIRST50' });
    check('the first-order coupon is quoted', near(q1.discount, 50), `discount ${q1.discount}`);
    const r1 = await w.place(buyer._id, { items, pricing: q1, couponCode: 'FIRST50', paymentMethod: 'razorpay' });
    const abandoned = await w.saved(r1);
    check('the order waits for payment', abandoned.orderStatus === 'pending_payment', abandoned.orderStatus);
    check('an unpaid attempt does not use the coupon', (await offerOf('FIRST50')).usedCount === 0,
        `usedCount ${(await offerOf('FIRST50')).usedCount}`);
    check('nor the customer\'s own allowance', (await usageOf('FIRST50', buyer._id)) === 0,
        `count ${await usageOf('FIRST50', buyer._id)}`);

    console.log('\nthe customer tries again');
    const q2 = await w.quote(buyer._id, { items, couponCode: 'FIRST50' });
    check('THE BUG: it is still their first order, and the coupon applies', near(q2.discount, 50),
        `discount ${q2.discount}`);

    const r2 = await w.place(buyer._id, { items, pricing: q2, couponCode: 'FIRST50', paymentMethod: 'razorpay' });
    const paidId = String(r2.order._id ?? r2.order.id);
    check('the gateway order is created (mock, test env)', String(r2.razorpay?.orderId || '').startsWith('mock_order_'),
        r2.razorpay?.orderId);
    await w.orderService.verifyPayment(String(buyer._id), {
        orderId: paidId,
        razorpayOrderId: r2.razorpay.orderId,
        razorpayPaymentId: 'mock_pay_smoke',
        razorpaySignature: 'mock_signature_bypass',
    });
    check('once paid, the use is counted', (await offerOf('FIRST50')).usedCount === 1,
        `usedCount ${(await offerOf('FIRST50')).usedCount}`);
    check('and the customer\'s allowance', (await usageOf('FIRST50', buyer._id)) === 1,
        `count ${await usageOf('FIRST50', buyer._id)}`);

    // The webhook arriving after /verify must not count it again.
    await countCouponUseOnPayment(await w.m.FoodOrder.findById(paidId));
    await w.orderService.verifyPayment(String(buyer._id), {
        orderId: paidId, razorpayOrderId: r2.razorpay.orderId,
        razorpayPaymentId: 'mock_pay_smoke', razorpaySignature: 'mock_signature_bypass',
    });
    check('verify and webhook together count it once', (await offerOf('FIRST50')).usedCount === 1,
        `usedCount ${(await offerOf('FIRST50')).usedCount}`);

    const q3 = await w.quote(buyer._id, { items, couponCode: 'FIRST50' });
    check('after a real order the first-order coupon no longer applies', near(q3.discount, 0),
        `discount ${q3.discount}`);

    console.log('\na cash order, cancelled');
    await w.m.FoodOffer.create({
        couponCode: 'ONCE10', discountType: 'flat-price', discountValue: 10,
        perUserLimit: 1, usageLimit: 5, status: 'active',
    });
    const buyer2 = await w.makeUser();
    const q4 = await w.quote(buyer2._id, { items, couponCode: 'ONCE10' });
    const cash = await w.saved(await w.place(buyer2._id, { items, pricing: q4 }));
    check('a cash order counts its use at placement', (await offerOf('ONCE10')).usedCount === 1,
        `usedCount ${(await offerOf('ONCE10')).usedCount}`);
    const q5 = await w.quote(buyer2._id, { items, couponCode: 'ONCE10' });
    check('the per-user limit is spent while it stands', near(q5.discount, 0), `discount ${q5.discount}`);

    await w.orderService.cancelOrder(String(cash._id), String(buyer2._id), 'changed my mind');
    check('cancelling gives the use back', (await offerOf('ONCE10')).usedCount === 0,
        `usedCount ${(await offerOf('ONCE10')).usedCount}`);
    check('and the customer\'s allowance', (await usageOf('ONCE10', buyer2._id)) === 0,
        `count ${await usageOf('ONCE10', buyer2._id)}`);
    const q6 = await w.quote(buyer2._id, { items, couponCode: 'ONCE10' });
    check('so the coupon applies again', near(q6.discount, 10), `discount ${q6.discount}`);

    failed = summary();
} catch (err) {
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    await w.stop();
    process.exit(failed ? 1 : 0);
}
