/**
 * The nightly ledger run against a real database.
 * Isolated in-memory MongoDB replica set; never touches Atlas.
 *
 * Run:  node tests/ledger.nightly.smoke.mjs
 *
 *   - several instances firing at once run the night exactly once
 *   - a clean night records clean and builds the streak night over night
 *   - a tampered balance makes the night dirty and resets the streak
 *   - a run that died mid-way is taken over once stale, and not before
 *   - nothing is run before 03:00 IST
 */
import assert from 'assert';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`  PASS  ${name}`); }
  catch (err) { results.push({ name, ok: false, err }); console.log(`  FAIL  ${name}\n        ${err.message}`); }
};
const oid = () => new mongoose.Types.ObjectId();
// 04:00 IST on the given date.
const at = (date) => new Date(`${date}T04:00:00+05:30`);

async function main() {
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  console.log('Booting in-memory MongoDB replica set…');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'nightly' });
  console.log('Connected.\n');

  const { LedgerEntry } = await import('../src/core/finance/ledgerEntry.model.js');
  const { PartnerBalance } = await import('../src/core/finance/partnerBalance.model.js');
  const { LedgerReconcileRun: Run } = await import('../src/core/finance/ledgerReconcileRun.model.js');
  for (const M of [LedgerEntry, PartnerBalance, Run]) { await M.init(); await M.createCollection().catch(() => {}); }

  const { loadDeliveryModels } = await import('../src/core/finance/riderFinance.service.js');
  const { runLedgerNightlyIfDue } = await import('../src/core/finance/ledgerNightly.js');
  const food = await loadDeliveryModels('food');

  const rider = oid();
  await food.Order.collection.insertOne({
    _id: oid(), orderStatus: 'delivered', riderEarning: 80, payment: { method: 'cash' },
    pricing: { total: 350 }, dispatch: { deliveryPartnerId: rider },
  });

  process.env.LEDGER_PROJECTION_ENABLED = 'true';
  delete process.env.LEDGER_DUAL_WRITE_ENABLED;

  await test('before 03:00 IST nothing runs', async () => {
    const r = await runLedgerNightlyIfDue({ now: new Date('2026-09-17T02:00:00+05:30') });
    assert.equal(r, null);
    assert.equal(await Run.countDocuments(), 0);
  });

  await test('five instances firing at once run the night exactly once', async () => {
    const outs = await Promise.all([1, 2, 3, 4, 5].map(() => runLedgerNightlyIfDue({ now: at('2026-09-17') })));
    assert.equal(outs.filter(Boolean).length, 1, 'exactly one instance ran');
    assert.equal(await Run.countDocuments({ night: '2026-09-17' }), 1);
    const entries = await LedgerEntry.countDocuments();
    assert.equal(entries, 1, `the projection was applied once, got ${entries} entries`);
  });

  await test('that night is recorded clean, streak 1, with the projection in the report', async () => {
    const row = await Run.findOne({ night: '2026-09-17' }).lean();
    assert.equal(row.status, 'done');
    assert.equal(row.clean, true, JSON.stringify(row.report));
    assert.equal(row.cleanStreak, 1);
    assert.equal(row.report.deliveryProjection.verticals.food.appended, 1);
    assert.equal(row.report.taxiMirror.skipped, true);
  });

  await test('a later call the same night does nothing', async () => {
    assert.equal(await runLedgerNightlyIfDue({ now: new Date('2026-09-17T23:00:00+05:30') }), null);
  });

  await test('the next clean night extends the streak', async () => {
    const row = await runLedgerNightlyIfDue({ now: at('2026-09-18') });
    assert.equal(row.clean, true);
    assert.equal(row.cleanStreak, 2);
  });

  await test('a tampered balance makes the night dirty and resets the streak', async () => {
    await PartnerBalance.updateOne({ ownerId: String(rider) }, { $inc: { balance: 5 } });
    const row = await runLedgerNightlyIfDue({ now: at('2026-09-19') });
    assert.equal(row.clean, false);
    assert.equal(row.cleanStreak, 0);
    assert.equal(row.report.internalConsistency.dirty, 1);
    await PartnerBalance.updateOne({ ownerId: String(rider) }, { $inc: { balance: -5 } });
  });

  await test('deleted delivery entries are re-projected and the repair is counted in the report', async () => {
    // For delivery money the ledger is DERIVED from riderFinance, so lost entries
    // are rebuilt rather than flagged. That makes the delivery reconciliation a check
    // on the projector's formulas, not on the source data -- stated in the docs, and
    // visible here as a non-zero 'appended' on a night that should have had none.
    await LedgerEntry.deleteMany({ ownerId: String(rider) });
    await PartnerBalance.deleteMany({ ownerId: String(rider) });
    const row = await runLedgerNightlyIfDue({ now: at('2026-09-20') });
    // The projector re-appends the missing entry, so the ledger converges and the
    // night is clean -- that is the intended self-healing, and it is recorded.
    assert.equal(row.report.deliveryProjection.verticals.food.appended, 1);
    assert.equal(row.clean, true);
    assert.equal(row.cleanStreak, 1, 'the dirty night before still broke the streak');
  });

  await test('a run that died mid-way is not taken over while fresh', async () => {
    await Run.create({ night: '2026-09-21', status: 'running', startedAt: new Date('2026-09-21T03:50:00+05:30') });
    assert.equal(await runLedgerNightlyIfDue({ now: at('2026-09-21') }), null);
  });

  await test('...and is taken over once stale, so the night is not lost', async () => {
    const row = await runLedgerNightlyIfDue({ now: new Date('2026-09-21T06:00:00+05:30') });
    assert.ok(row, 'taken over');
    assert.equal(row.status, 'done');
    assert.equal(row.cleanStreak, 2);
  });

  await test('a night on which every part is switched off is not clean', async () => {
    delete process.env.LEDGER_PROJECTION_ENABLED;
    await LedgerEntry.deleteMany({});
    await PartnerBalance.deleteMany({});
    const row = await runLedgerNightlyIfDue({ now: at('2026-09-22') });
    assert.equal(row.clean, false);
    assert.equal(row.cleanStreak, 0);
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
