/**
 * The tip reaches the rider, exactly once.
 *
 * Run: node tests/food-rider-tip.smoke.mjs
 *
 * Found in the audit: createOrder set riderEarning to the delivery payout
 * without the tip. riderEarning is what every rider balance is built from:
 * earnings summed over delivered orders, set against the COD cash collected
 * (the full pricing.total, tip included). So a tipped order paid the rider
 * nothing extra, and on cash they had to deposit the customer's tip.
 *
 * The ledger already added the tip on top of riderTotalPayout, so the tip goes
 * into riderEarning and riderTotalPayout stays pre-tip. The ledger's fallback to
 * riderEarning, used when the payout is zero, must then not count it a second
 * time.
 *
 * Drives the real createOrder and createInitialTransaction against an in-memory
 * Mongo.
 */
import mongoose from 'mongoose';
import { startFoodWorld, makeChecker, near } from './food-order-fixture.mjs';

const w = await startFoodWorld('rider_tip');
const { check, summary } = makeChecker();
let failed = 1;

try {
    const items = [w.appLine(w.dish)];
    const buyer = await w.makeUser();

    console.log('\na cash order with a Rs 20 tip');
    const q = await w.quote(buyer._id, { items, tip: 20 });
    check('the bill carries the tip, untaxed: Rs 272', near(q.tip, 20) && near(q.total, 272), `tip ${q.tip}, total ${q.total}`);
    const order = await w.saved(await w.place(buyer._id, { items, pricing: q, tip: 20 }));
    check('riderTotalPayout is the pay before the tip', near(order.riderTotalPayout, 30), `${order.riderTotalPayout}`);
    check('THE BUG: riderEarning includes the tip', near(order.riderEarning, 50), `${order.riderEarning}`);

    const tx = await w.m.FoodTransaction.findOne({ orderId: order._id }).lean();
    check('the ledger pays the rider 30 + 20, once', near(tx.amounts.riderTotalPayout, 50), `${tx.amounts.riderTotalPayout}`);
    const bill = order.pricing.bill;
    const accounted = tx.amounts.restaurantShare + tx.amounts.riderTotalPayout + tx.amounts.platformNetProfit
        + bill.gstOnItems + bill.platformFeeGst;
    check('every rupee is credited to somebody', near(accounted, order.pricing.total),
        `${Math.round(accounted * 100) / 100} of ${order.pricing.total}`);

    console.log('\nthe rider\'s balance once it is delivered');
    await w.m.FoodOrder.updateOne({ _id: order._id }, {
        $set: { orderStatus: 'delivered', 'payment.status': 'paid', 'dispatch.deliveryPartnerId': w.rider._id },
    });
    // The same sums every rider balance uses: earnings over delivered orders,
    // and the COD cash they collected.
    const [agg] = await w.m.FoodOrder.aggregate([
        { $match: { 'dispatch.deliveryPartnerId': w.rider._id, orderStatus: 'delivered' } },
        {
            $group: {
                _id: null,
                earned: { $sum: '$riderEarning' },
                cash: { $sum: { $cond: [{ $eq: ['$payment.method', 'cash'] }, '$pricing.total', 0] } },
            },
        },
    ]);
    check('the rider earned 50', near(agg.earned, 50), `${agg.earned}`);
    check('and owes back only what is not theirs: Rs 222, not 242', near(agg.cash - agg.earned, 222),
        `${agg.cash - agg.earned}`);

    console.log('\nthe ledger when the payout is zero');
    const synthetic = (tip) => ({
        _id: new mongoose.Types.ObjectId(),
        userId: buyer._id,
        restaurantId: w.restaurant._id,
        payment: { method: 'cash', status: 'cod_pending', amountDue: 222 + tip },
        riderTotalPayout: 0,
        riderEarning: tip,
        pricing: {
            subtotal: 200, commissionableAmount: 200, tax: 10, deliveryFee: 0, platformFee: 10,
            tip, total: 222 + tip, restaurantCommission: 0,
        },
    });
    const tipped = await w.ledger.createInitialTransaction(synthetic(20));
    const untipped = await w.ledger.createInitialTransaction(synthetic(0));
    check('the tip is paid once, not twice', near(tipped.amounts.riderTotalPayout, 20), `${tipped.amounts.riderTotalPayout}`);
    check('and is not booked as a platform cost', near(tipped.amounts.platformNetProfit, untipped.amounts.platformNetProfit),
        `${tipped.amounts.platformNetProfit} vs ${untipped.amounts.platformNetProfit}`);

    failed = summary();
} catch (err) {
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    await w.stop();
    process.exit(failed ? 1 : 0);
}
