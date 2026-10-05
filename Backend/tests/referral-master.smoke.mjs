/**
 * Master > Referral: one set of referral amounts for Food, Quick & Medical and Taxi.
 *
 * Run: node tests/referral-master.smoke.mjs
 *
 * What this guards:
 *   - with nothing set in Master, every service pays exactly what its own
 *     screen says (this reaches wallet-crediting code; a new screen must not
 *     move money until someone saves on it);
 *   - a global amount reaches all three services; a per-service value beats it;
 *   - Taxi keeps its own rules (programme type, rides first) and only takes the
 *     amount, with 0 switching its programme off;
 *   - clearing a Master value hands the number back to the service;
 *   - the apps' "invite and earn" figure is the one actually paid.
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

const referral = await import('../src/core/referral/referralSettings.service.js');
const resolver = await import('../src/core/config/resolver.service.js');
const { FoodReferralSettings } = await import('../src/modules/food/admin/models/referralSettings.model.js');
const { FoodReferralSettings: QuickReferralSettings } = await import('../src/modules/quickCommerce/modules/food/admin/models/referralSettings.model.js');
const { AdminBusinessSetting } = await import('../src/modules/taxi/admin/models/AdminBusinessSetting.js');
const { getUserReferralStats } = await import('../src/modules/food/user/services/userReferral.service.js');

// Each service's own settings, as its admin screen saved them.
await FoodReferralSettings.create({ referralRewardUser: 20, referralLimitUser: 5, referralRewardDelivery: 70, referralLimitDelivery: 2, isActive: true });
await QuickReferralSettings.create({ referralRewardUser: 30, referralLimitUser: 3, referralRewardDelivery: 80, referralLimitDelivery: 4, isActive: true, referralLinkUser: 'https://x/?ref={code}' });
await AdminBusinessSetting.create({
  scope: 'default',
  referral: {
    user: { enabled: true, type: 'conditional_referrer', amount: 40, ride_count: 2 },
    driver: { enabled: false, type: 'instant_referrer', amount: 0, ride_count: 0, milestone_program_enabled: true },
  },
});
const taxiOwn = async () => (await AdminBusinessSetting.findOne({ scope: 'default' }).lean()).referral;

const setMaster = (key, value, vertical = null) =>
  resolver.set(key, vertical ? { level: 'vertical', scopeId: vertical, value } : { level: 'global', scopeId: '*', value });

console.log('\nNothing set in Master');

await check('Food, Quick and Taxi pay what their own screens say', async () => {
  const food = await referral.referralSettingsFor('food', FoodReferralSettings);
  assert.equal(food.referralRewardUser, 20);
  assert.equal(food.referralLimitUser, 5);
  assert.equal(food.referralRewardDelivery, 70);
  const quick = await referral.referralSettingsFor('quickCommerce', QuickReferralSettings);
  assert.equal(quick.referralRewardUser, 30);
  assert.equal(quick.referralLinkUser, 'https://x/?ref={code}');
  const taxi = await taxiOwn();
  assert.deepEqual(await referral.taxiReferralFor('user', taxi.user), taxi.user);
  assert.deepEqual(await referral.taxiReferralFor('driver', taxi.driver), taxi.driver);
});

await check('the app shows the food amount from the food screen', async () => {
  const uid = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('users').insertOne({ _id: uid, phone: '9111111111', referralCount: 1 });
  assert.equal((await getUserReferralStats(String(uid))).rewardAmount, 20);
});

console.log('\nSet once for everyone');

await check('a global customer reward reaches all three services', async () => {
  await setMaster('referral.customerReward', 50);
  assert.equal((await referral.referralSettingsFor('food', FoodReferralSettings)).referralRewardUser, 50);
  assert.equal((await referral.referralSettingsFor('quickCommerce', QuickReferralSettings)).referralRewardUser, 50);
  const taxiUser = await referral.taxiReferralFor('user', (await taxiOwn()).user);
  assert.equal(taxiUser.amount, 50);
  assert.equal(taxiUser.enabled, true);
});

await check('what is not set in Master stays the service\'s own', async () => {
  const food = await referral.referralSettingsFor('food', FoodReferralSettings);
  assert.equal(food.referralLimitUser, 5);
  assert.equal(food.referralRewardDelivery, 70);
  const taxiDriver = await referral.taxiReferralFor('driver', (await taxiOwn()).driver);
  assert.equal(taxiDriver.enabled, false);
});

await check('Taxi keeps its own rules and only takes the amount', async () => {
  const taxiUser = await referral.taxiReferralFor('user', (await taxiOwn()).user);
  assert.equal(taxiUser.type, 'conditional_referrer');
  assert.equal(taxiUser.ride_count, 2);
});

await check('the app shows the Master amount, which is what is paid', async () => {
  const uid = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('users').insertOne({ _id: uid, phone: '9222222222' });
  assert.equal((await getUserReferralStats(String(uid))).rewardAmount, 50);
});

console.log('\nPer-service overrides');

await check('a per-service value beats the global one, for that service only', async () => {
  await setMaster('referral.customerReward', 25, 'quickCommerce');
  assert.equal((await referral.referralSettingsFor('quickCommerce', QuickReferralSettings)).referralRewardUser, 25);
  assert.equal((await referral.referralSettingsFor('food', FoodReferralSettings)).referralRewardUser, 50);
});

await check('0 for Taxi switches its referral programme off', async () => {
  await setMaster('referral.customerReward', 0, 'taxi');
  const taxiUser = await referral.taxiReferralFor('user', (await taxiOwn()).user);
  assert.equal(taxiUser.amount, 0);
  assert.equal(taxiUser.enabled, false);
});

await check('a rider/driver reward switches Taxi drivers on and pays Food riders', async () => {
  await setMaster('referral.partnerReward', 100);
  await setMaster('referral.partnerLimit', 10);
  const taxiDriver = await referral.taxiReferralFor('driver', (await taxiOwn()).driver);
  assert.equal(taxiDriver.amount, 100);
  assert.equal(taxiDriver.enabled, true);
  assert.equal(taxiDriver.milestone_program_enabled, true);
  const food = await referral.referralSettingsFor('food', FoodReferralSettings);
  assert.equal(food.referralRewardDelivery, 100);
  assert.equal(food.referralLimitDelivery, 10);
});

await check('the overview says where each number comes from', async () => {
  const { services } = await referral.referralOverview();
  const by = Object.fromEntries(services.map((s) => [s.vertical, s]));
  assert.deepEqual(by.food.customerReward, { value: 50, from: 'master' });
  assert.deepEqual(by.food.customerLimit, { value: 5, from: 'service' });
  assert.deepEqual(by.quickCommerce.customerReward, { value: 25, from: 'master' });
  assert.deepEqual(by.taxi.customerReward, { value: 0, from: 'master' });
  assert.deepEqual(by.taxi.partnerLimit, { value: null, from: 'none' });
  assert.equal(by.taxi.afterRides.user, 2);
});

console.log('\nClearing');

await check('clearing Master hands every number back to the services', async () => {
  for (const key of ['referral.customerReward', 'referral.partnerReward', 'referral.partnerLimit']) await setMaster(key, null);
  await setMaster('referral.customerReward', null, 'quickCommerce');
  await setMaster('referral.customerReward', null, 'taxi');
  assert.equal((await referral.referralSettingsFor('food', FoodReferralSettings)).referralRewardUser, 20);
  assert.equal((await referral.referralSettingsFor('quickCommerce', QuickReferralSettings)).referralRewardUser, 30);
  const taxi = await taxiOwn();
  assert.deepEqual(await referral.taxiReferralFor('user', taxi.user), taxi.user);
});

await check('with no service settings at all, a Master value still pays', async () => {
  await FoodReferralSettings.deleteMany({});
  assert.equal(await referral.referralSettingsFor('food', FoodReferralSettings), null);
  await setMaster('referral.customerReward', 60);
  await setMaster('referral.customerLimit', 3);
  const food = await referral.referralSettingsFor('food', FoodReferralSettings);
  assert.equal(food.referralRewardUser, 60);
  assert.equal(food.referralLimitUser, 3);
  assert.equal(food.referralRewardDelivery, 0);
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll referral checks passed');
process.exit(failed ? 1 : 0);
