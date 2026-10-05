/**
 * Phase 2 verification: the cross-service driver busy-lock (driverAssignmentService).
 * Isolated in-memory MongoDB replica set; never touches Atlas.
 *
 * Run:  node tests/assignment.smoke.mjs
 */
import assert from 'assert';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`  PASS  ${name}`); }
  catch (err) { results.push({ name, ok: false, err }); console.log(`  FAIL  ${name}\n        ${err.message}`); }
};
const oid = () => new mongoose.Types.ObjectId();

async function main() {
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  console.log('Booting in-memory MongoDB replica set…');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'assign' });
  console.log('Connected.\n');

  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { acquireDriverAssignment, releaseDriverAssignment, forceClearDriverAssignment } =
    await import('../src/modules/taxi/driver/services/driverAssignmentService.js');

  let phoneSeq = 9000000000;
  const newDriver = () => Driver.create({
    name: 'D', phone: `+91${phoneSeq++}`,
    password: 'secret123', vehicleType: 'car', location: { type: 'Point', coordinates: [72, 23] },
  });

  await test('acquire on a free driver succeeds and sets the lock', async () => {
    const d = await newDriver();
    const rideId = oid();
    assert.equal(await acquireDriverAssignment(d._id, 'ride', rideId), true);
    const fresh = await Driver.findById(d._id).lean();
    assert.equal(fresh.activeAssignment.type, 'ride');
    assert.equal(String(fresh.activeAssignment.id), String(rideId));
  });

  await test('a delivery cannot lock a driver already on a ride (mutual exclusion)', async () => {
    const d = await newDriver();
    assert.equal(await acquireDriverAssignment(d._id, 'ride', oid()), true);
    assert.equal(await acquireDriverAssignment(d._id, 'delivery', oid()), false, 'must be refused');
  });

  await test('re-acquiring the SAME assignment is idempotent (accept retry)', async () => {
    const d = await newDriver();
    const rideId = oid();
    assert.equal(await acquireDriverAssignment(d._id, 'ride', rideId), true);
    assert.equal(await acquireDriverAssignment(d._id, 'ride', rideId), true, 'same id re-acquire ok');
  });

  await test('concurrent acquires of different jobs: exactly one wins', async () => {
    const d = await newDriver();
    const [a, b, c] = await Promise.all([
      acquireDriverAssignment(d._id, 'ride', oid()),
      acquireDriverAssignment(d._id, 'delivery', oid()),
      acquireDriverAssignment(d._id, 'ride', oid()),
    ]);
    assert.equal([a, b, c].filter(Boolean).length, 1, 'only one of three may win the lock');
  });

  await test('release only clears when it still holds THIS assignment', async () => {
    const d = await newDriver();
    const rideId = oid();
    await acquireDriverAssignment(d._id, 'ride', rideId);
    // stale release for a different id must NOT clear
    assert.equal(await releaseDriverAssignment(d._id, oid()), false, 'stale release is a no-op');
    let fresh = await Driver.findById(d._id).lean();
    assert.ok(fresh.activeAssignment, 'lock still held after stale release');
    // correct release clears
    assert.equal(await releaseDriverAssignment(d._id, rideId), true);
    fresh = await Driver.findById(d._id).lean();
    assert.equal(fresh.activeAssignment, null, 'lock cleared');
  });

  await test('driver is re-lockable after release', async () => {
    const d = await newDriver();
    const r1 = oid();
    await acquireDriverAssignment(d._id, 'ride', r1);
    await releaseDriverAssignment(d._id, r1);
    assert.equal(await acquireDriverAssignment(d._id, 'delivery', oid()), true, 'free again');
  });

  await test('forceClear recovers a stuck lock', async () => {
    const d = await newDriver();
    await acquireDriverAssignment(d._id, 'ride', oid());
    assert.equal(await forceClearDriverAssignment(d._id), true);
    assert.equal((await Driver.findById(d._id).lean()).activeAssignment, null);
  });

  // ---- stale-lock self-heal ----
  const { reconcileDriverAssignment } = await import('../src/modules/taxi/driver/services/driverAssignmentService.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');

  const mkRide = (status) => Ride.create({
    userId: oid(), status, liveStatus: status === 'completed' ? 'completed' : 'accepted',
    fare: 100, baseFare: 100,
    pickupLocation: { type: 'Point', coordinates: [72, 23] },
    dropLocation: { type: 'Point', coordinates: [72.1, 23.1] },
  });

  await test('reconcile clears a lock whose ride is already COMPLETED', async () => {
    const d = await newDriver();
    const ride = await mkRide('completed');
    await acquireDriverAssignment(d._id, 'ride', ride._id);
    assert.equal(await reconcileDriverAssignment(d._id), true, 'should clear');
    assert.equal((await Driver.findById(d._id).lean()).activeAssignment, null);
  });

  await test('reconcile clears a lock whose ride no longer exists', async () => {
    const d = await newDriver();
    await acquireDriverAssignment(d._id, 'ride', oid()); // dangling id
    assert.equal(await reconcileDriverAssignment(d._id), true);
    assert.equal((await Driver.findById(d._id).lean()).activeAssignment, null);
  });

  await test('reconcile does NOT free a lock on a LIVE ride', async () => {
    const d = await newDriver();
    const ride = await mkRide('accepted');
    await acquireDriverAssignment(d._id, 'ride', ride._id);
    assert.equal(await reconcileDriverAssignment(d._id), false, 'must leave live job alone');
    assert.ok((await Driver.findById(d._id).lean()).activeAssignment, 'lock still held');
  });

  await test('reconcile clears a lock whose order is DELIVERED', async () => {
    const d = await newDriver();
    const order = await FoodOrder.create({
      userId: oid(), restaurantId: oid(), orderStatus: 'delivered',
      items: [{ itemId: oid(), name: 'x', price: 10, quantity: 1 }],
      deliveryAddress: { street: 's', city: 'c', state: 'st', location: { type: 'Point', coordinates: [72, 23] } },
      pricing: { subtotal: 10, total: 10 }, payment: { method: 'cash' },
    });
    await acquireDriverAssignment(d._id, 'delivery', order._id);
    assert.equal(await reconcileDriverAssignment(d._id), true);
  });

  await test('reconcile is a no-op for a free driver', async () => {
    const d = await newDriver();
    assert.equal(await reconcileDriverAssignment(d._id), false);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await mongoose.disconnect().catch(() => {});
  await replSet.stop().catch(() => {});
  return failed.length;
}

let code = 1;
try { code = await main(); } catch (err) { console.error('Harness error:', err); code = 1; }
process.exit(code === 0 ? 0 : 1);
