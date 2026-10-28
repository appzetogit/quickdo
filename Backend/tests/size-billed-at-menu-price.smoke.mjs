/**
 * A size is billed at exactly the price the menu shows for it.
 *
 * Run: node tests/size-billed-at-menu-price.smoke.mjs
 *
 * Reported from a real bill at Rainbow Restro: "Item Amount Rs 404.98" for a size
 * the menu listed at Rs 486. resolveAuthoritativeItems took the size's price --
 * already the charged figure under formulation pricing -- and removed
 * menu.discountPercent from it again. That field is the SAVING shown to the
 * customer, 16.67% on a +20% markup, so every size came out 16.67% under.
 *
 * Plain dishes were never affected, and the test pins that too.
 *
 * Drives the real resolveAuthoritativeItems -- the function both
 * /orders/calculate and order placement bill through -- against an in-memory
 * Mongo.
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
    await mongoose.connect(mongo.getUri(), { dbName: 'size_billing' });

    const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
    const { resolveAuthoritativeItems } = await import('../src/modules/food/orders/services/order-pricing.service.js');

    const restaurantId = new mongoose.Types.ObjectId();
    const sellable = { restaurantId, approvalStatus: 'approved', isActive: true, isAvailable: true };

    // Rainbow Restro's Mutton Masala, as production holds it: +20% markup, so the
    // run stored a displayed saving of 16.67% on the dish.
    const markup = await FoodItem.create({
        ...sellable,
        name: 'Mutton Masala',
        price: 283.5,
        basePrice: 283.5,
        discountPercent: 16.67,
        formulationMarkupPercent: 20,
        variantsEnabled: true,
        variants: [
            { name: 'Full', price: 486, basePrice: 486, formulationStrikePrice: 583.2 },
            { name: 'Half', price: 283.5, basePrice: 283.5, formulationStrikePrice: 340.2 },
        ],
    });

    // Margherita at -10%: the run already wrote the discounted figure into price.
    const discount = await FoodItem.create({
        ...sellable,
        name: 'Margherita Pizza',
        price: 90,
        basePrice: 100,
        discountPercent: 10,
        formulationDiscountPercent: 10,
        variantsEnabled: true,
        variants: [
            { name: 'Small', price: 90, basePrice: 100, formulationStrikePrice: 100 },
            { name: 'Large', price: 333, basePrice: 370, formulationStrikePrice: 370 },
        ],
    });

    // A plain dish carrying the same 16.67% displayed saving.
    const plain = await FoodItem.create({
        ...sellable,
        name: 'Chicken Biryani',
        price: 180,
        basePrice: 180,
        discountPercent: 16.67,
        formulationMarkupPercent: 20,
        formulationStrikePrice: 216,
    });

    const size = (dish, name) => dish.variants.find((v) => v.name === name)._id;
    const bill = async (lines) => resolveAuthoritativeItems(restaurantId, lines);

    console.log('\na size on a marked-up dish');
    let out = await bill([
        { itemId: markup._id, variantId: size(markup, 'Full'), quantity: 1 },
        { itemId: markup._id, variantId: size(markup, 'Half'), quantity: 1 },
    ]);

    check('THE BUG: Full is billed at its menu price of 486, not 404.98', () => {
        assert.equal(out[0].price, 486, `billed ${out[0].price}`);
    });
    check('Half is billed at its menu price of 283.50', () => {
        assert.equal(out[1].price, 283.5, `billed ${out[1].price}`);
    });

    console.log('\na size on a discounted dish');
    out = await bill([
        { itemId: discount._id, variantId: size(discount, 'Small'), quantity: 1 },
        { itemId: discount._id, variantId: size(discount, 'Large'), quantity: 1 },
    ]);

    check('Small is billed 90, not discounted a second time to 81', () => {
        assert.equal(out[0].price, 90, `billed ${out[0].price}`);
    });
    check('Large is billed 333, not 299.70', () => {
        assert.equal(out[1].price, 333, `billed ${out[1].price}`);
    });

    console.log('\na plain dish, which was always right');
    out = await bill([{ itemId: plain._id, quantity: 2 }]);

    check('still billed at its menu price', () => {
        assert.equal(out[0].price, 180, `billed ${out[0].price}`);
        assert.equal(out[0].quantity, 2);
    });

    console.log('\nthe bill in the report, reproduced');
    out = await bill([{ itemId: markup._id, variantId: size(markup, 'Full'), quantity: 1 }]);

    check('item amount equals the menu price the customer saw', () => {
        assert.equal(out[0].price * out[0].quantity, 486);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
