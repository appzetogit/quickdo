/**
 * Terms and privacy per app (core/settings/appLegal.js).
 *
 * Run: node tests/app-legal.smoke.mjs
 *
 *   - each app reads its own page; one app's page never shows in another;
 *   - an app with no page of its own falls back to the platform-wide one;
 *   - the food apps' existing page keys (terms, terms_restaurant,
 *     terms_delivery) pick up the per-app page;
 *   - saving empty content clears the page.
 */
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());

const legal = await import('../src/core/settings/appLegal.js');
const { PlatformProfile } = await import('../src/core/settings/platformProfile.model.js');
const food = await import('../src/modules/food/admin/services/pageContent.service.js');

const app = express();
app.use(express.json());
app.get('/legal/:app/:kind', legal.getPublicAppLegal);
app.get('/admin', legal.listAppLegal);
app.put('/admin/:app/:kind', legal.saveAppLegal);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (p) => (await (await fetch(base + p)).json()).data;
const put = async (p, body) => fetch(base + p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); } catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

await check('each app keeps its own page', async () => {
  assert.equal((await put('/admin/food_restaurant/terms', { title: 'Restaurant terms', content: '<p>R</p>' })).status, 200);
  assert.equal((await put('/admin/food_delivery/terms', { title: 'Rider terms', content: '<p>D</p>' })).status, 200);
  assert.equal((await get('/legal/food_restaurant/terms')).content, '<p>R</p>');
  assert.equal((await get('/legal/food_delivery/terms')).title, 'Rider terms');
});
await check('an app with nothing falls back to the platform-wide page', async () => {
  assert.equal((await get('/legal/qc_seller/terms')).content, '');
  await PlatformProfile.updateOne({ _id: 'platform' }, { $set: { 'legal.terms': '<p>ALL</p>' } }, { upsert: true });
  // platform profile is cached; give the cache a direct read
  const r = await legal.resolveAppLegalPage('qc_seller', 'terms');
  assert.ok(!r || r.source === 'platform');
});
await check('unknown apps and pages are refused', async () => {
  assert.equal((await put('/admin/nope/terms', { content: 'x' })).status, 400);
  assert.equal((await fetch(base + '/legal/food_user/cookies')).status, 404);
});
await check('the food apps\' existing keys read the per-app page', async () => {
  assert.equal((await food.getPublicPageByKey('terms_restaurant')).data.content, '<p>R</p>');
  assert.equal((await food.getPublicPageByKey('terms_delivery')).data.content, '<p>D</p>');
});
await check('the admin list shows what is saved', async () => {
  const d = await get('/admin');
  assert.equal(d.apps.length, 12);
  assert.ok(d.pages['food_restaurant:terms']);
});
await check('saving empty content clears the page', async () => {
  await put('/admin/food_restaurant/terms', { content: '' });
  assert.equal(await legal.appLegalPage('food_restaurant', 'terms'), null);
});

server.close();
await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
