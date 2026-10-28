/**
 * The Earnings dashboard counts what a seller earned, day by day.
 *
 * Run: node tests/seller-daily-earnings.smoke.mjs
 *
 * What this guards:
 *   - only delivered orders earn; cancelled ones are counted apart, and
 *     orders still on their way are left out;
 *   - an order's earning is its ledger restaurantShare, or subtotal +
 *     packaging - commission when there is no transaction yet;
 *   - days are Indian calendar days, every day of the range is present, and
 *     the summary adds up.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

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

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri('daily_earnings'));

const { createSellerDailyEarnings } = await import('../src/core/finance/sellerDailyEarnings.js');

// Bare collections with only the fields read, so the test does not depend on
// every required field of the real order schema.
const Order = mongoose.model('EOrder', new mongoose.Schema({}, { strict: false, collection: 'e_orders' }));
const Transaction = mongoose.model('ETx', new mongoose.Schema({}, { strict: false, collection: 'e_txs' }));
const earnings = createSellerDailyEarnings({ Order, Transaction });

const rid = new mongoose.Types.ObjectId();
const other = new mongoose.Types.ObjectId();
const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const istKey = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const noonIst = (offset) => new Date(`${istKey(now - offset * DAY)}T12:00:00+05:30`);

const order = (offset, extra) => Order.create({ restaurantId: rid, createdAt: noonIst(offset), ...extra });
const today1 = await order(0, { orderStatus: 'delivered', pricing: { subtotal: 300, packagingFee: 20, restaurantCommission: 30 } });
await Transaction.create({ orderId: today1._id, amounts: { restaurantShare: 275, restaurantCommission: 45 } });
await order(0, { orderStatus: 'preparing', pricing: { subtotal: 999 } }); // not delivered yet
await order(0, { orderStatus: 'cancelled_by_restaurant', pricing: { subtotal: 500 } });
await order(1, { orderStatus: 'confirmed', deliveryState: { currentPhase: 'delivered' }, pricing: { subtotal: 200, packagingFee: 0, restaurantCommission: 20 } });
await order(10, { orderStatus: 'delivered', pricing: { subtotal: 100 } });
await Order.create({ restaurantId: other, createdAt: noonIst(0), orderStatus: 'delivered', pricing: { subtotal: 5000 } });

const out = await earnings(rid, { days: 7 });

await check('today: one delivered order at its ledger share, a cancellation counted apart', () => {
    assert.deepEqual(
        { orders: out.summary.today.orders, cancelled: out.summary.today.cancelled, sales: out.summary.today.sales, commission: out.summary.today.commission, earnings: out.summary.today.earnings },
        { orders: 1, cancelled: 1, sales: 320, commission: 45, earnings: 275 },
    );
});

await check('yesterday: no transaction, so subtotal + packaging - commission', () => {
    assert.equal(out.summary.yesterday.orders, 1);
    assert.equal(out.summary.yesterday.earnings, 180);
});

await check('the range has every day, oldest first, ending today', () => {
    assert.equal(out.daily.length, 7);
    assert.equal(out.daily[6].date, istKey(now));
    assert.equal(out.daily[5].date, istKey(now - DAY));
    assert.ok(out.daily.slice(0, 5).every((d) => d.orders === 0));
});

await check('last 7 days leaves out the order from 10 days ago and other sellers', () => {
    assert.equal(out.summary.last7Days.orders, 2);
    assert.equal(out.summary.last7Days.earnings, 455);
    assert.equal(out.summary.range.earnings, 455);
});

await check('30 days takes in the older order; an odd day count falls back to 30', async () => {
    const month = await earnings(rid, { days: 30 });
    assert.equal(month.daily.length, 30);
    assert.equal(month.summary.range.orders, 3);
    assert.equal((await earnings(rid, { days: 12 })).days, 30);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
