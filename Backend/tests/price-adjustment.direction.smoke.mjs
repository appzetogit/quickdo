/**
 * What a global price adjustment shows the customer, in both directions.
 *
 * Drives the real service against a real in-memory Mongo and then asks the real
 * display function what the menu renders, because every bug this covers lived in
 * the gap between "the run wrote a number" and "the customer saw it":
 *
 *   - a +20% run measured its percentage from the LAST run's output, so running
 *     it twice advertised 44% off and five times 149% off;
 *   - a decrease overwrote the restaurant's own base price with the reduced
 *     figure, so the next run cut again from that, and the price the restaurant
 *     typed stopped existing anywhere;
 *   - a marked-down dish then displayed a stale comparison larger than either.
 *
 * None of that is visible by checking that updateMany reported rows modified,
 * which is why this asserts on the struck-through price and nothing else.
 *
 * Run: node tests/price-adjustment.direction.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri();
await mongoose.connect(server.getUri(), { dbName: 'smoke' });

const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { applyPriceAdjustment, revertPriceAdjustment, getPriceAdjustmentPreview } =
    await import('../src/modules/food/admin/services/priceAdjustment.service.js');
const { resolveItemDisplayPricing } = await import('../src/modules/food/shared/itemDiscountPricing.js');

/** What the menu renders, via the same function every API response calls. */
const shownFor = async (itemId) => {
    const item = await FoodItem.findById(itemId).lean();
    return { ...resolveItemDisplayPricing(item), stored: item };
};

const restaurant = await FoodRestaurant.create({
    restaurantName: 'Smoke Kitchen',
    ownerName: 'Owner',
    email: `smoke${Date.now()}@example.com`,
    phone: `9${String(Date.now()).slice(-9)}`,
});

const seed = async (fields) => {
    const doc = await FoodItem.create({
        restaurantId: restaurant._id,
        name: `Dish ${Math.random().toString(36).slice(2, 8)}`,
        price: 200,
        ...fields,
    });
    return doc._id;
};

const run = (percent) => applyPriceAdjustment({ percent, restaurantId: String(restaurant._id) }, {});

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

/* ---------------------------------------------------------------- increase */
console.log('\n+20% on a Rs 200 dish -> pays 200, struck 240');
{
    const id = await seed({ price: 200, basePrice: 200 });
    await run(20);
    const s = await shownFor(id);
    check('still charges 200', () => assert.equal(s.price, 200));
    check('strikes through 240', () => assert.equal(s.strikePrice, 240));
    check('reads as 17% off', () => assert.equal(s.discountPercent, 16.67));
    check('stores the percent, not a product', () => assert.equal(s.stored.formulationPercent, 20));

    /*
     * A second run ADDS to the first: +20% then +20% is +40%, so the strike
     * goes 240 then 280. Each step is twenty percent OF THE BASE.
     *
     * The distinction that matters is against compounding, which is what the
     * original bug did -- 200, 240, 288, 345, multiplying each result by the
     * next factor until a Rs 100 dish advertised 54% off a price nobody had
     * charged. Adding a fixed slice of a fixed origin is linear and cannot run
     * away like that.
     */
    await run(20);
    const twice = await shownFor(id);
    check('a second +20% strikes 280', () => assert.equal(twice.strikePrice, 280));
    check('not 288, which would be compounding', () =>
        assert.notEqual(twice.strikePrice, 288));
    check('the accumulated markup is stored', () =>
        assert.equal(twice.stored.formulationMarkupPercent, 40));

    await run(20);
    const thrice = await shownFor(id);
    check('a third +20% strikes 320', () => assert.equal(thrice.strikePrice, 320));
    check('nobody ever pays more', () => assert.equal(thrice.price, 200));
    check('the base never moved', () => assert.equal(thrice.stored.basePrice, 200));
}

/* ---------------------------------------------------------------- decrease */
console.log('\n-20% on a Rs 200 dish -> pays 160, struck 200');
{
    const id = await seed({ price: 200, basePrice: 200 });
    await run(-20);
    const s = await shownFor(id);
    check('charges 160', () => assert.equal(s.price, 160));
    check('strikes through 200', () => assert.equal(s.strikePrice, 200));
    check('reads as 20% off', () => assert.equal(s.discountPercent, 20));
    check('keeps the base at 200', () => assert.equal(s.stored.basePrice, 200));
}

console.log('\n-10% on a Rs 200 dish -> pays 180, struck 200');
{
    const id = await seed({ price: 200, basePrice: 200 });
    await run(-10);
    const s = await shownFor(id);
    check('charges 180', () => assert.equal(s.price, 180));
    check('strikes through 200', () => assert.equal(s.strikePrice, 200));
}

/* --------------------------------------------- the property this exists for */
console.log('\nruns add up, and cancel');
{
    const id = await seed({ price: 200, basePrice: 200 });
    await run(20);
    await run(-10);
    const s = await shownFor(id);
    /*
     * The two directions do not cancel. A decrease that spent itself undoing a
     * standing increase was the bug: a platform at +10% took -10% and the price
     * never moved, so the decrease looked broken.
     *
     * +20 markup and -10 discount both stand: struck at 240, sold at 180.
     */
    check('the markup survives the decrease', () =>
        assert.equal(s.stored.formulationMarkupPercent, 20));
    check('the discount is its own total', () =>
        assert.equal(s.stored.formulationDiscountPercent, 10));
    /*
     * The strike is what the LAST run set. A decrease sets it to the price the
     * dish was selling for immediately before the cut, so the customer sees the
     * figure it just dropped from -- 200 here, not the markup's 240.
     */
    check('the decrease strikes the pre-cut price', () => {
        assert.equal(s.strikePrice, 200);
        assert.equal(s.price, 180);
    });

    await run(-10);
    const deeper = await shownFor(id);
    check('another -10% cuts further, it does not cancel', () => {
        assert.equal(deeper.stored.formulationDiscountPercent, 20);
        assert.equal(deeper.price, 160);
    });
    check('and strikes the price before THAT cut', () =>
        assert.equal(deeper.strikePrice, 180));
    check('the markup total is still untouched', () =>
        assert.equal(deeper.stored.formulationMarkupPercent, 20));

    // An increase takes the strike back over, from the markup total.
    await run(10);
    const up = await shownFor(id);
    check('an increase restores a markup strike', () => {
        assert.equal(up.stored.formulationMarkupPercent, 30);
        assert.equal(up.strikePrice, 260);
    });
    check('and still charges the discounted price', () => assert.equal(up.price, 160));
}

console.log('\nrepeat decreases do not ratchet the base down');
{
    // Rainbow Restro as it actually stood: Rs 153 off its own Rs 170. One
    // platform-wide -10% used to leave it at Rs 137.70 off Rs 153, with the
    // Rs 170 gone from the menu and from the Edit Food form.
    const id = await seed({ price: 153, basePrice: 170, discountPercent: 10 });
    await run(-10);
    const once = await shownFor(id);
    check('keeps the restaurant base of 170', () => assert.equal(once.stored.basePrice, 170));
    check('charges 153', () => assert.equal(once.price, 153));

    // -10 then -10 is -20 OF THE BASE: 170 - 34 = 136. Compounding would give
    // 153 x 0.9 = 137.70, which is what the old code produced by cutting the
    // already-cut price -- and it took the base down with it every time.
    await run(-10);
    const twice2 = await shownFor(id);
    check('a second -10% charges 136', () => assert.equal(twice2.price, 136));
    check('not 137.70, which would be compounding', () =>
        assert.notEqual(twice2.price, 137.7));
    check('the restaurant base is still 170', () => assert.equal(twice2.stored.basePrice, 170));
    check('the discount accumulated to 20%', () =>
        assert.equal(twice2.stored.formulationDiscountPercent, 20));
}

/* ------------------------------------------------- an un-migrated legacy row */
console.log('\na row the backfill has not reached');
{
    // No formulationPercent at all: the adjustment lives in the price/base gap.
    // The field has to be removed rather than left at 0, because that is the
    // actual state of every row in the database -- the schema default only
    // applies to documents Mongoose creates, and an explicit 0 means "this dish
    // was migrated and is deliberately unadjusted", which is a different thing.
    const id = await seed({ price: 137.7, basePrice: 153 });
    await FoodItem.collection.updateOne(
        { _id: id },
        {
            $unset: {
                formulationPercent: '',
                formulationPrice: '',
                // The split fields have schema defaults of 0, so a document
                // Mongoose creates already looks migrated. A genuine legacy row
                // carries none of the three.
                formulationMarkupPercent: '',
                formulationDiscountPercent: '',
            },
        },
    );
    const before = await shownFor(id);
    check('charges what it charged, not the base', () => assert.equal(before.price, 137.7));
    check('strikes its own base', () => assert.equal(before.strikePrice, 153));
    check('reports the percent it is effectively sold at', () =>
        assert.equal(before.formulationPercent, -10));

    await run(-20);
    const after = await shownFor(id);
    // It was already effectively -10%, so another -20% takes it to -30% of 153.
    check('the inferred percent is added to, not replaced', () =>
        assert.equal(after.stored.formulationDiscountPercent, 30));
    check('so it charges 30% off the base', () => assert.equal(after.price, 107.1));
    // A decrease strikes the price before the cut, which for this row is the
    // 137.70 it was already selling at -- not the 153 base it derives from.
    check('and strikes the price before the cut', () =>
        assert.equal(after.strikePrice, 137.7));
}

/* ------------------------------------------------------------------ variants */
console.log('\nvariants follow the dish');
{
    const id = await seed({
        price: 120,
        basePrice: 120,
        variantsEnabled: true,
        variants: [{ name: 'Half', price: 120 }, { name: 'Full', price: 200 }],
    });
    await run(-25);
    const s = await shownFor(id);
    check('each size is cut', () => {
        const prices = s.stored.variants.map((v) => v.price).sort((a, b) => a - b);
        assert.deepEqual(prices, [90, 150]);
    });
    check('each size keeps its own base', () => {
        const bases = s.stored.variants.map((v) => v.basePrice).sort((a, b) => a - b);
        assert.deepEqual(bases, [120, 200]);
    });

    // -25 then -25 is -50 OF EACH SIZE'S OWN BASE: 60 and 100. Compounding
    // would give 67.50 and 112.50 by cutting the already-cut figures.
    await run(-25);
    const again = await shownFor(id);
    check('a second -25% halves each size from its own base', () => {
        const prices = again.stored.variants.map((v) => v.price).sort((a, b) => a - b);
        assert.deepEqual(prices, [60, 100]);
    });

    // An increase touches only the struck comparison, so every size keeps the
    // halved price it was cut to.
    await run(50);
    const up = await shownFor(id);
    check('an increase never raises what a size charges', () => {
        const prices = up.stored.variants.map((v) => v.price).sort((a, b) => a - b);
        assert.deepEqual(prices, [60, 100]);
    });
    check('and it raises the dish strike instead', () =>
        assert.equal(up.stored.formulationMarkupPercent, 50));
}

/* ------------------------------------------------------------------ revert */
console.log('\nrevert puts the dish back');
{
    // A dish already carrying a 20% discount: base 250, so it sells at 200.
    const id = await seed({ price: 200, basePrice: 250, formulationDiscountPercent: 20 });

    const down = await run(-30);
    const cut = await shownFor(id);
    check('the run took effect', () => {
        assert.equal(cut.stored.formulationDiscountPercent, 50);
        assert.equal(cut.price, 125);
    });

    await revertPriceAdjustment(String(down.adjustment._id), {});
    const after = await shownFor(id);
    // Only this run is removed. The 20% the dish already had is not the run's
    // to undo, so it stays -- which is the whole point of reverting rather
    // than resetting.
    check('the run is removed and the earlier discount survives', () =>
        assert.equal(after.stored.formulationDiscountPercent, 20));
    check('so the dish is back to what it sold for before the run', () =>
        assert.equal(after.price, 200));
    check('the restaurant base never moved', () =>
        assert.equal(after.stored.basePrice, 250));
}

/* ------------------------------------------------- revert, git-revert style */
console.log('\nreverting one run leaves the others standing');
{
    await FoodItem.deleteMany({ restaurantId: restaurant._id });
    const id = await seed({ price: 200, basePrice: 200 });

    const first = await run(-10);   // discount 10 -> pays 180
    await run(-10);                 // discount 20 -> pays 160
    await run(20);                  // markup 20   -> struck 240

    const before = await shownFor(id);
    check('three runs stack', () => {
        assert.equal(before.stored.formulationDiscountPercent, 20);
        assert.equal(before.stored.formulationMarkupPercent, 20);
        assert.equal(before.price, 160);
    });

    /*
     * Revert the FIRST run, with two later ones on top. Restoring its snapshot
     * would put the dish back to 200 and throw both away; removing its own
     * contribution leaves discount at 10 and the markup untouched.
     */
    await revertPriceAdjustment(String(first.adjustment._id), {});
    const after = await shownFor(id);
    check('the reverted run is gone from the total', () =>
        assert.equal(after.stored.formulationDiscountPercent, 10));
    check('the later decrease still stands', () => assert.equal(after.price, 180));
    check('the later increase still stands', () =>
        assert.equal(after.stored.formulationMarkupPercent, 20));
    check('it did not reset to the pre-run price', () =>
        assert.notEqual(after.price, 200));
}

console.log('\nreverting the only run returns the dish to its base');
{
    await FoodItem.deleteMany({ restaurantId: restaurant._id });
    const id = await seed({ price: 200, basePrice: 200 });
    const only = await run(-25);
    const applied = await shownFor(id);
    check('the run applied', () => assert.equal(applied.price, 150));
    await revertPriceAdjustment(String(only.adjustment._id), {});
    const back = await shownFor(id);
    check('back to the base price', () => assert.equal(back.price, 200));
    check('with nothing struck through', () => assert.equal(back.strikePrice, null));
    check('and both totals at zero', () => {
        assert.equal(back.stored.formulationDiscountPercent, 0);
        assert.equal(back.stored.formulationMarkupPercent, 0);
    });
}

/* ----------------------------------------------------------------- preview */
console.log('\nthe preview describes the run that will happen');
{
    await FoodItem.deleteMany({ restaurantId: restaurant._id });
    const id = await seed({ price: 200, basePrice: 200 });

    const up = await getPriceAdjustmentPreview({ restaurantId: String(restaurant._id), percent: 20 });
    check('previews the formulation landing on 240', () => assert.equal(up.samples[0].next, 240));
    check('previews the customer still paying 200', () => assert.equal(up.samples[0].paysAfter, 200));

    await run(20);
    const actual = await shownFor(id);
    check('and the run agrees with the preview', () =>
        assert.equal(actual.strikePrice, up.samples[0].next));

    const down = await getPriceAdjustmentPreview({ restaurantId: String(restaurant._id), percent: -20 });
    check('previews a decrease landing on 160', () => assert.equal(down.samples[0].next, 160));
    check('previews the customer paying 160', () => assert.equal(down.samples[0].paysAfter, 160));
    check('previews from the base, not from the standing +20%', () =>
        assert.equal(down.samples[0].strikeAfter, 200));
}

await mongoose.disconnect();
await server.stop();

console.log(failures ? `\n${failures} FAILED\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
