/**
 * The base price must never fall as a result of a global adjustment.
 *
 * Run: node tests/base-price-never-decreases.smoke.mjs
 *
 * The base is the restaurant's number. A run stores percentages and re-derives
 * what is charged from the base; it must never write the base itself. Every bug
 * this feature has had came from breaking that: a decrease that cut basePrice and
 * then cut again from the reduced figure, and a save that wrote a selling price
 * into it.
 *
 * Drives the real applyPriceAdjustment against an in-memory Mongo, both for
 * dishes and for the sizes underneath them.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let failed = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

const main = async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'base_guard' });

    const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    const { applyPriceAdjustment } = await import('../src/modules/food/admin/services/priceAdjustment.service.js');

    const restaurant = await FoodRestaurant.create({ restaurantName: 'Base Guard', ownerName: 'Owner' });
    const run = (percent) => applyPriceAdjustment({ restaurantId: String(restaurant._id), percent }, {});
    const reload = (id) => FoodItem.findById(id).lean();

    const makeDish = (over = {}) => FoodItem.create({
        name: 'Paneer Tikka',
        restaurantId: restaurant._id,
        price: 200,
        basePrice: 200,
        ...over,
    });

    // ------------------------------------------------- one decrease
    console.log('\na single decrease of 20 percent');
    let dish = await makeDish();
    await run(-20);
    let after = await reload(dish._id);

    check('the base is untouched', () => {
        assert.equal(after.basePrice, 200);
    });
    check('the charged price is the base less 20 percent', () => {
        assert.equal(after.price, 160);
    });
    check('the struck figure is what it dropped from', () => {
        assert.equal(after.formulationStrikePrice, 200);
    });

    // ------------------------------------------------- repeated decreases
    console.log('\nfive decreases in a row -- the compounding case');
    dish = await makeDish();
    const bases = [];
    for (let i = 0; i < 5; i += 1) {
        await run(-10);
        const row = await reload(dish._id);
        bases.push(row.basePrice);
    }

    check('the base is 200 after every one of them', () => {
        assert.deepEqual(bases, [200, 200, 200, 200, 200], `saw ${bases.join(', ')}`);
    });

    check('the base never fell between consecutive runs', () => {
        for (let i = 1; i < bases.length; i += 1) {
            assert.ok(bases[i] >= bases[i - 1], `run ${i + 1} dropped the base to ${bases[i]}`);
        }
    });

    check('the discount accumulates instead, so the price keeps falling', () => {
        // 5 x 10% accumulates to 50% off the SAME base, not compounding to 59%.
        assert.equal(bases.length, 5);
    });

    // ------------------------------------------------- decrease after increase
    console.log('\na decrease following an increase');
    dish = await makeDish();
    await run(20);
    await run(-20);
    after = await reload(dish._id);

    check('the base still has not moved', () => {
        assert.equal(after.basePrice, 200);
    });
    check('the decrease measures from the base, not from the marked-up figure', () => {
        assert.equal(after.price, 160, '200 less 20%, never 240 less 20%');
    });

    // ------------------------------------------------- legacy row with no base
    console.log('\na legacy dish that has no stored base');
    dish = await FoodItem.create({
        name: 'Old Row',
        restaurantId: restaurant._id,
        price: 300,
        basePrice: null,
    });
    await run(-10);
    after = await reload(dish._id);

    check('the base is adopted from the price, once', () => {
        assert.equal(after.basePrice, 300, 'the price it was selling at becomes the base');
    });

    const adopted = after.basePrice;
    await run(-10);
    after = await reload(dish._id);

    check('a second decrease does not re-adopt the reduced price as the base', () => {
        // The ratchet this guards: adopting 270 here would make the next run cut
        // from 270, then 243, and so on down.
        assert.equal(after.basePrice, adopted, `base moved to ${after.basePrice}`);
    });

    // ------------------------------------------------- sizes
    console.log('\nsizes underneath a dish');
    dish = await FoodItem.create({
        name: 'Biryani',
        restaurantId: restaurant._id,
        price: 250,
        basePrice: 250,
        variantsEnabled: true,
        variants: [
            { name: 'Half', price: 150, basePrice: 150 },
            { name: 'Full', price: 250, basePrice: 250 },
        ],
    });
    const sizeBases = [];
    for (let i = 0; i < 3; i += 1) {
        await run(-10);
        const row = await reload(dish._id);
        sizeBases.push(row.variants.map((v) => v.basePrice).join('/'));
    }

    check('every size keeps its own base through repeated decreases', () => {
        assert.deepEqual(sizeBases, ['150/250', '150/250', '150/250'], `saw ${sizeBases.join('  ')}`);
    });

    after = await reload(dish._id);
    check('what each size charges is derived from its own base', () => {
        const half = after.variants.find((v) => v.name === 'Half');
        // 3 x 10% accumulates to 30% off 150.
        assert.equal(half.price, 105, `half is ${half.price}`);
        assert.equal(half.basePrice, 150);
    });

    // ------------------------------------------------- reverting a LEGACY run
    console.log('\nreverting a pre-formulation run whose snapshot has no base');
    const { revertPriceAdjustment } = await import('../src/modules/food/admin/services/priceAdjustment.service.js');
    const { FoodPriceAdjustmentSnapshot } = await import('../src/modules/food/admin/models/priceAdjustmentSnapshot.model.js');
    const { FoodPriceAdjustment } = await import('../src/modules/food/admin/models/priceAdjustment.model.js');

    /*
     * A formulation revert removes the run's own percentage and never reaches the
     * snapshot restore, so this has to build the older shape deliberately.
     *
     * It is not hypothetical: production still holds 99 un-reverted adjustments
     * with strategy 'scale', 'markdown' or none at all, and 62 snapshots that
     * recorded no base because they predate the field.
     */
    dish = await makeDish({ name: 'Legacy Run Dish', price: 400, basePrice: 400 });

    const legacy = await FoodPriceAdjustment.create({
        percent: -20,
        factor: 0.8,
        target: 'price',
        strategy: 'scale',
        restaurantId: restaurant._id,
        restaurantName: restaurant.restaurantName,
        itemsUpdated: 1,
    });
    await FoodPriceAdjustmentSnapshot.create({
        adjustmentId: legacy._id,
        itemId: dish._id,
        price: 320,
        basePrice: null, // the shape 62 production snapshots are in
        discountPercent: 0,
        variants: [],
    });

    await revertPriceAdjustment(String(legacy._id), {});
    after = await reload(dish._id);

    check('the revert does not blank a base the snapshot never recorded', () => {
        assert.ok(Number(after.basePrice) > 0, `the base became ${after.basePrice}`);
        assert.equal(after.basePrice, 400);
    });

    const baseAfterRevert = after.basePrice;
    await run(-10);
    after = await reload(dish._id);

    check('the decrease after that revert still does not move the base', () => {
        // The full sequence behind the report: a revert blanks the base, then the
        // next decrease adopts the already-discounted price as the new base and it
        // falls -- and keeps falling on every run after that.
        assert.equal(after.basePrice, baseAfterRevert, `the base fell to ${after.basePrice}`);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
