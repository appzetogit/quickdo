/**
 * One customer wallet across Food, Rides and Quick & Medical.
 *
 * Run: node tests/one-wallet-quick.smoke.mjs
 *
 * Quick kept its own wallet (qc_user_wallets, keyed by the Quick customer id),
 * so money could not move between groceries/medicines and food/rides. Its
 * wallet model is now the shared wallet, translating Quick ids to the platform
 * account. Driven through each service's real wallet code:
 *   - money added in Food is spendable in Quick, and the reverse;
 *   - a ride credit (Taxi writes the shared wallet directly) shows in Quick;
 *   - Quick's payments ledger (refunds, cashback) lands in the same wallet;
 *   - a debit can never overdraw, from either side;
 *   - a Quick customer with no platform account still has a working wallet.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

let failed = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
  }
};

// A replica set: Quick's payments ledger writes inside a transaction, as it does live.
const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGO_URI = mongod.getUri();
process.env.MONGODB_URI = mongod.getUri();
await mongoose.connect(mongod.getUri());
const db = mongoose.connection;

const food = await import('../src/modules/food/user/services/userWallet.service.js');
const quick = await import('../src/modules/quickCommerce/modules/food/user/services/userWallet.service.js');
const quickLedger = await import('../src/modules/quickCommerce/core/payments/wallet.service.js');
const { CustomerWallet } = await import('../src/core/wallet/customerWallet.model.js');
const { FoodUserWallet: QuickWallet, __testables } = await import('../src/modules/quickCommerce/modules/food/user/models/userWallet.model.js');

const oid = () => new mongoose.Types.ObjectId();
const asha = oid();
const ashaQuick = oid();
const ravi = oid();
const raviQuickByPhone = oid();
const loner = oid();
await db.collection('users').insertMany([{ _id: asha, phone: '9876543210' }, { _id: ravi, phone: '9123456789' }]);
await db.collection('qc_users').insertMany([
  { _id: ashaQuick, platformUserId: asha, phone: '9876543210' },
  { _id: raviQuickByPhone, phone: '+91 91234 56789' },
  { _id: loner, phone: '9000000000' },
]);

const balanceOf = async (platformId) => (await CustomerWallet.findOne({ userId: platformId }).lean())?.balance ?? 0;

console.log('\nOne balance');
await check('money added in Food is visible and spendable in Quick', async () => {
  await food.creditReferralReward(String(asha), 200, { note: 'invite' });
  assert.equal((await quick.getUserWallet(String(ashaQuick))).balance, 200);
  await quick.deductWalletBalance(String(ashaQuick), 75, 'Groceries');
  assert.equal(await balanceOf(asha), 125);
  assert.equal((await food.getUserWallet(String(asha))).balance, 125);
});
await check('a Quick refund is spendable in Food', async () => {
  await quick.refundWalletBalance(String(ashaQuick), 40, 'Returned milk');
  assert.equal((await food.getUserWallet(String(asha))).balance, 165);
});
await check('a ride credit (Taxi writes the shared wallet directly) shows in Quick', async () => {
  await CustomerWallet.updateOne(
    { userId: asha },
    { $inc: { balance: 35 }, $push: { transactions: { kind: 'credit', amount: 35, title: 'Ride refund' } } },
  );
  const w = await quick.getUserWallet(String(ashaQuick));
  assert.equal(w.balance, 200);
  assert.ok(w.transactions.some((t) => t.description === 'Ride refund' || t.title === 'Ride refund'));
});
await check('Quick\'s payments ledger (refund/cashback path) lands in the same wallet', async () => {
  await quickLedger.creditWallet({ entityType: 'user', entityId: String(ashaQuick), amount: 10, description: 'Refund for order', category: 'order_refund' });
  assert.equal(await balanceOf(asha), 210);
});
await check('there is exactly one wallet for Asha, and none under her Quick id', async () => {
  assert.equal(await db.collection('food_user_wallets').countDocuments({ userId: asha }), 1);
  assert.equal(await db.collection('food_user_wallets').countDocuments({ userId: ashaQuick }), 0);
  assert.equal(await db.collection('qc_user_wallets').countDocuments({}), 0);
});

console.log('\nSafety');
await check('a Quick debit larger than the balance is refused and changes nothing', async () => {
  await assert.rejects(() => quick.deductWalletBalance(String(ashaQuick), 999, 'Too much'));
  assert.equal(await balanceOf(asha), 210);
});
await check('a Quick customer matched only by phone shares that account\'s wallet', async () => {
  __testables.clearCache();
  await food.creditReferralReward(String(ravi), 50, {});
  assert.equal((await quick.getUserWallet(String(raviQuickByPhone))).balance, 50);
});
await check('a Quick customer with no platform account still has a working wallet', async () => {
  await quick.refundWalletBalance(String(loner), 30, 'Refund');
  assert.equal((await quick.getUserWallet(String(loner))).balance, 30);
  assert.equal(await db.collection('food_user_wallets').countDocuments({ userId: loner }), 1);
});
await check('Quick wallet reads by $in translate too', async () => {
  const rows = await QuickWallet.find({ userId: { $in: [ashaQuick, raviQuickByPhone] } }).lean();
  assert.deepEqual(rows.map((r) => String(r.userId)).sort(), [String(asha), String(ravi)].sort());
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll one-wallet checks passed');
process.exit(failed ? 1 : 0);
