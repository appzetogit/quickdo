/**
 * Daily-needs products are limited to the stores serving where the customer is.
 *
 * Run: node tests/qc-products-zone.smoke.mjs
 *
 * The customer app asked for products with neither a zone nor a location, so
 * every approved store in the country was listed: a customer in Palampur saw
 * the Indore stores. The search now takes the delivery point and works out the
 * store zone itself, the city zone winning over a country-wide one.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

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
process.env.MONGODB_URI = mongo.getUri('qc_zone');
await mongoose.connect(mongo.getUri('qc_zone'));

const B = '../src/modules/quickCommerce/modules/food';
const { QCZone } = await import(`${B}/admin/models/zone.model.js`);
const { FoodRestaurant } = await import(`${B}/restaurant/models/restaurant.model.js`);
const { FoodItem } = await import(`${B}/admin/models/food.model.js`);
const { searchProducts } = await import(`${B}/search/services/search.service.js`);

const box = (lat, lng, d) => [
    { latitude: lat - d, longitude: lng - d }, { latitude: lat - d, longitude: lng + d },
    { latitude: lat + d, longitude: lng + d }, { latitude: lat + d, longitude: lng - d },
];
const indore = await QCZone.create({ name: 'Indore', coordinates: box(22.72, 75.86, 0.2), isActive: true });
await QCZone.create({ name: 'India', coordinates: box(22, 80, 12), isActive: true }); // country-wide

const store = await FoodRestaurant.create({
    restaurantName: 'Daily Needs Mart', ownerName: 'O', ownerPhone: '9000000031',
    status: 'approved', storeType: 'grocery', zoneId: indore._id,
});
await FoodItem.create({ restaurantId: store._id, name: 'Milk 500ml', price: 30, approvalStatus: 'approved', foodType: 'Veg' });

await check('a customer in Indore sees the Indore store', async () => {
    const out = await searchProducts({ lat: '22.7196', lng: '75.8577' });
    assert.equal(out.total, 1, JSON.stringify(out));
});

await check('a customer in Palampur (only the country-wide zone) sees no Indore store', async () => {
    const out = await searchProducts({ lat: '32.11', lng: '76.54' });
    assert.equal(out.total, 0);
    assert.notEqual(out.outOfService, true, 'Palampur is inside the India zone');
});

await check('outside every store zone: nothing, flagged out of service', async () => {
    const out = await searchProducts({ lat: '51.5', lng: '-0.12' });
    assert.equal(out.total, 0);
    assert.equal(out.outOfService, true);
});

await check('an explicit zone id still wins; no zone and no point is unchanged', async () => {
    assert.equal((await searchProducts({ zoneId: String(indore._id), lat: '32.11', lng: '76.54' })).total, 1);
    assert.equal((await searchProducts({})).total, 1);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
