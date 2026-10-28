/**
 * The admin's outlet switch actually takes a restaurant off the platform.
 *
 * Run: node tests/outlet-toggle.smoke.mjs
 *
 * The restaurants list had an "Active/Inactive" state read from `isActive`, a
 * field the restaurant record has never had: every outlet therefore showed as
 * active whatever its real state, and the only control on the page routed
 * through the APPROVAL endpoint -- pausing a kitchen for the evening stamped it
 * rejected with a reason of "Disabled by admin".
 *
 * The switch now writes isAcceptingOrders, which is what the order path reads.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri();
await mongoose.connect(server.getUri(), { dbName: 'outlet_toggle' });

const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const admin = await import('../src/modules/food/admin/services/admin.service.js');

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

const outlet = await FoodRestaurant.create({
    restaurantName: 'Corner Kitchen', ownerName: 'Owner', status: 'approved',
    email: `corner${Date.now()}@example.com`, phone: `9${String(Date.now()).slice(-9)}`,
});
const stored = async () => FoodRestaurant.findById(outlet._id).lean();
const listed = async () => {
    const { restaurants } = await admin.getRestaurants({ limit: 50 });
    return restaurants.find((r) => String(r._id) === String(outlet._id));
};

console.log('\nswitching the outlet off');
await admin.updateRestaurantById(String(outlet._id), { isAcceptingOrders: false });
await check('it is stored as not accepting orders', async () =>
    assert.equal((await stored()).isAcceptingOrders, false));
await check('THE BUG: its approval is untouched -- pausing is not banning', async () => {
    const doc = await stored();
    assert.equal(doc.status, 'approved');
    assert.ok(!doc.rejectionReason, `rejectionReason: ${doc.rejectionReason}`);
    assert.equal(doc.rejectedAt, undefined);
});
await check('THE BUG: the admin list reports the real state, not "active" for everything', async () => {
    const row = await listed();
    assert.ok(row, 'the outlet is missing from the list');
    assert.equal(row.isAcceptingOrders, false, 'the list still cannot see the switch');
});

console.log('\nwhat a customer gets while it is off');
await check('order placement refuses it', async () => {
    const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
    assert.ok(FoodOrder, 'order model missing');
    const source = await import('node:fs').then((fs) =>
        fs.readFileSync('src/modules/food/orders/services/order.service.js', 'utf8'));
    // The guard the switch relies on. Asserted rather than assumed: if it is
    // ever removed, this switch becomes decorative and this test must fail.
    assert.match(source, /isAcceptingOrders === false/);
});

console.log('\nswitching it back on');
await admin.updateRestaurantById(String(outlet._id), { isAcceptingOrders: true });
await check('it takes orders again', async () => assert.equal((await stored()).isAcceptingOrders, true));
await check('and the list agrees', async () => assert.equal((await listed()).isAcceptingOrders, true));

console.log('\na restaurant nobody has touched');
const fresh = await FoodRestaurant.create({
    restaurantName: 'Brand New', ownerName: 'Owner', status: 'approved',
    email: `new${Date.now()}@example.com`, phone: `8${String(Date.now()).slice(-9)}`,
});
await check('defaults to taking orders, so onboarding does not leave it dark', async () => {
    const doc = await FoodRestaurant.findById(fresh._id).lean();
    assert.notEqual(doc.isAcceptingOrders, false);
});

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} FAILED\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
