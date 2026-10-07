/**
 * Master broadcasts to every role (plan §7.6).
 *
 * Run: node tests/broadcast-roles.smoke.mjs
 *
 *   - taxi drivers and Services workers / vendors are audiences, beside customers,
 *     restaurants, stores and riders;
 *   - segments: zone (partners by their own zone, customers by where they
 *     ordered), vertical, and active within N days;
 *   - push files an inbox row for every recipient and rings only those with a device;
 *   - SMS and email are skipped -- logged, never failed -- when not configured,
 *     and sent once per phone / address when they are;
 *   - an admin addresses only the services they hold `cms.write` for.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); } catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`); }
};

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: 'broadcast_roles' });
const db = mongoose.connection.db;
const svc = await import('../src/core/notifications/platformBroadcast.service.js');
const { BroadcastNotification } = await import('../src/core/notifications/models/notificationBroadcast.model.js');

const oid = () => new mongoose.Types.ObjectId();
const daysAgo = (n) => new Date(Date.now() - n * 864e5);
const zoneA = oid(); const zoneB = oid();

const [d1, d2, d3] = [oid(), oid(), oid()];
await db.collection('taxidrivers').insertMany([
  { _id: d1, name: 'Dev', phone: '9000000001', email: 'dev@example.com', approve: true, zoneId: zoneA, fcmTokenMobile: 'tok-d1' },
  { _id: d2, name: 'Raj', phone: '9000000002', approve: true, zoneId: zoneB },
  { _id: d3, name: 'Pending', phone: '9000000003', approve: false, zoneId: zoneA },
]);
const [w1, w2, v1] = [oid(), oid(), oid()];
await db.collection('sp_workers').insertMany([
  { _id: w1, name: 'Sunil', phone: '9111111111', email: 'sunil@example.com', approvalStatus: 'approved', address: { city: 'Pune' }, fcmTokens: ['tok-w1'] },
  { _id: w2, name: 'Amit', phone: '9111111112', approvalStatus: 'approved', address: { city: 'Mumbai' } },
]);
await db.collection('sp_vendors').insertOne({ _id: v1, businessName: 'FixIt', phone: '9111111113', email: 'fixit@example.com', approvalStatus: 'approved', address: { city: 'Pune' } });
const [c1, c2] = [oid(), oid()];
await db.collection('users').insertMany([
  { _id: c1, name: 'Asha', phone: '9222222221', email: 'asha@example.com', role: 'USER', fcmTokens: ['tok-c1'] },
  { _id: c2, name: 'Ravi', phone: '9222222221', role: 'USER' }, // same phone: one SMS
]);
await db.collection('taxirides').insertMany([
  { userId: c1, driverId: d1, status: 'completed', fare: 100, pricingSnapshot: { surge_zone_id: zoneA }, createdAt: daysAgo(2) },
  { userId: c2, driverId: d2, status: 'completed', fare: 100, pricingSnapshot: { surge_zone_id: zoneB }, createdAt: daysAgo(40) },
]);

const owner = { _id: oid(), role: 'ADMIN', adminLevel: 'platform_superadmin' };
const pushed = [];
const smsSent = [];
const mails = [];
const configured = { sms: false, email: false };
svc.__setBroadcastTransportsForTests({
  push: async (tokens) => { pushed.push(tokens); return { successCount: tokens.length, failureCount: 0 }; },
  sms: async (phone, text) => { smsSent.push({ phone, text }); return { sent: true }; },
  smsConfigured: async () => configured.sms,
  email: async (mail) => { mails.push(mail); return { queued: true, sent: false }; },
  emailConfigured: async () => configured.email,
});

console.log('\nAudiences');
await check('taxi drivers and services workers/vendors are roles; only approved ones', async () => {
  const roles = svc.roleCatalogue(owner).map((r) => r.key);
  for (const r of ['taxi_drivers', 'sp_workers', 'sp_vendors', 'food_customers', 'restaurants', 'stores', 'food_riders']) assert.ok(roles.includes(r), r);
  const { recipients } = await svc.resolveAudience(owner, { roles: ['taxi_drivers'] });
  assert.deepEqual(recipients.map((r) => r.label).sort(), ['Dev', 'Raj']);
  assert.ok(recipients.every((r) => r.ownerType === 'DRIVER' && r.vertical === 'taxi'));
});
await check('zone: drivers by their own zone, customers by where they rode', async () => {
  const drivers = await svc.resolveAudience(owner, { segment: { roles: ['taxi_drivers'], zoneId: String(zoneA) } });
  assert.deepEqual(drivers.recipients.map((r) => r.label), ['Dev']);
  const customers = await svc.resolveAudience(owner, { segment: { roles: ['taxi_customers'], zoneId: String(zoneB) } });
  assert.deepEqual(customers.recipients.map((r) => r.label), ['Ravi']);
  const pune = await svc.resolveAudience(owner, { segment: { roles: ['sp_workers', 'sp_vendors'], zoneId: 'Pune' } });
  assert.deepEqual(pune.recipients.map((r) => r.label).sort(), ['FixIt', 'Sunil']);
});
await check('active within N days, and every role of a vertical', async () => {
  const active = await svc.resolveAudience(owner, { segment: { roles: ['taxi_drivers', 'taxi_customers'], activeWithinDays: 7 } });
  assert.deepEqual(active.recipients.map((r) => `${r.role}:${r.label}`).sort(), ['taxi_customers:Asha', 'taxi_drivers:Dev']);
  const services = await svc.resolveAudience(owner, { segment: { verticals: ['serviceProvider'] } });
  assert.deepEqual(services.segment.roles.sort(), ['services_customers', 'sp_vendors', 'sp_workers']);
  assert.deepEqual([...new Set(services.recipients.map((r) => r.role))].sort(), ['sp_vendors', 'sp_workers']);
  assert.equal(services.recipients.length, 3);
});
await check('an admin addresses only services they hold cms.write for', async () => {
  const taxiCms = { _id: oid(), role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', parentAdminId: owner._id, servicesAccess: ['taxi'], permissions: ['cms.write'] };
  assert.ok(svc.roleCatalogue(taxiCms).every((r) => r.vertical === 'taxi'));
  await assert.rejects(() => svc.resolveAudience(taxiCms, { roles: ['sp_workers'] }), /at least one audience/);
  await assert.rejects(() => svc.resolveAudience({ ...taxiCms, permissions: ['cms.read'] }, { roles: ['taxi_drivers'] }), /access to broadcasts/);
});

console.log('\nChannels');
await check('push: inbox for everyone, a ring only where there is a device', async () => {
  const r = await svc.createPlatformBroadcast(owner, { title: 'Hello', message: 'New zones open', roles: ['taxi_drivers', 'sp_workers'], channels: ['push'] });
  assert.equal(r.status, 'sent');
  assert.equal(r.targetCount, 4);
  assert.equal(r.stats.inbox, 4);
  assert.equal(r.stats.push.sent, 2);
  assert.equal(r.stats.push.noDevice, 2);
  assert.deepEqual(pushed.flat().sort(), ['tok-d1', 'tok-w1']);
  const inbox = await db.collection('food_notifications').find({ broadcastId: new mongoose.Types.ObjectId(r.id) }).toArray();
  assert.equal(inbox.length, 4);
  assert.deepEqual([...new Set(inbox.map((n) => n.ownerType))].sort(), ['DRIVER', 'WORKER']);
  assert.ok(inbox.filter((n) => n.ownerType === 'WORKER').every((n) => n.vertical === 'serviceProvider'));
  const saved = await BroadcastNotification.findById(r.id).lean();
  assert.equal(saved.scope, 'platform');
  assert.equal(saved.status, 'sent');
});
await check('SMS and email are skipped, not failed, when not configured', async () => {
  const r = await svc.createPlatformBroadcast(owner, { title: 'Hi', message: 'Test', roles: ['taxi_drivers'], channels: ['sms', 'email'] });
  assert.equal(r.status, 'sent');
  assert.equal(r.stats.sms.skipped, true);
  assert.match(r.stats.sms.reason, /not configured/);
  assert.equal(r.stats.email.skipped, true);
  assert.equal(smsSent.length, 0);
  assert.equal(mails.length, 0);
  const preview = await svc.previewAudience(owner, { roles: ['taxi_drivers'] });
  assert.deepEqual(preview.channels, { sms: false, email: false });
  assert.equal(preview.roles[0].withPhone, 2);
  assert.equal(preview.roles[0].withEmail, 1);
});
await check('configured: one SMS per phone, email through the queue', async () => {
  configured.sms = true;
  configured.email = true;
  const r = await svc.createPlatformBroadcast(owner, { title: 'Offer', message: '20% off', roles: ['food_customers'], channels: ['sms', 'email'] });
  assert.equal(r.stats.sms.sent, 1);
  assert.equal(smsSent[0].text, 'Offer: 20% off');
  assert.equal(r.stats.email.queued, 1);
  assert.equal(r.stats.email.noEmail, 1);
  assert.equal(mails[0].to, 'asha@example.com');
  assert.equal(mails[0].kind, 'broadcast');
});
await check('validation and history', async () => {
  await assert.rejects(() => svc.createPlatformBroadcast(owner, { message: 'x', roles: ['taxi_drivers'] }), /title is required/);
  await assert.rejects(() => svc.createPlatformBroadcast(owner, { title: 'x', message: 'x', roles: ['taxi_drivers'], channels: ['fax'] }), /at least one channel/);
  await assert.rejects(() => svc.createPlatformBroadcast(owner, { title: 'x', message: 'x', segment: { roles: ['taxi_drivers'], zoneId: String(oid()) } }), /Nobody matches/);
  const list = await svc.listPlatformBroadcasts(owner, {});
  assert.equal(list.total, 3);
  assert.match(list.items[0].audience, /Food customers/);
});

svc.__setBroadcastTransportsForTests(null);
await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll broadcast role checks passed');
process.exit(failed ? 1 : 0);
