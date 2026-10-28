/**
 * Approving a dish into, or out of, the adjustment standing over its menu.
 *
 * A dish arriving for approval carries no adjustment -- it was created after
 * every run that shaped the menu around it. Approved as-is it goes live at its
 * bare base price beside neighbours the platform has marked up and discounted.
 * The admin chooses; this proves both branches do what they say.
 *
 * Run: node tests/approval-pricing.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri();
process.env.REDIS_ENABLED = 'false';
await mongoose.connect(server.getUri(), { dbName: 'approval' });

const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { applyPriceAdjustment, revertPriceAdjustment, resolveStandingAdjustment } =
    await import('../src/modules/food/admin/services/priceAdjustment.service.js');
const { approveFoodItem } = await import('../src/modules/food/admin/services/foodApproval.service.js');
const { resolveItemDisplayPricing } = await import('../src/modules/food/shared/itemDiscountPricing.js');

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

let seq = 0;
const makeRestaurant = async () => {
    seq += 1;
    return FoodRestaurant.create({
        restaurantName: `Kitchen ${seq}`,
        ownerName: 'Owner',
        email: `ap${Date.now()}_${seq}@example.com`,
        phone: `9${String(Date.now()).slice(-8)}${seq}`,
        status: 'approved',
    });
};

const approvedDish = (restaurant, price = 200) => FoodItem.create({
    restaurantId: restaurant._id,
    name: 'Existing dish',
    price,
    basePrice: price,
    approvalStatus: 'approved',
});

const pendingDish = (restaurant, price = 200) => FoodItem.create({
    restaurantId: restaurant._id,
    name: 'New dish',
    price,
    basePrice: price,
    approvalStatus: 'pending',
});

const shown = async (id) => {
    const doc = await FoodItem.findById(id).lean();
    return { ...resolveItemDisplayPricing(doc), stored: doc };
};

/* ------------------------------------------------ the standing total itself */
console.log('\nwhat is standing over a menu');
{
    const r = await makeRestaurant();
    await approvedDish(r);
    const before = await resolveStandingAdjustment(r._id);
    check('a menu with no runs has nothing standing', () => {
        assert.equal(before.markupPercent, 0);
        assert.equal(before.discountPercent, 0);
    });

    await applyPriceAdjustment({ percent: 20, restaurantId: String(r._id) }, {});
    await applyPriceAdjustment({ percent: -10, restaurantId: String(r._id) }, {});
    const after = await resolveStandingAdjustment(r._id);
    check('runs accumulate into the two totals', () => {
        assert.equal(after.markupPercent, 20);
        assert.equal(after.discountPercent, 10);
    });

    const other = await makeRestaurant();
    await approvedDish(other);
    const elsewhere = await resolveStandingAdjustment(other._id);
    check('another restaurant is unaffected', () => {
        assert.equal(elsewhere.markupPercent, 0);
        assert.equal(elsewhere.discountPercent, 0);
    });
}

/* ------------------------------------------- a menu with nothing on it yet */
console.log('\na restaurant whose menu has no approved dish');
{
    /*
     * THE BUG: this answered from the run history -- every non-reverted
     * platform-wide run ever, summed -- and the approval dialog printed the
     * total as "50% markup and 30% discount applies to the other dishes here",
     * to an admin approving the first dish of a restaurant that had no other
     * dishes at all.
     */
    const platformRun = await applyPriceAdjustment({ percent: 50 }, {});
    await applyPriceAdjustment({ percent: -30 }, {});

    const fresh = await makeRestaurant();
    const standing = await resolveStandingAdjustment(String(fresh._id));

    check('nothing is claimed to be standing over an empty menu', () => {
        assert.equal(standing.markupPercent, 0);
        assert.equal(standing.discountPercent, 0);
    });
    check('  and it says so plainly rather than guessing from history', () => {
        assert.equal(standing.source, 'none');
        assert.equal(standing.sampleSize, 0);
    });
    check('  so the approval dialog has no second option to offer', () => {
        // The panel shows the choice only when one of these is above zero.
        assert.ok(!(standing.markupPercent > 0 || standing.discountPercent > 0));
    });

    check('a restaurant that HAS dishes still reports what they carry', async () => {
        const stocked = await makeRestaurant();
        await approvedDish(stocked);
        await applyPriceAdjustment({ percent: 25, restaurantId: String(stocked._id) }, {});
        const theirs = await resolveStandingAdjustment(String(stocked._id));
        assert.equal(theirs.markupPercent, 25);
        assert.equal(theirs.source, 'menu');
    });

    await revertPriceAdjustment(String(platformRun.adjustment._id), {});
}

console.log('\nreverted runs stop counting');
{
    const r = await makeRestaurant();
    await approvedDish(r);
    const run = await applyPriceAdjustment({ percent: -30, restaurantId: String(r._id) }, {});
    check('the run counts while it stands', async () => {
        assert.equal((await resolveStandingAdjustment(r._id)).discountPercent, 30);
    });
    await revertPriceAdjustment(String(run.adjustment._id), {});
    const after = await resolveStandingAdjustment(r._id);
    check('and stops once reverted', () => assert.equal(after.discountPercent, 0));
    check('the revert entry is not counted as a run of its own', () =>
        assert.equal(after.markupPercent, 0));
}

/* ------------------------------------------------------------ the two branches */
console.log('\napproving a dish, left untouched');
{
    const r = await makeRestaurant();
    // An approved dish to carry the adjustment: it is the menu, not the run
    // history, that says what a new dish should join.
    await approvedDish(r);
    await applyPriceAdjustment({ percent: 20, restaurantId: String(r._id) }, {});
    await applyPriceAdjustment({ percent: -10, restaurantId: String(r._id) }, {});

    const dish = await pendingDish(r, 200);
    await approveFoodItem(String(dish._id));
    const s = await shown(dish._id);

    check('it is approved', () => assert.equal(s.stored.approvalStatus, 'approved'));
    check('charges its own base price', () => assert.equal(s.price, 200));
    check('carries no adjustment', () => {
        assert.equal(s.stored.formulationMarkupPercent, 0);
        assert.equal(s.stored.formulationDiscountPercent, 0);
    });
    check('and strikes nothing', () => assert.equal(s.strikePrice, null));
}

console.log('\napproving a dish into the standing adjustment');
{
    const r = await makeRestaurant();
    // An approved dish to carry the adjustment: it is the menu, not the run
    // history, that says what a new dish should join.
    await approvedDish(r);
    await applyPriceAdjustment({ percent: 20, restaurantId: String(r._id) }, {});
    await applyPriceAdjustment({ percent: -10, restaurantId: String(r._id) }, {});

    const dish = await pendingDish(r, 200);
    await approveFoodItem(String(dish._id), { applyGlobalPricing: true });
    const s = await shown(dish._id);

    check('it is approved', () => assert.equal(s.stored.approvalStatus, 'approved'));
    check('inherits the 10% discount, so it charges 180', () => assert.equal(s.price, 180));
    /*
     * Struck at 200, not the markup's 240: the last run over this menu was a
     * decrease, and a decrease strikes the price the dish dropped from. A dish
     * already on the menu shows the same figure, which is the point of
     * inheriting at all.
     */
    check('strikes 200, the figure it is discounted from', () =>
        assert.equal(s.strikePrice, 200));
    check('both totals are stored', () => {
        assert.equal(s.stored.formulationMarkupPercent, 20);
        assert.equal(s.stored.formulationDiscountPercent, 10);
    });
    check('the restaurant base price is untouched', () =>
        assert.equal(s.stored.basePrice, 200));
}

console.log('\nit matches what the neighbouring dishes carry');
{
    const r = await makeRestaurant();
    const existing = await FoodItem.create({
        restaurantId: r._id, name: 'Existing', price: 200, basePrice: 200, approvalStatus: 'approved',
    });
    await applyPriceAdjustment({ percent: 25, restaurantId: String(r._id) }, {});
    await applyPriceAdjustment({ percent: -20, restaurantId: String(r._id) }, {});

    const dish = await pendingDish(r, 200);
    await approveFoodItem(String(dish._id), { applyGlobalPricing: true });

    const a = await shown(existing._id);
    const b = await shown(dish._id);
    check('the new dish lands exactly where the old one is', () => {
        assert.equal(b.price, a.price);
        assert.equal(b.strikePrice, a.strikePrice);
    });
}

console.log('\nthe direction that ran last decides the struck figure');
{
    // The same totals as the case above, in the opposite order: here the
    // increase ran last, so the markup figure is struck rather than the base.
    const r = await makeRestaurant();
    const existing = await FoodItem.create({
        restaurantId: r._id, name: 'Existing', price: 200, basePrice: 200, approvalStatus: 'approved',
    });
    await applyPriceAdjustment({ percent: -10, restaurantId: String(r._id) }, {});
    await applyPriceAdjustment({ percent: 20, restaurantId: String(r._id) }, {});

    const dish = await pendingDish(r, 200);
    await approveFoodItem(String(dish._id), { applyGlobalPricing: true });
    const s = await shown(dish._id);

    check('the same totals still charge 180', () => assert.equal(s.price, 180));
    check('but an increase last strikes the markup figure, 240', () =>
        assert.equal(s.strikePrice, 240));

    const neighbour = await shown(existing._id);
    check('matching what a dish already on the menu shows', () =>
        assert.equal(s.strikePrice, neighbour.strikePrice));
}

console.log('\nno runs standing: the choice makes no difference');
{
    const r = await makeRestaurant();
    const dish = await pendingDish(r, 150);
    await approveFoodItem(String(dish._id), { applyGlobalPricing: true });
    const s = await shown(dish._id);
    check('the dish is left at its base price', () => assert.equal(s.price, 150));
    check('and nothing is struck', () => assert.equal(s.strikePrice, null));
}

await mongoose.disconnect();
await server.stop();

console.log(failures ? `\n${failures} FAILED\n` : '\nall approval pricing checks passed\n');
process.exit(failures ? 1 : 0);
