/**
 * An increase must be visible on a dish sold by size.
 *
 * Run: node tests/variant-adjustment.smoke.mjs
 *
 * The reported bug: +20% moved the struck price on a plain dish and did nothing
 * at all on a dish with variants. A markup only ever raises a struck comparison,
 * never what is charged -- and sizes had no struck figure of their own, so the
 * run had nowhere to put it. Production showed it plainly: Kadai Paneer's item
 * strike went to 276 while both its sizes sat at base === price with no strike
 * field at all.
 *
 * Runs the real aggregation pipeline against an in-memory Mongo.
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
    await mongoose.connect(mongo.getUri(), { dbName: 'variant_adjust' });

    const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
    // The public entry point, so this exercises the same path the admin panel hits.
    const { applyPriceAdjustment } = await import('../src/modules/food/admin/services/priceAdjustment.service.js');
    const { serializeFoodVariants } = await import('../src/modules/food/admin/services/foodVariant.service.js');

    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    const restaurant = await FoodRestaurant.create({ restaurantName: 'Test Kitchen', ownerName: 'Owner' });
    const restaurantId = restaurant._id;
    const runAdjustment = (percent) => applyPriceAdjustment({ restaurantId: String(restaurantId), percent }, {});
    const makeDish = () => FoodItem.create({
        name: 'Kadai Paneer',
        restaurantId,
        price: 230,
        basePrice: 230,
        variantsEnabled: true,
        variants: [
            { name: 'Half', price: 155, basePrice: 155 },
            { name: 'Full', price: 357, basePrice: 357 },
        ],
    });

    const reload = async (id) => FoodItem.findById(id).lean();
    const sizeOf = (doc, name) => doc.variants.find((v) => v.name === name);

    // ---------------------------------------------------------------- increase
    console.log('\nan increase of 20 percent');
    let dish = await makeDish();
    await runAdjustment(20);
    let after = await reload(dish._id);
    let half = sizeOf(after, 'Half');
    let full = sizeOf(after, 'Full');

    check('the dish still charges its base -- nobody pays more', () => {
        assert.equal(after.price, 230);
        assert.equal(after.basePrice, 230);
    });

    check('each size still charges its base', () => {
        assert.equal(half.price, 155);
        assert.equal(full.price, 357);
    });

    check('THE BUG: each size now has a struck figure 20% above its base', () => {
        assert.equal(half.formulationStrikePrice, 186, 'Half: 155 x 1.2');
        assert.equal(full.formulationStrikePrice, 428.4, 'Full: 357 x 1.2');
    });

    check('a size never loses its real base to the strike', () => {
        assert.equal(half.basePrice, 155);
        assert.equal(full.basePrice, 357);
    });

    check('customers are sent the strike, so it renders', () => {
        const [h] = serializeFoodVariants([half], { strikeAsBase: true });
        assert.equal(h.basePrice, 186, 'struck figure');
        assert.equal(h.price, 155, 'charged');
        assert.ok(h.basePrice > h.price, 'a client only strikes what is above the price');
    });

    check('the admin is sent the real base, never the strike', () => {
        const [h] = serializeFoodVariants([half]);
        assert.equal(h.basePrice, 155, 'the admin form saves this straight back');
        assert.equal(h.strikePrice, 186, 'available separately');
    });

    // ---------------------------------------------------------------- decrease
    console.log('\na decrease of 10 percent');
    dish = await makeDish();
    await runAdjustment(-10);
    after = await reload(dish._id);
    half = sizeOf(after, 'Half');

    check('the charged price drops by the percentage of the base', () => {
        assert.equal(half.price, 139.5, '155 less 10%');
        assert.equal(half.basePrice, 155, 'the base does not move');
    });

    check('the strike records what the size dropped from', () => {
        assert.equal(half.formulationStrikePrice, 155);
    });

    // ------------------------------------------------------- surviving a save
    console.log('\nediting the dish afterwards');
    const { normalizeFoodVariantsInput } = await import('../src/modules/food/admin/services/foodVariant.service.js');

    check('an admin save keeps the base and the strike', () => {
        // What the admin form round-trips: serialize out, post back.
        const sent = serializeFoodVariants(after.variants);
        const saved = normalizeFoodVariantsInput(sent);
        const savedHalf = saved.find((v) => v.name === 'Half');
        assert.equal(savedHalf.basePrice, 155, 'the base used to be dropped here');
        assert.equal(savedHalf.formulationStrikePrice, 155, 'and the strike with it');
    });

    check('a brand new size gets a base immediately, equal to its price', () => {
        /*
         * It used to be left unset for the next run to settle. A dish no run ever
         * touches then keeps null bases forever, and nothing can express its
         * markup per size -- which is how paneer chila ended up with a 20% markup
         * that neither size could show, and the app inferred a flat saving that
         * was right for Half and wrong for Full.
         */
        const saved = normalizeFoodVariantsInput([{ name: 'Family', price: 500 }]);
        assert.equal(saved[0].basePrice, 500, 'an unadjusted size\'s price is its base');
        assert.equal(saved[0].formulationStrikePrice, undefined, 'but no strike until a run decides one');
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
