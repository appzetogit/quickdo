/**
 * A restaurant re-pricing a dish, then the admin approving it, lands the dish
 * on the menu's price adjustment -- shown and billed at the same figure.
 *
 * Run: node tests/edit-then-approve-keeps-adjustment.smoke.mjs
 *
 * Reported from the admin panel, 11 Sep: a NEW dish approved into the +20% hike
 * showed its hike, but a dish the restaurant had EDITED and sent back for
 * approval did not. The edit kept the strike stored against the old base, and
 * approval only rewrote the strike after a decrease -- so a Rs 200 dish struck
 * at 240, re-priced to Rs 300, went on striking 240: below its own price, and
 * the hike showed nowhere. The same edit on a discounted dish charged the bare
 * new base while the menu showed it discounted. And approving into a discount
 * only discounted the dish's headline, never its sizes.
 *
 * Replays the real flow against an in-memory Mongo: the restaurant panel's save
 * (updateRestaurantFood), admin approval (approveFoodItem), the admin's own save
 * (updateFood), what the customer menu shows (resolveItemDisplayPricing /
 * serializeFoodVariants) and what the bill charges (resolveAuthoritativeItems).
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
const id = () => new mongoose.Types.ObjectId();

const main = async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'edit_then_approve' });

    const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    const { updateRestaurantFood } = await import('../src/modules/food/restaurant/services/restaurantFood.service.js');
    const { approveFoodItem } = await import('../src/modules/food/admin/services/foodApproval.service.js');
    const { updateFood } = await import('../src/modules/food/admin/services/admin.service.js');
    const { resolveItemDisplayPricing } = await import('../src/modules/food/shared/itemDiscountPricing.js');
    const { serializeFoodVariants } = await import('../src/modules/food/admin/services/foodVariant.service.js');
    const { resolveAuthoritativeItems } = await import('../src/modules/food/orders/services/order-pricing.service.js');

    const restaurant = async (name) => {
        const _id = id();
        await FoodRestaurant.collection.insertOne({
            _id, restaurantName: name, ownerName: 'Owner', ownerPhone: '9999999999', status: 'approved',
            pureVegRestaurant: false, location: { type: 'Point', coordinates: [76.53, 32.1] }, createdAt: new Date(),
        });
        return _id;
    };
    const dish = async (restaurantId, fields) => {
        const _id = id();
        await FoodItem.collection.insertOne({
            _id, restaurantId, name: fields.name, categoryName: 'Mains', foodType: 'Veg', image: '',
            approvalStatus: 'approved', isActive: true, isAvailable: true, createdAt: new Date(), updatedAt: new Date(),
            ...fields,
        });
        return _id;
    };
    const load = (dishId) => FoodItem.findById(dishId).lean();
    // What the customer menu shows for a plain dish, and for each size.
    const shown = (d) => resolveItemDisplayPricing(d);
    const shownSizes = (d) => serializeFoodVariants(d.variants, { strikeAsBase: true });
    const billed = async (d, sizeName) => {
        const size = sizeName ? d.variants.find((v) => v.name === sizeName) : null;
        const [line] = await resolveAuthoritativeItems(d.restaurantId, [
            { itemId: d._id, variantId: size ? size._id : undefined, quantity: 1 },
        ]);
        return line.price;
    };

    // ------------------------------------------------ a menu on a +20% hike
    const hikeMenu = await restaurant('Hike Kitchen');
    for (const [name, base] of [['Dal', 150], ['Paneer', 250], ['Roti', 20]]) {
        await dish(hikeMenu, { name, basePrice: base, price: base, formulationMarkupPercent: 20, formulationDiscountPercent: 0,
            formulationPercent: 20, formulationStrikePrice: base * 1.2 });
    }

    console.log('\nhike: the restaurant re-prices a plain dish, the admin approves it into the hike');
    const plain = await dish(hikeMenu, { name: 'Kadai Paneer', basePrice: 200, price: 200, formulationMarkupPercent: 20,
        formulationDiscountPercent: 0, formulationPercent: 20, formulationStrikePrice: 240 });
    // What the restaurant panel posts for a plain dish.
    await updateRestaurantFood(hikeMenu, plain, { name: 'Kadai Paneer', basePrice: 300, price: 300, discountPercent: 0 });
    let d = await load(plain);
    check('the edit goes to approval', () => assert.equal(d.approvalStatus, 'pending'));
    check('while pending, the hike is already re-worked onto the new price: 300 struck 360', () => {
        assert.equal(shown(d).price, 300);
        assert.equal(shown(d).strikePrice, 360, `struck ${shown(d).strikePrice}`);
    });
    await approveFoodItem(String(plain), { applyGlobalPricing: true });
    d = await load(plain);
    check('THE BUG: approved into the hike, the menu shows 300 struck 360 -- not a stale 240', () => {
        assert.equal(shown(d).price, 300);
        assert.equal(shown(d).strikePrice, 360, `struck ${shown(d).strikePrice}`);
    });
    const plainBilled = await billed(d);
    check('  billed 300', () => assert.equal(plainBilled, 300, `billed ${plainBilled}`));

    console.log('\nhike: the same edit, approved with "keep its current pricing"');
    const plain2 = await dish(hikeMenu, { name: 'Shahi Paneer', basePrice: 200, price: 200, formulationMarkupPercent: 20,
        formulationDiscountPercent: 0, formulationPercent: 20, formulationStrikePrice: 240 });
    await updateRestaurantFood(hikeMenu, plain2, { name: 'Shahi Paneer', basePrice: 300, price: 300, discountPercent: 0 });
    await approveFoodItem(String(plain2), { applyGlobalPricing: false });
    d = await load(plain2);
    check('it keeps its own hike: 300 struck 360', () => {
        assert.equal(shown(d).price, 300);
        assert.equal(shown(d).strikePrice, 360, `struck ${shown(d).strikePrice}`);
    });

    console.log('\nhike: the restaurant re-prices one size of a dish');
    const sized = await dish(hikeMenu, { name: 'Paneer Chila', basePrice: 100, price: 100, formulationMarkupPercent: 20,
        formulationDiscountPercent: 0, formulationPercent: 20, formulationStrikePrice: 120, variantsEnabled: true,
        variants: [
            { _id: id(), name: 'Half', price: 100, basePrice: 100, formulationStrikePrice: 120 },
            { _id: id(), name: 'Full', price: 200, basePrice: 200, formulationStrikePrice: 240 },
        ] });
    let before = await load(sized);
    // The size editor posts each size's selling price.
    await updateRestaurantFood(hikeMenu, sized, { name: 'Paneer Chila', variantsEnabled: true, variants: [
        { _id: String(before.variants[0]._id), name: 'Half', price: 100 },
        { _id: String(before.variants[1]._id), name: 'Full', price: 250 },
    ] });
    await approveFoodItem(String(sized), { applyGlobalPricing: true });
    d = await load(sized);
    const sizes = shownSizes(d);
    check('Full shows 250 struck 300, Half stays 100 struck 120', () => {
        const full = sizes.find((v) => v.name === 'Full');
        const half = sizes.find((v) => v.name === 'Half');
        assert.equal(full.price, 250);
        assert.equal(full.strikePrice, 300, `Full struck ${full.strikePrice}`);
        assert.equal(half.price, 100);
        assert.equal(half.strikePrice, 120, `Half struck ${half.strikePrice}`);
    });
    const fullBilled = await billed(d, 'Full');
    check('and Full is billed 250', () => assert.equal(fullBilled, 250, `billed ${fullBilled}`));

    console.log('\nhike: a brand-new dish approved into the hike (already worked, must still work)');
    const fresh = await dish(hikeMenu, { name: 'Veg Pulao', basePrice: 200, price: 200, approvalStatus: 'pending' });
    await approveFoodItem(String(fresh), { applyGlobalPricing: true });
    d = await load(fresh);
    check('shows 200 struck 240', () => {
        assert.equal(shown(d).price, 200);
        assert.equal(shown(d).strikePrice, 240, `struck ${shown(d).strikePrice}`);
    });

    console.log('\nhike: a dish edited before this fix, still holding the stale strike, is approved');
    // Exactly what production holds for any dish edited before the fix: the new
    // base, and the strike from the old one.
    const stale = await dish(hikeMenu, { name: 'Malai Kofta', basePrice: 300, price: 300, formulationMarkupPercent: 20,
        formulationDiscountPercent: 0, formulationPercent: 20, formulationStrikePrice: 240, approvalStatus: 'pending' });
    await approveFoodItem(String(stale), { applyGlobalPricing: true });
    d = await load(stale);
    check('approval itself replaces the stale 240 with 360', () => {
        assert.equal(shown(d).price, 300);
        assert.equal(shown(d).strikePrice, 360, `struck ${shown(d).strikePrice}`);
    });

    // ------------------------------------------------ a menu on a -10% discount
    const cutMenu = await restaurant('Discount Dhaba');
    for (const [name, base] of [['Dal', 150], ['Paneer', 250], ['Roti', 20]]) {
        await dish(cutMenu, { name, basePrice: base, price: base * 0.9, formulationMarkupPercent: 0, formulationDiscountPercent: 10,
            formulationPercent: -10, formulationStrikePrice: base });
    }

    console.log('\ndiscount: the restaurant re-prices a discounted dish');
    const cut = await dish(cutMenu, { name: 'Mix Veg', basePrice: 200, price: 180, formulationMarkupPercent: 0,
        formulationDiscountPercent: 10, formulationPercent: -10, formulationStrikePrice: 200 });
    await updateRestaurantFood(cutMenu, cut, { name: 'Mix Veg', basePrice: 300, price: 300, discountPercent: 0 });
    d = await load(cut);
    const pendingBilled = await FoodItem.findById(cut).lean().then((x) => x.price);
    check('THE BUG: while pending, the stored (billed) price is 270, what the menu shows -- not 300', () => {
        assert.equal(shown(d).price, 270);
        assert.equal(pendingBilled, 270, `stored ${pendingBilled}`);
    });
    await approveFoodItem(String(cut), { applyGlobalPricing: true });
    d = await load(cut);
    check('approved: shows 270 struck 300', () => {
        assert.equal(shown(d).price, 270);
        assert.equal(shown(d).strikePrice, 300, `struck ${shown(d).strikePrice}`);
    });
    const cutBilled = await billed(d);
    check('  billed 270', () => assert.equal(cutBilled, 270, `billed ${cutBilled}`));

    console.log('\ndiscount: a new dish with sizes approved into the discount');
    const newSized = await dish(cutMenu, { name: 'Gulab Jamun', basePrice: 100, price: 100, approvalStatus: 'pending',
        variantsEnabled: true, variants: [
            { _id: id(), name: '4 Pcs', price: 100, basePrice: 100 },
            { _id: id(), name: '8 Pcs', price: 180, basePrice: 180 },
        ] });
    await approveFoodItem(String(newSized), { applyGlobalPricing: true });
    d = await load(newSized);
    const newSizes = shownSizes(d);
    check('THE BUG: every size is discounted, not only the headline -- 90 struck 100, 162 struck 180', () => {
        const small = newSizes.find((v) => v.name === '4 Pcs');
        const large = newSizes.find((v) => v.name === '8 Pcs');
        assert.equal(small.price, 90, `4 Pcs ${small.price}`);
        assert.equal(small.strikePrice, 100);
        assert.equal(large.price, 162, `8 Pcs ${large.price}`);
        assert.equal(large.strikePrice, 180);
    });
    const smallBilled = await billed(d, '4 Pcs');
    check('  4 Pcs billed 90', () => assert.equal(smallBilled, 90, `billed ${smallBilled}`));

    // ------------------------------------------------ the admin's own save
    console.log('\nadmin panel: re-pricing a dish that carries a hike AND a discount');
    const both = await dish(cutMenu, { name: 'Veg Biryani', basePrice: 200, price: 180, formulationMarkupPercent: 20,
        formulationDiscountPercent: 10, formulationPercent: 20, formulationStrikePrice: 200 });
    await updateFood(String(both), { basePrice: 300, price: 300, discountPercent: 0 });
    d = await load(both);
    check('THE BUG: keeps the discount -- charged 270, shown 270, struck 300', () => {
        assert.equal(d.price, 270, `stored ${d.price}`);
        assert.equal(shown(d).price, 270, `shown ${shown(d).price}`);
        assert.equal(shown(d).strikePrice, 300, `struck ${shown(d).strikePrice}`);
    });
    check('and neither accumulator was lost', () => {
        assert.equal(d.formulationMarkupPercent, 20);
        assert.equal(d.formulationDiscountPercent, 10);
    });

    console.log('\nan ordinary save that does not touch the price changes nothing');
    const steady = await dish(cutMenu, { name: 'Raita', basePrice: 80, price: 72, formulationMarkupPercent: 0,
        formulationDiscountPercent: 10, formulationPercent: -10, formulationStrikePrice: 80 });
    await updateRestaurantFood(cutMenu, steady, { name: 'Raita', description: 'Cool', basePrice: 80, price: 80, discountPercent: 0 });
    d = await load(steady);
    check('still charged 72, struck 80', () => {
        assert.equal(d.price, 72);
        assert.equal(shown(d).strikePrice, 80);
    });

    await mongoose.disconnect();
    await mongo.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
