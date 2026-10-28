/**
 * Master > Home Screen Banners: every banner the customer app shows, in one list.
 *
 * Run: node tests/home-content.smoke.mjs
 *
 * What this guards:
 *   - the five sets the app shows are listed, from their own collections;
 *   - section header artwork is split by section, and an empty section still
 *     appears (the app shows a flat colour there);
 *   - live / scheduled / ended / paused are right, and zones are named;
 *   - pausing writes the flag each service's public read already filters on,
 *     and resuming undoes it;
 *   - each admin sees only services they have Banners & pages access for, and
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
await mongoose.connect(mongod.getUri());
const db = mongoose.connection;
const content = await import('../src/core/cms/homeContent.service.js');

const oid = () => new mongoose.Types.ObjectId();
const day = 24 * 3600 * 1000;
const palampur = oid();

await db.collection('food_zones').insertOne({ _id: palampur, name: 'Palampur food' });
const foodHeader = oid();
await db.collection('food_hero_banners').insertMany([
  { _id: foodHeader, imageUrl: 'https://x/food.gif', title: 'Food header', isActive: true, sortOrder: 0 },
  { _id: oid(), imageUrl: 'https://x/taxi.jpg', module: 'taxi', isActive: true, sortOrder: 0 },
  { _id: oid(), imageUrl: 'https://x/med.mp4', resourceType: 'video', module: 'medical', isActive: false, sortOrder: 1 },
]);
const promoLive = oid();
await db.collection('food_home_promotion_banners').insertMany([
  { _id: promoLive, imageUrl: 'https://x/p1.jpg', title: 'Diwali', zoneId: palampur, startDate: new Date(Date.now() - day), endDate: new Date(Date.now() + day), isActive: true },
  { _id: oid(), imageUrl: 'https://x/p2.jpg', title: 'Next week', startDate: new Date(Date.now() + 5 * day), isActive: true },
  { _id: oid(), imageUrl: 'https://x/p3.jpg', title: 'Last month', endDate: new Date(Date.now() - 5 * day), isActive: true },
]);
await db.collection('qc_hero_banners').insertOne({ _id: oid(), imageUrl: 'https://x/q1.jpg', title: 'Fresh fruit', isActive: true });
const top = oid();
await db.collection('qc_top_banners').insertOne({ _id: top, image: 'https://x/top.jpg', order: 0, isActive: true });

const owner = { _id: oid(), role: 'ADMIN', adminLevel: 'platform_superadmin' };
const sub = (services, permissions) => ({
  _id: oid(), role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', parentAdminId: owner._id, servicesAccess: services, permissions,
});
const groupsOf = async (admin = owner) => Object.fromEntries((await content.listHomeContent(admin)).groups.map((g) => [g.key, g]));

console.log('\nThe list');
await check('the five sets the app shows, from their own collections', async () => {
  const g = await groupsOf();
  assert.deepEqual(Object.keys(g), ['header', 'foodPromo', 'quickHero', 'quickTop', 'quickPromo']);
  assert.equal(g.quickTop.items[0].imageUrl, 'https://x/top.jpg');
  assert.equal(g.quickTop.editPath, null);
});
await check('header artwork is split by section; empty sections still listed', async () => {
  const { sections } = (await groupsOf()).header;
  const by = Object.fromEntries(sections.map((s) => [s.id, s.items.length]));
  assert.deepEqual(by, { food: 1, taxi: 1, quick_commerce: 0, medical: 1, porter: 0, rental: 0, services: 0 });
  assert.equal(sections.find((s) => s.id === 'taxi').label, 'Rides');
});
await check('an old banner with no section is Food\'s, as the app treats it', async () => {
  const food = (await groupsOf()).header.sections.find((s) => s.id === 'food');
  assert.equal(food.items[0].id, String(foodHeader));
});
await check('videos are marked as videos', async () => {
  const med = (await groupsOf()).header.sections.find((s) => s.id === 'medical');
  assert.equal(med.items[0].isVideo, true);
});
await check('states: live, scheduled, ended, paused', async () => {
  const promo = Object.fromEntries((await groupsOf()).foodPromo.items.map((i) => [i.title, i.state]));
  assert.deepEqual(promo, { Diwali: 'live', 'Next week': 'scheduled', 'Last month': 'ended' });
  const med = (await groupsOf()).header.sections.find((s) => s.id === 'medical').items[0];
  assert.equal(med.state, 'paused');
});
await check('zones are named, and live counts are right', async () => {
  const g = await groupsOf();
  assert.equal(g.foodPromo.items.find((i) => i.title === 'Diwali').zone, 'Palampur food');
  assert.equal(g.foodPromo.live, 1);
  assert.equal(g.header.live, 2);
});

console.log('\nPausing');
await check('pausing writes the flag the public read filters on, and resuming undoes it', async () => {
  const paused = await content.setHomeContentLive(owner, 'foodPromo', String(promoLive), false);
  assert.equal(paused.state, 'paused');
  assert.equal((await db.collection('food_home_promotion_banners').findOne({ _id: promoLive })).isActive, false);
  await content.setHomeContentLive(owner, 'foodPromo', String(promoLive), true);
  assert.equal((await db.collection('food_home_promotion_banners').findOne({ _id: promoLive })).isActive, true);
});
await check('Quick top banners pause too', async () => {
  await content.setHomeContentLive(owner, 'quickTop', String(top), false);
  assert.equal((await db.collection('qc_top_banners').findOne({ _id: top })).isActive, false);
  await content.setHomeContentLive(owner, 'quickTop', String(top), true);
});
await check('bad requests are refused', async () => {
  await assert.rejects(() => content.setHomeContentLive(owner, 'nope', String(top), true), /Unknown banner group/);
  await assert.rejects(() => content.setHomeContentLive(owner, 'quickTop', String(oid()), true), /not found/);
  await assert.rejects(() => content.setHomeContentLive(owner, 'quickTop', String(top), 'yes'), /should be live/);
});

console.log('\nWho sees what');
await check('a Food banners sub-admin sees only Food\'s sets and can pause them', async () => {
  const foodCms = sub(['food'], ['cms.write']);
  assert.deepEqual(Object.keys(await groupsOf(foodCms)), ['header', 'foodPromo']);
  await content.setHomeContentLive(foodCms, 'header', String(foodHeader), false);
  await content.setHomeContentLive(owner, 'header', String(foodHeader), true);
  await assert.rejects(() => content.setHomeContentLive(foodCms, 'quickTop', String(top), false), /not change them/);
  assert.equal(content.canUploadQuickTop(foodCms), false);
});
await check('view-only cannot pause or upload', async () => {
  const viewer = sub(['quickCommerce'], ['cms.read']);
  assert.deepEqual(Object.keys(await groupsOf(viewer)), ['quickHero', 'quickTop', 'quickPromo']);
  await assert.rejects(() => content.setHomeContentLive(viewer, 'quickTop', String(top), false), /not change them/);
  assert.equal(content.canUploadQuickTop(viewer), false);
  assert.equal(content.canUploadQuickTop(owner), true);
});
await check('no Banners access at all is refused', async () => {
  await assert.rejects(() => content.listHomeContent(sub(['food'], ['orders.read'])), /access to banners/);
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll home-screen banner checks passed');
process.exit(failed ? 1 : 0);
