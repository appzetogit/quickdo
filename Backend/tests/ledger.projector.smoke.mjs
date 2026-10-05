/**
 * Food and quick-commerce rider money projected into the master ledger, against a
 * real database, checked against riderFinance itself.
 * Isolated in-memory MongoDB replica set; never touches Atlas.
 *
 * Run:  node tests/ledger.projector.smoke.mjs
 *
 * What must hold before the projector is run against production:
 *
 *   - dry run writes nothing
 *   - after a run, the ledger agrees with riderFinance to the paisa, for both
 *     verticals, balance AND cash
 *   - a second run appends nothing
 *   - source state changing underneath -- delivery reversed, withdrawal rejected,
 *     earning edited, order reassigned, deposit completed -- converges on the next
 *     run, and stays in agreement
 *   - two runs racing do not double-count
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

async function main() {
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  console.log('Booting in-memory MongoDB replica set…');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'projector' });
  console.log('Connected.\n');

  const { LedgerEntry } = await import('../src/core/finance/ledgerEntry.model.js');
  const { PartnerBalance } = await import('../src/core/finance/partnerBalance.model.js');
  await LedgerEntry.init();
  await PartnerBalance.init();
  await LedgerEntry.createCollection().catch(() => {});
  await PartnerBalance.createCollection().catch(() => {});

  const { loadDeliveryModels, getRiderFinance } = await import('../src/core/finance/riderFinance.service.js');
  const projector = await import('../src/core/finance/deliveryLedgerProjector.js');
  const { FoodDeliveryPartner: FoodPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
  const { FoodDeliveryPartner: QCPartner } = await import('../src/modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js');
  const food = await loadDeliveryModels('food');
  const qc = await loadDeliveryModels('quickCommerce');

  let phone = 9400000000;
  const seed = async (Partner, m, rider) => {
    await Partner.collection.insertOne({ _id: rider, name: 'R', phone: String(phone++), status: 'approved' });
    const orders = {
      online: oid(), cod: oid(), cancelled: oid(),
    };
    await m.Order.collection.insertMany([
      { _id: orders.online, orderStatus: 'delivered', riderEarning: 45.5, payment: { method: 'razorpay' }, pricing: { total: 500 }, dispatch: { deliveryPartnerId: rider } },
      { _id: orders.cod, orderStatus: 'delivered', riderEarning: 30, payment: { method: 'cash' }, pricing: { total: 640 }, dispatch: { deliveryPartnerId: rider } },
      { _id: orders.cancelled, orderStatus: 'cancelled', riderEarning: 99, payment: { method: 'cash' }, pricing: { total: 999 }, dispatch: { deliveryPartnerId: rider } },
    ]);
    const bonus = oid();
    await m.Bonus.collection.insertOne({ _id: bonus, transactionId: `BON-${bonus}`, deliveryPartnerId: rider, amount: 20 });
    const withdrawals = { approved: oid(), pending: oid() };
    await m.Withdrawal.collection.insertMany([
      { _id: withdrawals.approved, deliveryPartnerId: rider, amount: 40, status: 'approved' },
      { _id: withdrawals.pending, deliveryPartnerId: rider, amount: 15, status: 'pending' },
    ]);
    const deposit = oid();
    await m.CashDeposit.collection.insertOne({ _id: deposit, deliveryPartnerId: rider, amount: 200, status: 'Completed' });
    return { orders, bonus, withdrawals, deposit };
  };

  const agree = async (partnerId, vertical) => {
    const r = await projector.reconcilePartner({ partnerId, vertical });
    assert.equal(r.clean, true, `ledger ${JSON.stringify(r.ledger)} vs derived ${JSON.stringify(r.derived)}`);
    return r;
  };

  const foodRider = oid();
  const qcRider = oid();
  const foodRows = await seed(FoodPartner, food, foodRider);
  const qcRows = await seed(QCPartner, qc, qcRider);

  // --- first run ------------------------------------------------------------
  console.log('first run');

  await test('dry run plans entries and writes none', async () => {
    const r = await projector.projectPartner({ partnerId: foodRider, vertical: 'food' });
    assert.ok(r.entries.length > 0);
    assert.equal(r.appended, 0);
    assert.equal(await LedgerEntry.countDocuments(), 0);
  });

  await test('commit: the food ledger agrees with riderFinance, balance and cash', async () => {
    await projector.projectPartner({ partnerId: foodRider, vertical: 'food', commit: true });
    const r = await agree(foodRider, 'food');
    // earned 75.5 + bonus 20 - approved 40 - pending 15 ; cash 640 - 200
    assert.equal(r.ledger.balance, 40.5);
    assert.equal(r.ledger.cash, 440);
  });

  await test('commit: the quick-commerce ledger agrees too, from the qc_* collections', async () => {
    const totals = await projector.projectVertical({ vertical: 'quickCommerce', commit: true });
    assert.equal(totals.partners, 1);
    assert.equal(totals.failed, 0);
    await agree(qcRider, 'quickCommerce');
    const qcEntries = await LedgerEntry.find({ ownerId: String(qcRider) }).lean();
    assert.ok(qcEntries.every((e) => e.vertical === 'quickCommerce'));
  });

  await test('...and matches what the rider is actually shown', async () => {
    const shown = await getRiderFinance(qcRider);
    const r = await projector.reconcilePartner({ partnerId: qcRider, vertical: 'quickCommerce' });
    assert.equal(r.ledger.balance, shown.breakdown.delivery.pocketBalanceRaw);
    assert.equal(r.ledger.cash, shown.breakdown.delivery.cashInHandRaw);
  });

  await test('a second run appends nothing', async () => {
    const before = await LedgerEntry.countDocuments();
    const r = await projector.projectPartner({ partnerId: foodRider, vertical: 'food', commit: true });
    assert.equal(r.entries.length, 0);
    assert.equal(await LedgerEntry.countDocuments(), before);
  });

  // --- the source changes underneath ---------------------------------------
  console.log('source state changes');

  await test('delivery reversed, withdrawal rejected, earning edited, deposit completed: one run converges', async () => {
    await food.Order.collection.updateOne({ _id: foodRows.orders.cod }, { $set: { orderStatus: 'cancelled' } });
    await food.Withdrawal.collection.updateOne({ _id: foodRows.withdrawals.pending }, { $set: { status: 'rejected' } });
    await food.Order.collection.updateOne({ _id: foodRows.orders.online }, { $set: { riderEarning: 52 } });
    await food.CashDeposit.collection.insertOne({ _id: oid(), deliveryPartnerId: foodRider, amount: 50, status: 'Pending' });

    const stale = await projector.reconcilePartner({ partnerId: foodRider, vertical: 'food' });
    assert.equal(stale.clean, false, 'the reconciler must notice before the run');

    const r = await projector.projectPartner({ partnerId: foodRider, vertical: 'food', commit: true });
    assert.equal(r.corrections, 3);
    const after = await agree(foodRider, 'food');
    // earned 52 + bonus 20 - approved 40 ; cash 0 - 200
    assert.equal(after.ledger.balance, 32);
    assert.equal(after.ledger.cash, -200);
  });

  await test('history is appended to, never rewritten', async () => {
    const entries = await LedgerEntry.find({ ownerId: String(foodRider) }).lean();
    assert.ok(entries.some((e) => e.idempotencyKey.endsWith('#rev1')));
    for (const e of entries) {
      assert.equal(Math.round((e.balanceAfter - e.balanceBefore) * 100) / 100, e.amount, 'ledger invariant');
    }
  });

  await test('an order reassigned between riders moves between their ledgers', async () => {
    const other = oid();
    await FoodPartner.collection.insertOne({ _id: other, name: 'R2', phone: String(phone++), status: 'approved' });
    await food.Order.collection.updateOne(
      { _id: foodRows.orders.online },
      { $set: { 'dispatch.deliveryPartnerId': other } },
    );
    const totals = await projector.projectVertical({ vertical: 'food', commit: true });
    assert.equal(totals.failed, 0);
    const a = await agree(foodRider, 'food');
    const b = await agree(other, 'food');
    assert.equal(a.ledger.balance, -20, 'rider A lost the 52 earning');
    assert.equal(b.ledger.balance, 52, 'rider B gained it');
  });

  // --- concurrency ---------------------------------------------------------
  console.log('concurrency');

  await test('two runs racing over a change do not double-count', async () => {
    await qc.Withdrawal.collection.updateOne({ _id: qcRows.withdrawals.approved }, { $set: { amount: 60 } });
    await qc.Bonus.collection.insertOne({ _id: oid(), transactionId: 'BON-race', deliveryPartnerId: qcRider, amount: 7 });
    const runs = await Promise.all([1, 2, 3, 4].map(() =>
      projector.projectPartner({ partnerId: qcRider, vertical: 'quickCommerce', commit: true })));
    const appended = runs.reduce((s, r) => s + r.appended, 0);
    assert.equal(appended, 2, `expected exactly the 2 changes, got ${appended}`);
    await agree(qcRider, 'quickCommerce');
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
