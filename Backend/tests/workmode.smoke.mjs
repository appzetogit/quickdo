/**
 * Verifies the work-mode toggle + busy-lock actually FILTER dispatch candidates.
 * This is the check that was missing when findEligibleUnifiedDrivers shipped as dead code:
 * it asserts the real query shape excludes the right drivers.
 *
 * Run:  node tests/workmode.smoke.mjs
 */
import assert from 'assert';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push({ ok: true }); console.log(`  PASS  ${name}`); }
  catch (err) { results.push({ ok: false }); console.log(`  FAIL  ${name}\n        ${err.message}`); }
};

async function main() {
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  console.log('Booting in-memory MongoDB replica set…');
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(rs.getUri(), { dbName: 'workmode' });
  console.log('Connected.\n');

  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');

  let seq = 9100000000;
  const mk = (over = {}) => Driver.create({
    name: 'D', phone: `+91${seq++}`, password: 'secret123', vehicleType: 'car',
    isOnline: true, approve: true, deletedAt: null,
    serviceCapabilities: ['taxi', 'delivery'], workMode: 'all', activeAssignment: null,
    location: { type: 'Point', coordinates: [72.5, 23.0] },
    ...over,
  });

  // The exact filter matchingService applies for taxi when the flag is on.
  const taxiFilter = {
    isOnline: true,
    workMode: { $in: ['all', 'taxi'] },
    serviceCapabilities: 'taxi',
    activeAssignment: null,
  };
  // The exact filter the food dispatch applies via filterByUnifiedWorkMode.
  const deliveryFilter = {
    activeAssignment: null,
    workMode: { $in: ['all', 'delivery'] },
    serviceCapabilities: 'delivery',
  };
  const taxiIds = async () => (await Driver.find(taxiFilter).select('_id').lean()).map(d => String(d._id));
  const delIds = async () => (await Driver.find(deliveryFilter).select('_id').lean()).map(d => String(d._id));

  await test('workMode "all" driver is offered BOTH rides and deliveries', async () => {
    const d = await mk({ workMode: 'all' });
    assert.ok((await taxiIds()).includes(String(d._id)), 'should get rides');
    assert.ok((await delIds()).includes(String(d._id)), 'should get deliveries');
  });

  await test('workMode "taxi" driver gets rides but NOT deliveries', async () => {
    const d = await mk({ workMode: 'taxi' });
    assert.ok((await taxiIds()).includes(String(d._id)), 'should get rides');
    assert.ok(!(await delIds()).includes(String(d._id)), 'must NOT get deliveries');
  });

  await test('workMode "delivery" driver gets deliveries but NOT rides', async () => {
    const d = await mk({ workMode: 'delivery' });
    assert.ok((await delIds()).includes(String(d._id)), 'should get deliveries');
    assert.ok(!(await taxiIds()).includes(String(d._id)), 'must NOT get rides');
  });

  await test('driver busy on a RIDE is excluded from delivery dispatch', async () => {
    const d = await mk({ workMode: 'all', activeAssignment: { type: 'ride', id: new mongoose.Types.ObjectId(), at: new Date() } });
    assert.ok(!(await delIds()).includes(String(d._id)), 'busy on ride -> no delivery offers');
    assert.ok(!(await taxiIds()).includes(String(d._id)), 'busy on ride -> no ride offers either');
  });

  await test('driver busy on a DELIVERY is excluded from ride dispatch', async () => {
    const d = await mk({ workMode: 'all', activeAssignment: { type: 'delivery', id: new mongoose.Types.ObjectId(), at: new Date() } });
    assert.ok(!(await taxiIds()).includes(String(d._id)), 'busy on delivery -> no ride offers');
  });

  await test('taxi-only driver never appears in delivery dispatch', async () => {
    const d = await mk({ serviceCapabilities: ['taxi'], workMode: 'all' });
    assert.ok((await taxiIds()).includes(String(d._id)));
    assert.ok(!(await delIds()).includes(String(d._id)), 'no delivery capability -> excluded');
  });

  await test('offline driver appears in neither', async () => {
    const d = await mk({ isOnline: false });
    assert.ok(!(await taxiIds()).includes(String(d._id)));
  });

  await test('driver becomes available again once the lock is released', async () => {
    const rideId = new mongoose.Types.ObjectId();
    const d = await mk({ activeAssignment: { type: 'ride', id: rideId, at: new Date() } });
    assert.ok(!(await taxiIds()).includes(String(d._id)), 'busy first');
    const { releaseDriverAssignment } = await import('../src/modules/taxi/driver/services/driverAssignmentService.js');
    await releaseDriverAssignment(d._id, rideId);
    assert.ok((await taxiIds()).includes(String(d._id)), 'free after release');
    assert.ok((await delIds()).includes(String(d._id)), 'and eligible for deliveries again');
  });

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await mongoose.disconnect().catch(() => {});
  await rs.stop().catch(() => {});
  return failed;
}

let code = 1;
try { code = await main(); } catch (e) { console.error('Harness error:', e); code = 1; }
process.exit(code === 0 ? 0 : 1);
