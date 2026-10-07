/**
 * An admin assigns a delivery rider by hand (core/delivery/manualAssign.js).
 *
 * Run: node tests/manual-assign.smoke.mjs
 *
 * Covers both verticals: the candidate list (nearest first, with online /
 * on-a-trip / cash flags), the refusals, the confirm-before-assigning warnings,
 * assignment (Quick stores the linked Quick rider id), auto-dispatch leaving an
 * admin's pick alone, the rider seeing and accepting it (busy-lock claimed,
 * deadline cleared), decline, expiry and unassign -- each of the last three
 * putting the order back into auto-dispatch.
 */
process.env.UNIFIED_DISPATCH_ENABLED = 'true';
process.env.NODE_ENV = 'test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
await mongoose.connect(replSet.getUri(), { dbName: 'manual_assign' });

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack || e.message}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const oid = () => new mongoose.Types.ObjectId();

const { FoodDeliveryPartner: FoodRider } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { FoodOrder: QcOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodRestaurant: QcStore } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');
const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
const link = await import('../src/core/delivery/qcRiderLink.js');
const manual = await import('../src/core/delivery/manualAssign.js');
const foodDispatch = await import('../src/modules/food/orders/services/order-dispatch.service.js');
const qcDispatch = await import('../src/modules/quickCommerce/modules/food/orders/services/order-dispatch.service.js');
const foodDelivery = await import('../src/modules/food/orders/services/order-delivery.service.js');
const qcDelivery = await import('../src/modules/quickCommerce/modules/food/orders/services/order-delivery.service.js');
const foodCtrl = await import('../src/modules/food/orders/controllers/order.controller.js');
const { manualAssignControllers } = await import('../src/core/delivery/manualAssign.controller.js');

// Taxi's minimum-balance rule must not be the thing that decides here.
const { AdminAppSetting } = await import('../src/modules/taxi/admin/models/AdminAppSetting.js');
await AdminAppSetting.collection.updateOne({ scope: 'default' },
  { $set: { 'wallet_setting.driver_wallet_minimum_amount_to_get_an_order': -1000 } }, { upsert: true });
// Rs 500 cash limit for every rider.
await mongoose.connection.db.collection('food_delivery_cash_limits')
  .insertOne({ isActive: true, deliveryCashLimit: 500, deliveryWithdrawalLimit: 100, createdAt: new Date() });

// ---- the world ----------------------------------------------------------
// Store and restaurant at the same Indore corner.
const STORE = [75.88, 22.72];
const { insertedId: restaurantId } = await FoodRestaurant.collection.insertOne({
  restaurantName: 'Smoke Kitchen', status: 'approved', location: { type: 'Point', coordinates: STORE }, createdAt: new Date(),
});
const { insertedId: storeId } = await QcStore.collection.insertOne({
  restaurantName: 'Smoke Mart', status: 'approved', location: { type: 'Point', coordinates: STORE }, createdAt: new Date(),
});

let seq = 9300000000;
const driverFor = (balance = 0) => Driver.create({
  name: 'D', phone: `+91${seq++}`, password: 'secret123', vehicleType: 'bike',
  location: { type: 'Point', coordinates: STORE }, workMode: 'all',
  serviceCapabilities: ['delivery', 'quickCommerce'], wallet: { balance, isBlocked: false },
});
const rider = async (name, { at = null, online = true, status = 'approved', driver = null } = {}) => FoodRider.create({
  name, phone: String(seq++), status, availabilityStatus: online ? 'online' : 'offline',
  ...(at ? { lastLat: at[1], lastLng: at[0], lastLocationAt: new Date(), lastLocation: { type: 'Point', coordinates: at } } : {}),
  ...(driver ? { driverId: driver._id } : {}),
});

const dA = await driverFor(0);
const dB = await driverFor(-450); // Rs 450 cash in hand against the Rs 500 limit
const A = await rider('Asha', { at: [75.8805, 22.7205], driver: dA });   // ~0.07 km
const F = await rider('Farid', { at: [75.89, 22.73] });                   // ~1.5 km, on a trip
const B = await rider('Bala', { at: [75.90, 22.74], driver: dB });        // ~3 km, cash heavy
const E = await rider('Esha', { at: [75.88, 23.45] });                    // ~80 km, past dispatch's 60 km reach
const C = await rider('Chetan', { online: false });                       // offline, never placed
const D = await rider('Dev', { at: [75.8806, 22.7206], status: 'pending' });

let n = 0;
const foodOrder = async (extra = {}) => {
  n += 1;
  const { insertedId } = await FoodOrder.collection.insertOne({
    order_id: `FOD-77000${n}`, orderStatus: 'preparing', restaurantId, userId: oid(),
    items: [{ itemId: oid(), name: 'Paneer Tikka', price: 200, quantity: 1 }],
    pricing: { subtotal: 200, deliveryFee: 30, total: 252 }, riderEarning: 30,
    payment: { method: 'cash', status: 'cod_pending' },
    dispatch: { status: 'unassigned', offeredTo: [] }, statusHistory: [],
    deliveryAddress: { street: '1 MG Road', city: 'Indore', state: 'MP', location: { type: 'Point', coordinates: [75.87, 22.71] } },
    createdAt: new Date(), updatedAt: new Date(), ...extra,
  });
  return String(insertedId);
};
const qcOrder = async (extra = {}) => {
  n += 1;
  const { insertedId } = await QcOrder.collection.insertOne({
    order_id: `QC-77000${n}`, orderStatus: 'preparing', restaurantId: storeId, userId: oid(),
    items: [{ itemId: oid(), name: 'Milk', price: 60, quantity: 1 }],
    pricing: { subtotal: 60, deliveryFee: 20, total: 80 }, riderEarning: 20,
    payment: { method: 'razorpay', status: 'paid' },
    dispatch: { status: 'unassigned', offeredTo: [] }, statusHistory: [],
    deliveryAddress: { street: '2 MG Road', city: 'Indore', state: 'MP', location: { type: 'Point', coordinates: [75.87, 22.71] } },
    createdAt: new Date(), updatedAt: new Date(), ...extra,
  });
  return String(insertedId);
};
const foodRow = (id) => FoodOrder.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
const qcRow = (id) => QcOrder.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
const admin = { id: String(oid()), name: 'Ops Priya' };

// Farid is on a Food delivery right now.
await foodOrder({ orderStatus: 'picked_up', dispatch: { status: 'accepted', deliveryPartnerId: F._id, acceptedAt: new Date(), offeredTo: [] } });

// ---- candidates ----------------------------------------------------------
console.log('\ncandidates');
const cashOrder = await foodOrder();
await check('nearest first, unknown location last; unapproved riders left out', async () => {
  const { riders, order } = await manual.listRiderCandidates({ vertical: 'food', orderId: cashOrder });
  assert.deepEqual(riders.map((r) => r.name), ['Asha', 'Farid', 'Bala', 'Esha', 'Chetan']);
  assert.ok(riders[0].distanceKm < 0.2, String(riders[0].distanceKm));
  assert.equal(riders[4].distanceKm, null);
  assert.deepEqual(order.pickup, { lat: 22.72, lng: 75.88 });
  assert.ok(riders[0].phone, 'admins get the full phone');
});
await check('online / on a trip / over the cash limit are flagged', async () => {
  const { riders } = await manual.listRiderCandidates({ vertical: 'food', orderId: cashOrder });
  const by = Object.fromEntries(riders.map((r) => [r.name, r]));
  assert.equal(by.Chetan.online, false);
  assert.equal(by.Asha.online, true);
  assert.equal(by.Farid.onTrip, true);
  assert.equal(by.Asha.onTrip, false);
  assert.equal(by.Bala.cashInHand, 450);
  assert.equal(by.Bala.cashLimit, 500);
  assert.equal(by.Bala.overCashLimit, true, 'Rs 450 + a Rs 252 cash order > Rs 500');
  assert.equal(by.Asha.overCashLimit, false);
});
await check('search by name or phone (escaped), limit capped at 50', async () => {
  const byName = await manual.listRiderCandidates({ vertical: 'food', orderId: cashOrder, q: 'esh' });
  assert.deepEqual(byName.riders.map((r) => r.name), ['Esha']);
  const byPhone = await manual.listRiderCandidates({ vertical: 'food', orderId: cashOrder, q: B.phone.slice(-4) });
  assert.deepEqual(byPhone.riders.map((r) => r.name), ['Bala']);
  const weird = await manual.listRiderCandidates({ vertical: 'food', orderId: cashOrder, q: '.*(' });
  assert.equal(weird.riders.length, 0);
  const big = await manual.listRiderCandidates({ vertical: 'food', orderId: cashOrder, limit: 500 });
  assert.ok(big.riders.length <= 50);
});

// ---- refusals ------------------------------------------------------------
console.log('\nrefusals');
await check('a picked-up order is refused', async () => {
  const id = await foodOrder({ orderStatus: 'picked_up' });
  await assert.rejects(() => manual.assignRider({ vertical: 'food', orderId: id, foodRiderId: String(A._id), admin, force: true }), /picked up/);
});
await check('an order a rider already accepted is refused', async () => {
  const id = await foodOrder({ dispatch: { status: 'accepted', deliveryPartnerId: F._id, acceptedAt: new Date(), offeredTo: [] } });
  await assert.rejects(() => manual.assignRider({ vertical: 'food', orderId: id, foodRiderId: String(A._id), admin, force: true }), /already accepted/);
});
await check('a legacy prescription (MED-) order whose bill the customer has not accepted is refused', async () => {
  const id = await qcOrder({
    order_id: 'MED-7700001', prescriptionOnly: true, payment: { method: 'cash', status: 'cod_pending' },
    prescription: { required: true, status: 'approved', bill: { status: 'submitted', amount: 60 } },
  });
  await assert.rejects(() => manual.assignRider({ vertical: 'quickCommerce', orderId: id, foodRiderId: String(A._id), admin, force: true }), /not agreed the bill/);
  assert.equal((await qcRow(id)).dispatch.status, 'unassigned');
});
await check('an unapproved rider is refused', async () => {
  const id = await foodOrder();
  await assert.rejects(() => manual.assignRider({ vertical: 'food', orderId: id, foodRiderId: String(D._id), admin, force: true }), /not approved/);
});
await check('the controller validates the rider id and force', async () => {
  const ctl = manualAssignControllers('food');
  const run = (body) => new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); return this; } };
    ctl.assignRider({ params: { orderId: cashOrder }, body, user: { userId: admin.id, role: 'ADMIN' } }, res,
      (err) => resolve({ code: err?.statusCode || 500, body: { message: err?.message } }));
  });
  assert.equal((await run({ deliveryPartnerId: 'nope' })).code, 400);
  assert.equal((await run({ deliveryPartnerId: String(A._id), force: 'yes' })).code, 400);
});

// ---- warnings and force ----------------------------------------------------
console.log('\nwarnings and force');
const farOrder = await foodOrder();
await check('a far rider: warnings come back, nothing changes', async () => {
  const before = await foodRow(farOrder);
  const out = await manual.assignRider({ vertical: 'food', orderId: farOrder, foodRiderId: String(E._id), admin });
  assert.equal(out.needsConfirmation, true);
  assert.deepEqual(out.warnings.map((w) => w.code), ['far']);
  const after = await foodRow(farOrder);
  assert.deepEqual(after.dispatch, before.dispatch);
  assert.equal(after.statusHistory.length, 0);
});
await check('an offline rider with no position, and a cash-heavy rider, are warned about', async () => {
  const off = await manual.assignRider({ vertical: 'food', orderId: farOrder, foodRiderId: String(C._id), admin });
  assert.deepEqual(off.warnings.map((w) => w.code).sort(), ['location_unknown', 'offline']);
  const cash = await manual.assignRider({ vertical: 'food', orderId: farOrder, foodRiderId: String(B._id), admin });
  assert.deepEqual(cash.warnings.map((w) => w.code), ['over_cash_limit']);
  const busy = await manual.assignRider({ vertical: 'food', orderId: farOrder, foodRiderId: String(F._id), admin });
  assert.deepEqual(busy.warnings.map((w) => w.code), ['on_trip']);
});
await check('with force the Food order is assigned, manual, with a 3 minute deadline', async () => {
  const t0 = Date.now();
  const out = await manual.assignRider({ vertical: 'food', orderId: farOrder, foodRiderId: String(E._id), admin, force: true });
  assert.equal(out.needsConfirmation, false);
  assert.equal(out.assignedRider.id, String(E._id));
  const row = await foodRow(farOrder);
  assert.equal(row.dispatch.status, 'assigned');
  assert.equal(String(row.dispatch.deliveryPartnerId), String(E._id));
  assert.equal(row.dispatch.assignMode, 'manual');
  assert.equal(row.dispatch.assignedBy.name, 'Ops Priya');
  assert.equal(String(row.dispatch.assignedBy.adminId), admin.id);
  const left = new Date(row.dispatch.manualDeadlineAt).getTime() - t0;
  assert.ok(left > 170000 && left <= 181000, String(left));
  assert.match(row.statusHistory.at(-1).note, /Esha assigned by Ops Priya/);
  assert.equal(row.dispatch.dispatchingAt, undefined);
});
await check('unassign: back to unassigned, rider dropped, auto-dispatch restarted', async () => {
  const out = await manual.unassignRider({ vertical: 'food', orderId: farOrder, admin });
  assert.equal(out.order.dispatch.status, 'unassigned');
  await wait(1500);
  const row = await foodRow(farOrder);
  assert.equal(row.dispatch.status, 'unassigned');
  assert.equal(row.dispatch.assignMode, 'auto');
  assert.equal(row.dispatch.deliveryPartnerId, null);
  assert.ok(!row.dispatch.manualDeadlineAt);
  const offered = row.dispatch.offeredTo.map((o) => String(o.partnerId));
  assert.ok(!offered.includes(String(E._id)), `the unassigned rider is no longer offered it: ${JSON.stringify({ offered, A: A._id, B: B._id, C: C._id, D: D._id, E: E._id, F: F._id })}`);
  assert.ok(offered.includes(String(A._id)), `auto-dispatch offered it again: ${offered}`);
  assert.match(row.statusHistory.at(-1).note, /unassigned by Ops Priya/);
});

// ---- the rider's side --------------------------------------------------------
console.log('\nassigned rider accepts');
const pick = await foodOrder();
await check('no warnings for a near, online, free rider: assigned straight away', async () => {
  const out = await manual.assignRider({ vertical: 'food', orderId: pick, foodRiderId: String(A._id), admin });
  assert.equal(out.needsConfirmation, false);
  assert.deepEqual(out.warnings, []);
});
await check('auto-dispatch leaves the pick alone inside its window (even past the 55s offer lock)', async () => {
  await FoodOrder.collection.updateOne({ _id: new mongoose.Types.ObjectId(pick) },
    { $set: { 'dispatch.assignedAt': new Date(Date.now() - 120000) } });
  // (Compared as a boolean: a failing assert would otherwise try to print a whole mongoose document.)
  const res = await foodDispatch.tryAutoAssign(pick);
  assert.ok(res === null, 'auto-dispatch claimed the order');
  const row = await foodRow(pick);
  assert.equal(row.dispatch.status, 'assigned');
  assert.equal(String(row.dispatch.deliveryPartnerId), String(A._id));
  assert.ok(!row.dispatch.dispatchingAt);
});
await check('the rider sees it in their available list', async () => {
  const list = await foodDelivery.listOrdersAvailableDelivery(String(A._id), {});
  assert.ok(list.data.some((o) => String(o._id) === pick));
});
await check('the rider accepts: accepted, deadline cleared, busy-lock claimed', async () => {
  await foodDelivery.acceptOrderDelivery(pick, String(A._id));
  const row = await foodRow(pick);
  assert.equal(row.dispatch.status, 'accepted');
  assert.ok(!row.dispatch.manualDeadlineAt);
  const d = await Driver.findById(dA._id).lean();
  assert.ok((d.activeAssignments || []).some((a) => String(a.jobId) === pick), JSON.stringify(d.activeAssignments));
});
await check('unassign of an accepted order is refused', async () => {
  await assert.rejects(() => manual.unassignRider({ vertical: 'food', orderId: pick, admin }), /already accepted/);
});

console.log('\ndecline');
const declined = await foodOrder({ payment: { method: 'razorpay', status: 'paid' } });
await check('the rider declines with a reason: unassigned, noted, auto-dispatch called', async () => {
  // Asha is now on a trip, so it needs force.
  const out = await manual.assignRider({ vertical: 'food', orderId: declined, foodRiderId: String(E._id), admin, force: true });
  assert.equal(out.needsConfirmation, false);
  const ctrlRes = await new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); return this; } };
    foodCtrl.rejectOrderDeliveryController({ params: { orderId: declined }, user: { userId: String(E._id), role: 'DELIVERY_PARTNER' }, body: { reason: 'Bike puncture' } }, res,
      (err) => resolve({ code: err?.statusCode || 500, body: { message: err?.message } }));
  });
  assert.equal(ctrlRes.code, 200, JSON.stringify(ctrlRes.body).slice(0, 300));
  await wait(1500);
  const row = await foodRow(declined);
  assert.equal(row.dispatch.status, 'unassigned');
  assert.equal(row.dispatch.assignMode, 'auto');
  assert.ok(!row.dispatch.manualDeadlineAt);
  assert.ok(row.statusHistory.some((h) => h.note === 'Declined by Esha: Bike puncture'), JSON.stringify(row.statusHistory));
  const mine = row.dispatch.offeredTo.find((o) => String(o.partnerId) === String(E._id));
  assert.equal(mine.action, 'rejected');
  assert.ok(row.dispatch.offeredTo.some((o) => String(o.partnerId) !== String(E._id)), 'auto-dispatch offered it to others');
});
await check('an ordinary reject (not a manual pick) is unchanged', async () => {
  const id = await foodOrder({ dispatch: { status: 'assigned', deliveryPartnerId: E._id, assignedAt: new Date(), offeredTo: [{ partnerId: E._id, at: new Date(), action: 'offered' }] } });
  await foodDelivery.rejectOrderDelivery(id, String(E._id), { reason: 'x' });
  const row = await foodRow(id);
  assert.equal(row.statusHistory.at(-1).note, 'Rejected');
});

console.log('\nexpiry');
const lapsed = await foodOrder({ payment: { method: 'razorpay', status: 'paid' } });
await check('nobody answers: back to unassigned once, idempotent on a second run', async () => {
  await manual.assignRider({ vertical: 'food', orderId: lapsed, foodRiderId: String(C._id), admin, force: true });
  // Not yet due.
  assert.equal((await manual.expireManualAssignments()).food, 0);
  await FoodOrder.collection.updateOne({ _id: new mongoose.Types.ObjectId(lapsed) },
    { $set: { 'dispatch.manualDeadlineAt': new Date(Date.now() - 1000) } });
  const [first, overlapping] = await Promise.all([manual.expireManualAssignments(), manual.expireManualAssignments()]);
  assert.equal(first.food, 1);
  assert.equal(overlapping.skipped, true, 'a second run while one is going is skipped');
  assert.equal((await manual.expireManualAssignments()).food, 0, 'nothing left to expire');
  const row = await foodRow(lapsed);
  assert.equal(row.dispatch.status, 'unassigned');
  assert.equal(row.dispatch.assignMode, 'auto');
  assert.equal(row.statusHistory.filter((h) => /didn't respond/.test(h.note)).length, 1);
  assert.equal(row.dispatch.offeredTo.find((o) => String(o.partnerId) === String(C._id)).action, 'timeout');
});
await check('an expiry that lost the race to an accept leaves the accept alone', async () => {
  const id = await foodOrder({ payment: { method: 'razorpay', status: 'paid' } });
  await manual.assignRider({ vertical: 'food', orderId: id, foodRiderId: String(F._id), admin, force: true });
  await FoodOrder.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) },
    { $set: { 'dispatch.manualDeadlineAt': new Date(Date.now() - 1000), 'dispatch.status': 'accepted', 'dispatch.acceptedAt': new Date() } });
  assert.equal((await manual.expireManualAssignments()).food, 0);
  assert.equal((await foodRow(id)).dispatch.status, 'accepted');
});

// ---- Quick Commerce --------------------------------------------------------
console.log('\nQuick Commerce');
const q1 = await qcOrder();
await check('assign stores the linked Quick rider id', async () => {
  const qcIdB = await link.qcRiderIdForFoodRider(String(B._id));
  // Bala is cash heavy, but this order is prepaid: no warnings.
  const out = await manual.assignRider({ vertical: 'quickCommerce', orderId: q1, foodRiderId: String(B._id), admin });
  assert.equal(out.needsConfirmation, false, JSON.stringify(out.warnings));
  assert.equal(out.assignedRider.partnerId, qcIdB);
  const row = await qcRow(q1);
  assert.equal(row.dispatch.status, 'assigned');
  assert.equal(String(row.dispatch.deliveryPartnerId), qcIdB);
  assert.equal(row.dispatch.assignMode, 'manual');
});
await check('Quick auto-dispatch leaves it alone inside the window', async () => {
  await QcOrder.collection.updateOne({ _id: new mongoose.Types.ObjectId(q1) },
    { $set: { 'dispatch.assignedAt': new Date(Date.now() - 120000) } });
  assert.ok((await qcDispatch.tryAutoAssign(q1)) === null, 'auto-dispatch claimed the order');
  assert.equal((await qcRow(q1)).dispatch.status, 'assigned');
});
await check('the rider sees it and accepts through the FOOD endpoint; lock claimed, deadline cleared', async () => {
  const qcIdB = await link.qcRiderIdForFoodRider(String(B._id));
  const list = await qcDelivery.listOrdersAvailableDelivery(qcIdB, {});
  assert.ok(list.data.some((o) => String(o._id) === q1), 'in the Quick available list');
  const out = await new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); return this; } };
    foodCtrl.acceptOrderDeliveryController({ params: { orderId: q1 }, user: { userId: String(B._id), role: 'DELIVERY_PARTNER' }, body: {} }, res,
      (err) => resolve({ code: err?.statusCode || 500, body: { message: err?.message } }));
  });
  assert.equal(out.code, 200, JSON.stringify(out.body).slice(0, 300));
  const row = await qcRow(q1);
  assert.equal(row.dispatch.status, 'accepted');
  assert.ok(!row.dispatch.manualDeadlineAt);
  const d = await Driver.findById(dB._id).lean();
  assert.ok((d.activeAssignments || []).some((a) => String(a.jobId) === q1), JSON.stringify(d.activeAssignments));
});
await check('a legacy prescription (MED-) order with its bill approved can be assigned', async () => {
  const id = await qcOrder({
    order_id: 'MED-7700002', prescriptionOnly: true, payment: { method: 'cash', status: 'cod_pending' },
    prescription: { required: true, status: 'approved', bill: { status: 'approved', amount: 60 } },
  });
  const out = await manual.assignRider({ vertical: 'quickCommerce', orderId: id, foodRiderId: String(E._id), admin, force: true });
  assert.equal(out.needsConfirmation, false);
  assert.equal((await qcRow(id)).dispatch.status, 'assigned');
});
await check('Quick decline through the Food reject endpoint: unassigned and noted', async () => {
  const id = await qcOrder();
  await manual.assignRider({ vertical: 'quickCommerce', orderId: id, foodRiderId: String(E._id), admin, force: true });
  const out = await new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); return this; } };
    foodCtrl.rejectOrderDeliveryController({ params: { orderId: id }, user: { userId: String(E._id), role: 'DELIVERY_PARTNER' }, body: { reason: 'Too far' } }, res,
      (err) => resolve({ code: err?.statusCode || 500, body: { message: err?.message } }));
  });
  assert.equal(out.code, 200, JSON.stringify(out.body).slice(0, 300));
  const row = await qcRow(id);
  assert.equal(row.dispatch.status, 'unassigned');
  assert.equal(row.dispatch.assignMode, 'auto');
  assert.ok(row.statusHistory.some((h) => h.note === 'Declined by Esha: Too far'), JSON.stringify(row.statusHistory));
});
await check('Quick unassign marks the rider deassigned; Quick expiry works too', async () => {
  const id = await qcOrder();
  await manual.assignRider({ vertical: 'quickCommerce', orderId: id, foodRiderId: String(E._id), admin, force: true });
  await manual.unassignRider({ vertical: 'quickCommerce', orderId: id, admin });
  const row = await qcRow(id);
  assert.equal(row.dispatch.status, 'unassigned');
  const qcIdE = await link.qcRiderIdForFoodRider(String(E._id));
  assert.equal(row.dispatch.offeredTo.find((o) => String(o.partnerId) === qcIdE).action, 'deassigned');

  const id2 = await qcOrder();
  await manual.assignRider({ vertical: 'quickCommerce', orderId: id2, foodRiderId: String(E._id), admin, force: true });
  await QcOrder.collection.updateOne({ _id: new mongoose.Types.ObjectId(id2) },
    { $set: { 'dispatch.manualDeadlineAt': new Date(Date.now() - 1000) } });
  const r = await manual.expireManualAssignments();
  assert.equal(r.quickCommerce, 1);
  assert.equal((await qcRow(id2)).dispatch.status, 'unassigned');
});

await wait(500);
await mongoose.disconnect();
await replSet.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall manual-assign checks passed');
process.exit(failed ? 1 : 0);
