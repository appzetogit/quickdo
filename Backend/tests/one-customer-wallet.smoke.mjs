/**
 * One wallet per customer, whichever app they use it from.
 *
 * Run: node tests/one-customer-wallet.smoke.mjs
 *
 * Food kept its balance in `food_user_wallets` and taxi in `taxiuserwallets`,
 * both keyed by the same `users._id`. A customer who topped up while booking a
 * ride saw Rs 0 when they went to order food. Both now use one model
 * (core/wallet/customerWallet.model.js).
 *
 * The part that is easy to get wrong is not the shared balance, it is the
 * shared SCHEMA:
 *   - food names a row's direction `type`, taxi `kind`, and each screen reads
 *     its own -- so every row has to carry both, including rows pushed
 *     atomically, which never run subdocument hooks;
 *   - taxi's admin adjustment does load, mutate, save -- which, with two
 *     schemas, would silently drop the fields only the other one declared.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());

const { FoodUserWallet } = await import('../src/modules/food/user/models/userWallet.model.js');
const { UserWallet } = await import('../src/modules/taxi/user/models/UserWallet.js');
const food = await import('../src/modules/food/user/services/userWallet.service.js');

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

const newCustomer = () => new mongoose.Types.ObjectId();

/** Exactly the update taxi's creditUserWalletByReference sends. */
const taxiCredit = async (userId, amount, referenceKey) => {
  await UserWallet.updateOne(
    { userId },
    { $setOnInsert: { userId, balance: 0, refundWallet: 0, transactions: [] } },
    { upsert: true },
  );
  return UserWallet.updateOne(
    { userId },
    {
      $inc: { balance: amount },
      $push: { transactions: { $each: [{ kind: 'credit', amount, title: 'Ride refund', referenceKey }], $position: 0 } },
    },
  );
};

await check('food and taxi are the same model on the same collection', () => {
  assert.equal(FoodUserWallet, UserWallet);
  assert.equal(UserWallet.collection.collectionName, 'food_user_wallets');
});

await check('money added through taxi can be spent on food', async () => {
  const me = newCustomer();
  await taxiCredit(me, 200, 'ride-refund-1');
  // Food's real debit path, the one an order payment uses.
  await food.deductWalletBalance(me, 150, 'Order payment');
  const w = await FoodUserWallet.findOne({ userId: me }).lean();
  assert.equal(w.balance, 50, 'one balance, not two');
  assert.equal(w.transactions.length, 2);
});

await check('money added through food is visible to taxi', async () => {
  const me = newCustomer();
  await food.refundWalletBalance(me, 80, 'Order refund');
  const w = await UserWallet.findOne({ userId: me }).lean();
  assert.equal(w.balance, 80);
});

await check('a taxi row is readable on the food screen, and the reverse', async () => {
  const me = newCustomer();
  await taxiCredit(me, 100, 'k1');                   // taxi writes `kind` only
  await food.deductWalletBalance(me, 30, 'Order');   // food writes `type` only
  const w = await FoodUserWallet.findOne({ userId: me }).lean();
  // Rows were pushed atomically, which never runs a subdocument hook. The
  // model's update middleware is what filled the other field in.
  for (const tx of w.transactions) {
    assert.ok(tx.type, `row ${tx.title || tx.description} has no food-side type`);
    assert.ok(tx.kind, `row ${tx.title || tx.description} has no taxi-side kind`);
  }
  const taxiRow = w.transactions.find((t) => t.referenceKey === 'k1');
  assert.equal(taxiRow.kind, 'credit');
  assert.equal(taxiRow.type, 'addition');
  const foodRow = w.transactions.find((t) => t.description === 'Order');
  assert.equal(foodRow.type, 'deduction');
  assert.equal(foodRow.kind, 'debit');
});

await check("taxi's duplicate-credit guard still holds across the shared wallet", async () => {
  const me = newCustomer();
  await taxiCredit(me, 50, 'once-only');
  // Taxi checks for the key before crediting; the key has to survive the
  // shared schema or that check would never find it and pay twice.
  const seen = await UserWallet.findOne({ userId: me, 'transactions.referenceKey': 'once-only' }).lean();
  assert.ok(seen, 'the reference key was not stored, so a second credit would be applied');
});

await check('a load-mutate-save by taxi does not drop food fields', async () => {
  const me = newCustomer();
  await FoodUserWallet.updateOne(
    { userId: me },
    { $setOnInsert: { userId: me, balance: 0 }, $set: { referralEarnings: 25 } },
    { upsert: true },
  );
  // taxi/admin/services/adminService.js adjusts a wallet this way.
  const w = await UserWallet.findOne({ userId: me });
  w.balance += 40;
  w.refundWallet += 10;
  w.transactions.push({ kind: 'credit', amount: 40, title: 'Admin adjustment' });
  await w.save();

  const after = await FoodUserWallet.findOne({ userId: me }).lean();
  assert.equal(after.referralEarnings, 25, "taxi's save dropped food's referralEarnings");
  assert.equal(after.refundWallet, 10);
  assert.equal(after.balance, 40);
  // .save() runs the subdocument hook, so this row got its food field too.
  assert.equal(after.transactions[0].type, 'addition');
});

await check('a load-mutate-save by food does not drop taxi fields', async () => {
  const me = newCustomer();
  await taxiCredit(me, 60, 'k2');
  await UserWallet.updateOne({ userId: me }, { $set: { refundWallet: 15 } });
  const w = await FoodUserWallet.findOne({ userId: me });
  w.referralEarnings = 5;
  await w.save();
  const after = await UserWallet.findOne({ userId: me }).lean();
  assert.equal(after.refundWallet, 15, "food's save dropped taxi's refundWallet");
  assert.equal(after.transactions[0].referenceKey, 'k2', "food's save dropped taxi's referenceKey");
});

await check('the balance cannot go negative from either side', async () => {
  const me = newCustomer();
  await taxiCredit(me, 20, 'k3');
  await assert.rejects(() => food.deductWalletBalance(me, 50, 'Too much'), /Insufficient/);
  const w = await FoodUserWallet.findOne({ userId: me }).lean();
  assert.equal(w.balance, 20, 'a refused debit must leave the balance untouched');
});

await check('concurrent moves from both apps settle to the right total', async () => {
  const me = newCustomer();
  await taxiCredit(me, 500, 'seed');
  // Ten food debits of 10 and ten taxi credits of 5, all at once.
  await Promise.all([
    ...Array.from({ length: 10 }, (_, i) => food.deductWalletBalance(me, 10, `order ${i}`)),
    ...Array.from({ length: 10 }, (_, i) => taxiCredit(me, 5, `c${i}`)),
  ]);
  const w = await FoodUserWallet.findOne({ userId: me }).lean();
  assert.equal(w.balance, 500 - 100 + 50);
  assert.equal(w.transactions.length, 21);
});

await check("the food wallet screen labels a taxi row, and gives it a direction", async () => {
  const me = newCustomer();
  await taxiCredit(me, 70, 'shown-on-food');
  const screen = await food.getUserWallet(me);
  const row = screen.transactions[0];
  assert.equal(row.description, 'Ride refund', 'a ride refund would show with no label');
  assert.equal(row.type, 'addition');
});

await check('one wallet per customer, however many apps write to it', async () => {
  const me = newCustomer();
  await Promise.all([taxiCredit(me, 1, 'a'), food.refundWalletBalance(me, 1, 'b'), taxiCredit(me, 1, 'c')]);
  assert.equal(await FoodUserWallet.countDocuments({ userId: me }), 1);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
