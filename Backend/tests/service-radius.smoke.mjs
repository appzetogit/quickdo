/**
 * A restaurant that delivers within 10 km serves 10 km, and nowhere further.
 *
 * Run: node tests/service-radius.smoke.mjs
 *
 * One stored number, two editors, four places that obey it. What this guards:
 *
 *   - the restaurant app and the admin panel write the SAME field through the
 *     SAME validation, so neither can save what the other would refuse;
 *   - the admin ceiling bounds both, and lowering it narrows what is enforced
 *     without destroying what a restaurant had saved;
 *   - the customer listing and search hide a restaurant that cannot reach the
 *     customer, and keep every restaurant that set no radius;
 *   - the cart quote says so, with the distance, and order placement refuses --
 *     which is the check that actually holds against an old app;
 *   - an address whose distance cannot be measured is refused, not waved
 *     through as "0 km away".
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Straight-line distances, so the geometry below is exact and no test reaches
// out to Google.
process.env.DELIVERY_DISTANCE_SOURCE = 'straight';
process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

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

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('service_radius');
await mongoose.connect(mongo.getUri('service_radius'));

const rule = await import('../src/modules/food/shared/serviceRadius.js');
const radius = await import('../src/modules/food/restaurant/services/serviceRadius.service.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
const { FoodFeeSettings } = await import('../src/modules/food/admin/models/feeSettings.model.js');
const { FoodDeliveryCommissionRule } = await import('../src/modules/food/admin/models/deliveryCommissionRule.model.js');
const { FoodUser } = await import('../src/core/users/user.model.js');
const restaurants = await import('../src/modules/food/restaurant/services/restaurant.service.js');
const search = await import('../src/modules/food/search/services/search.service.js');
const pricing = await import('../src/modules/food/orders/services/order-pricing.service.js');
const orders = await import('../src/modules/food/orders/services/order.service.js');

await FoodRestaurant.init(); // the 2dsphere index $geoNear needs

// Nagpur. One degree of latitude is ~111.19 km, so these are 8 km and 12 km due north.
const KITCHEN = { lat: 21.1458, lng: 79.0882 };
const KM = 1 / 111.195;
const AT_8KM = { lat: KITCHEN.lat + 8 * KM, lng: KITCHEN.lng };
const AT_12KM = { lat: KITCHEN.lat + 12 * KM, lng: KITCHEN.lng };
const point = ({ lat, lng }) => ({ type: 'Point', coordinates: [lng, lat] });

await FoodFeeSettings.create({
    deliveryFeeComputationMode: 'distance_order_value',
    platformFee: 0, gstRate: 5, isActive: true,
});
await FoodDeliveryCommissionRule.create({
    name: 'all', minDistance: 0, maxDistance: null, userDeliveryFee: 30,
    commissionPerKm: 0, basePayout: 20, status: true,
});

const tenKm = await FoodRestaurant.create({
    restaurantName: 'Ten Km Kitchen', ownerName: 'A', ownerPhone: '9000000011',
    status: 'approved', location: point(KITCHEN),
});
const noRadius = await FoodRestaurant.create({
    restaurantName: 'Anywhere In Zone', ownerName: 'B', ownerPhone: '9000000012',
    status: 'approved', location: point(KITCHEN),
});
const unplaced = await FoodRestaurant.create({
    restaurantName: 'No Location Yet', ownerName: 'C', ownerPhone: '9000000013',
    status: 'approved',
});

const dish = await FoodItem.create({
    restaurantId: tenKm._id, categoryId: new mongoose.Types.ObjectId(),
    categoryName: 'Mains', name: 'Thali', price: 200, basePrice: 200, discountPercent: 0,
    variantsEnabled: false, variants: [], foodType: 'Veg', isAvailable: true,
    approvalStatus: 'approved',
});

// The listing only shows restaurants with an approved dish, so each gets one.
for (const r of [noRadius, unplaced]) {
    await FoodItem.create({
        restaurantId: r._id, categoryId: new mongoose.Types.ObjectId(),
        categoryName: 'Mains', name: 'Dal', price: 150, basePrice: 150, discountPercent: 0,
        variantsEnabled: false, variants: [], foodType: 'Veg', isAvailable: true,
        approvalStatus: 'approved',
    });
}

const address = (at, label) => ({
    label: 'Home', street: `${label} street`, city: 'Nagpur', state: 'MH',
    location: point(at),
});
const customer = await FoodUser.create({
    phone: '9000000099', name: 'Customer',
    addresses: [address(AT_8KM, 'near'), address(AT_12KM, 'far')],
});

const quote = (at) => pricing.calculateOrderPricing(String(customer._id), {
    restaurantId: String(tenKm._id),
    items: [{ itemId: String(dish._id), quantity: 1 }],
    orderType: 'delivery', paymentMethod: 'cod',
    deliveryAddress: at === null ? { label: 'Home', street: 'nowhere' } : address(at, 'x'),
});

const listedNames = async (at) => {
    const out = await restaurants.listApprovedRestaurants({ lat: String(at.lat), lng: String(at.lng), limit: '50' });
    return out.restaurants.map((r) => r.restaurantName || r.name).sort();
};

console.log('\nthe rule');

await check('blank clears; a number within bounds is kept', () => {
    assert.equal(rule.validateServiceRadius(null).radiusKm, null);
    assert.equal(rule.validateServiceRadius('').radiusKm, null);
    assert.equal(rule.validateServiceRadius('10').radiusKm, 10);
});

await check('below 1 km, above the ceiling, or not a number is refused', () => {
    assert.equal(rule.validateServiceRadius(0.2).ok, false);
    assert.equal(rule.validateServiceRadius(0).ok, false, '0 is not "no radius" -- blank is');
    assert.equal(rule.validateServiceRadius(25, { maxRadiusKm: 20 }).ok, false);
    assert.equal(rule.validateServiceRadius('ten').ok, false);
    assert.equal(rule.validateServiceRadius(true).ok, false);
});

await check('the edge is inside: 10.0 km from a 10 km restaurant is served', () => {
    assert.equal(rule.judgeServiceRadius({ radiusKm: 10, distanceKm: 10 }).deliverable, true);
    assert.equal(rule.judgeServiceRadius({ radiusKm: 10, distanceKm: 10.01 }).deliverable, false);
});

await check('an unmeasured distance is refused, not read as 0 km', () => {
    const verdict = rule.judgeServiceRadius({ radiusKm: 10, distanceKm: null, measured: false });
    assert.equal(verdict.deliverable, false);
    assert.equal(verdict.code, 'DISTANCE_UNKNOWN');
});

await check('no radius means the zone decides, at any distance', () => {
    assert.equal(rule.judgeServiceRadius({ radiusKm: null, distanceKm: 500 }).deliverable, true);
});

console.log('\none field, two editors');

await check('the restaurant sets 10 km from its app', async () => {
    const saved = await radius.setRestaurantServiceRadius(tenKm._id, 10, { actor: 'restaurant' });
    assert.equal(saved.serviceRadiusKm, 10);
    assert.equal(saved.effectiveRadiusKm, 10);
    assert.equal(saved.updatedBy, 'restaurant');
});

await check('the admin panel reads back exactly that, and who set it', async () => {
    const seen = await radius.getRestaurantServiceRadius(String(tenKm._id));
    assert.equal(seen.serviceRadiusKm, 10);
    assert.equal(seen.updatedBy, 'restaurant');
});

await check('the admin changes it; the restaurant sees the change and who made it', async () => {
    await radius.setRestaurantServiceRadius(String(tenKm._id), 7, { actor: 'admin' });
    const seen = await radius.getRestaurantServiceRadius(tenKm._id);
    assert.equal(seen.serviceRadiusKm, 7);
    assert.equal(seen.updatedBy, 'admin');
    await radius.setRestaurantServiceRadius(tenKm._id, 10, { actor: 'restaurant' });
});

await check('the ceiling binds the admin exactly as it binds the restaurant', async () => {
    for (const actor of ['restaurant', 'admin']) {
        await assert.rejects(
            () => radius.setRestaurantServiceRadius(noRadius._id, 45, { actor }),
            /cannot be more than 20 km/,
            `${actor} saved past the ceiling`,
        );
    }
    assert.equal((await FoodRestaurant.findById(noRadius._id).lean()).serviceRadiusKm, null);
});

await check('a radius cannot be set on a restaurant with no location', async () => {
    await assert.rejects(
        () => radius.setRestaurantServiceRadius(unplaced._id, 5, { actor: 'restaurant' }),
        /no location saved/,
    );
});

await check('an unknown actor is a programming error, not a third editor', async () => {
    await assert.rejects(() => radius.setRestaurantServiceRadius(tenKm._id, 5, { actor: 'pos' }));
});

console.log('\nwhat the customer sees');

await check('8 km away: both restaurants are listed', async () => {
    assert.deepEqual(await listedNames(AT_8KM), ['Anywhere In Zone', 'No Location Yet', 'Ten Km Kitchen']);
});

await check('THE POINT: 12 km away, the 10 km restaurant is not listed', async () => {
    const names = await listedNames(AT_12KM);
    assert.ok(!names.includes('Ten Km Kitchen'), names.join(', '));
    assert.ok(names.includes('Anywhere In Zone'), 'a restaurant with no radius was hidden');
    assert.ok(names.includes('No Location Yet'), 'a restaurant without coordinates was hidden');
});

await check('nor does it come up in search', async () => {
    const far = await search.searchUnified({ q: 'Kitchen', lat: String(AT_12KM.lat), lng: String(AT_12KM.lng) });
    const near = await search.searchUnified({ q: 'Kitchen', lat: String(AT_8KM.lat), lng: String(AT_8KM.lng) });
    const names = (r) => (r?.data?.restaurants || r?.restaurants || []).map((x) => x.restaurantName || x.name);
    assert.ok(!names(far).includes('Ten Km Kitchen'), `far: ${names(far)}`);
    assert.ok(names(near).includes('Ten Km Kitchen'), `near: ${names(near)}`);
});

await check('with no point to judge from, nothing is hidden', async () => {
    const out = await restaurants.listApprovedRestaurants({ lat: '', lng: '', limit: '50' });
    assert.ok(out.restaurants.some((r) => (r.restaurantName || r.name) === 'Ten Km Kitchen'));
});

await check('the cart at 8 km: deliverable, with the distance', async () => {
    const { pricing: p } = await quote(AT_8KM);
    assert.equal(p.serviceability.deliverable, true);
    assert.equal(p.serviceability.radiusKm, 10);
    assert.ok(Math.abs(p.serviceability.distanceKm - 8) < 0.1, `${p.serviceability.distanceKm}`);
});

await check('the cart at 12 km: not deliverable, and says why', async () => {
    const { pricing: p } = await quote(AT_12KM);
    assert.equal(p.serviceability.deliverable, false);
    assert.equal(p.serviceability.code, 'OUTSIDE_SERVICE_RADIUS');
    assert.match(p.serviceability.reason, /only delivers within 10 km/);
    assert.match(p.serviceability.reason, /12(\.\d+)? km away/);
});

await check('the list and the cart agree on the same address', async () => {
    const names = await listedNames(AT_12KM);
    const { pricing: p } = await quote(AT_12KM);
    assert.equal(names.includes('Ten Km Kitchen'), p.serviceability.deliverable);
});

await check('placing the order at 12 km is refused, whatever the app showed', async () => {
    await assert.rejects(
        () => orders.createOrder(String(customer._id), {
            restaurantId: String(tenKm._id),
            items: [{ itemId: String(dish._id), quantity: 1, price: 200, name: 'Thali' }],
            orderType: 'delivery', paymentMethod: 'cash',
            deliveryAddress: address(AT_12KM, 'far'), address: address(AT_12KM, 'far'),
        }),
        /only delivers within 10 km/,
    );
});

await check('  and at 8 km it is not refused for distance', async () => {
    try {
        await orders.createOrder(String(customer._id), {
            restaurantId: String(tenKm._id),
            items: [{ itemId: String(dish._id), quantity: 1, price: 200, name: 'Thali' }],
            orderType: 'delivery', paymentMethod: 'cash',
            deliveryAddress: address(AT_8KM, 'near'), address: address(AT_8KM, 'near'),
        });
    } catch (err) {
        // Other checks downstream (payment, riders) may stop a bare test
        // order. Only the radius is under test here.
        assert.doesNotMatch(String(err.message), /only delivers within|how far your address is/);
    }
});

console.log('\nthe admin ceiling');

await check('lowering the ceiling to 6 km narrows what is enforced', async () => {
    await radius.updateServiceRadiusSettings({ maxRadiusKm: 6 });
    const { pricing: p } = await quote(AT_8KM);
    assert.equal(p.serviceability.deliverable, false, 'an 8 km order went through a 6 km ceiling');
    assert.ok(!(await listedNames(AT_8KM)).includes('Ten Km Kitchen'));
});

await check('  both panels say it is capped, and the saved 10 is kept', async () => {
    const seen = await radius.getRestaurantServiceRadius(tenKm._id);
    assert.equal(seen.serviceRadiusKm, 10);
    assert.equal(seen.effectiveRadiusKm, 6);
    assert.equal(seen.capped, true);
    const overview = await radius.getServiceRadiusOverview();
    assert.equal(overview.restaurantsCapped, 1);
});

await check('  raising it again restores the restaurant\'s own 10 km', async () => {
    await radius.updateServiceRadiusSettings({ maxRadiusKm: 20 });
    const { pricing: p } = await quote(AT_8KM);
    assert.equal(p.serviceability.deliverable, true);
});

await check('a nonsense ceiling is refused', async () => {
    await assert.rejects(() => radius.updateServiceRadiusSettings({ maxRadiusKm: 0 }));
    await assert.rejects(() => radius.updateServiceRadiusSettings({ maxRadiusKm: 500 }));
    await assert.rejects(() => radius.updateServiceRadiusSettings({}));
});

console.log('\nclearing it');

/*
 * Changed on 24 Sep 2026: a restaurant with no radius of its own used to serve
 * its whole zone, so the admin's radius bound only the few that set one (six of
 * seven on Quick Drop set none). It now falls back to the platform radius.
 */
await check('clearing the radius falls back to the platform radius', async () => {
    await radius.setRestaurantServiceRadius(tenKm._id, null, { actor: 'restaurant' });
    const { pricing: p } = await quote(AT_12KM);
    assert.equal(p.serviceability.applies, true);
    assert.equal(p.serviceability.radiusKm, 20);
    assert.equal(p.serviceability.deliverable, true);
    assert.ok((await listedNames(AT_12KM)).includes('Ten Km Kitchen'));
    const seen = await radius.getRestaurantServiceRadius(tenKm._id);
    assert.equal(seen.serviceRadiusKm, null);
    assert.equal(seen.effectiveRadiusKm, 20);
    assert.equal(seen.usesDefault, true);
});

await check('  and the platform radius holds it: lowered to 10 km, 12 km away is refused and unlisted', async () => {
    await radius.updateServiceRadiusSettings({ maxRadiusKm: 10 });
    const { pricing: p } = await quote(AT_12KM);
    assert.equal(p.serviceability.deliverable, false);
    assert.ok(!(await listedNames(AT_12KM)).includes('Ten Km Kitchen'));
    await radius.updateServiceRadiusSettings({ maxRadiusKm: 20 });
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
