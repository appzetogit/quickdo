/**
 * Master settings: saved values win everywhere, empty means "keep what was used before".
 *
 * Run: node tests/master-settings.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.RAZORPAY_KEY_ID = 'rzp_test_ENVKEY';
process.env.RAZORPAY_KEY_SECRET = 'env_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'env_webhook';
process.env.SMS_INDIA_HUB_API_KEY = 'env_sms_key';
process.env.SMS_INDIA_HUB_SENDER_ID = 'ENVSID';
process.env.EMAIL_HOST = 'smtp.env.test';
process.env.EMAIL_USER = 'env@test';
process.env.EMAIL_PASS = 'envpass';

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'master_settings' });

const svc = await import('../src/core/settings/platformProfile.service.js');
const cjs = (await import('module')).createRequire(import.meta.url)('../src/core/settings/platformCredentials.cjs');

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
const save = (payload) => svc.updatePlatformProfile(payload, 'test');

console.log('\nnothing saved: every reader keeps what it used before');
await svc.refreshPlatformProfile();
await check('razorpay, sms and email come from .env', async () => {
  assert.equal(svc.razorpayCredentials().keyId, 'rzp_test_ENVKEY');
  assert.equal(svc.razorpayCredentials().source, 'env');
  assert.equal(svc.smsCredentials().apiKey, 'env_sms_key');
  assert.equal(svc.emailCredentials().host, 'smtp.env.test');
});
await check('the CommonJS helper gives the same answer', async () => {
  assert.equal(cjs.razorpayKeyId(), 'rzp_test_ENVKEY');
  assert.equal(cjs.smsCredentials().senderId, 'ENVSID');
});
await check('business settings pass through untouched', async () => {
  const food = { companyName: 'Food Co', email: 'f@x.in', phone: { countryCode: '+91', number: '9000000000' } };
  assert.deepEqual(await svc.overlayBusinessSettings(food), food);
  assert.equal(await svc.managedLegalPage('terms'), null);
});

console.log('\nrazorpay keys move as a pair');
await check('an id without a secret is not used', async () => {
  await save({ integrations: { razorpay: { keyId: 'rzp_live_MASTER' } } });
  assert.equal(svc.razorpayKeyId(), 'rzp_test_ENVKEY');
});
await check('with both saved, every reader switches', async () => {
  await save({ integrations: { razorpay: { keySecret: 'master_secret' } } });
  assert.equal(svc.razorpayKeyId(), 'rzp_live_MASTER');
  assert.equal(svc.razorpayKeySecret(), 'master_secret');
  assert.equal(cjs.razorpayKeySecret(), 'master_secret');
  assert.equal(svc.razorpayWebhookSecret(), 'env_webhook', 'no webhook secret saved: .env still used');
});
await check('the admin view never shows a secret', async () => {
  const view = await svc.getPlatformProfileForAdmin();
  assert.equal(view.integrations.razorpay.keySecret, '••••cret');
  assert.equal(view.integrations.razorpay.inUse.mode, 'live');
  assert.ok(!JSON.stringify(view).includes('master_secret'));
});
await check('saving the masked value back keeps the secret', async () => {
  await save({ integrations: { razorpay: { keyId: 'rzp_live_MASTER', keySecret: '••••cret' } } });
  assert.equal(svc.razorpayKeySecret(), 'master_secret');
});
await check('clearing the id drops the pair back to .env', async () => {
  await save({ integrations: { razorpay: { keyId: null } } });
  assert.equal(svc.razorpayKeyId(), 'rzp_test_ENVKEY');
  assert.equal(svc.razorpayKeySecret(), 'env_secret');
});
await check('a malformed key id is refused', async () => {
  await assert.rejects(() => save({ integrations: { razorpay: { keyId: 'hello' } } }), /rzp_live_/);
});

console.log('\nsms and email');
await check('an sms api key switches sms; unsaved fields keep .env', async () => {
  await save({ integrations: { sms: { apiKey: 'master_sms' } } });
  assert.equal(svc.smsCredentials().apiKey, 'master_sms');
  assert.equal(svc.smsCredentials().senderId, 'ENVSID');
});
await check('an sms template without {{OTP}} is refused', async () => {
  await assert.rejects(() => save({ integrations: { sms: { templateText: 'Your code' } } }), /OTP/);
});
await check('a mail host switches email as one block', async () => {
  await save({ integrations: { email: { host: 'smtp.master.test', port: 465, user: 'm@test', pass: 'mpass', from: 'Quick Drop <m@test>' } } });
  const mail = svc.emailCredentials();
  assert.equal(mail.host, 'smtp.master.test');
  assert.equal(mail.secure, true);
  assert.equal(mail.from, 'Quick Drop <m@test>');
});

console.log('\nbrand, contact and legal pages');
await check('a saved name and phone show in every service\'s settings', async () => {
  await save({ brand: { name: 'Quick Drop' }, contact: { phone: '9876543210', phoneCountryCode: '+91' } });
  const out = await svc.overlayBusinessSettings({ companyName: 'Switcheats', email: 'old@x.in', phone: { countryCode: '+1', number: '1' } });
  assert.equal(out.companyName, 'Quick Drop');
  assert.equal(out.phone.number, '9876543210');
  assert.equal(out.phone.countryCode, '+91');
  assert.equal(out.email, 'old@x.in', 'email not saved in master: the service keeps its own');
});
await check('a bad email is refused', async () => {
  await assert.rejects(() => save({ contact: { email: 'nope' } }), /valid email/);
});
await check('a saved legal page is served; others keep their own', async () => {
  await save({ legal: { terms: '<p>One set of terms</p>' } });
  assert.equal(await svc.managedLegalPage('terms'), '<p>One set of terms</p>');
  assert.equal(await svc.managedLegalPage('privacy'), null);
});
await check('an older screen editing a managed field updates the master', async () => {
  await svc.syncManagedFromLegacy({ name: 'Quick Drop India', email: 'ignored@x.in' });
  assert.equal((await svc.managedBrand()).name, 'Quick Drop India');
  assert.equal((await svc.managedBrand()).email, undefined, 'unmanaged fields are not pulled in');
});
await check('an older screen editing a managed legal page updates the master', async () => {
  await svc.syncManagedLegalFromLegacy('terms', '<p>Edited in Food</p>');
  await svc.syncManagedLegalFromLegacy('privacy', '<p>Not managed</p>');
  assert.equal(await svc.managedLegalPage('terms'), '<p>Edited in Food</p>');
  assert.equal(await svc.managedLegalPage('privacy'), null);
});

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
