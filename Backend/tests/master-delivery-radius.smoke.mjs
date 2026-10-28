/**
 * Master > Delivery Radius: every restaurant's radius in one list.
 *
 * Run: node tests/master-delivery-radius.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'master_delivery_radius' });
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const svc = await import('../src/modules/food/restaurant/services/serviceRadius.service.js');

let failures = 0;
const check = async (label, fn) => {
    try { await fn(); console.log(`  ok   ${label}`); }
    catch (err) { failures += 1; console.log(`  FAIL ${label}\n       ${err.message}`); }
};
const add = async (doc) => (await FoodRestaurant.collection.insertOne({
    _id: new mongoose.Types.ObjectId(), ownerPhone: String(Math.random()).slice(2, 12), status: 'approved', createdAt: new Date(), ...doc,
})).insertedId;
const at = { type: 'Point', coordinates: [76.53, 32.1] };

const wide = await add({ restaurantName: 'Wide', location: at, serviceRadiusKm: 12 });
await add({ restaurantName: 'Blank', location: at });
await add({ restaurantName: 'Nowhere' });
await svc.updateServiceRadiusSettings({ maxRadiusKm: 10 });

await check('every restaurant is listed with the radius actually enforced', async () => {
    const { settings, restaurants } = await svc.listRestaurantServiceRadii();
    const by = Object.fromEntries(restaurants.map((r) => [r.restaurantName, r]));
    assert.equal(settings.maxRadiusKm, 10);
    assert.deepEqual(Object.keys(by), ['Blank', 'Nowhere', 'Wide']);
    assert.deepEqual([by.Wide.effectiveRadiusKm, by.Wide.capped, by.Wide.serviceRadiusKm], [10, true, 12]);
    assert.deepEqual([by.Blank.effectiveRadiusKm, by.Blank.usesDefault], [10, true]);
    assert.equal(by.Nowhere.hasLocation, false);
});
await check('saving a row from Master changes what the list shows', async () => {
    await svc.setRestaurantServiceRadius(String(wide), 4, { actor: 'admin' });
    const { restaurants } = await svc.listRestaurantServiceRadii();
    const w = restaurants.find((r) => r.restaurantName === 'Wide');
    assert.deepEqual([w.effectiveRadiusKm, w.updatedBy], [4, 'admin']);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
