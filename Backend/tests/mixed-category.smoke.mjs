/**
 * Mixed ("Both") categories work in veg and non-veg restaurants alike.
 *
 * Run: node tests/mixed-category.smoke.mjs
 *
 *  - A pure-veg restaurant sees Veg and Mixed categories (not Non-Veg) and can
 *    put veg dishes in a Mixed category. It cannot add a non-veg dish anywhere.
 *  - A regular restaurant can use all three, with each category still limited
 *    to its own diet type.
 *  - Both the Food and Quick-commerce copies behave the same.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};
const rejects = (p) => p.then(() => null, (e) => e);

const VERTICALS = [
    ['food', '../src/modules/food'],
    ['quick-commerce', '../src/modules/quickCommerce/modules/food'],
];

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'mixed_category' });

    for (const [label, base] of VERTICALS) {
        console.log(`\n${label}`);
        const { FoodRestaurant } = await import(`${base}/restaurant/models/restaurant.model.js`);
        const { FoodCategory } = await import(`${base}/admin/models/category.model.js`);
        const foodSvc = await import(`${base}/restaurant/services/restaurantFood.service.js`);
        const catSvc = await import(`${base}/restaurant/services/restaurantCategory.service.js`);

        const mk = (name, pureVeg) => FoodRestaurant.create({
            restaurantName: `${label} ${name}`,
            ownerName: 'Owner',
            ownerPhone: pureVeg ? '9000000001' : '9000000002',
            status: 'approved',
            pureVegRestaurant: pureVeg,
        });
        const vegR = await mk('Pure Veg', true);
        const mixR = await mk('Regular', false);
        // Global, approved categories, as the admin creates them.
        const cat = (name, foodTypeScope) => FoodCategory.create({ name: `${label} ${name}`, foodTypeScope, approvalStatus: 'approved', isApproved: true, isActive: true });
        const vegCat = await cat('Veg Thali', 'Veg');
        const bothCat = await cat('Mixed Starters', 'Both');
        const nonVegCat = await cat('Chicken Specials', 'Non-Veg');

        const dish = (r, c, foodType, name) => foodSvc.createRestaurantFood(String(r._id), {
            name: `${name} ${Math.random().toString(36).slice(2, 6)}`,
            price: 199,
            foodType,
            categoryId: String(c._id),
        });

        await check(`${label}: pure-veg restaurant's category list shows Veg and Mixed, not Non-Veg`, async () => {
            const res = await catSvc.listRestaurantCategories(String(vegR._id), { compact: 'true' });
            const list = res.categories || res.items || res.data || res;
            const names = (Array.isArray(list) ? list : []).map((c) => c.name);
            assert.ok(names.includes(vegCat.name), `missing Veg: ${names}`);
            assert.ok(names.includes(bothCat.name), `missing Mixed: ${names}`);
            assert.ok(!names.includes(nonVegCat.name), `Non-Veg shown: ${names}`);
        });

        await check(`${label}: pure-veg restaurant adds a veg dish to a Mixed category`, async () => {
            await dish(vegR, bothCat, 'Veg', 'Paneer Tikka');
        });

        await check(`${label}: pure-veg restaurant cannot add a non-veg dish to a Mixed category`, async () => {
            const err = await rejects(dish(vegR, bothCat, 'Non-Veg', 'Chicken Tikka'));
            assert.match(err?.message || '', /only add veg food/);
        });

        await check(`${label}: pure-veg restaurant cannot use a Non-Veg category`, async () => {
            const err = await rejects(dish(vegR, nonVegCat, 'Veg', 'Salad'));
            assert.ok(err, 'Non-Veg category accepted');
        });

        await check(`${label}: pure-veg restaurant can create a Mixed category, not a Non-Veg one`, async () => {
            await catSvc.createRestaurantCategory(String(vegR._id), { name: `${label} own mixed`, foodTypeScope: 'Both' });
            const err = await rejects(catSvc.createRestaurantCategory(String(vegR._id), { name: `${label} own nonveg`, foodTypeScope: 'Non-Veg' }));
            assert.match(err?.message || '', /veg or mixed/);
        });

        await check(`${label}: regular restaurant puts veg and non-veg dishes in a Mixed category`, async () => {
            await dish(mixR, bothCat, 'Veg', 'Veg Spring Roll');
            await dish(mixR, bothCat, 'Non-Veg', 'Chicken Lollipop');
        });

        await check(`${label}: a Veg category still refuses non-veg, even for a regular restaurant`, async () => {
            const err = await rejects(dish(mixR, vegCat, 'Non-Veg', 'Mutton Curry'));
            assert.match(err?.message || '', /cannot accept/);
        });
    }

    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
