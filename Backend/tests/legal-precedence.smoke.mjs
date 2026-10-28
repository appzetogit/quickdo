/**
 * One precedence for every legal page, and a screen that can say which won.
 *
 * Run: node tests/legal-precedence.smoke.mjs
 *
 * Legal text was written in four places -- Master's per-app pages, Master's
 * platform-wide pages, food's PAGES & SOCIAL MEDIA, and taxi's landing CMS --
 * and nothing said which one an app would show. An admin could edit one, see no
 * change, and have no way to find out why.
 *
 *     this app's own page  >  the platform-wide page  >  the vertical's own
 *
 * Taxi was outside that chain entirely: its site and app read the landing CMS
 * whatever Master held. That is the gap these checks close.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());

const { AppLegalPage, resolveAppLegalPage, listAppLegal } = await import('../src/core/settings/appLegal.js');
const { PlatformProfile } = await import('../src/core/settings/platformProfile.model.js');
const { refreshPlatformProfile } = await import('../src/core/settings/platformProfile.service.js');

/*
 * The profile is a singleton at _id 'platform' and is cached in process, so a
 * fixture has to write THAT document and then refresh -- otherwise the test
 * measures a stale cache rather than the precedence.
 */
const setPlatformLegal = async (legal) => {
  await PlatformProfile.updateOne({ _id: 'platform' }, { $set: { legal } }, { upsert: true });
  await refreshPlatformProfile();
};

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

const clear = async () => {
  await AppLegalPage.deleteMany({});
  await PlatformProfile.deleteMany({});
  await refreshPlatformProfile();
};

await check('nothing set anywhere: the app falls through to its own screen', async () => {
  await clear();
  assert.equal(await resolveAppLegalPage('taxi_user', 'terms'), null);
});

await check('the platform-wide page wins when the app has none', async () => {
  await clear();
  await setPlatformLegal({ terms: '<p>Platform terms</p>' });
  const r = await resolveAppLegalPage('taxi_user', 'terms');
  assert.equal(r.source, 'platform');
  assert.match(r.content, /Platform terms/);
});

await check("the app's own page beats the platform one", async () => {
  await AppLegalPage.create({ app: 'taxi_user', kind: 'terms', title: 'Rider terms', content: '<p>Taxi terms</p>' });
  const r = await resolveAppLegalPage('taxi_user', 'terms');
  assert.equal(r.source, 'app');
  assert.match(r.content, /Taxi terms/);
  // And only for that app -- the driver app still reads the platform page.
  const driver = await resolveAppLegalPage('taxi_driver', 'terms');
  assert.equal(driver.source, 'platform');
});

await check('a blank page is not a page', async () => {
  await clear();
  await AppLegalPage.create({ app: 'taxi_user', kind: 'privacy', title: 'x', content: '   ' });
  // Whitespace must fall through rather than publish an empty policy.
  assert.equal(await resolveAppLegalPage('taxi_user', 'privacy'), null);
});

await check('an unknown app or page is refused, not guessed', async () => {
  assert.equal(await resolveAppLegalPage('not_an_app', 'terms'), null);
  assert.equal(await resolveAppLegalPage('taxi_user', 'not_a_kind'), null);
});

await check('the admin list reports what each app falls back to', async () => {
  await clear();
  await setPlatformLegal({ terms: '<p>Platform terms</p>', privacy: '' });
  let body = null;
  const res = { status() { return this; }, json(b) { body = b; return this; } };
  await listAppLegal({}, res);
  const data = body?.data || body;
  // Without this the editor shows an empty box for an app that is already
  // serving the platform's text, and "empty" reads as "nothing is published".
  assert.equal(data.platform.terms, true);
  assert.equal(data.platform.privacy, false);
  assert.ok(Array.isArray(data.apps) && data.apps.length >= 12);
  assert.ok(Array.isArray(data.kinds) && data.kinds.length >= 2);
});

await check('taxi now reads the same chain its landing CMS used to own', async () => {
  await clear();
  const { LandingPageSetting } = await import('../src/modules/taxi/admin/models/LandingPageSetting.js');
  await LandingPageSetting.deleteMany({});
  await LandingPageSetting.create({
    scope: 'default',
    pages: { terms_conditions: '<p>CMS terms</p>', privacy_policy: '<p>CMS privacy</p>' },
  });

  const { getLandingPageSettings } = await import('../src/modules/taxi/common/controllers/commonController.js');
  const call = () => new Promise((resolve, reject) => {
    const res = { json(b) { resolve(b); return this; }, status() { return this; } };
    Promise.resolve(getLandingPageSettings({ params: {}, query: {}, body: {} }, res, reject)).catch(reject);
  });

  // Nothing in Master: the CMS still wins, so nothing changed on deploy.
  let out = await call();
  assert.match(out.data.pages.terms_conditions, /CMS terms/);

  // Master's platform page now wins over the CMS.
  await setPlatformLegal({ terms: '<p>Platform terms</p>' });
  out = await call();
  assert.match(out.data.pages.terms_conditions, /Platform terms/);
  // Privacy was not set in Master, so it still comes from the CMS.
  assert.match(out.data.pages.privacy_policy, /CMS privacy/);

  // And the taxi app's own page beats both.
  await AppLegalPage.create({ app: 'taxi_user', kind: 'terms', content: '<p>Taxi app terms</p>' });
  out = await call();
  assert.match(out.data.pages.terms_conditions, /Taxi app terms/);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
