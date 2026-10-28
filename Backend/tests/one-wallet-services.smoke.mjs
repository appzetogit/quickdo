/**
 * Services customers share the ONE customer wallet with Food, Rides and Quick.
 *
 * Run: node tests/one-wallet-services.smoke.mjs
 *
 * Services kept a balance on each customer record (sp_users.wallet.balance). For a
 * customer with a platform account, the Services User model now moves money in
 * the shared wallet (food_user_wallets) instead -- utils/sharedWalletBridge.js.
 * Driven through the real Services code: the wallet-balance controller, the
 * booking-expiry refund, and the exact guarded debit the wallet payment runs,
 * inside the real transaction helper.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const require = createRequire(import.meta.url);
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

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
await mongoose.connect(replSet.getUri(), { dbName: 'one_wallet_sp' });
const db = mongoose.connection;

const User = require('../src/modules/serviceProvider/models/User.js');
const Booking = require('../src/modules/serviceProvider/models/Booking.js');
const Transaction = require('../src/modules/serviceProvider/models/Transaction.js');
const { expireTimedOutBooking } = require('../src/modules/serviceProvider/services/bookingExpiry.js');
const { getWalletBalance } = require('../src/modules/serviceProvider/controllers/userControllers/userWalletController.js');
const { withTransaction, abort } = require('../src/modules/serviceProvider/utils/withTransaction.js');
const { __testables } = require('../src/modules/serviceProvider/utils/sharedWalletBridge.js');
const food = await import('../src/modules/food/user/services/userWallet.service.js');
const { CustomerWallet } = await import('../src/core/wallet/customerWallet.model.js');
for (const M of [User, Booking, Transaction, CustomerWallet]) await M.createCollection().catch(() => {});

const oid = () => new mongoose.Types.ObjectId();
const asha = oid(); // platform account
const ashaSp = oid(); // her Services record, linked by platformUserId
const ravi = oid();
const raviSp = oid(); // linked only by phone
const loner = oid(); // Services only
await db.collection('users').insertMany([{ _id: asha, phone: '9876543210' }, { _id: ravi, phone: '9123456789' }]);
await User.collection.insertMany([
  { _id: ashaSp, platformUserId: asha, name: 'Asha', phone: '9876543210', wallet: { balance: 0, penalty: 0 } },
  { _id: raviSp, name: 'Ravi', phone: '+91 91234 56789', wallet: { balance: 0, penalty: 0 } },
  { _id: loner, name: 'Loner', phone: '9000000000', wallet: { balance: 80, penalty: 0 } },
]);

const shared = async (id) => (await CustomerWallet.findOne({ userId: id }).lean())?.balance ?? 0;
const apiBalance = async (spId) => {
  let body;
  const res = { status() { return this; }, json(b) { body = b; return this; } };
  await getWalletBalance({ user: { id: String(spId) } }, res);
  return body.data.balance;
};
// The exact debit paymentController's wallet payment runs.
const walletPay = (spId, amount, { failAfter = false } = {}) => withTransaction(async (session) => {
  const u = await User.findOneAndUpdate(
    { _id: spId, 'wallet.balance': { $gte: amount } },
    { $inc: { 'wallet.balance': -amount } },
    { new: true, session },
  );
  if (!u) abort({ insufficient: true });
  if (failAfter) abort({ later: true });
  return { balanceAfter: u.wallet.balance };
});

console.log('\nOne balance');
await check('money added in Food shows in the Services wallet', async () => {
  await food.creditReferralReward(String(asha), 500, {});
  assert.equal(await apiBalance(ashaSp), 500);
});
await check('a Services wallet payment spends the shared balance', async () => {
  const out = await walletPay(ashaSp, 300);
  assert.equal(out.balanceAfter, 200);
  assert.equal(await shared(asha), 200);
  assert.equal((await food.getUserWallet(String(asha))).balance, 200);
  const raw = await User.collection.findOne({ _id: ashaSp });
  assert.equal(raw.wallet.balance, 0, 'the Services record itself is untouched');
});
await check('a Services refund (booking expiry) lands in the shared wallet', async () => {
  const b = oid();
  await Booking.collection.insertOne({
    _id: b, userId: ashaSp, bookingNumber: 'BK1', status: 'searching', paymentStatus: 'success',
    paymentMethod: 'wallet', finalAmount: 300, paidAmount: 300, createdAt: new Date(),
  });
  const r = await expireTimedOutBooking(b);
  assert.equal(r.refundAmount, 300);
  assert.equal(await shared(asha), 500);
  assert.equal(await apiBalance(ashaSp), 500);
});
await check('the wallet history in Food shows the Services rows', async () => {
  const w = await food.getUserWallet(String(asha));
  assert.ok(w.transactions.some((t) => /Services/.test(t.description || '')));
});

console.log('\nSafety');
await check('a payment larger than the shared balance is refused and changes nothing', async () => {
  assert.deepEqual(await walletPay(ashaSp, 9999), { insufficient: true });
  assert.equal(await shared(asha), 500);
});
await check('a payment aborted later in the transaction rolls the shared debit back', async () => {
  assert.deepEqual(await walletPay(ashaSp, 100, { failAfter: true }), { later: true });
  assert.equal(await shared(asha), 500);
});
await check('penalty stays on the Services record', async () => {
  await User.findByIdAndUpdate(ashaSp, { $inc: { 'wallet.balance': 10, 'wallet.penalty': 25 } });
  const raw = await User.collection.findOne({ _id: ashaSp });
  assert.equal(raw.wallet.penalty, 25);
  assert.equal(raw.wallet.balance, 0);
  assert.equal(await shared(asha), 510);
});
await check('a customer linked only by phone shares that account\'s wallet', async () => {
  __testables.clearCache();
  await food.creditReferralReward(String(ravi), 60, {});
  assert.equal(await apiBalance(raviSp), 60);
  await walletPay(raviSp, 60);
  assert.equal(await shared(ravi), 0);
});
await check('a Services-only customer keeps their own balance, as before', async () => {
  assert.equal(await apiBalance(loner), 80);
  await walletPay(loner, 30);
  assert.equal((await User.collection.findOne({ _id: loner })).wallet.balance, 50);
  assert.equal(await db.collection('food_user_wallets').countDocuments({ userId: loner }), 0);
});
await check('a saved Services document does not copy the shared balance onto its record', async () => {
  const doc = await User.findById(ashaSp);
  assert.equal(doc.wallet.balance, 510);
  doc.name = 'Asha K';
  await doc.save();
  assert.equal((await User.collection.findOne({ _id: ashaSp })).wallet.balance, 0);
});

await mongoose.disconnect();
await replSet.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Services one-wallet checks passed');
process.exit(failed ? 1 : 0);
