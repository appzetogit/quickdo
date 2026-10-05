/**
 * My Orders: one list of the customer's orders from every service.
 *
 * Run: node tests/my-orders.smoke.mjs
 *
 * What this guards:
 *   - Food, Quick, Medical, rides, parcel and Services bookings appear in one
 *     newest-first list, each with the route of its own detail screen;
 *   - Quick and Services orders are found through the customer's own rows in
 *     those services (platformUserId, else the same phone);
 *   - nobody else's orders appear; abandoned unpaid checkouts do not appear;
 *   - ongoing / past and per-service filters, and paging with nextBefore.
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

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri());
const db = mongoose.connection;
const { listMyOrders } = await import('../src/core/orders/myOrders.service.js');

const oid = () => new mongoose.Types.ObjectId();
const minsAgo = (m) => new Date(Date.now() - m * 60_000);

const asha = oid();
const other = oid();
await db.collection('users').insertMany([{ _id: asha, phone: '9876543210' }, { _id: other, phone: '9000000000' }]);
const ashaQuick = oid();
const ashaQuickByPhone = oid();
const ashaSp = oid();
await db.collection('qc_users').insertMany([
  { _id: ashaQuick, platformUserId: asha, phone: '9876543210' },
  { _id: ashaQuickByPhone, phone: '+91 9876543210' },
]);
await db.collection('sp_users').insertOne({ _id: ashaSp, platformUserId: asha });

const joy = oid();
const grocer = oid();
const chemist = oid();
await db.collection('food_restaurants').insertOne({ _id: joy, restaurantName: 'Joy' });
await db.collection('qc_restaurants').insertMany([
  { _id: grocer, restaurantName: 'Daily Needs', storeType: 'grocery' },
  { _id: chemist, restaurantName: 'Sharma Medical', storeType: 'pharmacy' },
]);

const food1 = oid();
await db.collection('food_orders').insertMany([
  { _id: food1, userId: asha, restaurantId: joy, order_id: 'FOD-1', orderStatus: 'delivered', items: [{ name: 'Paneer Tikka', quantity: 2 }, { name: 'Naan', quantity: 4 }], pricing: { total: 520 }, createdAt: minsAgo(60) },
  { _id: oid(), userId: asha, restaurantId: joy, order_id: 'FOD-2', orderStatus: 'pending_payment', items: [], pricing: { total: 100 }, createdAt: minsAgo(55) },
  { _id: oid(), userId: asha, restaurantId: joy, order_id: 'FOD-3', orderStatus: 'cancelled_by_restaurant', items: [{ name: 'Dal', quantity: 1 }], pricing: { total: 180 }, createdAt: minsAgo(50) },
  { _id: oid(), userId: other, restaurantId: joy, order_id: 'FOD-X', orderStatus: 'delivered', items: [], pricing: { total: 999 }, createdAt: minsAgo(5) },
]);
const med = oid();
await db.collection('qc_orders').insertMany([
  { _id: oid(), userId: ashaQuick, restaurantId: grocer, order_id: 'QC-1', orderStatus: 'picked_up', items: [{ name: 'Milk', quantity: 1 }], pricing: { total: 60 }, createdAt: minsAgo(30) },
  { _id: med, userId: ashaQuickByPhone, restaurantId: chemist, order_id: 'MED-1', orderStatus: 'confirmed', items: [{ name: 'Paracetamol', quantity: 1 }], pricing: { total: 45 }, createdAt: minsAgo(20) },
]);
const ride = oid();
await db.collection('taxirides').insertMany([
  { _id: ride, userId: asha, serviceType: 'ride', status: 'completed', pickupAddress: 'Bus Stand, Palampur', dropAddress: 'Tea Garden, Palampur', fare: 113, createdAt: minsAgo(40) },
  { _id: oid(), userId: asha, serviceType: 'parcel', status: 'accepted', pickupAddress: 'Home', dropAddress: 'Office, Dharamshala', fare: 80, createdAt: minsAgo(10) },
  { _id: oid(), userId: other, serviceType: 'ride', status: 'completed', fare: 999, createdAt: minsAgo(2) },
]);
await db.collection('sp_bookings').insertOne({
  _id: oid(), userId: ashaSp, bookingNumber: 'BK-7', serviceName: 'AC repair', status: 'confirmed', userPayableAmount: 499,
  scheduledDate: new Date(), timeSlot: { start: '10:00' }, createdAt: minsAgo(1),
});

const all = await listMyOrders(String(asha), {});

console.log('\nOne list');
await check('every service, newest first, nobody else\'s, no unpaid checkout', async () => {
  assert.deepEqual(all.items.map((i) => i.number), ['BK-7', all.items[1].number, 'MED-1', 'QC-1', all.items[4].number, 'FOD-3', 'FOD-1']);
  assert.deepEqual(all.items.map((i) => i.service), ['services', 'parcel', 'medical', 'quick', 'taxi', 'food', 'food']);
  assert.ok(!all.items.some((i) => i.number === 'FOD-2' || i.number === 'FOD-X'));
});
await check('each row names what it was and opens its own detail screen', async () => {
  const by = Object.fromEntries(all.items.map((i) => [i.service, i]));
  assert.equal(by.food.title, 'Joy');
  assert.equal(all.items.find((i) => i.number === 'FOD-1').subtitle, '2 × Paneer Tikka, +1 more');
  assert.equal(all.items.find((i) => i.number === 'FOD-1').route, `/food/orders/${food1}`);
  assert.equal(by.medical.title, 'Sharma Medical');
  assert.equal(by.medical.route, `/qc/order/${med}`);
  assert.equal(by.taxi.title, 'Ride to Tea Garden');
  assert.equal(by.taxi.subtitle, 'Bus Stand → Tea Garden');
  assert.equal(by.taxi.route, `/taxi/rides/${ride}`);
  assert.equal(by.parcel.title, 'Parcel to Office');
  assert.equal(by.services.title, 'AC repair');
  assert.match(by.services.subtitle, /^For .*, 10:00$/);
  assert.equal(by.services.amount, 499);
});
await check('states and labels', async () => {
  const s = Object.fromEntries(all.items.map((i) => [i.number, [i.state, i.statusLabel]]));
  assert.deepEqual(s['FOD-1'], ['completed', 'Delivered']);
  assert.deepEqual(s['FOD-3'], ['cancelled', 'Cancelled']);
  assert.deepEqual(s['QC-1'], ['ongoing', 'On the way']);
  assert.deepEqual(s['MED-1'], ['ongoing', 'Accepted']);
  assert.equal(all.ongoingCount, 4);
});

console.log('\nFilters and paging');
await check('ongoing only, and past only', async () => {
  const on = await listMyOrders(String(asha), { state: 'ongoing' });
  assert.deepEqual(on.items.map((i) => i.number).sort(), ['BK-7', 'MED-1', 'QC-1', on.items.find((i) => i.service === 'parcel').number].sort());
  const past = await listMyOrders(String(asha), { state: 'past' });
  assert.deepEqual(past.items.map((i) => i.state).sort(), ['cancelled', 'completed', 'completed']);
});
await check('one service at a time', async () => {
  assert.deepEqual((await listMyOrders(String(asha), { service: 'medical' })).items.map((i) => i.number), ['MED-1']);
  assert.deepEqual((await listMyOrders(String(asha), { service: 'food' })).items.map((i) => i.number), ['FOD-3', 'FOD-1']);
});
await check('paging with nextBefore walks the whole list once', async () => {
  const seen = [];
  let before;
  for (let i = 0; i < 10; i += 1) {
    const page = await listMyOrders(String(asha), { limit: 3, before });
    seen.push(...page.items.map((x) => x.key));
    if (!page.nextBefore) break;
    before = page.nextBefore;
  }
  assert.deepEqual(seen, all.items.map((x) => x.key));
});
await check('a customer with no orders gets an empty list', async () => {
  const lonely = oid();
  await db.collection('users').insertOne({ _id: lonely, phone: '9111111111' });
  const r = await listMyOrders(String(lonely), {});
  assert.deepEqual(r.items, []);
  assert.equal(r.nextBefore, null);
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll my-orders checks passed');
process.exit(failed ? 1 : 0);
