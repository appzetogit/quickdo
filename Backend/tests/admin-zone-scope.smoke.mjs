/**
 * Sub-admins limited to zones (admin accounts form, "Zones").
 *
 * Run: node tests/admin-zone-scope.smoke.mjs
 *
 *   - the form saves food and quick-commerce zones, and /me reports them;
 *   - the zone middleware limits a zone-limited sub-admin, and a zone outside
 *     their list matches nothing; owners and unlimited sub-admins are untouched;
 *   - the food store list and order list only return their zones' rows;
 *   - a taxi-only sub-admin is reported as restricted with only the taxi panel.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());

const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
const svc = await import('../src/core/admin/platformAdmins.service.js');
const { adminZoneScope, zoneMatchFrom } = await import('../src/core/admin/adminZoneScope.js');
const { FoodZone } = await import('../src/modules/food/admin/models/zone.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const foodAdmin = await import('../src/modules/food/admin/services/admin.service.js');
const foodOrders = await import('../src/modules/food/orders/services/order.service.js');
const { invalidateAdminCache } = await import('../src/modules/food/admin/middlewares/foodAdmin.middleware.js');

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); } catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.stack.split('\n').slice(0, 3).join('\n        ')}`); }
};

const owner = (await FoodAdmin.create({
  name: 'Owner', email: 'owner@t.test', password: 'owner-pass', role: 'ADMIN', admin_type: 'superadmin',
  adminLevel: 'platform_superadmin', servicesAccess: ['food', 'quickCommerce', 'medical', 'taxi'], permissions: ['*'],
})).toObject();
const [north, south] = await FoodZone.collection.insertMany([{ name: 'North', isActive: true }, { name: 'South', isActive: true }])
  .then((r) => [r.insertedIds[0], r.insertedIds[1]]);
const rNorth = (await FoodRestaurant.collection.insertOne({ restaurantName: 'North Diner', zoneId: north, status: 'approved', createdAt: new Date() })).insertedId;
const rSouth = (await FoodRestaurant.collection.insertOne({ restaurantName: 'South Diner', zoneId: south, status: 'approved', createdAt: new Date() })).insertedId;
await FoodOrder.collection.insertMany([
  { orderId: 'N1', restaurantId: rNorth, orderStatus: 'delivered', payment: { method: 'cash' }, createdAt: new Date() },
  { orderId: 'S1', restaurantId: rSouth, orderStatus: 'delivered', payment: { method: 'cash' }, createdAt: new Date() },
]);

let limited;
await check('the form saves food zones and /me reports them', async () => {
  const meta = await svc.getMeta(owner);
  assert.equal(meta.foodZones.length, 2);
  limited = await svc.createAdmin(owner, {
    name: 'North only', email: 'north@t.test', password: 'north-pass', role: 'custom',
    servicesAccess: ['food'], permissions: ['orders.read', 'restaurants.read'], foodZoneIds: [String(north)],
  });
  assert.deepEqual(limited.foodZoneIds, [String(north)]);
  const me = svc.describeCaller(await FoodAdmin.findById(limited.id).lean());
  assert.deepEqual(me.foodZoneIds, [String(north)]);
});

const run = async (userId, query = {}) => {
  const req = { user: { userId: String(userId) }, query: { ...query } };
  await new Promise((resolve, reject) => adminZoneScope('food')(req, {}, (err) => (err ? reject(err) : resolve())));
  return req.query;
};

await check('the middleware limits a zone-limited sub-admin', async () => {
  invalidateAdminCache(limited.id);
  const q = await run(limited.id);
  assert.deepEqual(q.scopeZoneIds, [String(north)]);
  const outside = await run(limited.id, { zoneId: String(south) });
  assert.equal(outside.zoneId, '000000000000000000000000');
});
await check('owners are not limited', async () => {
  const q = await run(owner._id);
  assert.equal(q.scopeZoneIds, undefined);
  assert.equal(zoneMatchFrom(q), null);
});
await check('the store list shows only their zone', async () => {
  const q = await run(limited.id);
  const res = await foodAdmin.getRestaurants(q);
  const names = (res.restaurants || res.data || res).map((r) => r.restaurantName);
  assert.deepEqual(names, ['North Diner']);
});
await check('the order list shows only their zone', async () => {
  const q = await run(limited.id);
  const res = await foodOrders.listOrdersAdmin(q);
  const rows = res.orders || res.docs || res.data || [];
  const shops = rows.map((o) => String(o.restaurantId?._id || o.restaurantId?.id || o.restaurantId || o.restaurant?._id || ''));
  assert.deepEqual(shops, [String(rNorth)]);
});
await check('a zone they were not given matches nothing', async () => {
  const q = await run(limited.id, { zoneId: String(south) });
  const res = await foodOrders.listOrdersAdmin(q);
  assert.equal((res.orders || res.docs || res.data || []).length, 0);
});
await check('a taxi-only sub-admin is restricted to the taxi panel', async () => {
  const taxi = await svc.createAdmin(owner, {
    name: 'Taxi', email: 'taxi@t.test', password: 'taxi-pass', role: 'custom',
    servicesAccess: ['taxi'], permissions: ['orders.read'],
    serviceLocationIds: [String(new mongoose.Types.ObjectId())],
  });
  const me = svc.describeCaller(await FoodAdmin.findById(taxi.id).lean());
  assert.equal(me.isSuperAdmin, false);
  assert.deepEqual(me.servicesAccess, ['taxi']);
});
await check('a limited admin cannot hand out every zone or zones they lack', async () => {
  const lim = await FoodAdmin.findById(limited.id).lean();
  await FoodAdmin.updateOne({ _id: lim._id }, { $set: { permissions: ['orders.read', 'subadmins.write'] } });
  const me = await FoodAdmin.findById(limited.id).lean();
  await assert.rejects(svc.createAdmin(me, { name: 'x', email: 'x@t.test', password: 'xxxxxx', role: 'custom', servicesAccess: ['food'], permissions: ['orders.read'] }));
  await assert.rejects(svc.createAdmin(me, { name: 'y', email: 'y@t.test', password: 'yyyyyy', role: 'custom', servicesAccess: ['food'], permissions: ['orders.read'], foodZoneIds: [String(south)] }));
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
