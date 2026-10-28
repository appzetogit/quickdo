/**
 * The coupon the cart quoted is the coupon the order charges.
 *
 * Run: node tests/food-coupon-at-placement.smoke.mjs
 *
 * Found in the audit: with a Rs 50 coupon /calculate quoted Rs 199, and the
 * saved order charged Rs 252 with no discount. Placement re-prices from a
 * top-level `couponCode`. The Flutter app and the web send the coupon only
 * inside `pricing`, echoing /calculate, and the create validator's pricing
 * schema did not declare it, so it was stripped and the coupon never reached
 * the re-price. The use was never counted either.
 *
 * Drives the real validators and createOrder against an in-memory Mongo.
 *
 * The totals here are Rs 202, not the Rs 199 this once expected. SAVE50 has no
 * `createdByRole`, so it is an admin coupon: the platform funds it and the
 * restaurant is paid in full, which means the supply is still worth the
 * pre-coupon amount and GST is due on that. The customer saves the coupon's
 * face value and no more. A restaurant-funded coupon IS a supplier discount
 * and still comes off the taxable value -- the SHOP50 section pins the
 * difference, and Rs 199 is where it lands.
 */
import { startFoodWorld, makeChecker, near } from './food-order-fixture.mjs';

const w = await startFoodWorld('coupon_at_placement');
const { check, summary } = makeChecker();
let failed = 1;

try {
    await w.m.FoodOffer.create({ couponCode: 'SAVE50', discountType: 'flat-price', discountValue: 50, status: 'active' });
    const items = [w.appLine(w.dish)];
    const usedCount = async () => (await w.m.FoodOffer.findOne({ couponCode: 'SAVE50' }).lean()).usedCount;

    console.log('\nthe Flutter app: the coupon travels only inside pricing');
    const buyer = await w.makeUser();
    const quoted = await w.quote(buyer._id, { items, couponCode: 'SAVE50' });
    check('the cart is quoted Rs 202 with the coupon', near(quoted.total, 202) && near(quoted.discount, 50),
        `total ${quoted.total}, discount ${quoted.discount}`);

    const order = await w.saved(await w.place(buyer._id, { items, pricing: quoted }));
    check('THE BUG: the order is charged the quoted Rs 202, not Rs 252', near(order.pricing.total, 202),
        `charged ${order.pricing.total}`);
    check('the discount is on the saved order', near(order.pricing.discount, 50), `${order.pricing.discount}`);
    check('the customer is asked for Rs 202', near(order.payment.amountDue, 202), `${order.payment.amountDue}`);
    check('the coupon use is counted', (await usedCount()) === 1, `usedCount ${await usedCount()}`);

    console.log('\nan older web build: pricing.couponCode only');
    const webBuyer = await w.makeUser();
    const webQuote = await w.quote(webBuyer._id, { items, couponCode: 'SAVE50' });
    const webOrder = await w.saved(await w.place(webBuyer._id, { items, pricing: { ...webQuote, couponCode: 'SAVE50' } }));
    check('charged Rs 202', near(webOrder.pricing.total, 202), `charged ${webOrder.pricing.total}`);
    check('counted', (await usedCount()) === 2, `usedCount ${await usedCount()}`);

    console.log('\na restaurant-funded coupon still comes off the taxable value');
    await w.m.FoodOffer.create({
        couponCode: 'SHOP50', discountType: 'flat-price', discountValue: 50,
        status: 'active', createdByRole: 'RESTAURANT',
    });
    const shopBuyer = await w.makeUser();
    const shopQuote = await w.quote(shopBuyer._id, { items, couponCode: 'SHOP50' });
    // The restaurant gives this one up, so the tax goes with it: Rs 50 off
    // the food AND the GST that was riding on it.
    check('a shop coupon is quoted Rs 199, tax and all', near(shopQuote.total, 199) && near(shopQuote.discount, 50),
        `total ${shopQuote.total}, discount ${shopQuote.discount}`);
    const shopOrder = await w.saved(await w.place(shopBuyer._id, { items, pricing: shopQuote }));
    check('and charged the Rs 199 it quoted', near(shopOrder.pricing.total, 199), `charged ${shopOrder.pricing.total}`);

    console.log('\nno coupon: /calculate echoes couponCode null');
    const plainBuyer = await w.makeUser();
    const plainQuote = await w.quote(plainBuyer._id, { items });
    check('the quote carries couponCode null', plainQuote.couponCode === null, `${plainQuote.couponCode}`);
    const plain = await w.saved(await w.place(plainBuyer._id, { items, pricing: plainQuote }));
    check('the order is still accepted, at Rs 252', near(plain.pricing.total, 252), `charged ${plain.pricing.total}`);

    console.log('\na code the customer is not entitled to is not honoured just for being echoed');
    const sneaky = await w.makeUser();
    const sneakyQuote = await w.quote(sneaky._id, { items });
    const sneakyOrder = await w.saved(await w.place(sneaky._id, { items, pricing: { ...sneakyQuote, couponCode: 'NOSUCHCODE' } }));
    check('an unknown code gives no discount', near(sneakyOrder.pricing.discount, 0) && near(sneakyOrder.pricing.total, 252),
        `discount ${sneakyOrder.pricing.discount}, total ${sneakyOrder.pricing.total}`);

    failed = summary();
} catch (err) {
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    await w.stop();
    process.exit(failed ? 1 : 0);
}
