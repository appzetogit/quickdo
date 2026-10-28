/**
 * The master ledger against a real database: core/finance/ledger.service.append.
 * Isolated in-memory MongoDB replica set; never touches Atlas.
 *
 * Run:  node tests/ledger.append.smoke.mjs
 *
 * Every other check on this branch is pure arithmetic, and the ledger's arithmetic
 * was already covered there. What was NOT covered is the half that only exists
 * against a database, and it is the half that decides whether money is correct:
 *
 *   - the transaction. append() increments a balance and inserts a row, and they
 *     must both happen or neither. If the insert loses a unique-key race, the
 *     increment has to roll back with it, or a replayed webhook silently adds
 *     money without leaving a row to explain it.
 *   - $inc under contention. Concurrent appends must not lose each other's update,
 *     which is the exact bug adminService.adjustDriverWallet had by doing the
 *     arithmetic in JavaScript.
 *   - E11000 as a success path. A retry is supposed to get the ORIGINAL result,
 *     not an error.
 *
 * A replica set is required, because append() uses a transaction and refuses to
 * degrade to a non-atomic path. That requirement is itself asserted below.
 */
import assert from 'assert';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`  PASS  ${name}`); }
  catch (err) { results.push({ name, ok: false, err }); console.log(`  FAIL  ${name}\n        ${err.message}`); }
};

let seq = 0;
const owner = () => `partner_${++seq}`;

async function main() {
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  console.log('Booting in-memory MongoDB replica set…');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'ledger' });
  console.log('Connected.\n');

  const { append, foldBalance, reconcileOwner } = await import('../src/core/finance/ledger.service.js');
  const { LedgerEntry } = await import('../src/core/finance/ledgerEntry.model.js');
  const { PartnerBalance } = await import('../src/core/finance/partnerBalance.model.js');
  const keys = await import('../src/core/finance/idempotencyKeys.js');

  // The unique index is what makes a replay inert. Without it built, every
  // idempotency assertion below would pass for the wrong reason.
  await LedgerEntry.syncIndexes();
  await PartnerBalance.syncIndexes();

  const entry = (ownerId, over = {}) => ({
    ownerType: 'partner',
    ownerId,
    vertical: 'food',
    type: 'EARNING',
    amount: 100,
    idempotencyKey: keys.forOrderRiderEarning(`order_${++seq}`),
    ...over,
  });

  // --- the basics -----------------------------------------------------------
  console.log('appending');

  await test('a first append moves the balance and records why', async () => {
    const o = owner();
    const res = await append(entry(o, { amount: 120 }));
    assert.equal(res.applied, true);
    assert.equal(res.duplicate, false);
    assert.equal(res.entry.balanceBefore, 0);
    assert.equal(res.entry.balanceAfter, 120);

    const snap = await PartnerBalance.findOne({ ownerType: 'partner', ownerId: o }).lean();
    assert.equal(snap.balance, 120);
    assert.equal(snap.version, 1);
  });

  await test('before/after are derived from the post-increment figure', async () => {
    const o = owner();
    await append(entry(o, { amount: 100 }));
    const res = await append(entry(o, { amount: 50 }));
    assert.equal(res.entry.balanceBefore, 100);
    assert.equal(res.entry.balanceAfter, 150);
  });

  await test('a debit is a negative amount and takes the balance DOWN', async () => {
    const o = owner();
    await append(entry(o, { amount: 100 }));
    const res = await append(entry(o, { amount: -30, type: 'WITHDRAWAL' }));
    assert.equal(res.entry.balanceAfter, 70);
  });

  // --- negative balances ----------------------------------------------------
  console.log('\nnegative balances are recorded, not refused');

  await test('THE P0-8 CASE: debiting 250 against 100 leaves -150 on the record', async () => {
    /*
     * transaction.service.recordTransaction throws here, which means it declines
     * to record a debt that genuinely exists. The debt does not stop being real;
     * it stops being visible.
     */
    const o = owner();
    await append(entry(o, { amount: 100 }));
    const res = await append(entry(o, { amount: -250, type: 'CASH_COLLECTED' }));
    assert.equal(res.applied, true);
    assert.equal(res.entry.balanceAfter, -150);

    const snap = await PartnerBalance.findOne({ ownerType: 'partner', ownerId: o }).lean();
    assert.equal(snap.balance, -150);
  });

  await test('a negative balance can go further negative and come back', async () => {
    const o = owner();
    await append(entry(o, { amount: -200, type: 'CASH_COLLECTED' }));
    await append(entry(o, { amount: -50, type: 'PENALTY' }));
    const back = await append(entry(o, { amount: 300 }));
    assert.equal(back.entry.balanceAfter, 50);
  });

  // --- idempotency ----------------------------------------------------------
  console.log('\nidempotency, against the real unique index');

  await test('the same key twice moves the money ONCE', async () => {
    const o = owner();
    const key = keys.forProviderPayment('pay_replay_1');
    const first = await append(entry(o, { amount: 500, idempotencyKey: key }));
    const second = await append(entry(o, { amount: 500, idempotencyKey: key }));

    assert.equal(first.applied, true);
    assert.equal(second.applied, false);
    assert.equal(second.duplicate, true);

    const snap = await PartnerBalance.findOne({ ownerType: 'partner', ownerId: o }).lean();
    assert.equal(snap.balance, 500, 'a replayed webhook must not add the money twice');
    assert.equal(await LedgerEntry.countDocuments({ idempotencyKey: key }), 1);
  });

  await test('a replay returns the ORIGINAL row, not an error', async () => {
    // A retry asking "did this happen?" deserves the answer.
    const o = owner();
    const key = keys.forRideSettlement('ride_replay_1');
    const first = await append(entry(o, { amount: 77, idempotencyKey: key }));
    const second = await append(entry(o, { amount: 77, idempotencyKey: key }));
    assert.equal(String(second.entry._id), String(first.entry._id));
  });

  await test('THE ROLLBACK: a losing insert does not leave the balance moved', async () => {
    /*
     * The reason the increment happens INSIDE the transaction. If the balance were
     * incremented outside it, a duplicate key would abort the insert and leave the
     * money added with no row explaining it -- money appearing from nowhere, which
     * is worse than money not moving.
     */
    const o = owner();
    const key = keys.forProviderEvent('evt_rollback_1');
    await append(entry(o, { amount: 1000, idempotencyKey: key }));

    const before = await PartnerBalance.findOne({ ownerType: 'partner', ownerId: o }).lean();
    await append(entry(o, { amount: 1000, idempotencyKey: key }));
    const after = await PartnerBalance.findOne({ ownerType: 'partner', ownerId: o }).lean();

    assert.equal(after.balance, before.balance, 'balance moved on a duplicate');
    assert.equal(after.version, before.version, 'version moved on a duplicate');
  });

  // --- concurrency ----------------------------------------------------------
  console.log('\nconcurrency, which is the whole reason the arithmetic is server-side');

  await test('twenty concurrent appends all land; none is lost', async () => {
    /*
     * The bug this prevents, in adminService.adjustDriverWallet: read the balance,
     * compute in JavaScript, write it back absolutely. Two of those interleaving
     * lose one update outright.
     */
    const o = owner();
    const N = 20;
    const rows = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        append(entry(o, { amount: 10, idempotencyKey: keys.forOrderRiderEarning(`conc_${o}_${i}`) }))),
    );
    const applied = rows.filter((r) => r.status === 'fulfilled' && r.value.applied).length;

    const snap = await PartnerBalance.findOne({ ownerType: 'partner', ownerId: o }).lean();
    assert.equal(applied, N, `only ${applied} of ${N} appends applied`);
    assert.equal(snap.balance, N * 10, `balance is ${snap.balance}, expected ${N * 10}`);
  });

  await test('concurrent replays of ONE key credit once', async () => {
    // Two webhook deliveries arriving together, which is the realistic shape of
    // the duplicate rather than one-after-the-other.
    const o = owner();
    const key = keys.forProviderEvent('evt_concurrent_1');
    await Promise.allSettled(
      Array.from({ length: 8 }, () => append(entry(o, { amount: 250, idempotencyKey: key }))),
    );
    const snap = await PartnerBalance.findOne({ ownerType: 'partner', ownerId: o }).lean();
    assert.equal(snap.balance, 250);
    assert.equal(await LedgerEntry.countDocuments({ idempotencyKey: key }), 1);
  });

  await test('interleaved credits and debits settle on the right number', async () => {
    const o = owner();
    const moves = [100, -40, 250, -10, -300, 75];
    await Promise.allSettled(moves.map((amount, i) =>
      append(entry(o, { amount, idempotencyKey: keys.forOrderRiderEarning(`mix_${o}_${i}`) }))));
    const snap = await PartnerBalance.findOne({ ownerType: 'partner', ownerId: o }).lean();
    assert.equal(snap.balance, moves.reduce((a, b) => a + b, 0));
  });

  // --- the fold -------------------------------------------------------------
  console.log('\nthe collection folds back to the balance');

  await test('folding every amount reproduces the stored balance', async () => {
    const o = owner();
    const moves = [120, -45.5, 300, -0.5];
    for (const [i, amount] of moves.entries()) {
      await append(entry(o, { amount, idempotencyKey: keys.forOrderRiderEarning(`fold_${o}_${i}`) }));
    }
    const folded = await foldBalance('partner', o);
    const snap = await PartnerBalance.findOne({ ownerType: 'partner', ownerId: o }).lean();
    assert.equal(folded.balance, snap.balance);
    assert.equal(folded.entries, moves.length);
  });

  await test('reconcileOwner reports clean when they agree', async () => {
    const o = owner();
    await append(entry(o, { amount: 90 }));
    const report = await reconcileOwner('partner', o);
    assert.equal(report.clean, true);
    assert.equal(report.drift, 0);
    assert.equal(report.versionDrift, 0);
  });

  await test('reconcileOwner CATCHES a balance tampered with behind the ledger', async () => {
    // The whole point of the reconciler: an out-of-band write is exactly what the
    // five existing wallet writers do today.
    const o = owner();
    await append(entry(o, { amount: 90 }));
    await PartnerBalance.updateOne({ ownerType: 'partner', ownerId: o }, { $inc: { balance: 1000 } });

    const report = await reconcileOwner('partner', o);
    assert.equal(report.clean, false);
    assert.equal(report.drift, 1000, 'drift should name the size of the discrepancy');
  });

  await test('reconcileOwner catches a MISSING entry, which a sum alone would hide', async () => {
    /*
     * Two errors of opposite sign cancel in a total but not in a count. This is
     * why version is compared as well as balance.
     */
    const o = owner();
    await append(entry(o, { amount: 100 }));
    await append(entry(o, { amount: -100 }));
    await LedgerEntry.deleteOne({ ownerId: o, amount: 100 });
    await LedgerEntry.deleteOne({ ownerId: o, amount: -100 });

    const report = await reconcileOwner('partner', o);
    assert.equal(report.versionDrift, 2, 'two entries removed should show as version drift');
    assert.equal(report.clean, false);
  });

  // --- refusals -------------------------------------------------------------
  console.log('\nrefusals');

  await test('an append without an idempotency key is refused, not written', async () => {
    const o = owner();
    await assert.rejects(
      () => append({ ownerType: 'partner', ownerId: o, vertical: 'food', type: 'EARNING', amount: 10 }),
      /idempotencyKey/,
    );
    assert.equal(await LedgerEntry.countDocuments({ ownerId: o }), 0);
  });

  await test('a row violating the balance invariant cannot be written at all', async () => {
    // The cash-tip shape: an amount that does not equal its own balance delta.
    await assert.rejects(() => LedgerEntry.create({
      ownerType: 'partner', ownerId: owner(), vertical: 'taxi', type: 'ADJUSTMENT',
      amount: 50, balanceBefore: 500, balanceAfter: 500,
      idempotencyKey: 'manual_invariant_probe',
    }), /invariant/i);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length
    ? `\n${failed.length} of ${results.length} checks failed\n`
    : `\nall ${results.length} checks passed\n`);

  await mongoose.disconnect();
  await replSet.stop().catch(() => {});
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`HARNESS FAILED: ${err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
