/**
 * Master > Coupons: every service's coupons in one list, and pause from there.
 *
 * Run: node tests/coupon-list.smoke.mjs
 *
 * What this guards:
 *   - Food, Quick & Medical and Taxi coupons appear together with a readable
 *     discount, where they apply, and how far they have been used;
 *   - each coupon's state (live, scheduled, paused, used up, expired) is right,
 *     including a limit tightened by the Master promo ceiling;
 *   - pausing writes what each checkout reads (status 'paused' / active:false)
 *     and resuming undoes it; an expired coupon is not resumed;
 *   - permissions: each admin sees only services with Offers access, and
 *     view-only cannot pause.
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
process.env.MONGO_URI = mongod.getUri();
await mongoose.connect(process.env.MONGO_URI);

const coupons = await import('../src/core/promotions/couponList.service.js');
const resolver = await import('../src/core/config/resolver.service.js');
const { FoodOffer } = await import('../src/modules/food/admin/models/offer.model.js');
const { FoodOffer: QuickOffer } = await import('../src/modules/quickCommerce/modules/food/admin/models/offer.model.js');
const { PromoCode } = await import('../src/modules/taxi/admin/promotions/models/PromoCode.js');

const day = 24 * 60 * 60 * 1000;
const past = new Date(Date.now() - 10 * day);
const future = new Date(Date.now() + 10 * day);
const oid = () => new mongoose.Types.ObjectId();

const joy = oid();
const storeA = oid();
const storeB = oid();
await mongoose.connection.collection('food_restaurants').insertOne({ _id: joy, restaurantName: 'Joy' });
await mongoose.connection.collection('qc_restaurants').insertMany([
  { _id: storeA, restaurantName: 'Sharma Medical' },
  { _id: storeB, restaurantName: 'Daily Needs' },
]);

const f = {};
f.live = await FoodOffer.create({ couponCode: 'WELCOME50', discountType: 'flat-price', discountValue: 50, minOrderValue: 199, status: 'active', startDate: past, endDate: future, usedCount: 3, usageLimit: 100, createdAt: new Date(Date.now() - 5000) });
f.joy = await FoodOffer.create({ couponCode: 'JOY20', discountType: 'percentage', discountValue: 20, maxDiscount: 80, restaurantScope: 'selected', restaurantId: joy, customerScope: 'first-time', status: 'active', createdByRole: 'RESTAURANT', createdAt: new Date(Date.now() - 4000) });
f.expired = await FoodOffer.create({ couponCode: 'OLD10', discountType: 'percentage', discountValue: 10, status: 'inactive', startDate: new Date(Date.now() - 30 * day), endDate: past, createdAt: new Date(Date.now() - 3000) });
const q = {};
q.scheduled = await QuickOffer.create({ couponCode: 'MEDS15', discountType: 'percentage', discountValue: 15, restaurantScope: 'selected', restaurantIds: [storeA, storeB], status: 'active', startDate: future, createdAt: new Date(Date.now() - 2000) });
q.usedUp = await QuickOffer.create({ couponCode: 'FIRST100', discountType: 'flat-price', discountValue: 100, status: 'active', usedCount: 10, usageLimit: 10, createdAt: new Date(Date.now() - 1000) });
const t = await PromoCode.create({
  service_location_id: oid(), service_location_names: ['Palampur'], code: 'RIDE25', discount_percentage: 25,
  maximum_discount_amount: 60, from_date: past, to_date: future, uses_per_user: 2, max_uses_total: 0,
  usage_count: 4, active: true, audience_type: 'new_users', transport_type: 'taxi',
});

const owner = { _id: oid(), role: 'ADMIN', adminLevel: 'platform_superadmin' };
const sub = (services, permissions) => ({
  _id: oid(), role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', parentAdminId: owner._id,
  servicesAccess: services, permissions,
});
const byCode = async (admin = owner, query = {}) =>
  Object.fromEntries((await coupons.listCoupons(admin, query)).items.map((r) => [r.code, r]));

console.log('\nThe list');

await check('all three services in one list', async () => {
  const res = await coupons.listCoupons(owner, {});
  assert.equal(res.total, 6);
  assert.deepEqual(res.sources.map((s) => s.key), ['food', 'quick', 'taxi']);
});

await check('each coupon reads plainly', async () => {
  const c = await byCode();
  assert.equal(c.WELCOME50.discount, '₹50 off');
  assert.equal(c.WELCOME50.minOrder, 199);
  assert.equal(c.WELCOME50.where, 'All restaurants');
  assert.equal(c.JOY20.discount, '20% off up to ₹80');
  assert.equal(c.JOY20.where, 'Joy');
  assert.equal(c.JOY20.audience, 'First order only');
  assert.equal(c.JOY20.createdBy, 'restaurant');
  assert.equal(c.MEDS15.where, '2 stores');
  assert.equal(c.RIDE25.discount, '25% off up to ₹60');
  assert.equal(c.RIDE25.where, 'Palampur · taxi');
  assert.equal(c.RIDE25.audience, 'New users');
  assert.equal(c.RIDE25.perUser, 2);
});

await check('states are right', async () => {
  const c = await byCode();
  assert.equal(c.WELCOME50.state, 'live');
  assert.equal(c.JOY20.state, 'live');
  assert.equal(c.OLD10.state, 'expired');
  assert.equal(c.MEDS15.state, 'scheduled');
  assert.equal(c.FIRST100.state, 'used_up');
  assert.equal(c.RIDE25.state, 'live');
});

await check('counts and the state filter agree', async () => {
  const res = await coupons.listCoupons(owner, { state: 'live' });
  assert.deepEqual(res.counts, { live: 3, scheduled: 1, paused: 0, used_up: 1, expired: 1 });
  assert.deepEqual(res.items.map((r) => r.code).sort(), ['JOY20', 'RIDE25', 'WELCOME50']);
});

await check('search finds a code or a place', async () => {
  assert.deepEqual((await coupons.listCoupons(owner, { q: 'ride' })).items.map((r) => r.code), ['RIDE25']);
  assert.deepEqual((await coupons.listCoupons(owner, { q: 'joy' })).items.map((r) => r.code), ['JOY20']);
});

await check('a Master ceiling shows as the enforced limit', async () => {
  await resolver.set('promo.maxUsesTotal', { level: 'global', scopeId: '*', value: 3 });
  const c = await byCode();
  assert.equal(c.WELCOME50.limit, 3);
  assert.equal(c.WELCOME50.state, 'used_up');
  assert.equal(c.RIDE25.limit, 3);
  assert.equal(c.RIDE25.state, 'used_up');
  await resolver.set('promo.maxUsesTotal', { level: 'global', scopeId: '*', value: null });
  assert.equal((await byCode()).WELCOME50.state, 'live');
});

console.log('\nPausing');

await check('pausing a Food coupon writes what checkout reads', async () => {
  const row = await coupons.setCouponLive(owner, 'food', String(f.live._id), false);
  assert.equal(row.state, 'paused');
  assert.equal((await FoodOffer.findById(f.live._id).lean()).status, 'paused');
  await coupons.setCouponLive(owner, 'food', String(f.live._id), true);
  assert.equal((await FoodOffer.findById(f.live._id).lean()).status, 'active');
});

await check('pausing a Quick coupon, and resuming it', async () => {
  await coupons.setCouponLive(owner, 'quick', String(q.scheduled._id), false);
  assert.equal((await QuickOffer.findById(q.scheduled._id).lean()).status, 'paused');
  const row = await coupons.setCouponLive(owner, 'quick', String(q.scheduled._id), true);
  assert.equal(row.state, 'scheduled');
});

await check('Taxi pauses through its own toggle, and asking twice changes nothing', async () => {
  await coupons.setCouponLive(owner, 'taxi', String(t._id), false);
  assert.equal((await PromoCode.findById(t._id).lean()).active, false);
  await coupons.setCouponLive(owner, 'taxi', String(t._id), false);
  assert.equal((await PromoCode.findById(t._id).lean()).active, false);
  const row = await coupons.setCouponLive(owner, 'taxi', String(t._id), true);
  assert.equal(row.state, 'live');
});

await check('an expired coupon is not resumed', async () => {
  await assert.rejects(() => coupons.setCouponLive(owner, 'food', String(f.expired._id), true), /end date has passed/);
  assert.equal((await FoodOffer.findById(f.expired._id).lean()).status, 'inactive');
  await coupons.setCouponLive(owner, 'food', String(f.expired._id), false);
});

console.log('\nWho sees what');

await check('an offers sub-admin for Food sees and pauses only Food', async () => {
  const foodOffers = sub(['food'], ['promotions.write']);
  const res = await coupons.listCoupons(foodOffers, {});
  assert.deepEqual([...new Set(res.items.map((r) => r.source))], ['food']);
  await coupons.setCouponLive(foodOffers, 'food', String(f.joy._id), false);
  await assert.rejects(() => coupons.setCouponLive(foodOffers, 'taxi', String(t._id), false), /not change them/);
  await coupons.setCouponLive(owner, 'food', String(f.joy._id), true);
});

await check('view-only cannot pause', async () => {
  const viewer = sub(['taxi'], ['promotions.read']);
  assert.equal((await coupons.listCoupons(viewer, {})).total, 1);
  await assert.rejects(() => coupons.setCouponLive(viewer, 'taxi', String(t._id), false), /not change them/);
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll coupon list checks passed');
process.exit(failed ? 1 : 0);
