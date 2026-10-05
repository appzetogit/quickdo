/**
 * A combo is shown at the price it is billed, with its parts total struck
 * through, and global price runs leave it alone.
 *
 * Run: node tests/combo-shown-as-billed.smoke.mjs
 *
 * Found by the calculation audit, 11 Sep: a combo stored its parts total as the
 * base price. The menu derives the price it shows from the base, and the bill
 * charges `price` -- so a Rs 150 combo of Rs 200 of dishes was shown at Rs 200,
 * nothing struck, and billed Rs 150. A -10% run then started from the parts
 * total and RAISED the combo to Rs 180.
 *
 * Drives the real saveCombo, applyPriceAdjustment, the customer display rule
 * and resolveAuthoritativeItems against an in-memory Mongo.
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
    await mongoose.connect(mongo.getUri(), { dbName: 'combo_shown' });

    const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
    const { saveCombo } = await import('../src/modules/food/shared/combo.service.js');
    const { applyPriceAdjustment } = await import('../src/modules/food/admin/services/priceAdjustment.service.js');
    const { resolveItemDisplayPricing } = await import('../src/modules/food/shared/itemDiscountPricing.js');
    const { resolveAuthoritativeItems } = await import('../src/modules/food/orders/services/order-pricing.service.js');

    const restaurantId = id();
    // A price run refuses a restaurant it cannot find.
    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    await FoodRestaurant.collection.insertOne({
        _id: restaurantId, restaurantName: 'Combo Corner', ownerName: 'Owner', ownerPhone: '9999999999',
        status: 'approved', location: { type: 'Point', coordinates: [76.53, 32.1] }, createdAt: new Date(),
    });
    const dish = async (name, price) => {
        const _id = id();
        await FoodItem.collection.insertOne({
            _id, restaurantId, name, price, basePrice: price, categoryName: 'Mains', foodType: 'Veg',
            approvalStatus: 'approved', isActive: true, isAvailable: true, createdAt: new Date(), updatedAt: new Date(),
        });
        return _id;
    };
    const burger = await dish('Burger', 120);
    const coffee = await dish('Cold Coffee', 80);

    const { combo } = await saveCombo(String(restaurantId), {
        name: 'Burger + Cold Coffee',
        components: [{ itemId: String(burger), quantity: 1 }, { itemId: String(coffee), quantity: 1 }],
        comboPrice: 150,
    }, { updatedByRole: 'ADMIN' });

    const load = (x) => FoodItem.findById(x).lean();
    const billed = async (x) => (await resolveAuthoritativeItems(restaurantId, [{ itemId: x, quantity: 1 }]))[0].price;

    console.log('\na Rs 150 combo of Rs 200 of dishes');
    let c = await load(combo._id);
    let shown = resolveItemDisplayPricing(c);
    check('THE BUG: the menu shows Rs 150 -- not the Rs 200 parts total', () => assert.equal(shown.price, 150, `shown ${shown.price}`));
    check('with the Rs 200 parts total struck through', () => assert.equal(shown.strikePrice, 200, `struck ${shown.strikePrice}`));
    const before = await billed(combo._id);
    check('and the bill charges Rs 150', () => assert.equal(before, 150, `billed ${before}`));

    console.log('\na -10% price run over the menu');
    await applyPriceAdjustment({ percent: -10, restaurantId: String(restaurantId) }, {});
    c = await load(combo._id);
    shown = resolveItemDisplayPricing(c);
    const after = await billed(combo._id);
    check('THE BUG: the combo is left alone -- still Rs 150, not raised to 180', () => {
        assert.equal(after, 150, `billed ${after}`);
        assert.equal(shown.price, 150, `shown ${shown.price}`);
        assert.equal(shown.strikePrice, 200, `struck ${shown.strikePrice}`);
    });
    const burgerAfter = await billed(burger);
    check('while an ordinary dish on the menu is discounted: Burger 120 -> 108', () => assert.equal(burgerAfter, 108, `billed ${burgerAfter}`));

    await mongoose.disconnect();
    await mongo.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
