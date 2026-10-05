/**
 * Zone sub-admins in Master: they change only their own zones' settings.
 *
 * Run: node tests/zone-admin-settings.smoke.mjs
 *
 * Drives the real guard on /v1/platform/settings (core/admin/zoneAdminSettings.js):
 *   - a sub-admin may save a zone value for their zone, with the permission;
 *   - not another zone, not module-wide or all-modules, not without permission,
 *     not a head-office-only setting;
 *   - "every zone" (no list) means every zone of their module, and no other;
 *   - an owner is not limited at all.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`); }
};

const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
const { FoodZone } = await import('../src/modules/food/admin/models/zone.model.js');
const { zoneSettingsWriteGuard, zoneAdminContext } = await import('../src/core/admin/zoneAdminSettings.js');

const oid = () => new mongoose.Types.ObjectId();
const owner = oid();
const [indore, bhopal] = [oid(), oid()];
await FoodZone.collection.insertMany([
  { _id: indore, name: 'Indore', isActive: true, coordinates: [] },
  { _id: bhopal, name: 'Bhopal', isActive: true, coordinates: [] },
]);
const makeAdmin = async (over) => {
  const _id = oid();
  await FoodAdmin.collection.insertOne({
    _id, name: 'Zone admin', email: `${_id}@t.test`, password: 'x', role: 'ADMIN',
    adminLevel: 'subadmin', admin_type: 'subadmin', parentAdminId: owner,
    servicesAccess: ['food'], permissions: ['zone_earnings.write'], food_zone_ids: [indore], ...over,
  });
  return String(_id);
};
await FoodAdmin.collection.insertOne({ _id: owner, name: 'Owner', email: 'o@t.test', password: 'x', role: 'ADMIN', adminLevel: 'platform_superadmin', permissions: ['*'] });

/** Runs the guard; returns 'next' or the refusal status + message. */
const attempt = (adminId, method, path, body = {}) => new Promise((resolve, reject) => {
  const req = { method, path, body, user: { userId: adminId } };
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(b) { resolve({ status: this.statusCode, message: b?.message }); return this; },
  };
  zoneSettingsWriteGuard(req, res, (err) => (err ? reject(err) : resolve('next')));
});
const put = (adminId, key, level, scopeId) => attempt(adminId, 'PUT', `/${key}`, { level, scopeId, value: 1 });

const zoneAdmin = await makeAdmin({});
const readOnly = await makeAdmin({ permissions: ['zone_earnings.read'] });
const everyZone = await makeAdmin({ food_zone_ids: [] });

console.log('\nWhat a zone sub-admin may save');
await check('their own zone, with permission: allowed', async () => {
  assert.equal(await put(zoneAdmin, 'earnings.formula', 'zone', String(indore)), 'next');
});
await check('another zone: refused', async () => {
  const r = await put(zoneAdmin, 'earnings.formula', 'zone', String(bhopal));
  assert.equal(r.status, 403); assert.match(r.message, /not one of yours/);
});
await check('module-wide and all-modules values: refused', async () => {
  assert.equal((await put(zoneAdmin, 'earnings.formula', 'vertical', 'food')).status, 403);
  assert.equal((await put(zoneAdmin, 'earnings.formula', 'global', '*')).status, 403);
});
await check('a section they were not given: refused', async () => {
  const r = await put(zoneAdmin, 'fees.platformFee', 'zone', String(indore));
  assert.equal(r.status, 403); assert.match(r.message, /permission/);
});
await check('View only: refused', async () => {
  assert.equal((await put(readOnly, 'earnings.formula', 'zone', String(indore))).status, 403);
});
await check('a head-office-only setting, or anything but a PUT: refused', async () => {
  assert.equal((await put(zoneAdmin, 'maintenance.enabled', 'zone', String(indore))).status, 403);
  assert.equal((await attempt(zoneAdmin, 'POST', '/cache/invalidate')).status, 403);
});
await check('reading is open (the page shows head-office values)', async () => {
  assert.equal(await attempt(zoneAdmin, 'GET', '/earnings.formula/explain'), 'next');
});

console.log('\nNo zone list = every zone of their modules, and no other');
await check('any food zone: allowed', async () => {
  assert.equal(await put(everyZone, 'earnings.formula', 'zone', String(bhopal)), 'next');
});
await check('a zone id that is not a food zone: refused', async () => {
  assert.equal((await put(everyZone, 'earnings.formula', 'zone', String(oid()))).status, 403);
});
await check('their zone list for a module they cannot open is empty', async () => {
  const ctx = await zoneAdminContext({ user: { userId: zoneAdmin } });
  assert.deepEqual(await ctx.zoneIdsFor('taxi'), []);
  assert.deepEqual(await ctx.zoneIdsFor('food'), [String(indore)]);
});

console.log('\nOwners');
await check('an owner is not limited', async () => {
  assert.equal(await put(String(owner), 'earnings.formula', 'global', '*'), 'next');
  assert.equal(await put(String(owner), 'fees.platformFee', 'vertical', 'food'), 'next');
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall zone admin checks passed');
process.exit(failed ? 1 : 0);
