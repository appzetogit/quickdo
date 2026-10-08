/**
 * One driver for taxi rides and deliveries (SOW plan §8), end to end on an in-memory DB.
 *
 *   - the backfill: dry run by default (reports, writes nothing, lists conflicts),
 *     --apply links, a second --apply changes nothing;
 *   - flag OFF: food dispatch and the job feed behave exactly as before;
 *   - flag ON: a driver with both capabilities in work mode 'all' is offered food,
 *     grocery and taxi jobs on one `job:offer` feed; holding one job locks them out of
 *     the others; work mode 'taxi' keeps food away; a riderFinance block (cash ceiling)
 *     keeps them out of every candidate list at dispatch time; the pilot-zone setting
 *     scopes the unified pool; QC self-pickup orders are never dispatched;
 *   - GET /taxi/drivers/jobs/active lists every held job, and the delivery session
 *     issues a delivery-partner token for the driver's own linked record only.
 *
 * Run:  node tests/unified-dispatch.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, '..', 'scripts', 'migrate-unify-drivers.js');

let failed = 0;
let passed = 0;
const check = async (label, fn) => {
  try { await fn(); passed += 1; console.log(`  PASS  ${label}`); }
  catch (e) { failed += 1; console.log(`  FAIL  ${label}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ') || e.message}`); }
};
const oid = () => new mongoose.Types.ObjectId();
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
console.log('Booting in-memory MongoDB replica set...');
const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
const uri = rs.getUri();
await mongoose.connect(uri, { dbName: 'unified_dispatch' });
console.log('Connected.\n');

const { config, env } = await import('../src/config/env.js');
const setFlag = (on) => { config.unifiedDispatchEnabled = on; env.unifiedDispatchEnabled = on; };
setFlag(false);

const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const QC = '../src/modules/quickCommerce/modules/food';
const { FoodRestaurant: QcStore } = await import(`${QC}/restaurant/models/restaurant.model.js`);
const { FoodOrder: QcOrder } = await import(`${QC}/orders/models/order.model.js`);
const foodDispatch = await import('../src/modules/food/orders/services/order-dispatch.service.js');
const qcDispatch = await import(`${QC}/orders/services/order-dispatch.service.js`);
const { migrateUnifyDrivers } = await import('../scripts/migrate-unify-drivers.js');
const { claimAssignment, releaseAssignment } = await import('../src/core/assignment/assignment.service.js');
const { matchDrivers } = await import('../src/modules/taxi/services/matchingService.js');
const { emitToRoom } = await import('../src/modules/taxi/services/dispatchService.js');
const jobFeed = await import('../src/core/dispatch/jobFeed.js');
const unified = await import('../src/core/dispatch/unifiedDispatch.js');
const settings = await import('../src/core/config/resolver.service.js');
const { getActiveJobs, createDeliverySession } = await import('../src/modules/taxi/driver/controllers/unifiedJobsController.js');
const { verifyAccessToken } = await import('../src/core/auth/token.util.js');
await Driver.init();

// Every job:offer / job:cancelled the feed sends, instead of a live socket server.
const feed = [];
jobFeed.__setJobFeedEmitterForTests((e) => feed.push(e));
const offersTo = (driverId, jobType) => feed.filter((e) => e.event === 'job:offer'
  && e.driverId === String(driverId) && (!jobType || e.payload.jobType === jobType));

const setSetting = (key, value) => settings.set(key, { level: 'global', scopeId: '*', value, updatedBy: 'test', reason: 'test' });

// ------------------------------------------------------------------ migration
console.log('[1] migration: dry run by default, conflicts, apply, idempotent');

const HERE = [75.88, 22.72]; // [lng, lat]
const dualDriver = await Driver.create({
  name: 'Asha Rao', phone: '+919700000001', password: 'secret123', vehicleType: 'bike',
  serviceCapabilities: ['taxi'], workMode: 'all', approve: true, status: 'approved',
  location: { type: 'Point', coordinates: [HERE[0], HERE[1] + 0.01] },
});
const dualPartner = await FoodDeliveryPartner.create({
  name: 'Asha', phone: '9700000001', status: 'approved', availabilityStatus: 'offline', vehicleType: 'bike',
});
// Conflicts.
await Driver.create({ name: 'Ravi Kumar', phone: '+919700000002', password: 'secret123', vehicleType: 'car', location: { type: 'Point', coordinates: HERE } });
const mismatch = await FoodDeliveryPartner.create({ name: 'Suresh Patel', phone: '9700000002', status: 'approved' });
const dupA = await FoodDeliveryPartner.create({ name: 'Dup A', phone: '9700000003', status: 'approved' });
await FoodDeliveryPartner.create({ name: 'Dup B', phone: '+91 97000 00003', status: 'approved' });
await Driver.create({ name: 'Twin', phone: '+919700000004', password: 'secret123', vehicleType: 'car', location: { type: 'Point', coordinates: HERE } });
await Driver.create({ name: 'Twin', phone: '09700000004', password: 'secret123', vehicleType: 'car', location: { type: 'Point', coordinates: HERE } });
await FoodDeliveryPartner.create({ name: 'Twin', phone: '9700000004', status: 'approved' });
// Delivery-only partner: becomes a new delivery-only driver.
const soloPartner = await FoodDeliveryPartner.create({ name: 'Meena', phone: '9700000005', status: 'approved' });

const driversBefore = await Driver.countDocuments();

await check('dry run (the default, via the CLI) writes nothing and reports links, creates and conflicts', async () => {
  const { stdout } = await execFileP(process.execPath, [scriptPath, '--json'], {
    env: { ...process.env, MONGODB_URI: uri, MONGO_URI: uri, MONGODB_DB_NAME: 'unified_dispatch' },
  });
  const report = JSON.parse(stdout.trim().split('\n').pop());
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.stats.linked, 1, JSON.stringify(report.stats));
  assert.equal(report.stats.created, 1);
  const codes = report.conflicts.map((c) => c.code).sort();
  assert.ok(codes.includes('name_mismatch'), codes.join());
  assert.ok(codes.includes('ambiguous_driver_match'), codes.join());
  assert.equal(codes.filter((c) => c === 'duplicate_partner_phone').length, 2, codes.join());
  assert.ok(report.conflicts.some((c) => c.code === 'name_mismatch' && c.partnerId === String(mismatch._id)));
  assert.ok(report.conflicts.some((c) => c.code === 'duplicate_partner_phone' && c.partnerId === String(dupA._id)));
  // Nothing written.
  assert.equal(await Driver.countDocuments(), driversBefore);
  assert.equal((await FoodDeliveryPartner.findById(dualPartner._id).lean()).driverId ?? null, null);
  assert.deepEqual((await Driver.findById(dualDriver._id).lean()).serviceCapabilities, ['taxi']);
});

let firstApply;
await check('--apply links the same person, creates the delivery-only driver, skips conflicts', async () => {
  firstApply = await migrateUnifyDrivers({ apply: true });
  const d = await Driver.findById(dualDriver._id).lean();
  assert.deepEqual([...d.serviceCapabilities].sort(), ['delivery', 'quickCommerce', 'taxi']);
  assert.equal(String(d.legacyDeliveryPartnerId), String(dualPartner._id));
  assert.equal(String((await FoodDeliveryPartner.findById(dualPartner._id).lean()).driverId), String(dualDriver._id));
  const solo = await FoodDeliveryPartner.findById(soloPartner._id).lean();
  assert.ok(solo.driverId, 'delivery-only driver created and linked');
  assert.equal((await FoodDeliveryPartner.findById(mismatch._id).lean()).driverId ?? null, null, 'conflict left alone');
  assert.equal(await Driver.countDocuments(), driversBefore + 1);
});

await check('a second --apply is idempotent: no writes, nothing new, same conflicts', async () => {
  const again = await migrateUnifyDrivers({ apply: true });
  assert.equal(again.actions.length, 0, JSON.stringify(again.actions));
  assert.equal(again.stats.created, 0);
  assert.equal(again.stats.linked, 0);
  assert.equal(again.stats.alreadyLinked, 2);
  assert.equal(again.stats.conflicts, firstApply.stats.conflicts);
  assert.equal(await Driver.countDocuments(), driversBefore + 1);
  const d = await Driver.findById(dualDriver._id).lean();
  assert.equal(d.serviceCapabilities.filter((c) => c === 'delivery').length, 1);
});

// ------------------------------------------------------------------ dispatch world
const restaurant = await FoodRestaurant.create({
  restaurantName: 'Thali House', ownerName: 'O', status: 'approved',
  location: { type: 'Point', coordinates: HERE, latitude: HERE[1], longitude: HERE[0], addressLine1: 'MG Road' },
});
// A rider still on the old delivery app only: never migrated, online with fresh GPS.
const legacyRider = await FoodDeliveryPartner.create({
  name: 'Legacy', phone: '9700000010', status: 'approved', availabilityStatus: 'online',
  lastLat: HERE[1] + 0.02, lastLng: HERE[0], lastLocationAt: new Date(),
});
// The dual driver goes online in the driver app (taxi side), at the restaurant's doorstep.
// Rs 500 in the taxi wallet: above the taxi minimum balance (Rs 100 by default), which the
// dispatch-time riderFinance gate applies to rides exactly as accept always has.
await Driver.updateOne({ _id: dualDriver._id }, { $set: { isOnline: true, approve: true, workMode: 'all', 'wallet.balance': 500 } });

const foodCandidates = async () => (await foodDispatch.__testables.listNearbyOnlineDeliveryPartners(restaurant._id, { maxKm: 15 }))
  .partners.map((p) => String(p.partnerId));
const taxiCandidates = async () => (await matchDrivers([HERE[0], HERE[1]], { maxDistance: 5000, limit: 10 }))
  .drivers.map((d) => String(d._id));
const qcEligible = async () => (await unified.unifiedDeliveryCandidates('quickCommerce', HERE, { maxKm: 15 }))
  .map((c) => String(c.driverId));

const newFoodOrder = async (over = {}) => {
  const id = oid();
  await FoodOrder.collection.insertOne({
    _id: id, order_id: `FOD-U${String(id).slice(-6)}`, orderStatus: 'confirmed',
    userId: oid(), restaurantId: restaurant._id,
    items: [{ itemId: oid(), name: 'Thali', price: 150, quantity: 1 }],
    pricing: { subtotal: 150, deliveryFee: 30, total: 180 }, riderEarning: 40,
    payment: { method: 'razorpay', status: 'paid' },
    deliveryAddress: { street: '12 MG Road', city: 'Indore', state: 'MP', location: { type: 'Point', coordinates: [HERE[0], HERE[1] + 0.03] } },
    dispatch: { status: 'unassigned', offeredTo: [] },
    createdAt: new Date(), updatedAt: new Date(), ...over,
  });
  return String(id);
};
const ridePayload = (rideId) => ({
  rideId: String(rideId), type: 'ride', serviceType: 'ride', fare: 120, paymentMethod: 'cash',
  pickupLocation: { type: 'Point', coordinates: HERE }, pickupAddress: 'MG Road',
  dropLocation: { type: 'Point', coordinates: [HERE[0] + 0.02, HERE[1]] }, dropAddress: 'Palasia',
  estimatedDistanceMeters: 2300, estimatedDurationMinutes: 9, expiresInSeconds: 30, zoneId: null,
});

// ------------------------------------------------------------------ flag off
console.log('\n[2] flag OFF: old behaviour');

await check('food dispatch draws only on the delivery-app pool (driver pool untouched)', async () => {
  const ids = await foodCandidates();
  assert.ok(ids.includes(String(legacyRider._id)), 'legacy rider still offered');
  assert.ok(!ids.includes(String(dualPartner._id)), 'driver-app rider not drawn in while the flag is off');
});

await check('no job:offer / job:cancelled is emitted for food or taxi', async () => {
  const before = feed.length;
  const orderId = await newFoodOrder();
  await foodDispatch.tryAutoAssign(orderId);
  emitToRoom(`driver:${dualDriver._id}`, 'rideRequest', ridePayload(oid()));
  emitToRoom(`driver:${dualDriver._id}`, 'rideRequestClosed', { rideId: String(oid()) });
  await tick(100);
  assert.equal(feed.length, before, JSON.stringify(feed.slice(before)));
  const row = await FoodOrder.findById(orderId).lean();
  assert.ok(row.dispatch.offeredTo.some((o) => String(o.partnerId) === String(legacyRider._id)), 'legacy rider was offered as before');
});

await check('the delivery session is refused while the flag is off', async () => {
  const out = await callController(createDeliverySession, dualDriver._id);
  assert.equal(out.status, 404);
});

// ------------------------------------------------------------------ flag on
console.log('\n[3] flag ON: one driver, one feed');
setFlag(true);

await check('the dual driver (work mode all) is a candidate for food, grocery and taxi', async () => {
  const food = await foodCandidates();
  assert.ok(food.includes(String(dualPartner._id)), `food: ${food}`);
  assert.ok(food.includes(String(legacyRider._id)), 'unmigrated delivery-app rider still in the pool');
  assert.ok((await qcEligible()).includes(String(dualDriver._id)), 'grocery');
  assert.ok((await taxiCandidates()).includes(String(dualDriver._id)), 'taxi');
});

await check('a food order reaches the driver as job:offer (jobType food) in addition to new_order', async () => {
  const orderId = await newFoodOrder();
  await foodDispatch.tryAutoAssign(orderId);
  const offers = offersTo(dualDriver._id, 'food').filter((e) => e.payload.jobId === orderId);
  assert.equal(offers.length, 1, JSON.stringify(feed.map((e) => [e.event, e.payload.jobType, e.payload.jobId])));
  const o = offers[0].payload;
  assert.equal(o.accept.method, 'PATCH');
  assert.equal(o.accept.path, `/api/v1/food/delivery/orders/${orderId}/accept`);
  assert.equal(o.pickup.name, 'Thali House');
  assert.equal(o.earning, 40);
  const row = await FoodOrder.findById(orderId).lean();
  assert.ok(row.dispatch.offeredTo.some((x) => String(x.partnerId) === String(dualPartner._id)), 'offered as the linked partner');
});

await check('a ride request reaches the same driver as job:offer (jobType taxi); closing it sends job:cancelled', async () => {
  const rideId = String(oid());
  emitToRoom(`driver:${dualDriver._id}`, 'rideRequest', ridePayload(rideId));
  emitToRoom(`driver:${dualDriver._id}`, 'rideRequestClosed', { rideId, reason: 'accepted-by-other' });
  await tick(150);
  const offer = offersTo(dualDriver._id, 'taxi').find((e) => e.payload.jobId === rideId);
  assert.ok(offer, 'taxi job:offer');
  assert.equal(offer.payload.accept.transport, 'socket');
  assert.equal(offer.payload.accept.event, 'acceptRide');
  assert.equal(offer.payload.tripDistanceKm, 2.3);
  assert.ok(feed.some((e) => e.event === 'job:cancelled' && e.payload.jobId === rideId && e.payload.jobType === 'taxi'));
});

await check('holding a ride locks the driver out of food, grocery and other rides', async () => {
  const rideId = oid();
  const { claimed } = await claimAssignment(dualDriver._id, { vertical: 'taxi', jobId: rideId });
  assert.ok(claimed);
  try {
    assert.ok(!(await foodCandidates()).includes(String(dualPartner._id)), 'no food while on a ride');
    assert.ok(!(await qcEligible()).includes(String(dualDriver._id)), 'no grocery while on a ride');
    assert.ok(!(await taxiCandidates()).includes(String(dualDriver._id)), 'no second ride');
    const before = offersTo(dualDriver._id, 'food').length;
    await foodDispatch.tryAutoAssign(await newFoodOrder());
    assert.equal(offersTo(dualDriver._id, 'food').length, before, 'no food job:offer while locked');
  } finally {
    await releaseAssignment(dualDriver._id, rideId);
  }
  assert.ok((await foodCandidates()).includes(String(dualPartner._id)), 'free again after release');
});

await check('GET /taxi/drivers/jobs/active lists every held job (ride + food order)', async () => {
  const ride = await Ride.collection.insertOne({
    userId: oid(), driverId: dualDriver._id, status: 'accepted', liveStatus: 'accepted', fare: 120,
    pickupAddress: 'MG Road', dropAddress: 'Palasia', paymentMethod: 'cash',
    pickupLocation: { type: 'Point', coordinates: HERE }, dropLocation: { type: 'Point', coordinates: HERE },
    createdAt: new Date(), updatedAt: new Date(),
  });
  const orderId = await newFoodOrder({ orderStatus: 'picked_up', dispatch: { status: 'accepted', deliveryPartnerId: dualPartner._id, acceptedAt: new Date() } });
  await claimAssignment(dualDriver._id, { vertical: 'taxi', jobId: ride.insertedId });
  try {
    const out = await callController(getActiveJobs, dualDriver._id);
    assert.equal(out.status, 200);
    const jobs = out.body.data.jobs;
    assert.ok(jobs.some((j) => j.jobType === 'taxi' && j.jobId === String(ride.insertedId) && j.lockHeld), JSON.stringify(jobs));
    assert.ok(jobs.some((j) => j.jobType === 'food' && j.jobId === orderId), JSON.stringify(jobs));
    assert.equal(out.body.data.busy, true);
  } finally {
    await releaseAssignment(dualDriver._id, ride.insertedId);
    await Ride.collection.updateOne({ _id: ride.insertedId }, { $set: { status: 'completed' } });
    await FoodOrder.collection.updateOne({ _id: new mongoose.Types.ObjectId(orderId) }, { $set: { orderStatus: 'delivered' } });
  }
});

await check('work mode "taxi" keeps food and grocery away but rides still come', async () => {
  await Driver.updateOne({ _id: dualDriver._id }, { $set: { workMode: 'taxi' } });
  try {
    assert.ok(!(await foodCandidates()).includes(String(dualPartner._id)), 'no food in taxi mode');
    assert.ok(!(await qcEligible()).includes(String(dualDriver._id)), 'no grocery in taxi mode');
    assert.ok((await taxiCandidates()).includes(String(dualDriver._id)), 'rides still offered');
  } finally {
    await Driver.updateOne({ _id: dualDriver._id }, { $set: { workMode: 'all' } });
  }
});

await check('a riderFinance block (over the shared cash ceiling) excludes them from every candidate list', async () => {
  await setSetting('finance.cashLimit', 500);
  // Rs 600 of platform cash held from rides: taxi encodes it as a negative balance.
  await Driver.updateOne({ _id: dualDriver._id }, { $set: { 'wallet.balance': -600 } });
  try {
    const { kept: foodKept, blocked } = await unified.filterByRiderFinance([{ partnerId: dualPartner._id }], { vertical: 'food' });
    assert.equal(foodKept.length, 0);
    assert.equal(blocked.get(String(dualPartner._id)), 'cash_limit_reached');
    assert.ok(!(await taxiCandidates()).includes(String(dualDriver._id)), 'no rides at dispatch time');
    const orderId = await newFoodOrder();
    await foodDispatch.tryAutoAssign(orderId);
    assert.equal(offersTo(dualDriver._id, 'food').filter((e) => e.payload.jobId === orderId).length, 0, 'no food job:offer');
    const row = await FoodOrder.findById(orderId).lean();
    assert.ok(!row.dispatch.offeredTo.some((x) => String(x.partnerId) === String(dualPartner._id)), 'not offered on new_order either');
    assert.ok(row.dispatch.offeredTo.some((x) => String(x.partnerId) === String(legacyRider._id)), 'others still offered');
  } finally {
    await Driver.updateOne({ _id: dualDriver._id }, { $set: { 'wallet.balance': 500 } });
    await setSetting('finance.cashLimit', null);
  }
  assert.ok((await taxiCandidates()).includes(String(dualDriver._id)), 'eligible again once settled');
});

await check('pilot zones: outside the listed zones the driver pool is not used', async () => {
  await setSetting('dispatch.unifiedZones', [String(oid())]);
  try {
    assert.equal(await unified.isUnifiedDispatchActive([null]), false);
    const ids = await foodCandidates();
    assert.ok(!ids.includes(String(dualPartner._id)), 'driver pool not used outside the pilot');
    assert.ok(ids.includes(String(legacyRider._id)));
  } finally {
    await setSetting('dispatch.unifiedZones', []);
  }
  assert.equal(await unified.isUnifiedDispatchActive([null]), true, '[] = every zone');
});

// ------------------------------------------------------------------ quick commerce
console.log('\n[4] quick commerce');
const store = await QcStore.create({
  restaurantName: 'Corner Kirana', ownerName: 'O', ownerPhone: '9000000201', status: 'approved',
  location: { type: 'Point', coordinates: HERE, latitude: HERE[1], longitude: HERE[0], addressLine1: 'Kirana road' },
});
const newQcOrder = async (over = {}) => {
  const id = oid();
  await QcOrder.collection.insertOne({
    _id: id, order_id: `QC-U${String(id).slice(-6)}`, orderStatus: 'confirmed',
    userId: oid(), restaurantId: store._id,
    items: [{ itemId: oid(), name: 'Rice 5kg', price: 300, quantity: 1 }],
    pricing: { subtotal: 300, deliveryFee: 30, total: 330 }, riderEarning: 35,
    payment: { method: 'razorpay', status: 'paid' },
    deliveryAddress: { street: '12 MG Road', city: 'Indore', state: 'MP', location: { type: 'Point', coordinates: [HERE[0], HERE[1] + 0.01] } },
    dispatch: { status: 'unassigned', offeredTo: [] },
    createdAt: new Date(), updatedAt: new Date(), ...over,
  });
  return String(id);
};

await check('a self-pickup grocery order is never dispatched, and nobody gets a job:offer for it', async () => {
  const orderId = await newQcOrder({ fulfilmentType: 'pickup', pricing: { subtotal: 300, total: 300 } });
  assert.equal(await qcDispatch.tryAutoAssign(orderId), null);
  const row = await QcOrder.findById(orderId).lean();
  assert.equal(row.dispatch.status, 'unassigned');
  assert.equal((row.dispatch.offeredTo || []).length, 0);
  assert.equal(feed.filter((e) => e.payload?.jobId === orderId).length, 0);
});

await check('a grocery delivery reaches the dual driver as job:offer (jobType quick_commerce)', async () => {
  const orderId = await newQcOrder();
  await qcDispatch.tryAutoAssign(orderId);
  const offer = offersTo(dualDriver._id, 'quick_commerce').find((e) => e.payload.jobId === orderId);
  if (!offer) {
    const near = await qcDispatch.__testables.listNearbyOnlineDeliveryPartners(store._id, { maxKm: 3 });
    const pool = await unified.unifiedDeliveryCandidates('quickCommerce', HERE, { maxKm: 3 });
    console.log('        debug', JSON.stringify({ near, pool, order: await QcOrder.findById(orderId).select('dispatch').lean() }));
  }
  assert.ok(offer, JSON.stringify(feed.slice(-5).map((e) => [e.event, e.payload.jobType, e.payload.jobId])));
  assert.equal(offer.payload.accept.path, `/api/v1/food/delivery/orders/${orderId}/accept`);
});

// ------------------------------------------------------------------ delivery session
console.log('\n[5] delivery session');
await check('the driver gets a delivery-partner token for their OWN linked record', async () => {
  const out = await callController(createDeliverySession, dualDriver._id);
  assert.equal(out.status, 201, JSON.stringify(out.body));
  const claims = verifyAccessToken(out.body.data.accessToken);
  assert.equal(claims.role, 'DELIVERY_PARTNER');
  assert.equal(claims.userId, String(dualPartner._id));
});

await check('a taxi-only driver is refused a delivery session', async () => {
  const taxiOnly = await Driver.create({
    name: 'Taxi Only', phone: '+919700000020', password: 'secret123', vehicleType: 'car', approve: true,
    serviceCapabilities: ['taxi'], location: { type: 'Point', coordinates: HERE },
  });
  const out = await callController(createDeliverySession, taxiOnly._id);
  assert.equal(out.status, 403);
});

setFlag(false);
jobFeed.__setJobFeedEmitterForTests(null);
await mongoose.disconnect().catch(() => {});
await rs.stop().catch(() => {});
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);

// ------------------------------------------------------------------ helpers
async function callController(handler, driverId) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
  };
  try {
    await handler({ auth: { sub: String(driverId), role: 'driver' }, body: {}, params: {}, query: {} }, res);
    return { status: res.statusCode, body: res.body };
  } catch (err) {
    return { status: err.statusCode || 500, body: { message: err.message } };
  }
}
