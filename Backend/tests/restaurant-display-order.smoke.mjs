/**
 * The admin's display order leads the customer app's restaurant list.
 *
 * Run: node tests/restaurant-display-order.smoke.mjs
 *
 *  - With the app's default sort (rating), numbered restaurants come first in
 *    their number order, then the rest by rating -- with and without the
 *    customer's location.
 *  - A sort the customer picks (price) ignores the display order.
 *  - The admin update accepts 1..9999 or blank, and refuses anything else.
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
    await mongoose.connect(replSet.getUri(), { dbName: 'display_order' });

    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
    const { listApprovedRestaurants } = await import('../src/modules/food/restaurant/services/restaurant.service.js');
    const admin = await import('../src/modules/food/admin/services/admin.service.js');
    await FoodRestaurant.syncIndexes();

    const zoneId = new mongoose.Types.ObjectId();
    const at = (dLat) => ({ type: 'Point', coordinates: [75.8577, 22.7196 + dLat], latitude: 22.7196 + dLat, longitude: 75.8577 });
    const mk = async (name, { rating, displayOrder = null, featuredPrice, dLat }) => {
        const r = await FoodRestaurant.create({
            restaurantName: name, ownerName: 'O', ownerPhone: `90000${String(Math.random()).slice(2, 7)}`,
            status: 'approved', pureVegRestaurant: false, zoneId, rating, displayOrder, featuredPrice, location: at(dLat),
            isAcceptingOrders: true,
        });
        await FoodItem.create({ name: `${name} dish`, price: 100, basePrice: 100, restaurantId: r._id, foodType: 'Veg', approvalStatus: 'approved' });
        return r;
    };
    // Ratings say: Top(4.9) Good(4.5) Mid(4.0) New(0). Admin pins New=1, Mid=2.
    await mk('Top', { rating: 4.9, featuredPrice: 300, dLat: 0.01 });
    await mk('Good', { rating: 4.5, featuredPrice: 100, dLat: 0.02 });
    const mid = await mk('Mid', { rating: 4.0, featuredPrice: 200, dLat: 0.03, displayOrder: 2 });
    const fresh = await mk('New', { rating: 0, featuredPrice: 150, dLat: 0.04, displayOrder: 1 });

    const names = (res) => res.restaurants.map((r) => r.restaurantName);

    await check('app default (rating): numbered first in order, then by rating', async () => {
        const res = await listApprovedRestaurants({ zoneId: String(zoneId), sortBy: 'rating' });
        assert.deepEqual(names(res), ['New', 'Mid', 'Top', 'Good']);
        assert.ok(!('_displayRank' in res.restaurants[0]), 'internal sort key leaked');
    });

    await check('with the customer location (nearest): numbered first, then nearest', async () => {
        const res = await listApprovedRestaurants({ zoneId: String(zoneId), sortBy: 'nearest', lat: 22.7196, lng: 75.8577 });
        assert.deepEqual(names(res), ['New', 'Mid', 'Top', 'Good']);
    });

    await check('a sort the customer picks (price low) ignores display order', async () => {
        const res = await listApprovedRestaurants({ zoneId: String(zoneId), sortBy: 'price-low' });
        assert.deepEqual(names(res), ['Good', 'New', 'Mid', 'Top']);
    });

    await check('admin update: sets, clears, and refuses bad values', async () => {
        await admin.updateRestaurantById(String(mid._id), { displayOrder: '5' });
        assert.equal((await FoodRestaurant.findById(mid._id).lean()).displayOrder, 5);
        await admin.updateRestaurantById(String(fresh._id), { displayOrder: '' });
        assert.equal((await FoodRestaurant.findById(fresh._id).lean()).displayOrder, null);
        for (const bad of [0, -1, 2.5, 'abc', 10000]) {
            const err = await admin.updateRestaurantById(String(mid._id), { displayOrder: bad }).then(() => null, (e) => e);
            assert.ok(err, `accepted ${bad}`);
        }
        const res = await listApprovedRestaurants({ zoneId: String(zoneId), sortBy: 'rating' });
        assert.deepEqual(names(res), ['Mid', 'Top', 'Good', 'New']);
    });

    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
