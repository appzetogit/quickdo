/**
 * A paid add-on is billed, quoted, and sent to the kitchen.
 *
 * Run: node tests/food-addons-billed.smoke.mjs
 *
 * Found in the audit: a Rs 200 dish with a Rs 30 add-on was billed Rs 200. The
 * order validator's item schema declared neither `addonIds` (what the web
 * sends) nor `addons` (what the Flutter app sends), so zod stripped both before
 * pricing ran. The add-on was never charged and never reached the kitchen,
 * while the Flutter cart line showed Rs 230.
 *
 * Drives the real validators, calculateOrderPricing and createOrder against an
 * in-memory Mongo.
 */
import { startFoodWorld, makeChecker, near, thrownBy } from './food-order-fixture.mjs';

const w = await startFoodWorld('addons_billed');
const { check, summary } = makeChecker();
let failed = 1;

try {
    const addon = await w.m.FoodAddon.create({
        restaurantId: w.restaurant._id,
        draft: { name: 'Extra Cheese', price: 30 },
        published: { name: 'Extra Cheese', price: 30 },
        approvalStatus: 'approved',
        isAvailable: true,
    });
    const notOffered = await w.m.FoodAddon.create({
        restaurantId: w.restaurant._id,
        draft: { name: 'Truffle', price: 90 },
        published: { name: 'Truffle', price: 90 },
        approvalStatus: 'approved',
        isAvailable: true,
    });
    const burger = await w.makeDish({ name: 'Burger', price: 200, addonIds: [addon._id] });
    const buyer = await w.makeUser();

    // Flutter: ids under `addons`, and the unit price it showed (base + add-on).
    const flutterLine = w.appLine(burger, { price: 230, addons: [String(addon._id)], addonsPrice: 30 });
    // Web: ids under `addonIds`, base price.
    const webLine = w.appLine(burger, { addonIds: [String(addon._id)] });

    console.log('\nthe quote');
    const flutterQuote = await w.quote(buyer._id, { items: [flutterLine] });
    check('THE BUG: the Flutter cart is quoted food Rs 230, not 200', near(flutterQuote.subtotal, 230),
        `subtotal ${flutterQuote.subtotal}`);
    const webQuote = await w.quote(buyer._id, { items: [webLine] });
    check('the web cart is quoted food Rs 230', near(webQuote.subtotal, 230), `subtotal ${webQuote.subtotal}`);
    // 230 + 11.50 GST + 30 delivery + 11.80 platform fee = 283.30
    check('the total is Rs 283', near(flutterQuote.total, 283), `total ${flutterQuote.total}`);

    console.log('\nthe order');
    const order = await w.saved(await w.place(buyer._id, { items: [flutterLine], pricing: flutterQuote }));
    const line = order.items[0] || {};
    check('the customer is charged Rs 283', near(order.pricing.total, 283), `charged ${order.pricing.total}`);
    check('the kitchen sees the add-on on the line', line.addons?.[0]?.name === 'Extra Cheese',
        `addons ${JSON.stringify((line.addons || []).map((a) => a.name))}`);
    check('priced from the published record, per unit', near(line.addonsTotal, 30), `${line.addonsTotal}`);

    console.log('\nthe client still cannot choose what it is charged');
    const cheap = await w.quote(buyer._id, { items: [w.appLine(burger, { price: 1, addons: [String(addon._id)] })] });
    check('a client price of Rs 1 is ignored', near(cheap.subtotal, 230), `subtotal ${cheap.subtotal}`);
    const refused = await thrownBy(() => w.quote(buyer._id, { items: [w.appLine(burger, { addonIds: [String(notOffered._id)] })] }));
    check('an add-on this dish does not offer is refused', /cannot be added/.test(refused?.message || ''),
        refused?.message || 'accepted');

    failed = summary();
} catch (err) {
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    await w.stop();
    process.exit(failed ? 1 : 0);
}
