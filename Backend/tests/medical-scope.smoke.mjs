/**
 * The Medical panel shows pharmacies and nothing else.
 *
 * Run: node tests/medical-scope.smoke.mjs
 *
 * Medical is the quick-commerce admin pointed at sellers whose storeType is
 * 'pharmacy'. Everything hangs off that one filter, so it has to hold in both
 * directions -- no grocery seller, product or order may appear under Medical,
 * and nothing may disappear from the unscoped quick-commerce lists -- and it
 * has to survive being combined with the filters the screens already send
 * (a named seller, a zone).
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri();
await mongoose.connect(server.getUri(), { dbName: 'medical_scope' });

const { FoodRestaurant } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');
const { FoodItem } = await import('../src/modules/quickCommerce/modules/food/admin/models/food.model.js');
const { FoodOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const { FoodZone } = await import('../src/modules/quickCommerce/modules/food/admin/models/zone.model.js');
const admin = await import('../src/modules/quickCommerce/modules/food/admin/services/admin.service.js');
const orders = await import('../src/modules/quickCommerce/modules/food/orders/services/order.service.js');
const { applySellerScope, normalizeStoreTypeFilter } = await import('../src/modules/quickCommerce/modules/food/shared/storeScope.js');

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

// A real polygon: the zone model refuses anything with fewer than 3 points.
const zone = await FoodZone.create({
    name: 'Indore', isActive: true,
    coordinates: [{ latitude: 22.70, longitude: 75.85 }, { latitude: 22.80, longitude: 75.85 }, { latitude: 22.80, longitude: 75.95 }, { latitude: 22.70, longitude: 75.95 }],
});
let phone = 8000000000;
const seller = async (name, storeType, zoneId = zone._id) => FoodRestaurant.create({
    restaurantName: name, ownerName: 'Owner', status: 'approved', storeType, zoneId,
    email: `${name.replace(/\W/g, '')}@example.com`, phone: String(phone++),
});
const pharmacy = await seller('City Chemist', 'pharmacy');
const otherPharmacy = await seller('Night Chemist', 'pharmacy');
const grocery = await seller('Corner Kirana', 'kirana');
const legacy = await FoodRestaurant.create({
    restaurantName: 'Old Shop', ownerName: 'Owner', status: 'approved',
    email: 'old@example.com', phone: String(phone++),
});

const product = async (r, name) => FoodItem.create({
    restaurantId: r._id, name, price: 50, basePrice: 50, approvalStatus: 'approved',
});
await product(pharmacy, 'Paracetamol');
await product(grocery, 'Rice 5kg');

let orderSeq = 0;
// Inserted raw: the order schema demands a full delivery address and payment
// block that say nothing about what is being tested here.
const order = async (r) => FoodOrder.collection.insertOne({
    _id: new mongoose.Types.ObjectId(),
    order_id: `QC-${++orderSeq}`, restaurantId: r._id, userId: new mongoose.Types.ObjectId(),
    items: [{ name: 'Thing', quantity: 1, price: 50 }],
    pricing: { subtotal: 50, total: 50 }, orderStatus: 'delivered',
    payment: { method: 'cash', status: 'paid' },
    createdAt: new Date(), updatedAt: new Date(),
});
await order(pharmacy);
await order(grocery);

const names = (result) => (result?.restaurants || result?.data || result?.items || []).map((r) => r.restaurantName || r.name);

console.log('\nthe sellers list');
const allSellers = await admin.getRestaurants({ limit: 100 });
const medicalSellers = await admin.getRestaurants({ limit: 100, storeType: 'pharmacy' });
await check('unscoped, every shop is still listed', () => {
    assert.equal(names(allSellers).length, 4, `saw ${names(allSellers).join(', ')}`);
});
await check('THE POINT: scoped to pharmacy, only the two chemists', () => {
    assert.deepEqual(names(medicalSellers).sort(), ['City Chemist', 'Night Chemist']);
});
await check('a seller saved before store types existed is not swept in', () => {
    assert.ok(!names(medicalSellers).includes('Old Shop'));
});

console.log('\nthe products list');
const medicalProducts = await admin.getFoods({ limit: 100, storeType: 'pharmacy' });
const allProducts = await admin.getFoods({ limit: 100 });
await check('scoped: the chemist\'s medicine, not the kirana\'s rice', () => {
    assert.deepEqual((medicalProducts.foods || []).map((f) => f.name), ['Paracetamol']);
});
await check('unscoped: both', () => assert.equal((allProducts.foods || []).length, 2));

console.log('\nthe orders list');
const medicalOrders = await orders.listOrdersAdmin({ limit: 100, storeType: 'pharmacy' });
const rows = (r) => r.orders || r.data || r.items || [];
await check('scoped to the pharmacy\'s order', () => {
    assert.equal(rows(medicalOrders).length, 1);
    assert.equal(String(rows(medicalOrders)[0].restaurantId?._id || rows(medicalOrders)[0].restaurantId), String(pharmacy._id));
});
await check('unscoped, both orders are still there', async () => {
    assert.equal(rows(await orders.listOrdersAdmin({ limit: 100 })).length, 2);
});

console.log('\ncombined with the filters the screens already send');
await check('THE LEAK IT PREVENTS: Medical + a grocery seller returns nothing, not that seller', async () => {
    const result = await orders.listOrdersAdmin({ limit: 100, storeType: 'pharmacy', restaurantId: String(grocery._id) });
    assert.equal(rows(result).length, 0);
});
await check('Medical + the pharmacy itself still returns its order', async () => {
    const result = await orders.listOrdersAdmin({ limit: 100, storeType: 'pharmacy', restaurantId: String(pharmacy._id) });
    assert.equal(rows(result).length, 1);
});
await check('Medical + a zone shows the pharmacies in it, not every shop in it', async () => {
    const result = await orders.listOrdersAdmin({ limit: 100, storeType: 'pharmacy', zoneId: String(zone._id) });
    assert.equal(rows(result).length, 1);
    assert.equal(String(rows(result)[0].restaurantId?._id || rows(result)[0].restaurantId), String(pharmacy._id));
});

console.log('\nthe filter itself');
await check('an unknown type is refused, never ignored', () => {
    assert.throws(() => normalizeStoreTypeFilter('pharmacies'), /Unknown store type/);
});
await check('absent or "all" means no scope', () => {
    assert.equal(normalizeStoreTypeFilter(undefined), null);
    assert.equal(normalizeStoreTypeFilter('all'), null);
});
await check('a type no shop has yet narrows to nothing, not to everything', () => {
    const filter = {};
    applySellerScope(filter, []);
    assert.deepEqual(filter.restaurantId, { $in: [] });
});

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} FAILED\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
