/**
 * Master > Help & Support: one inbox over every service's tickets.
 *
 * Run: node tests/support-inbox.smoke.mjs
 *
 * What this guards:
 *   - tickets from all seven places appear in one list, newest first, with a
 *     name and phone for whoever raised them;
 *   - the three shared statuses map onto each service's own spelling, both
 *     when filtering and when writing back;
 *   - a reply lands where that service's own panel reads it (adminResponse, or
 *     the taxi conversation), so the service screens stay in step;
 *   - a sub-admin sees only the services they were given, and view-only means
 *     they cannot answer.
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

const inbox = await import('../src/core/support/supportInbox.service.js');
const { FoodSupportTicket } = await import('../src/modules/food/user/models/supportTicket.model.js');
const { FoodRestaurantSupportTicket } = await import('../src/modules/food/restaurant/models/supportTicket.model.js');
const { DeliverySupportTicket } = await import('../src/modules/food/delivery/models/supportTicket.model.js');
const QC = {
  customer: (await import('../src/modules/quickCommerce/modules/food/user/models/supportTicket.model.js')).FoodSupportTicket,
  store: (await import('../src/modules/quickCommerce/modules/food/restaurant/models/supportTicket.model.js')).FoodRestaurantSupportTicket,
  rider: (await import('../src/modules/quickCommerce/modules/food/delivery/models/supportTicket.model.js')).DeliverySupportTicket,
};
const { SupportTicket: TaxiTicket } = await import('../src/modules/taxi/support/models/SupportTicket.js');

const oid = () => new mongoose.Types.ObjectId();
const db = mongoose.connection;
const at = (min) => new Date(Date.now() - min * 60000);

// People the tickets point at.
const userId = oid();
const qcUserId = oid();
const restId = oid();
const storeId = oid();
const riderId = oid();
const qcRiderId = oid();
await db.collection('users').insertOne({ _id: userId, name: 'Asha Food', phone: '9000000001' });
await db.collection('qc_users').insertOne({ _id: qcUserId, name: 'Ravi Quick', phone: '9000000002' });
await db.collection('food_restaurants').insertOne({ _id: restId, restaurantName: 'Joy', ownerPhone: '9000000003' });
await db.collection('qc_restaurants').insertOne({ _id: storeId, restaurantName: 'Sharma Medical', ownerPhone: '9000000004' });
await db.collection('food_delivery_partners').insertOne({ _id: riderId, name: 'Food Rider', phone: '9000000005' });
await db.collection('qc_delivery_partners').insertOne({ _id: qcRiderId, name: 'Quick Rider', phone: '9000000006' });

// One ticket per source, written raw so updatedAt is ours to set.
const ins = (Model, doc) => Model.collection.insertOne({ _id: oid(), ...doc });
const t = {};
t.food_customer = (await ins(FoodSupportTicket, { userId, type: 'order', issueType: 'Cold food', description: 'Arrived cold', status: 'open', adminResponse: '', createdAt: at(70), updatedAt: at(70) })).insertedId;
t.food_restaurant = (await ins(FoodRestaurantSupportTicket, { restaurantId: restId, category: 'payments', issueType: 'Payout late', subject: 'Payout', status: 'in-progress', adminResponse: '', createdAt: at(60), updatedAt: at(60) })).insertedId;
t.food_rider = (await ins(DeliverySupportTicket, { deliveryPartnerId: riderId, subject: 'App crash', description: 'Crashes on accept', status: 'closed', createdAt: at(50), updatedAt: at(50) })).insertedId;
t.quick_customer = (await ins(QC.customer, { userId: qcUserId, type: 'order', issueType: 'Missing item', status: 'open', adminResponse: '', createdAt: at(40), updatedAt: at(40) })).insertedId;
t.quick_store = (await ins(QC.store, { restaurantId: storeId, category: 'orders', issueType: 'Wrong zone order', status: 'open', adminResponse: '', createdAt: at(30), updatedAt: at(30) })).insertedId;
t.quick_rider = (await ins(QC.rider, { deliveryPartnerId: qcRiderId, subject: 'Cash limit', description: 'Blocked', status: 'in_progress', createdAt: at(20), updatedAt: at(20) })).insertedId;
t.taxi = (await ins(TaxiTicket, {
  ticketCode: 'TKT-1', titleId: oid(), title: 'Driver was rude', userType: 'user', supportType: 'general',
  requesterRole: 'user', requesterId: oid(), requesterName: 'Neha Taxi', requesterPhone: '9000000007',
  status: 'pending', messages: [{ _id: oid(), senderRole: 'user', senderId: oid(), senderName: 'Neha Taxi', message: 'He shouted', createdAt: at(10) }],
  lastMessageAt: at(10), createdAt: at(10), updatedAt: at(10),
})).insertedId;

const owner = { _id: oid(), role: 'ADMIN', adminLevel: 'platform_superadmin', name: 'Owner' };
const foodSupportOnly = {
  _id: oid(), role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', parentAdminId: owner._id,
  servicesAccess: ['food'], permissions: ['support.write'],
};
const quickViewOnly = {
  _id: oid(), role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', parentAdminId: owner._id,
  servicesAccess: ['quickCommerce'], permissions: ['support.read'],
};

console.log('\nThe list');

await check('an owner sees all seven sources, newest activity first', async () => {
  const res = await inbox.listInbox(owner, {});
  assert.equal(res.total, 7);
  assert.deepEqual(res.items.map((r) => r.source), ['taxi', 'quick_rider', 'quick_store', 'quick_customer', 'food_rider', 'food_restaurant', 'food_customer']);
});

await check('each row names who raised it', async () => {
  const { items } = await inbox.listInbox(owner, {});
  const by = Object.fromEntries(items.map((r) => [r.source, r]));
  assert.equal(by.food_customer.requesterName, 'Asha Food');
  assert.equal(by.food_restaurant.requesterName, 'Joy');
  assert.equal(by.food_rider.requesterPhone, '9000000005');
  assert.equal(by.quick_customer.requesterName, 'Ravi Quick');
  assert.equal(by.quick_store.requesterName, 'Sharma Medical');
  assert.equal(by.quick_rider.requesterName, 'Quick Rider');
  assert.equal(by.taxi.requesterName, 'Neha Taxi');
  assert.equal(by.taxi.description, 'He shouted');
});

await check('statuses read as open / in progress / resolved', async () => {
  const { items } = await inbox.listInbox(owner, {});
  const by = Object.fromEntries(items.map((r) => [r.source, r.status]));
  assert.deepEqual(by, {
    food_customer: 'open', food_restaurant: 'in_progress', food_rider: 'resolved',
    quick_customer: 'open', quick_store: 'open', quick_rider: 'in_progress', taxi: 'open',
  });
});

await check('filtering by status finds each service\'s own spelling', async () => {
  const open = await inbox.listInbox(owner, { status: 'open' });
  assert.deepEqual(open.items.map((r) => r.source).sort(), ['food_customer', 'quick_customer', 'quick_store', 'taxi']);
  const progress = await inbox.listInbox(owner, { status: 'in_progress' });
  assert.deepEqual(progress.items.map((r) => r.source).sort(), ['food_restaurant', 'quick_rider']);
  const resolved = await inbox.listInbox(owner, { status: 'resolved' });
  assert.deepEqual(resolved.items.map((r) => r.source), ['food_rider']);
});

await check('search and service filters narrow the list', async () => {
  assert.deepEqual((await inbox.listInbox(owner, { q: 'payout' })).items.map((r) => r.source), ['food_restaurant']);
  assert.equal((await inbox.listInbox(owner, { service: 'quickCommerce' })).total, 3);
  assert.equal((await inbox.listInbox(owner, { q: '9000000007' })).items[0]?.source, 'taxi');
});

await check('the header counts add up', async () => {
  const { counts } = await inbox.inboxStats(owner);
  assert.deepEqual(counts, { open: 4, in_progress: 2, resolved: 1 });
});

console.log('\nAnswering');

await check('a food reply is saved where the Food panel reads it', async () => {
  const row = await inbox.updateInboxTicket(owner, 'food_customer', String(t.food_customer), { reply: 'Refund issued', status: 'resolved' });
  assert.equal(row.status, 'resolved');
  const raw = await FoodSupportTicket.findById(t.food_customer).lean();
  assert.equal(raw.adminResponse, 'Refund issued');
  assert.equal(raw.status, 'resolved');
});

await check('in progress is written as each service spells it', async () => {
  await inbox.updateInboxTicket(owner, 'quick_store', String(t.quick_store), { status: 'in_progress' });
  assert.equal((await QC.store.findById(t.quick_store).lean()).status, 'in-progress');
  await inbox.updateInboxTicket(owner, 'food_rider', String(t.food_rider), { status: 'in_progress' });
  assert.equal((await DeliverySupportTicket.findById(t.food_rider).lean()).status, 'in_progress');
});

await check('a rider reply records when it was answered', async () => {
  await inbox.updateInboxTicket(owner, 'quick_rider', String(t.quick_rider), { reply: 'Limit raised' });
  const raw = await QC.rider.findById(t.quick_rider).lean();
  assert.equal(raw.adminResponse, 'Limit raised');
  assert.ok(raw.respondedAt);
});

await check('a taxi reply joins the conversation and takes the ticket', async () => {
  const row = await inbox.updateInboxTicket(owner, 'taxi', String(t.taxi), { reply: 'We have spoken to the driver' });
  const raw = await TaxiTicket.findById(t.taxi).lean();
  assert.equal(raw.messages.length, 2);
  assert.equal(raw.messages[1].senderRole, 'admin');
  assert.equal(raw.messages[1].message, 'We have spoken to the driver');
  assert.equal(raw.status, 'assigned');
  assert.equal(row.status, 'in_progress');
  assert.equal(row.reply, 'We have spoken to the driver');
});

await check('resolving a taxi ticket closes it', async () => {
  await inbox.updateInboxTicket(owner, 'taxi', String(t.taxi), { status: 'resolved' });
  assert.equal((await TaxiTicket.findById(t.taxi).lean()).status, 'closed');
});

await check('an empty update and a made-up status are refused', async () => {
  await assert.rejects(() => inbox.updateInboxTicket(owner, 'food_customer', String(t.food_customer), {}), /reply or pick a status/);
  await assert.rejects(() => inbox.updateInboxTicket(owner, 'food_customer', String(t.food_customer), { status: 'deleted' }), /open, in progress or resolved/);
  await assert.rejects(() => inbox.updateInboxTicket(owner, 'nope', String(t.food_customer), { status: 'open' }), /Unknown ticket source/);
});

console.log('\nWho sees what');

await check('a food support sub-admin sees only food tickets and can answer them', async () => {
  const res = await inbox.listInbox(foodSupportOnly, {});
  assert.deepEqual([...new Set(res.items.map((r) => r.service))], ['food']);
  assert.equal(res.total, 3);
  await inbox.updateInboxTicket(foodSupportOnly, 'food_restaurant', String(t.food_restaurant), { reply: 'Paid today' });
  await assert.rejects(() => inbox.getInboxTicket(foodSupportOnly, 'taxi', String(t.taxi)), /do not have access/);
});

await check('view-only support cannot answer', async () => {
  const res = await inbox.listInbox(quickViewOnly, {});
  assert.equal(res.total, 3);
  await assert.rejects(
    () => inbox.updateInboxTicket(quickViewOnly, 'quick_customer', String(t.quick_customer), { reply: 'hi' }),
    /view these tickets but not answer/,
  );
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll support inbox checks passed');
process.exit(failed ? 1 : 0);
