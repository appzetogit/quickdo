/**
 * My Orders: a quick-commerce multi-store checkout is one entry.
 *
 * Run: node tests/myorders-grouping.smoke.mjs
 *
 * What this guards (core/orders/myOrders.service.js):
 *   - QC child orders that share a parent (parent_orders, MSO-) are listed as
 *     ONE entry with the children inside it, the parent's number and total,
 *     and a state worked out from the children's;
 *   - single-store QC orders, food orders and rides are listed exactly as before;
 *   - ?groupByParent=false gives the old flat list (every child on its own);
 *   - a checkout is never split or repeated across pages, and the ongoing
 *     count counts a checkout once;
 *   - unpaid children stay hidden, a parent with every child unpaid is not listed.
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
const { listMyOrders } = await import('../src/core/orders/myOrders.service.js');

const oid = () => new mongoose.Types.ObjectId();
const minsAgo = (m) => new Date(Date.now() - m * 60_000);

const asha = oid();
const other = oid();
await db.collection('users').insertMany([{ _id: asha, phone: '9876543210' }, { _id: other, phone: '9000000000' }]);
const ashaQuick = oid();
const otherQuick = oid();
await db.collection('qc_users').insertMany([
  { _id: ashaQuick, platformUserId: asha, phone: '9876543210' },
  { _id: otherQuick, platformUserId: other, phone: '9000000000' },
]);

const joy = oid();
const [grocer, bakery, chemist] = [oid(), oid(), oid()];
await db.collection('food_restaurants').insertOne({ _id: joy, restaurantName: 'Joy' });
await db.collection('qc_restaurants').insertMany([
  { _id: grocer, restaurantName: 'Daily Needs' },
  { _id: bakery, restaurantName: 'Bake House' },
  { _id: chemist, restaurantName: 'Sharma Medical' },
]);

// MSO-1: three stores, one delivered, two still on the way.
const p1 = oid();
const [c11, c12, c13] = [oid(), oid(), oid()];
// MSO-2: two stores, both delivered.
const p2 = oid();
const [c21, c22] = [oid(), oid()];
// MSO-3: abandoned at payment -- every child unpaid.
const p3 = oid();
await db.collection('parent_orders').insertMany([
  { _id: p1, vertical: 'quickCommerce', orderNumber: 'MSO-AAAAAAAAA1', userId: ashaQuick, status: 'placed', fulfilmentType: 'delivery', pricing: { total: 401 }, childOrderIds: [c11, c12, c13], createdAt: minsAgo(30) },
  { _id: p2, vertical: 'quickCommerce', orderNumber: 'MSO-BBBBBBBBB2', userId: ashaQuick, status: 'placed', fulfilmentType: 'pickup', pricing: { total: 250 }, childOrderIds: [c21, c22], createdAt: minsAgo(90) },
  { _id: p3, vertical: 'quickCommerce', orderNumber: 'MSO-CCCCCCCCC3', userId: ashaQuick, status: 'pending_payment', pricing: { total: 99 }, createdAt: minsAgo(5) },
]);

const at = (m, ms = 0) => new Date(minsAgo(m).getTime() + ms);
const single = oid();
await db.collection('qc_orders').insertMany([
  // MSO-1 children: created a few ms apart, as one checkout writes them.
  { _id: c11, userId: ashaQuick, restaurantId: grocer, parentOrderId: p1, order_id: 'QC-11', orderStatus: 'picked_up', items: [{ name: 'Milk', quantity: 2 }], pricing: { total: 150 }, createdAt: at(30, 0) },
  { _id: c12, userId: ashaQuick, restaurantId: bakery, parentOrderId: p1, order_id: 'QC-12', orderStatus: 'delivered', items: [{ name: 'Bread', quantity: 1 }], pricing: { total: 120 }, createdAt: at(30, 2) },
  { _id: c13, userId: ashaQuick, restaurantId: chemist, parentOrderId: p1, order_id: 'QC-13', orderStatus: 'preparing', items: [{ name: 'Bandage', quantity: 1 }], pricing: { total: 131 }, createdAt: at(30, 4) },
  // MSO-2 children
  { _id: c21, userId: ashaQuick, restaurantId: grocer, parentOrderId: p2, order_id: 'QC-21', orderStatus: 'delivered', fulfilmentType: 'pickup', items: [{ name: 'Rice', quantity: 1 }], pricing: { total: 200 }, createdAt: at(90, 0) },
  { _id: c22, userId: ashaQuick, restaurantId: bakery, parentOrderId: p2, order_id: 'QC-22', orderStatus: 'delivered', fulfilmentType: 'pickup', items: [{ name: 'Cake', quantity: 1 }], pricing: { total: 50 }, createdAt: at(90, 3) },
  // MSO-3 children, unpaid
  { _id: oid(), userId: ashaQuick, restaurantId: grocer, parentOrderId: p3, order_id: 'QC-31', orderStatus: 'pending_payment', items: [], pricing: { total: 50 }, createdAt: at(5, 0) },
  { _id: oid(), userId: ashaQuick, restaurantId: bakery, parentOrderId: p3, order_id: 'QC-32', orderStatus: 'pending_payment', items: [], pricing: { total: 49 }, createdAt: at(5, 1) },
  // A single-store QC order: no parent, unchanged shape.
  { _id: single, userId: ashaQuick, restaurantId: grocer, order_id: 'QC-S', orderStatus: 'confirmed', items: [{ name: 'Eggs', quantity: 1 }], pricing: { total: 70 }, createdAt: minsAgo(60) },
  // Somebody else's order is never listed.
  { _id: oid(), userId: otherQuick, restaurantId: grocer, order_id: 'QC-X', orderStatus: 'delivered', items: [], pricing: { total: 1 }, createdAt: minsAgo(1) },
]);
await db.collection('food_orders').insertOne({ _id: oid(), userId: asha, restaurantId: joy, order_id: 'FOD-1', orderStatus: 'delivered', items: [{ name: 'Dal', quantity: 1 }], pricing: { total: 180 }, createdAt: minsAgo(45) });
await db.collection('taxirides').insertOne({ _id: oid(), userId: asha, status: 'completed', pickupAddress: 'A', dropAddress: 'B', fare: 90, createdAt: minsAgo(10) });

const all = await listMyOrders(String(asha), {});

console.log('\nGrouped (default)');
await check('a checkout is one entry, newest first, with the other services unchanged', async () => {
  assert.deepEqual(all.items.map((i) => i.number), [all.items[0].number, 'MSO-AAAAAAAAA1', 'FOD-1', 'QC-S', 'MSO-BBBBBBBBB2']);
  assert.deepEqual(all.items.map((i) => i.service), ['taxi', 'quick', 'food', 'quick', 'quick']);
  assert.ok(!all.items.some((i) => /QC-1\d|QC-2\d|QC-3\d|QC-X|MSO-CCC/.test(i.number)), 'children, unpaid and other customers stay out');
});
await check('the entry carries the parent, the stores and every child', async () => {
  const g = all.items.find((i) => i.number === 'MSO-AAAAAAAAA1');
  assert.equal(g.key, `quick:parent:${p1}`);
  assert.equal(g.id, String(p1));
  assert.equal(g.parentOrderId, String(p1));
  assert.equal(g.isMultiStore, true);
  assert.equal(g.amount, 401);
  assert.equal(g.title, 'Daily Needs, Bake House +1 more');
  assert.equal(g.subtitle, '3 stores · 2 × Milk');
  assert.equal(g.fulfilmentType, 'delivery');
  assert.deepEqual(g.children.map((c) => c.number), ['QC-11', 'QC-12', 'QC-13']);
  assert.deepEqual(g.children.map((c) => c.title), ['Daily Needs', 'Bake House', 'Sharma Medical']);
  assert.deepEqual(g.children.map((c) => c.route), [`/qc/order/${c11}`, `/qc/order/${c12}`, `/qc/order/${c13}`]);
  assert.equal(g.route, `/qc/order/${c11}`);
  // Sorted at its latest child.
  assert.equal(new Date(g.createdAt).getTime(), new Date(g.children[2].createdAt).getTime());
});
await check('state from the children: any ongoing is ongoing, all delivered is completed', async () => {
  const g1 = all.items.find((i) => i.number === 'MSO-AAAAAAAAA1');
  assert.equal(g1.state, 'ongoing');
  assert.equal(g1.statusLabel, 'In progress');
  const g2 = all.items.find((i) => i.number === 'MSO-BBBBBBBBB2');
  assert.equal(g2.state, 'completed');
  assert.equal(g2.statusLabel, 'Delivered');
  assert.equal(g2.fulfilmentType, 'pickup');
  assert.equal(g2.title, 'Daily Needs & Bake House');
  // taxi completed; ongoing are MSO-1 (once) and QC-S.
  assert.equal(all.ongoingCount, 2);
});
await check('a single-store QC order keeps its old shape', async () => {
  const s = all.items.find((i) => i.number === 'QC-S');
  assert.equal(s.key, `quick:${single}`);
  assert.equal(s.isMultiStore, undefined);
  assert.equal(s.children, undefined);
  assert.equal(s.route, `/qc/order/${single}`);
});
await check('filters see the entry: ongoing, past and service=quick', async () => {
  const on = await listMyOrders(String(asha), { state: 'ongoing' });
  assert.deepEqual(on.items.map((i) => i.number), ['MSO-AAAAAAAAA1', 'QC-S']);
  const past = await listMyOrders(String(asha), { state: 'past', service: 'quick' });
  assert.deepEqual(past.items.map((i) => i.number), ['MSO-BBBBBBBBB2']);
  const quick = await listMyOrders(String(asha), { service: 'quick' });
  assert.deepEqual(quick.items.map((i) => i.number), ['MSO-AAAAAAAAA1', 'QC-S', 'MSO-BBBBBBBBB2']);
});
await check('paging never splits or repeats a checkout', async () => {
  for (const limit of [1, 2, 3]) {
    const seen = [];
    let before;
    for (let i = 0; i < 20; i += 1) {
      const page = await listMyOrders(String(asha), { limit, before });
      seen.push(...page.items.map((x) => x.key));
      if (!page.nextBefore) break;
      before = page.nextBefore;
    }
    assert.deepEqual(seen, all.items.map((x) => x.key), `limit ${limit}`);
  }
});

console.log('\nFlat (groupByParent=false)');
await check('every child on its own, exactly as before', async () => {
  const flat = await listMyOrders(String(asha), { groupByParent: 'false' });
  assert.deepEqual(
    flat.items.filter((i) => i.service === 'quick').map((i) => i.number),
    ['QC-13', 'QC-12', 'QC-11', 'QC-S', 'QC-22', 'QC-21'],
  );
  assert.ok(flat.items.every((i) => i.isMultiStore === undefined && i.children === undefined));
  assert.equal(flat.ongoingCount, 3);
  assert.equal((await listMyOrders(String(asha), { groupByParent: '0' })).items.length, flat.items.length);
});
await check('a child whose parent row is missing is listed on its own', async () => {
  const orphan = oid();
  await db.collection('qc_orders').insertOne({ _id: orphan, userId: ashaQuick, restaurantId: grocer, parentOrderId: oid(), order_id: 'QC-O', orderStatus: 'delivered', items: [], pricing: { total: 10 }, createdAt: minsAgo(200) });
  const r = await listMyOrders(String(asha), { service: 'quick' });
  const o = r.items.find((i) => i.number === 'QC-O');
  assert.ok(o);
  assert.equal(o.key, `quick:${orphan}`);
  await db.collection('qc_orders').deleteOne({ _id: orphan });
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll myorders-grouping checks passed');
process.exit(failed ? 1 : 0);
