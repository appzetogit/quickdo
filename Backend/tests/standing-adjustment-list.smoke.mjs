/**
 * What the Global Price Adjustment page reports as currently applied.
 *
 * Run: node tests/standing-adjustment-list.smoke.mjs
 *
 * The page used to show only the run history -- what an admin ASKED for. That
 * disagrees with the menu whenever anything moved a price outside the adjuster
 * (a direct correction, a bulk reset, a migration; this platform has had all
 * three), and an admin who cannot see what is already standing applies another
 * percent on top of it. These figures are read from the dishes instead.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri();
await mongoose.connect(server.getUri(), { dbName: 'standing' });

const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { listStandingAdjustments, resolveStandingAdjustment } = await import('../src/modules/food/admin/services/priceAdjustment.service.js');

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

let phone = 7000000000;
const restaurant = async (name) => FoodRestaurant.create({
    restaurantName: name, ownerName: 'Owner', status: 'approved',
    email: `${name.replace(/\W/g, '')}@example.com`, phone: String(phone++),
});
const dish = async (r, fields) => FoodItem.create({
    restaurantId: r._id, name: `Dish ${Math.random().toString(36).slice(2, 7)}`,
    price: 100, basePrice: 100, approvalStatus: 'approved', ...fields,
});

const marked = await restaurant('Marked Up Kitchen');
const cut = await restaurant('Discount Diner');
const plain = await restaurant('Untouched Cafe');
const mixed = await restaurant('Half And Half');
const pending = await restaurant('Not Live Yet');

for (let i = 0; i < 3; i++) await dish(marked, { formulationMarkupPercent: 20, formulationDiscountPercent: 0 });
for (let i = 0; i < 2; i++) await dish(cut, { formulationMarkupPercent: 0, formulationDiscountPercent: 10 });
for (let i = 0; i < 2; i++) await dish(plain, {});
// Three dishes at 15%, one left behind at 0 -- the case an admin most needs to see.
for (let i = 0; i < 3; i++) await dish(mixed, { formulationMarkupPercent: 15 });
await dish(mixed, {});
await dish(pending, { formulationMarkupPercent: 40, approvalStatus: 'pending' });

const { standing } = await listStandingAdjustments();
const row = (name) => standing.find((r) => r.restaurantName === name);

console.log('\nwhat each menu carries');
await check('a marked-up menu reports its markup', () => {
    assert.equal(row('Marked Up Kitchen').markupPercent, 20);
    assert.equal(row('Marked Up Kitchen').discountPercent, 0);
    assert.equal(row('Marked Up Kitchen').totalItems, 3);
});
await check('a cut menu reports its discount', () => {
    assert.equal(row('Discount Diner').discountPercent, 10);
    assert.equal(row('Discount Diner').markupPercent, 0);
});
await check('a menu nothing has been applied to says so', () => {
    assert.equal(row('Untouched Cafe').isUntouched, true);
    assert.equal(row('Untouched Cafe').markupPercent, 0);
});

console.log('\nthe cases that mislead');
await check('THE POINT: a part-adjusted menu is flagged mixed, not reported as uniform', () => {
    const r = row('Half And Half');
    assert.equal(r.isMixed, true);
    assert.equal(r.markupPercent, 15, 'the majority formulation is the one reported');
    assert.equal(r.onThisFormulation, 3);
    assert.equal(r.totalItems, 4);
});
await check('a uniform menu is not flagged mixed', () => assert.equal(row('Marked Up Kitchen').isMixed, false));
await check('unapproved dishes are not read, so a pending menu is absent', () =>
    assert.equal(row('Not Live Yet'), undefined));

console.log('\nagreement with the figure a new dish inherits');
await check('the list matches resolveStandingAdjustment, restaurant by restaurant', async () => {
    for (const name of ['Marked Up Kitchen', 'Discount Diner', 'Half And Half']) {
        const listed = row(name);
        const inherited = await resolveStandingAdjustment(listed.restaurantId);
        assert.equal(listed.markupPercent, inherited.markupPercent, `${name} markup`);
        assert.equal(listed.discountPercent, inherited.discountPercent, `${name} discount`);
    }
});
await check('every restaurant with approved dishes appears exactly once', () => {
    const ids = standing.map((r) => r.restaurantId);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(standing.length, 4);
});
await check('listed alphabetically, so the same menu does not move between loads', () => {
    const names = standing.map((r) => r.restaurantName);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} FAILED\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
