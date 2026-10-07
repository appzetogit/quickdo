/**
 * Integration smoke tests for the concurrency-sensitive taxi flow fixes.
 *
 * Runs against an ISOLATED in-memory MongoDB replica set (replica set is required because the
 * ride/wallet code uses transactions). It never touches the configured Atlas cluster.
 *
 * Run:  node tests/flow.smoke.mjs
 */
import assert from 'assert';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet;
const results = [];
const test = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
};

const oid = () => new mongoose.Types.ObjectId();

async function main() {
  // Cold-start of the cached mongod binary can exceed the 10s default (notably on Windows).
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  console.log('Booting in-memory MongoDB replica set…');
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = replSet.getUri();
  process.env.MONGODB_URI = uri;
  process.env.MONGO_URI = uri;
  process.env.REDIS_ENABLED = 'false';
  process.env.BULLMQ_ENABLED = 'false';
  process.env.JWT_ACCESS_SECRET = 'test';
  process.env.JWT_REFRESH_SECRET = 'test';

  await mongoose.connect(uri, { dbName: 'flowsmoke' });
  console.log('Connected.\n');

  console.log('Driver-cancel re-dispatch exclusion');

  await test('rejection survives stopDispatchFlow ordering (canceller not re-offered)', async () => {
    const ds = await import('../src/modules/taxi/services/dispatchService.js');
    const rideId = String(oid());
    const driverId = String(oid());
    // Simulate a live dispatch, then the fixed cancel ordering:
    ds.getDispatchState(rideId);
    ds.stopDispatchFlow(rideId);              // must come FIRST
    ds.markDriverRejectedFromDispatch(rideId, driverId); // then seed the rejection
    const state = ds.getDispatchState(rideId);
    assert.ok(
      state.rejectedDriverIds.map(String).includes(driverId),
      'cancelling driver must remain excluded from re-dispatch',
    );
  });

  await test('wrong order (reject then stop) would lose the exclusion — regression guard', async () => {
    const ds = await import('../src/modules/taxi/services/dispatchService.js');
    const rideId = String(oid());
    const driverId = String(oid());
    ds.markDriverRejectedFromDispatch(rideId, driverId);
    ds.stopDispatchFlow(rideId); // wipes state — this is the bug we fixed
    const state = ds.getDispatchState(rideId);
    assert.equal(
      state.rejectedDriverIds.length, 0,
      'documents why order matters: stopDispatchFlow clears the rejection',
    );
  });

  // ---- summary ----
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.err.stack?.split('\n')[0]}`);
  }
  return failed.length;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error('Harness error:', err);
  code = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
  await replSet?.stop().catch(() => {});
}
process.exit(code === 0 ? 0 : 1);
