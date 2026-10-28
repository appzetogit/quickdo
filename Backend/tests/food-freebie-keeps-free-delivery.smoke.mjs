/**
 * Earning a spend-threshold reward does not cost the customer free delivery.
 *
 * Run: node tests/food-freebie-keeps-free-delivery.smoke.mjs
 *
 * Found in the audit: a cart made only of free-delivery dishes ships free, but
 * pricing appended the reward line BEFORE checking that "every line ships
 * free". The reward line carries no freeDelivery flag, so the cart that earned a
 * gift was charged the Rs 30 delivery fee.
 *
 * Drives the real calculateOrderPricing against an in-memory Mongo.
 */
import { startFoodWorld, makeChecker, near } from './food-order-fixture.mjs';

const w = await startFoodWorld('freebie_free_delivery');
const { check, summary } = makeChecker();
let failed = 1;

try {
    const thali = await w.makeDish({ name: 'Thali', price: 200, freeDelivery: true });
    const reward = await w.makeDish({ name: 'Gulab Jamun', price: 40 });
    const ladder = await w.m.FoodFreebieOffer.create({
        restaurantId: w.restaurant._id,
        isActive: true,
        tiers: [{ minOrderValue: 150, rewardType: 'item', rewardItemId: reward._id }],
    });
    const buyer = await w.makeUser();

    console.log('\na free-delivery cart that earns a reward');
    const earned = await w.quote(buyer._id, { items: [w.appLine(thali)] });
    check('the reward is earned', earned.freebie?.earned?.name === 'Gulab Jamun', `${earned.freebie?.earned?.name}`);
    check('THE BUG: delivery is still free', near(earned.deliveryFee, 0), `delivery ${earned.deliveryFee}`);
    // 200 + 10 GST + 0 delivery + 11.80 platform fee = 221.80
    check('the total is Rs 222', near(earned.total, 222), `total ${earned.total}`);

    console.log('\nthe same cart with the reward switched off');
    await w.m.FoodFreebieOffer.updateOne({ _id: ladder._id }, { $set: { isActive: false } });
    const plain = await w.quote(buyer._id, { items: [w.appLine(thali)] });
    check('delivery free, and the same total', near(plain.deliveryFee, 0) && near(plain.total, earned.total),
        `delivery ${plain.deliveryFee}, total ${plain.total}`);
    await w.m.FoodFreebieOffer.updateOne({ _id: ladder._id }, { $set: { isActive: true } });

    console.log('\nthe reward does not make delivery free either');
    const mixed = await w.quote(buyer._id, { items: [w.appLine(w.dish)] });
    check('a cart with an ordinary dish still pays Rs 30', near(mixed.deliveryFee, 30), `delivery ${mixed.deliveryFee}`);

    failed = summary();
} catch (err) {
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    await w.stop();
    process.exit(failed ? 1 : 0);
}
