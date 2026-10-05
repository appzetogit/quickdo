/**
 * Quick Shop never shows a pharmacy or its medicines; the Medical tab still does.
 *
 * Run: node tests/quick-shop-excludes-pharmacy.smoke.mjs
 *
 * Quick Shop and Medical share one seller collection. The customer app's Quick
 * Shop asks for sellers with no storeType and searches products with none, and
 * the server used to answer with every approved seller -- so chemists and
 * paracetamol appeared among the groceries.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri();
await mongoose.connect(server.getUri(), { dbName: 'quick_shop_scope' });

const { FoodRestaurant } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');
const { FoodItem } = await import('../src/modules/quickCommerce/modules/food/admin/models/food.model.js');
const { listApprovedRestaurants } = await import('../src/modules/quickCommerce/modules/food/restaurant/services/restaurant.service.js');
const { searchProducts } = await import('../src/modules/quickCommerce/modules/food/search/services/search.service.js');
const { listPublicFoods } = await import('../src/modules/quickCommerce/modules/food/restaurant/services/publicFoods.service.js');

let failures = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  ok   ${label}`);
    } catch (err) {
        failures += 1;
        console.log(`  FAIL ${label}\n       ${err.message}`);
    }
};

let phone = 8100000000;
const seller = (name, storeType) => FoodRestaurant.create({
    restaurantName: name, ownerName: 'Owner', status: 'approved',
    ...(storeType ? { storeType } : {}),
    email: `${name.replace(/\W/g, '')}@example.com`, phone: String(phone++),
});
const chemist = await seller('City Chemist', 'pharmacy');
const kirana = await seller('Corner Kirana', 'kirana');
const legacy = await FoodRestaurant.collection.insertOne({
    restaurantName: 'Old Shop', status: 'approved', email: 'old@example.com', phone: String(phone++),
});
for (const [r, name] of [[chemist, 'Paracetamol'], [kirana, 'Rice 5kg']]) {
    await FoodItem.create({ restaurantId: r._id, name, price: 50, basePrice: 50, approvalStatus: 'approved' });
}

const namesOf = (list) => list.map((r) => r.restaurantName || r.name).sort();
const sellersIn = (res) => res.restaurants || res.results || res.data || res;

await check('Quick Shop seller list has no pharmacy (and keeps sellers saved before storeType)', async () => {
    const names = namesOf(sellersIn(await listApprovedRestaurants({})));
    assert.deepEqual(names, ['Corner Kirana', 'Old Shop']);
});

await check('Medical tab still lists the pharmacy, and only it', async () => {
    const names = namesOf(sellersIn(await listApprovedRestaurants({ storeType: 'pharmacy' })));
    assert.deepEqual(names, ['City Chemist']);
});

await check('Quick Shop product search has no medicine', async () => {
    const { products } = await searchProducts({});
    assert.deepEqual(products.map((p) => p.name).sort(), ['Rice 5kg']);
    const { products: hits } = await searchProducts({ q: 'para' });
    assert.equal(hits.length, 0);
});

await check('public product list has no medicine', async () => {
    const { foods } = await listPublicFoods({});
    assert.deepEqual(foods.map((f) => f.name).sort(), ['Rice 5kg']);
});

void legacy;
await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
