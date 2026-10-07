/**
 * Quick commerce search suggestions, barcodes and vendor customer analytics
 * (plan §5.5, §5.6, §5.9).
 *
 * Run: node tests/qc-search-barcode.smoke.mjs
 *
 *  - suggestions prefix-match product, category and brand names and rank by
 *    how much was ordered; the same product from two stores is one suggestion;
 *  - recent searches are per customer, newest first, de-duplicated, clearable;
 *  - a barcode is stored normalised, a wrong check digit is refused, and the
 *    lookup finds the product from a scanned UPC or EAN form;
 *  - the vendor analytics name new, returning and repeat customers and the
 *    top customers by spend, with masked phone numbers.
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
        console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
    }
};

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri('qc_search_barcode'));

const BASE = '../src/modules/quickCommerce/modules/food';
const { FoodRestaurant } = await import(`${BASE}/restaurant/models/restaurant.model.js`);
const { FoodItem } = await import(`${BASE}/admin/models/food.model.js`);
const { FoodCategory } = await import(`${BASE}/admin/models/category.model.js`);
const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);
const { FoodUser } = await import('../src/modules/quickCommerce/core/users/user.model.js');
const qcSearch = await import(`${BASE}/search/services/suggest.service.js`);
const core = await import('../src/core/search/suggest.service.js');
const barcode = await import('../src/core/catalog/barcode.js');
const analytics = await import(`${BASE}/restaurant/services/restaurantAnalytics.service.js`);

const shopA = await FoodRestaurant.create({ restaurantName: 'Kirana A', ownerName: 'A', ownerPhone: '9000000401', status: 'approved', location: { type: 'Point', coordinates: [75.88, 22.72] } });
const shopB = await FoodRestaurant.create({ restaurantName: 'Kirana B', ownerName: 'B', ownerPhone: '9000000402', status: 'approved', location: { type: 'Point', coordinates: [75.88, 22.72] } });
const dairy = await FoodCategory.create({ name: 'Milk & Dairy', isActive: true, approvalStatus: 'approved' }).catch(() => FoodCategory.collection.insertOne({ name: 'Milk & Dairy', isActive: true }));
const mk = (shop, name, brand, extra = {}) => FoodItem.create({ restaurantId: shop._id, name, brand, price: 50, approvalStatus: 'approved', ...extra });
const amulA = await mk(shopA, 'Amul Milk 500ml', 'Amul');
await mk(shopB, 'Amul Milk 500ml', 'Amul');
const motherDairy = await mk(shopA, 'Mother Dairy Milk', 'Mother Dairy');
const milkBread = await mk(shopA, 'Milk Bread', 'Harvest');
await mk(shopA, 'Milkmaid Condensed', 'Nestle', { approvalStatus: 'pending' });

const customer = await FoodUser.create({ name: 'Ravi', phone: '9876504567' });
const repeatCust = await FoodUser.create({ name: 'Sita', phone: '9876505678' });
const order = (userId, itemId, name, qty, total, at = new Date(), status = 'delivered', restaurantId = shopA._id) => FoodOrder.collection.insertOne({
    userId, restaurantId, orderStatus: status, createdAt: at, updatedAt: at, customerName: 'x', customerPhone: '9876500000',
    items: [{ itemId: String(itemId), name, quantity: qty, price: 50, brand: '' }], pricing: { subtotal: total, total },
});
await order(customer._id, milkBread._id, 'Milk Bread', 9, 450);
await order(customer._id, motherDairy._id, 'Mother Dairy Milk', 2, 100);
await order(repeatCust._id, motherDairy._id, 'Mother Dairy Milk', 1, 50);
await order(repeatCust._id, motherDairy._id, 'Mother Dairy Milk', 1, 50);
await order(repeatCust._id, amulA._id, 'Amul Milk 500ml', 20, 1000, new Date(), 'cancelled_by_user');

console.log('\n[1] suggestions');

await check('prefix match on name, brand and category, ranked by units ordered', async () => {
    core.__clearPopularityCache();
    const out = await qcSearch.suggestQc({ q: 'mil', limit: 10 });
    const texts = out.suggestions.map((s) => `${s.type}:${s.text}`);
    assert.equal(texts[0], 'product:Milk Bread', texts.join(' | '));
    assert.equal(texts[1], 'product:Mother Dairy Milk', 'second by units (4)');
    assert.ok(texts.includes('category:Milk & Dairy'), texts.join(' | '));
    assert.ok(!texts.includes('product:Milkmaid Condensed'), 'unapproved products are not suggested');
    assert.equal(out.suggestions.filter((s) => s.text === 'Amul Milk 500ml').length, 1, 'one suggestion per product name');
});

await check('cancelled orders do not make a product popular; brands match by prefix', async () => {
    core.__clearPopularityCache();
    const out = await qcSearch.suggestQc({ q: 'amu' });
    const amul = out.suggestions.find((s) => s.type === 'product');
    assert.equal(amul.popularity, 0);
    assert.ok(out.suggestions.some((s) => s.type === 'brand' && s.text === 'Amul'));
});

await check('an empty query suggests nothing', async () => {
    assert.deepEqual((await qcSearch.suggestQc({ q: '  ' })).suggestions, []);
});

await check('recent searches: newest first, no duplicates, clearable', async () => {
    const uid = String(customer._id);
    await core.recordRecentSearch(uid, 'quickCommerce', 'milk');
    await core.recordRecentSearch(uid, 'quickCommerce', 'bread');
    await core.recordRecentSearch(uid, 'quickCommerce', 'MILK');
    const list = await core.listRecentSearches(uid, 'quickCommerce');
    assert.deepEqual(list.map((x) => x.term), ['MILK', 'bread']);
    const withUser = await qcSearch.suggestQc({ q: 'mi', userId: uid });
    assert.equal(withUser.recent.length, 2);
    await core.clearRecentSearches(uid, 'quickCommerce', 'bread');
    assert.deepEqual((await core.listRecentSearches(uid, 'quickCommerce')).map((x) => x.term), ['MILK']);
    await core.clearRecentSearches(uid, 'quickCommerce');
    assert.deepEqual(await core.listRecentSearches(uid, 'quickCommerce'), []);
});

console.log('\n[2] barcodes');

await check('stored normalised; a wrong check digit is refused', async () => {
    assert.equal(barcode.normalizeBarcode(' 4006-3813 33931 '), '4006381333931');
    assert.throws(() => barcode.normalizeBarcode('4006381333932'), /check digit/);
    assert.equal(barcode.normalizeBarcode('ABC-1234'), 'ABC1234');
    assert.equal(barcode.normalizeBarcode(''), '');
});

await check('the lookup finds the product in every live store, from EAN or UPC form', async () => {
    await FoodItem.updateMany({ name: 'Amul Milk 500ml' }, { $set: { barcode: '0012345678905' } });
    const byEan = await qcSearch.findProductsByBarcode('0012345678905');
    assert.equal(byEan.products.length, 2);
    assert.deepEqual(byEan.products.map((p) => p.store.name).sort(), ['Kirana A', 'Kirana B']);
    const byUpc = await qcSearch.findProductsByBarcode('012345678905');
    assert.equal(byUpc.products.length, 2, 'a 12-digit UPC scan finds the 13-digit EAN');
    const none = await qcSearch.findProductsByBarcode('9999999999994');
    assert.equal(none.products.length, 0);
});

await check('a store that is not approved is not offered', async () => {
    await FoodRestaurant.updateOne({ _id: shopB._id }, { $set: { status: 'rejected' } });
    const r = await qcSearch.findProductsByBarcode('0012345678905');
    assert.equal(r.products.length, 1);
});

console.log('\n[3] vendor customer analytics');

await check('new, returning and repeat customers, and top customers by spend', async () => {
    const old = new Date(Date.now() - 60 * 86400000);
    await order(customer._id, milkBread._id, 'Milk Bread', 1, 50, old);
    const out = await analytics.getRestaurantAnalytics(String(shopA._id), {});
    assert.equal(out.totalCustomers, 2);
    assert.equal(out.returningCustomers, 1, 'Ravi ordered before the window');
    assert.equal(out.newCustomers, 1);
    assert.equal(out.repeatCustomers, 2, 'both ordered twice in the window');
    assert.equal(out.topCustomers[0].name, 'Ravi');
    assert.equal(out.topCustomers[0].spend, 550);
    assert.equal(out.topCustomers[0].orders, 2);
    assert.equal(out.topCustomers[0].isNew, false);
    assert.equal(out.topCustomers[1].isNew, true);
    assert.equal(out.topCustomers[0].phone, '******4567');
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
