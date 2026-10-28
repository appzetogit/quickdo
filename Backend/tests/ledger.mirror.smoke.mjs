/**
 * Ledger dual-write against a real database: core/finance/ledgerMirror.js, driven
 * through the REAL taxi wallet writer (applyDriverWalletAdjustment).
 * Isolated in-memory MongoDB replica set; never touches Atlas.
 *
 * Run:  node tests/ledger.mirror.smoke.mjs
 *
 * What has to be true before the flag can be switched on in production:
 *
 *   - off means off: no ledger row, and the wallet behaves exactly as before
 *   - on, every wallet movement lands in the ledger once, with the same amount
 *   - a movement inside a transaction that ABORTS never reaches the ledger. This is
 *     the case that would put phantom money in the ledger if the mirror ran at
 *     the point the wallet row is created, which is inside the caller's transaction.
 *   - a withTransaction-style retry (abort, then commit) mirrors only the committed
 *     attempt
 *   - a ledger failure does not fail the wallet write, and is dead-lettered
 *   - a replay of the same source row is inert
 *   - the reconciler finds a row with no entry
 */
import assert from 'assert';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`  PASS  ${name}`); }
  catch (err) { results.push({ name, ok: false, err }); console.log(`  FAIL  ${name}\n        ${err.message}`); }
};

// The mirror is fire-and-forget; give its promise chain a moment to land.
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

async function main() {
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  console.log('Booting in-memory MongoDB replica set…');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'mirror' });
  console.log('Connected.\n');

  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');
  const { applyDriverWalletAdjustment } = await import('../src/modules/taxi/driver/services/walletService.js');
  const { LedgerEntry } = await import('../src/core/finance/ledgerEntry.model.js');
  const { PartnerBalance } = await import('../src/core/finance/partnerBalance.model.js');
  const { FailedFinancialOperation } = await import('../src/core/finance/failedFinancialOperation.model.js');
  const { mirrorToLedger, taxiWalletRowToEntry, reconcileTaxiWalletMirror } =
    await import('../src/core/finance/ledgerMirror.js');
  const { forSourceRow } = await import('../src/core/finance/idempotencyKeys.js');

  await LedgerEntry.syncIndexes();
  await PartnerBalance.syncIndexes();
  // Transactions fail with "catalog changes" if an index build is still running on a
  // collection they write to, so every model the writer touches is initialised first.
  await Driver.init();
  await WalletTransaction.init();
  await FailedFinancialOperation.init();
  // Collections must exist before a transaction writes to them.
  await WalletTransaction.createCollection().catch(() => {});
  await LedgerEntry.createCollection().catch(() => {});
  await PartnerBalance.createCollection().catch(() => {});

  const startedAt = new Date(Date.now() - 1000);

  let phoneSeq = 9200000000;
  const newDriver = () => Driver.create({
    name: 'D', phone: `+91${phoneSeq++}`,
    password: 'secret123', vehicleType: 'car', location: { type: 'Point', coordinates: [72, 23] },
  });
  const entriesFor = (driverId) => LedgerEntry.find({ ownerType: 'partner', ownerId: String(driverId) }).lean();
  const walletOf = async (driverId) => (await Driver.findById(driverId).lean()).wallet?.balance || 0;

  // --- flag off --------------------------------------------------------------
  console.log('flag off');
  delete process.env.LEDGER_DUAL_WRITE_ENABLED;

  await test('off: the wallet moves and nothing is written to the ledger', async () => {
    const d = await newDriver();
    const r = await applyDriverWalletAdjustment({ driverId: d._id, amount: 120, type: 'top_up' });
    await settle();
    assert.equal(r.transaction.amount, 120);
    assert.equal(await walletOf(d._id), 120);
    assert.equal((await entriesFor(d._id)).length, 0);
  });

  // --- flag on ---------------------------------------------------------------
  console.log('flag on');
  process.env.LEDGER_DUAL_WRITE_ENABLED = 'true';

  await test('on, no session: the movement is mirrored once with the same amount, owner and type', async () => {
    const d = await newDriver();
    const ride = new mongoose.Types.ObjectId();
    const r = await applyDriverWalletAdjustment({ driverId: d._id, amount: -35.5, type: 'commission_deduction', rideId: ride });
    await settle();
    const rows = await entriesFor(d._id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, -35.5);
    assert.equal(rows[0].type, 'COMMISSION');
    assert.equal(rows[0].vertical, 'taxi');
    assert.equal(rows[0].jobId, String(ride));
    assert.equal(rows[0].idempotencyKey, forSourceRow('wallettransactions', r.transaction._id));
  });

  await test('on, committed transaction: mirrored only after the commit', async () => {
    const d = await newDriver();
    const session = await mongoose.startSession();
    session.startTransaction();
    await applyDriverWalletAdjustment({ driverId: d._id, amount: 200, type: 'top_up', session });
    await settle();
    assert.equal((await entriesFor(d._id)).length, 0, 'nothing may be mirrored while the transaction is open');
    await session.commitTransaction();
    await session.endSession();
    await session.__ledgerMirrorFlush;
    const rows = await entriesFor(d._id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, 200);
  });

  await test('on, ABORTED transaction: the rolled-back movement never reaches the ledger', async () => {
    const d = await newDriver();
    const session = await mongoose.startSession();
    session.startTransaction();
    await applyDriverWalletAdjustment({ driverId: d._id, amount: 999, type: 'top_up', session });
    await session.abortTransaction();
    await session.endSession();
    await session.__ledgerMirrorFlush;
    await settle();
    assert.equal(await walletOf(d._id), 0, 'the wallet rolled back');
    assert.equal((await entriesFor(d._id)).length, 0, 'so the ledger must not have it either');
  });

  await test('on, retried transaction (abort then commit): only the committed attempt is mirrored', async () => {
    const d = await newDriver();
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await applyDriverWalletAdjustment({ driverId: d._id, amount: 50, type: 'top_up', session });
    }).catch(() => {});
    // Simulate withTransaction's retry by hand: attempt 1 aborts, attempt 2 commits.
    const d2 = await newDriver();
    session.startTransaction();
    await applyDriverWalletAdjustment({ driverId: d2._id, amount: 70, type: 'top_up', session });
    await session.abortTransaction();
    session.startTransaction();
    await applyDriverWalletAdjustment({ driverId: d2._id, amount: 80, type: 'top_up', session });
    await session.commitTransaction();
    await session.endSession();
    await session.__ledgerMirrorFlush;
    await settle();

    // The session was reused: its FIRST transaction committed and must not be lost
    // just because a later one on the same session aborted.
    assert.deepEqual((await entriesFor(d._id)).map((e) => e.amount), [50], 'an earlier committed transaction on a reused session');

    const rows2 = await entriesFor(d2._id);
    assert.deepEqual(rows2.map((e) => e.amount), [80], 'the aborted 70 must be dropped');
    assert.equal(await walletOf(d2._id), 80);
  });

  await test('on, withTransaction: a normal committed callback is mirrored', async () => {
    const d = await newDriver();
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await applyDriverWalletAdjustment({ driverId: d._id, amount: 45, type: 'ride_earning', session });
    });
    await session.endSession();
    await session.__ledgerMirrorFlush;
    const rows = await entriesFor(d._id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'EARNING');
  });

  await test('replaying the same source row is inert', async () => {
    const d = await newDriver();
    const r = await applyDriverWalletAdjustment({ driverId: d._id, amount: 60, type: 'top_up' });
    await settle();
    const entry = taxiWalletRowToEntry(r.transaction);
    const replays = await Promise.all([1, 2, 3].map(() => mirrorToLedger(entry)));
    assert.ok(replays.every((x) => x && x.duplicate === true));
    const rows = await entriesFor(d._id);
    assert.equal(rows.length, 1);
    assert.equal((await PartnerBalance.findOne({ ownerId: String(d._id) }).lean()).balance, 60);
  });

  await test('a ledger failure does not fail the wallet write, and is dead-lettered as UNMIRRORED', async () => {
    const d = await newDriver();
    const original = LedgerEntry.create;
    LedgerEntry.create = async () => { throw new Error('simulated ledger outage'); };
    let r;
    try {
      r = await applyDriverWalletAdjustment({ driverId: d._id, amount: 75, type: 'top_up' });
      await settle(400);
    } finally {
      LedgerEntry.create = original;
    }
    assert.equal(r.transaction.amount, 75, 'the wallet write succeeded');
    assert.equal(await walletOf(d._id), 75);
    assert.equal((await entriesFor(d._id)).length, 0);
    const dead = await FailedFinancialOperation.findOne({ operation: 'ledger_mirror', entityId: String(d._id) }).lean();
    assert.ok(dead, 'the failure is recorded for replay');
    assert.equal(dead.payload.idempotencyKey, forSourceRow('wallettransactions', r.transaction._id));

    // And the recorded payload replays cleanly once the outage is over.
    const replay = await mirrorToLedger(dead.payload);
    assert.equal(replay.applied, true);
    assert.equal((await entriesFor(d._id)).length, 1);
  });

  await test('a zero-amount row (cash tip) is not mirrored', async () => {
    assert.equal(taxiWalletRowToEntry({ _id: 'x', driverId: 'd', amount: 0, type: 'adjustment' }), null);
  });

  // --- reconciler ------------------------------------------------------------
  console.log('reconciler');

  await test('reconciler is clean when every row is mirrored, and names a row that is not', async () => {
    // Everything above either mirrored or rolled back, except the flag-off row and
    // the failed one (replayed). The flag-off row predates mirroring for that driver
    // but falls in the window -- which is exactly what the reconciler should report.
    const first = await reconcileTaxiWalletMirror({ since: startedAt });
    assert.equal(first.missing.length, 1, `expected only the flag-off row, got ${first.missing.length}`);
    assert.equal(first.missing[0].amount, 120);

    const d = await newDriver();
    const row = await WalletTransaction.create({
      driverId: d._id, type: 'adjustment', amount: 10, balanceBefore: 0, balanceAfter: 10, cashLimit: 0, isBlockedAfter: false,
    });
    const second = await reconcileTaxiWalletMirror({ since: startedAt });
    assert.equal(second.clean, false);
    assert.ok(second.missing.some((m) => m.metadata.sourceRowId === String(row._id)));

    await mirrorToLedger(taxiWalletRowToEntry(row));
    await mirrorToLedger(first.missing[0]);
    const third = await reconcileTaxiWalletMirror({ since: startedAt });
    assert.equal(third.clean, true, JSON.stringify(third.missing.map((m) => m.idempotencyKey)));
  });

  await mongoose.disconnect();
  await replSet.stop();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
  console.log('PASS');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
