/**
 * What the menu API actually sends a client, for each direction.
 *
 * The unit checks prove the arithmetic and the direction smoke test proves the
 * write. Neither catches the bug this covers: the menu services build their
 * response by spreading several pricing objects over one another, and the
 * other-platform comparison spread LAST -- so it silently overwrote the
 * formulation's strikePrice on the way out of the door. Every screen in the
 * customer app reads that one key.
 *
 * Run: node tests/formulation.api.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri();
await mongoose.connect(server.getUri(), { dbName: 'smoke' });

const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodFeeSettings } = await import('../src/modules/food/admin/models/feeSettings.model.js');
const { applyPriceAdjustment } = await import('../src/modules/food/admin/services/priceAdjustment.service.js');
// The customer menu: the portal one (getRestaurantMenu) sends the real base and
// no strike by design, so it cannot show what the app is sent.
const { getPublicApprovedRestaurantMenu } = await import('../src/modules/food/restaurant/services/restaurantMenu.service.js');

// The blanket markup is ON in production at 20%, and it is exactly what used to
// hijack the strike on a shallow markdown. Left on so this proves it cannot.
await FoodFeeSettings.create({
    isActive: true,
    otherPlatformPrice: { isEnabled: true, markupPercent: 20, label: 'Other platforms' },
});

const restaurant = await FoodRestaurant.create({
    restaurantName: 'API Kitchen',
    ownerName: 'Owner',
    status: 'approved',
    email: `api${Date.now()}@example.com`,
    phone: `9${String(Date.now()).slice(-9)}`,
});

let failures = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  ok   ${label}`);
    } catch (err) {
        failures += 1;
        console.log(`  FAIL ${label}\n       ${err.message}`);
    }
};

const seed = async (fields) => {
    await FoodItem.deleteMany({ restaurantId: restaurant._id });
    const doc = await FoodItem.create({
        restaurantId: restaurant._id,
        name: 'Paneer Tikka',
        price: 200,
        basePrice: 200,
        approvalStatus: 'approved',
        isAvailable: true,
        ...fields,
    });
    return doc._id;
};

/** The dish exactly as the menu endpoint serialises it. */
const fromApi = async () => {
    // `sections` carries the items; `categories` is the sibling index and has
    // none, so reading that first silently yields an empty menu.
    const menu = await getPublicApprovedRestaurantMenu(String(restaurant._id));
    const items = (menu?.sections || []).flatMap((s) => s?.items || []);
    assert.ok(items.length, 'the menu returned no items to inspect');
    return items[0];
};

console.log('\nwhat the API sends for a +20% increase');
{
    await seed({});
    await applyPriceAdjustment({ percent: 20, restaurantId: String(restaurant._id) }, {});
    const dish = await fromApi();
    check('price is the base, unchanged', () => assert.equal(dish.price, 200));
    check('strikePrice is the formulation figure', () => assert.equal(dish.strikePrice, 240));
    // The formulation price is what the customer pays, so an increase leaves it
    // alone. 240 is the struck-through comparison, asserted above.
    check('formulationPrice is unmoved by an increase', () =>
        assert.equal(dish.formulationPrice, 200));
    check('formulationPercent is sent', () => assert.equal(dish.formulationPercent, 20));
}

console.log('\nwhat the API sends for a -10% decrease');
{
    await seed({});
    await applyPriceAdjustment({ percent: -10, restaurantId: String(restaurant._id) }, {});
    const dish = await fromApi();
    check('price is the cut figure', () => assert.equal(dish.price, 180));
    /*
     * The regression this file exists for. With the 20% blanket markup on, the
     * old code struck through 180 x 1.2 = 216 -- above the Rs 200 the dish had
     * actually been selling at, and unmovable by any adjustment.
     */
    check('strikePrice is the pre-cut price, not the markup', () =>
        assert.equal(dish.strikePrice, 200));
    check('it is not labelled as another platform', () =>
        assert.equal(dish.strikeLabel || '', ''));
    check('the saving reads as the percent that was applied', () =>
        assert.equal(dish.discountPercent, 10));
}

console.log('\na rival price the restaurant genuinely typed still wins');
{
    await seed({ otherPrice: 320 });
    await applyPriceAdjustment({ percent: -10, restaurantId: String(restaurant._id) }, {});
    const dish = await fromApi();
    check('charges the cut figure', () => assert.equal(dish.price, 180));
    check('strikes the typed rival price', () => assert.equal(dish.strikePrice, 320));
    check('and says whose price it is', () =>
        assert.equal(dish.strikeLabel, 'Other platforms'));
    check('the global run did not overwrite it', () => assert.equal(dish.otherPrice, 320));
}

console.log('\nan unadjusted dish advertises nothing');
{
    await seed({});
    await applyPriceAdjustment({ percent: 0.0001, restaurantId: String(restaurant._id) }, {});
    const dish = await fromApi();
    check('charges its own price', () => assert.equal(dish.price, 200));
    check('strikes nothing', () => assert.equal(dish.strikePrice, null));
}

await mongoose.disconnect();
await server.stop();

console.log(failures ? `\n${failures} FAILED\n` : '\nall API checks passed\n');
process.exit(failures ? 1 : 0);
