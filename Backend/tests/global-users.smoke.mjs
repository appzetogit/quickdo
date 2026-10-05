/**
 * Master > Customers: one list of every customer, and its export.
 *
 * Run: node tests/global-users.smoke.mjs
 *
 * Food and taxi customers are already the SAME documents -- both schemas declare
 * `collection: 'users'` -- so this list is a read, not a migration. Quick
 * commerce and service provider still keep their own documents, linked by
 * `platformUserId` where the backfill reached and by phone where it did not.
 *
 * Checked here:
 *   - one row per person, whichever vertical they came from;
 *   - search finds a phone however it was stored (+91…, 91…, bare ten digits);
 *   - orders, rides and wallet are counted per page, not per row;
 *   - a satellite document is attributed by its explicit link AND by phone;
 *   - the CSV neutralises spreadsheet formulas, which is the part that would
 *     otherwise make this export a delivery mechanism.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());

const { FoodUser } = await import('../src/core/users/user.model.js');
const svc = await import('../src/core/users/globalUsers.service.js');
const { listGlobalUsers, buildUserFilter, streamGlobalUsersCsv, __testables } = svc;
const { csvCell } = __testables;

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

// Two customers in the shared collection: one from food, one from taxi.
const asha = (await FoodUser.collection.insertOne({
  name: 'Asha Rao', phone: '9876543210', countryCode: '+91', email: 'asha@test.in',
  isActive: true, isVerified: true, createdAt: new Date('2026-01-10'),
  addresses: [{ city: 'Indore', isDefault: true }], referralCode: 'ASHA1', referralCount: 2,
})).insertedId;

const vikram = (await FoodUser.collection.insertOne({
  // Taxi's schema adds fields food's does not. They must survive a read here.
  name: 'Vikram Singh', phone: '9812345678', countryCode: '+91',
  isActive: false, isVerified: false, createdAt: new Date('2026-02-01'),
  password: 'hashed', status: 'active', deletionRequest: null,
})).insertedId;

await mongoose.connection.collection('food_orders').insertMany([
  { userId: asha, pricing: { total: 250 } },
  { userId: asha, pricing: { total: 150 } },
]);
await mongoose.connection.collection('taxirides').insertOne({ userId: vikram });
await mongoose.connection.collection('food_user_wallets').insertOne({ userId: asha, balance: 75 });
// A quick-commerce document with the explicit link, and a services one with only a phone.
const ashaQc = (await mongoose.connection.collection('qc_users').insertOne({ platformUserId: asha, phone: '9876543210' })).insertedId;
// Quick-commerce and medical orders live in qc_orders, keyed by the qc_users id.
// This page used to claim they shared food_orders and counted none of them.
await mongoose.connection.collection('qc_orders').insertMany([
  { userId: ashaQc, pricing: { total: 90 } },
  { userId: ashaQc, pricing: { total: 60 } },
]);
// An unlinked qc_users row for Vikram, matched only by phone.
const vikramQc = (await mongoose.connection.collection('qc_users').insertOne({ phone: '+919812345678' })).insertedId;
await mongoose.connection.collection('qc_orders').insertOne({ userId: vikramQc, pricing: { total: 40 } });
await mongoose.connection.collection('sp_users').insertOne({ phone: '+919812345678' });

await check('food and taxi customers are one list, not two', async () => {
  const { users, pagination } = await listGlobalUsers({});
  assert.equal(pagination.total, 2);
  const names = users.map((u) => u.name).sort();
  assert.deepEqual(names, ['Asha Rao', 'Vikram Singh']);
});

await check('orders, spend, rides and wallet are attributed correctly', async () => {
  const { users } = await listGlobalUsers({});
  const a = users.find((u) => u.name === 'Asha Rao');
  const v = users.find((u) => u.name === 'Vikram Singh');
  assert.equal(a.foodOrders, 2);
  assert.equal(a.quickOrders, 2, 'grocery and pharmacy orders were not counted');
  assert.equal(a.orders, 4);
  assert.equal(a.orderValue, 550, 'food 400 + quick 150');
  assert.equal(a.walletBalance, 75);
  assert.equal(a.rides, 0);
  assert.equal(v.rides, 1);
  assert.equal(v.foodOrders, 0);
  assert.equal(v.quickOrders, 1, 'an order under an unlinked qc_users row, matched by phone');
  assert.equal(v.orderValue, 40);
});

await check('a linked quick-commerce account shows against its owner', async () => {
  const { users } = await listGlobalUsers({ search: 'Asha' });
  assert.ok(users[0].apps.includes('quick'), `apps were ${users[0].apps}`);
});

await check('an UNLINKED services account is still matched, by phone', async () => {
  // sp_users has no platformUserId and stores +91XXXXXXXXXX; the user row is bare
  // ten digits. This is the fallback the backfill has not reached yet.
  const { users } = await listGlobalUsers({ search: 'Vikram' });
  assert.ok(users[0].apps.includes('services'), `apps were ${users[0].apps}`);
});

await check('a phone is found however it was typed', async () => {
  for (const term of ['9876543210', '+919876543210', '919876543210']) {
    const { users } = await listGlobalUsers({ search: term });
    assert.equal(users.length, 1, term);
    assert.equal(users[0].name, 'Asha Rao', term);
  }
});

await check('search by name and email, and status filters', async () => {
  assert.equal((await listGlobalUsers({ search: 'asha@test.in' })).users.length, 1);
  assert.equal((await listGlobalUsers({ status: 'blocked' })).users[0].name, 'Vikram Singh');
  assert.equal((await listGlobalUsers({ status: 'active' })).users[0].name, 'Asha Rao');
  assert.equal((await listGlobalUsers({ status: 'unverified' })).users[0].name, 'Vikram Singh');
});

await check('a search box cannot inject a regex', () => {
  // '.*' would match everyone if it reached the engine unescaped.
  const f = buildUserFilter({ search: '.*' });
  assert.ok(f.$or.some((c) => c.name instanceof RegExp));
  assert.equal(f.$or[0].name.source, '\\.\\*');
});

await check('a joined-date range covers the whole end day', () => {
  const f = buildUserFilter({ from: '2026-01-01', to: '2026-01-10' });
  assert.ok(f.createdAt.$gte <= new Date('2026-01-10'));
  // Asha joined ON the 10th; an end date that stopped at midnight would miss her.
  assert.ok(f.createdAt.$lte >= new Date('2026-01-10T23:59:00'));
});

await check('the CSV cannot carry a spreadsheet formula', () => {
  // The attack: a customer names themselves =HYPERLINK(...) and it executes for
  // whoever opens the export.
  assert.equal(csvCell('=HYPERLINK("http://evil","click")'), '"\'=HYPERLINK(""http://evil"",""click"")"');
  for (const dangerous of ['=cmd', '+1', '-1', '@SUM(A1)', '\tx']) {
    assert.ok(csvCell(dangerous).replace(/^"/, '').startsWith("'"), dangerous);
  }
  // Ordinary values are untouched, and commas and quotes are still escaped.
  assert.equal(csvCell('Asha Rao'), 'Asha Rao');
  assert.equal(csvCell('Rao, Asha'), '"Rao, Asha"');
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell(null), '');
});

await check('the export streams every matching row, with a header', async () => {
  const chunks = [];
  const res = {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    write(c) { chunks.push(c); return true; },
    end() { this.ended = true; },
  };
  await streamGlobalUsersCsv(res, {});
  const csv = chunks.join('');
  assert.match(res.headers['Content-Type'], /text\/csv/);
  assert.match(res.headers['Content-Disposition'], /attachment; filename="customers-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.ok(csv.startsWith('﻿'), 'a BOM, or Excel mangles non-ASCII names');
  const lines = csv.replace('﻿', '').trim().split('\n');
  assert.equal(lines.length, 3, 'header plus both customers');
  assert.match(lines[0], /^Name,Phone,Email/);
  assert.ok(csv.includes('Asha Rao') && csv.includes('Vikram Singh'));
  assert.ok(res.ended);
});

await check('the export honours the filters on screen', async () => {
  const chunks = [];
  const res = { setHeader() {}, write(c) { chunks.push(c); return true; }, end() {} };
  await streamGlobalUsersCsv(res, { status: 'blocked' });
  const csv = chunks.join('');
  assert.ok(csv.includes('Vikram Singh'));
  assert.ok(!csv.includes('Asha Rao'), 'an export must not widen the filter the operator saw');
});

await check('a page is capped however large a limit is asked for', async () => {
  const { pagination } = await listGlobalUsers({ limit: 5000 });
  assert.ok(pagination.limit <= 100, `limit was ${pagination.limit}`);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
