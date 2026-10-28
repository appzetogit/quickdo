/**
 * The customer app's Rs 99 store shows what the admin's dish form shows.
 *
 * Run: node tests/ninety-nine-store-listing.smoke.mjs
 *
 *  - A dish at or under the cap whose flag was never stored (older than the
 *    shelf, or price lowered elsewhere) is on the shelf: the admin form shows
 *    it ticked, "added automatically".
 *  - A dish an admin took off by hand stays off.
 *  - A ticked dish above the cap stays off; the form warns it stays hidden.
 *  - Other lists are unchanged.
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

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'ninety_nine_listing' });

    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
    const { listPublicFoods } = await import('../src/modules/food/restaurant/services/publicFoods.service.js');

    const zoneId = new mongoose.Types.ObjectId();
    const r = await FoodRestaurant.create({
        restaurantName: 'Shelf Kitchen', ownerName: 'O', ownerPhone: '9000012345',
        status: 'approved', pureVegRestaurant: false, zoneId, isAcceptingOrders: true,
        location: { type: 'Point', coordinates: [75.8577, 22.7196], latitude: 22.7196, longitude: 75.8577 },
    });
    const dish = (name, price, extra = {}) => FoodItem.create({
        name, price, basePrice: price, restaurantId: r._id, foodType: 'Veg', approvalStatus: 'approved', ...extra,
    });
    await dish('Ticked Tea', 50, { showIn99Store: true });
    await dish('Never Flagged Samosa', 70);
    await dish('Removed Lassi', 60, { showIn99Store: false, ninetyNineStoreExcluded: true });
    await dish('Ticked Thali', 150, { showIn99Store: true });
    await dish('Dear Biryani', 250);
    await dish('Pending Roll', 40, { approvalStatus: 'pending' });

    const names = (res) => res.foods.map((f) => f.name).sort();

    await check('99 store: ticked and never-flagged cheap dishes, nothing removed or over the cap', async () => {
        const res = await listPublicFoods({ promo: 'switch99', zoneId: String(zoneId) });
        assert.deepEqual(names(res), ['Never Flagged Samosa', 'Ticked Tea']);
    });

    await check('the full feed is unchanged', async () => {
        const res = await listPublicFoods({ zoneId: String(zoneId) });
        assert.deepEqual(names(res), ['Dear Biryani', 'Never Flagged Samosa', 'Removed Lassi', 'Ticked Tea', 'Ticked Thali']);
    });

    await check('the exclusion flag does not leak into the public payload', async () => {
        const res = await listPublicFoods({ promo: 'switch99', zoneId: String(zoneId) });
        assert.ok(res.foods.every((f) => !('ninetyNineStoreExcluded' in f)));
    });

    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
