/**
 * A placement that does not go through leaves no money behind.
 *
 * Run: node tests/food-placement-rollback.smoke.mjs
 *
 * Two findings from the audit:
 *
 *   1. The wallet is debited before the order is saved. That order is
 *      deliberate, since it avoids a paid order with no debit, but a failed
 *      save left the customer charged for an order that does not exist.
 *   2. The coupon's usage cap was claimed after the save. When a concurrent
 *      order took the last use, only a warning was logged, and this order kept
 *      a discount the coupon no longer allowed.
 *
 * Drives the real createOrder against an in-memory Mongo. The save failure and
 * the lost race are both staged: the first by making the order's save throw
 * once, the second by letting "another order" take the last use at the exact
 * moment this one claims it.
 */
import { startFoodWorld, makeChecker, near, thrownBy } from './food-order-fixture.mjs';

const w = await startFoodWorld('placement_rollback');
const { check, summary } = makeChecker();
let failed = 1;

try {
    const items = [w.appLine(w.dish)];
    const balanceOf = async (userId) => {
        const res = await w.wallet.getUserWallet(userId);
        return Number(res?.balance ?? res?.wallet?.balance);
    };

    console.log('\na wallet order whose save fails');
    const buyer = await w.makeUser();
    await w.wallet.refundWalletBalance(buyer._id, 1000, 'test top-up');
    check('the wallet starts at Rs 1000', near(await balanceOf(buyer._id), 1000), `${await balanceOf(buyer._id)}`);
    const q = await w.quote(buyer._id, { items });

    w.m.FoodOrder.prototype.save = async function failingSave() {
        throw new Error('simulated database failure');
    };
    let err;
    try {
        err = await thrownBy(() => w.place(buyer._id, { items, pricing: q, paymentMethod: 'wallet' }));
    } finally {
        delete w.m.FoodOrder.prototype.save;
    }
    check('the placement fails', Boolean(err), err?.message || 'placed');
    check('no order was saved', (await w.m.FoodOrder.countDocuments({ userId: buyer._id })) === 0);
    check('THE BUG: the Rs 252 debit is credited back', near(await balanceOf(buyer._id), 1000),
        `balance ${await balanceOf(buyer._id)}`);

    console.log('\nthe same wallet order when the save works');
    const ok = await w.saved(await w.place(buyer._id, { items, pricing: q, paymentMethod: 'wallet' }));
    check('it is paid and debited once', ok?.payment?.status === 'paid' && near(await balanceOf(buyer._id), 748),
        `status ${ok?.payment?.status}, balance ${await balanceOf(buyer._id)}`);

    console.log('\ntwo customers race for the last use of a coupon');
    await w.m.FoodOffer.create({
        couponCode: 'LAST1', discountType: 'flat-price', discountValue: 50, usageLimit: 1, status: 'active',
    });
    const racer = await w.makeUser();
    const rq = await w.quote(racer._id, { items, couponCode: 'LAST1' });
    check('the quote still offers it', near(rq.discount, 50), `discount ${rq.discount}`);

    // Another order takes the last use just before this one claims it.
    const originalUpdateOne = w.m.FoodOffer.updateOne;
    let raced = false;
    w.m.FoodOffer.updateOne = function racingUpdateOne(filter, update, ...rest) {
        if (!raced && update?.$inc?.usedCount === 1) {
            raced = true;
            return originalUpdateOne
                .call(this, { _id: filter._id }, { $set: { usedCount: 1 } })
                .then(() => originalUpdateOne.call(this, filter, update, ...rest));
        }
        return originalUpdateOne.call(this, filter, update, ...rest);
    };
    let raceErr;
    try {
        raceErr = await thrownBy(() => w.place(racer._id, { items, pricing: rq }));
    } finally {
        w.m.FoodOffer.updateOne = originalUpdateOne;
    }
    check('the race was staged', raced);
    check('THE BUG: the order that lost the race is refused', /usage limit/i.test(raceErr?.message || ''),
        raceErr?.message || 'placed with the discount');
    check('no order keeps a discount the coupon no longer allows',
        (await w.m.FoodOrder.countDocuments({ userId: racer._id, 'pricing.discount': { $gt: 0 } })) === 0);
    const offer = await w.m.FoodOffer.findOne({ couponCode: 'LAST1' }).lean();
    check('the coupon is used exactly once', offer.usedCount === 1, `usedCount ${offer.usedCount}`);

    failed = summary();
} catch (err) {
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    await w.stop();
    process.exit(failed ? 1 : 0);
}
