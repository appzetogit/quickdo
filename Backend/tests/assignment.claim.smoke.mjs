/**
 * The master busy-lock against a real database: core/assignment/assignment.service.
 * Isolated in-memory MongoDB replica set; never touches Atlas.
 *
 * Run:  node tests/assignment.claim.smoke.mjs
 *
 * tests/assignment.smoke.mjs covers the old single-slot primitive. This covers
 * what replaced it, and specifically the parts that only exist against a database:
 *
 *   - the claim filter under genuine concurrency, where two verticals racing for
 *     one driver must produce exactly one winner;
 *   - the MIRROR. activeAssignment is kept equal to activeAssignments[0] so the old
 *     primitive and three dispatchers keep working untouched. If the mirror is
 *     wrong in either direction, food and taxi double-book QC riders again -- the
 *     hole this whole change exists to close;
 *   - the two release/claim hazards found while writing it: a release that clears
 *     a lock belonging to a different job, and a driver locked before the array
 *     existed reading as free;
 *   - reconcile knowing quick-commerce orders live in their own collection, without
 *     which every QC lock would be judged stale and cleared on sight.
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
  await mongoose.connect(replSet.getUri(), { dbName: 'claim' });
  console.log('Connected.\n');

  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { claimAssignment, releaseAssignment, reconcileAssignments } =
    await import('../src/core/assignment/assignment.service.js');
  const { EXAMPLE_STACKING_POLICY } = await import('../src/core/assignment/assignmentRules.js');
  const { acquireDriverAssignment } =
    await import('../src/modules/taxi/driver/services/driverAssignmentService.js');

  let phoneSeq = 9100000000;
  const newDriver = () => Driver.create({
    name: 'D', phone: `+91${phoneSeq++}`,
    password: 'secret123', vehicleType: 'car', location: { type: 'Point', coordinates: [72, 23] },
  });
  const read = (id) => Driver.findById(id).lean();

  // --- claiming ------------------------------------------------------------
  console.log('claiming');

  await test('a free driver can be claimed, and the mirror follows', async () => {
    const d = await newDriver();
    const job = oid();
    const r = await claimAssignment(d._id, { vertical: 'quickCommerce', jobId: job });
    assert.equal(r.claimed, true);

    const fresh = await read(d._id);
    assert.equal(fresh.activeAssignments.length, 1);
    assert.equal(fresh.activeAssignments[0].jobType, 'quickCommerceDelivery');
    assert.equal(String(fresh.activeAssignment.id), String(job), 'mirror must point at the job');
    assert.equal(fresh.activeAssignment.type, 'delivery');
  });

  await test('a taxi claim mirrors as type "ride"', async () => {
    const d = await newDriver();
    await claimAssignment(d._id, { vertical: 'taxi', jobId: oid() });
    assert.equal((await read(d._id)).activeAssignment.type, 'ride');
  });

  await test('THE LIVE HOLE: a driver on a QC order cannot be claimed for a ride', async () => {
    const d = await newDriver();
    await claimAssignment(d._id, { vertical: 'quickCommerce', jobId: oid() });
    const r = await claimAssignment(d._id, { vertical: 'taxi', jobId: oid() });
    assert.equal(r.claimed, false);
    assert.equal((await read(d._id)).activeAssignments.length, 1);
  });

  await test('a re-claim of the same job succeeds without extending the hold', async () => {
    // A double-tap or a second device. Success, not "already on another job".
    const d = await newDriver();
    const job = oid();
    await claimAssignment(d._id, { vertical: 'food', jobId: job });
    const firstAt = (await read(d._id)).activeAssignments[0].at;

    await new Promise((r) => setTimeout(r, 15));
    const again = await claimAssignment(d._id, { vertical: 'food', jobId: job });

    const fresh = await read(d._id);
    assert.equal(again.claimed, true);
    assert.equal(fresh.activeAssignments.length, 1, 're-claim must not add a second entry');
    assert.equal(fresh.activeAssignments[0].at.getTime(), firstAt.getTime(), 'the hold must not be extended');
  });

  // --- interoperability with the old primitive -----------------------------
  console.log('\nthe old primitive and the new one see each other');

  await test('a QC claim BLOCKS the old food/taxi acquire, via the mirror', async () => {
    /*
     * The reason the mirror exists. Food and taxi still call
     * acquireDriverAssignment, which only looks at activeAssignment. If a QC claim
     * did not set it, food would happily take a rider already carrying groceries.
     */
    const d = await newDriver();
    await claimAssignment(d._id, { vertical: 'quickCommerce', jobId: oid() });
    assert.equal(await acquireDriverAssignment(d._id, 'ride', oid()), false);
    assert.equal(await acquireDriverAssignment(d._id, 'delivery', oid()), false);
  });

  await test('a LEGACY lock blocks a new claim, even with no array at all', async () => {
    /*
     * A driver locked before this module exists has activeAssignment set and no
     * activeAssignments. $size of a missing array is 0, so without the legacy
     * guard they would read as free and be double-booked by the very code meant
     * to prevent it.
     */
    const d = await newDriver();
    await Driver.updateOne({ _id: d._id }, {
      $set: { activeAssignment: { type: 'ride', id: oid(), at: new Date() } },
      $unset: { activeAssignments: '' },
    });
    const r = await claimAssignment(d._id, { vertical: 'quickCommerce', jobId: oid() });
    assert.equal(r.claimed, false, 'a legacy-locked driver must not be claimable');
  });

  // --- food and taxi now go through the master primitive -------------------
  console.log('\nfood and taxi delegate to the master claim');

  await test('the old acquire now writes activeAssignments, not just the mirror', async () => {
    /*
     * The point of the wiring. Before it, food and taxi wrote only activeAssignment
     * while QC wrote the array: two primitives deciding one question. Now the array
     * is the record for every vertical.
     */
    const d = await newDriver();
    const ride = oid();
    assert.equal(await acquireDriverAssignment(d._id, 'ride', ride), true);
    const fresh = await read(d._id);
    assert.equal(fresh.activeAssignments.length, 1);
    assert.equal(fresh.activeAssignments[0].vertical, 'taxi');
    assert.equal(fresh.activeAssignments[0].jobType, 'taxiRide');
  });

  await test("a 'delivery' acquire is recorded as food", async () => {
    const d = await newDriver();
    await acquireDriverAssignment(d._id, 'delivery', oid());
    assert.equal((await read(d._id)).activeAssignments[0].vertical, 'food');
  });

  await test('a job id passed as a STRING re-claims idempotently', async () => {
    // Pipeline literals are not cast by mongoose, so without normalisation a string
    // id would be stored as a string and never match its own ObjectId on retry.
    const d = await newDriver();
    const job = oid();
    assert.equal((await claimAssignment(d._id, { vertical: 'food', jobId: String(job) })).claimed, true);
    assert.equal((await claimAssignment(d._id, { vertical: 'food', jobId: job })).claimed, true, 'retry with the ObjectId');
    assert.equal((await claimAssignment(d._id, { vertical: 'food', jobId: String(job) })).claimed, true, 'retry with the string');
    const fresh = await read(d._id);
    assert.equal(fresh.activeAssignments.length, 1);
    assert.ok(fresh.activeAssignments[0].jobId instanceof mongoose.Types.ObjectId, 'stored as an ObjectId');
  });

  await test('forceClear empties the array as well as the mirror', async () => {
    const { forceClearDriverAssignment } = await import('../src/modules/taxi/driver/services/driverAssignmentService.js');
    const d = await newDriver();
    await claimAssignment(d._id, { vertical: 'quickCommerce', jobId: oid() });
    assert.equal(await forceClearDriverAssignment(d._id), true);
    const fresh = await read(d._id);
    assert.equal(fresh.activeAssignment, null);
    assert.equal(fresh.activeAssignments.length, 0, 'clearing only the mirror would leave the driver locked');
    assert.equal((await claimAssignment(d._id, { vertical: 'taxi', jobId: oid() })).claimed, true);
  });

  // --- concurrency ---------------------------------------------------------
  console.log('\nconcurrency');

  await test('three verticals racing for one driver: exactly one wins', async () => {
    const d = await newDriver();
    const verdicts = await Promise.all([
      claimAssignment(d._id, { vertical: 'food', jobId: oid() }),
      claimAssignment(d._id, { vertical: 'quickCommerce', jobId: oid() }),
      claimAssignment(d._id, { vertical: 'taxi', jobId: oid() }),
    ]);
    assert.equal(verdicts.filter((v) => v.claimed).length, 1, 'only one vertical may win');
    const fresh = await read(d._id);
    assert.equal(fresh.activeAssignments.length, 1, 'and only one entry may exist');
  });

  await test('the new claim racing the OLD acquire: still exactly one winner', async () => {
    // During the transition food and taxi use one primitive and QC the other.
    // The race between them is the realistic one.
    let wins = 0;
    for (let i = 0; i < 10; i += 1) {
      const d = await newDriver();
      const [a, b] = await Promise.all([
        claimAssignment(d._id, { vertical: 'quickCommerce', jobId: oid() }),
        acquireDriverAssignment(d._id, 'ride', oid()),
      ]);
      const winners = (a.claimed ? 1 : 0) + (b ? 1 : 0);
      assert.equal(winners, 1, `round ${i}: ${winners} winners`);
      wins += winners;
    }
    assert.equal(wins, 10);
  });

  await test('many concurrent claims under a stacking policy never exceed the ceiling', async () => {
    const d = await newDriver();
    const verdicts = await Promise.all(Array.from({ length: 12 }, () =>
      claimAssignment(d._id, { vertical: 'food', jobId: oid() }, { policy: EXAMPLE_STACKING_POLICY })));
    const fresh = await read(d._id);
    assert.equal(verdicts.filter((v) => v.claimed).length, 2);
    assert.equal(fresh.activeAssignments.length, 2, 'maxConcurrentJobs is 2 under this policy');
  });

  // --- stacking, when a policy permits it ----------------------------------
  console.log('\nstacking');

  await test('Food + QC stack under a policy that permits it; Taxi still refused', async () => {
    const d = await newDriver();
    await Driver.updateOne({ _id: d._id }, { $unset: { activeAssignment: '' } });
    const policy = { policy: EXAMPLE_STACKING_POLICY };
    assert.equal((await claimAssignment(d._id, { vertical: 'food', jobId: oid() }, policy)).claimed, true);
    assert.equal((await claimAssignment(d._id, { vertical: 'quickCommerce', jobId: oid() }, policy)).claimed, true);
    assert.equal((await claimAssignment(d._id, { vertical: 'taxi', jobId: oid() }, policy)).claimed, false);
  });

  // --- releasing -----------------------------------------------------------
  console.log('\nreleasing');

  await test('releasing the job held frees the driver and clears the mirror', async () => {
    const d = await newDriver();
    const job = oid();
    await claimAssignment(d._id, { vertical: 'quickCommerce', jobId: job });
    assert.equal(await releaseAssignment(d._id, job), true);
    const fresh = await read(d._id);
    assert.equal(fresh.activeAssignments.length, 0);
    assert.equal(fresh.activeAssignment, null);
  });

  await test('REGRESSION: releasing a job NOT held leaves the real lock intact', async () => {
    /*
     * Found while writing the service. The release pipeline re-derives the mirror
     * from the array, so an unguarded filter rewrote it from an empty array to
     * null -- clearing a live lock owned by a different job. A late release from a
     * finished order would free a driver already claimed for a new one.
     */
    const d = await newDriver();
    const held = oid();
    await claimAssignment(d._id, { vertical: 'food', jobId: held });
    assert.equal(await releaseAssignment(d._id, oid()), false, 'a stale release must be a no-op');
    const fresh = await read(d._id);
    assert.equal(String(fresh.activeAssignment.id), String(held), 'the real lock must survive');
    assert.equal(fresh.activeAssignments.length, 1);
  });

  await test('REGRESSION: a stale release cannot clear a LEGACY-only lock either', async () => {
    const d = await newDriver();
    const held = oid();
    await Driver.updateOne({ _id: d._id }, {
      $set: { activeAssignment: { type: 'ride', id: held, at: new Date() } },
      $unset: { activeAssignments: '' },
    });
    await releaseAssignment(d._id, oid());
    assert.equal(String((await read(d._id)).activeAssignment.id), String(held));
  });

  await test('a legacy-only lock CAN be released by its own job id', async () => {
    // Otherwise reconcile could never free a driver locked before the array existed.
    const d = await newDriver();
    const held = oid();
    await Driver.updateOne({ _id: d._id }, {
      $set: { activeAssignment: { type: 'ride', id: held, at: new Date() } },
      $unset: { activeAssignments: '' },
    });
    assert.equal(await releaseAssignment(d._id, held), true);
    assert.equal((await read(d._id)).activeAssignment, null);
  });

  await test('under stacking, releasing the FIRST job re-points the mirror at the second', async () => {
    const d = await newDriver();
    await Driver.updateOne({ _id: d._id }, { $unset: { activeAssignment: '' } });
    const policy = { policy: EXAMPLE_STACKING_POLICY };
    const first = oid();
    const second = oid();
    await claimAssignment(d._id, { vertical: 'food', jobId: first }, policy);
    await claimAssignment(d._id, { vertical: 'quickCommerce', jobId: second }, policy);

    await releaseAssignment(d._id, first);
    const fresh = await read(d._id);
    assert.equal(fresh.activeAssignments.length, 1);
    assert.equal(String(fresh.activeAssignment.id), String(second), 'the mirror must follow what is still held');
  });

  // --- reconcile knows about quick commerce --------------------------------
  console.log('\nreconcile, across verticals');

  const { FoodOrder: QCOrder } =
    await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');

  await test('a QC lock on a LIVE qc_orders order is NOT cleared', async () => {
    /*
     * The bug that made QC unable to use the old primitive at all: the old
     * reconcile looked every delivery up in food_orders, found nothing, and cleared
     * the lock -- handing the rider a second job while still carrying the first.
     */
    const d = await newDriver();
    const orderId = oid();
    await QCOrder.collection.insertOne({ _id: orderId, orderStatus: 'picked_up' });
    await claimAssignment(d._id, { vertical: 'quickCommerce', jobId: orderId });

    assert.equal(await reconcileAssignments(d._id), 0, 'a live QC order must keep its lock');
    assert.equal((await read(d._id)).activeAssignments.length, 1);
  });

  await test('a QC lock on a DELIVERED order is cleared', async () => {
    const d = await newDriver();
    const orderId = oid();
    await QCOrder.collection.insertOne({ _id: orderId, orderStatus: 'delivered' });
    await claimAssignment(d._id, { vertical: 'quickCommerce', jobId: orderId });
    assert.equal(await reconcileAssignments(d._id), 1);
    assert.equal((await read(d._id)).activeAssignment, null);
  });

  await test('a QC lock whose order no longer exists is cleared', async () => {
    const d = await newDriver();
    await claimAssignment(d._id, { vertical: 'quickCommerce', jobId: oid() });
    assert.equal(await reconcileAssignments(d._id), 1);
  });

  await test('reconcile only clears the finished job when two are held', async () => {
    const d = await newDriver();
    await Driver.updateOne({ _id: d._id }, { $unset: { activeAssignment: '' } });
    const live = oid();
    const done = oid();
    await QCOrder.collection.insertMany([
      { _id: live, orderStatus: 'picked_up' },
      { _id: done, orderStatus: 'delivered' },
    ]);
    const policy = { policy: EXAMPLE_STACKING_POLICY };
    await claimAssignment(d._id, { vertical: 'quickCommerce', jobId: live }, policy);
    await claimAssignment(d._id, { vertical: 'quickCommerce', jobId: done }, policy);

    assert.equal(await reconcileAssignments(d._id), 1);
    const fresh = await read(d._id);
    assert.equal(fresh.activeAssignments.length, 1);
    assert.equal(String(fresh.activeAssignments[0].jobId), String(live));
  });

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length
    ? `\n${failed.length} of ${results.length} checks failed\n`
    : `\nall ${results.length} checks passed\n`);

  await mongoose.disconnect().catch(() => {});
  await replSet.stop().catch(() => {});
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`HARNESS FAILED: ${err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
