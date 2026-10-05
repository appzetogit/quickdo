/**
 * Two things happening to one wallet at the same moment.
 *
 * Run: node tests/wallet-concurrent-moves.smoke.mjs
 *
 * Every wallet move was load, mutate, save: read the balance, unshift a row
 * onto the embedded transactions array, write the document back. Two moves on
 * one wallet then raced.
 *
 * The credit side surfaced first, in qc-return-payout, which failed about one
 * run in three with Mongoose's own words -- "No matching document found for id
 * ... modifiedPaths transactions, balance". One customer returning two items
 * is two refunds at once: the second threw, and they were paid for one return
 * until somebody retried the other by hand.
 *
 * The debit side is the one that costs money the other way. The balance check
 * was a separate read before the save, so two orders paid from one wallet
 * together both passed it and both wrote, and the customer spent more than
 * they had.
 *
 * Both are now one atomic update, which is what these checks pin.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri();
await mongoose.connect(server.getUri(), { dbName: 'wallet_concurrency' });

// Two collections, one per vertical: QC writes qc_user_wallets and food writes
// its own, so a balance has to be read from the same side that wrote it.
const { FoodUserWallet } = await import('../src/modules/quickCommerce/modules/food/user/models/userWallet.model.js');
const { FoodUserWallet: FoodSideWallet } = await import('../src/modules/food/user/models/userWallet.model.js');
const qcWallet = await import('../src/modules/quickCommerce/modules/food/user/services/userWallet.service.js');
const foodWallet = await import('../src/modules/food/user/services/userWallet.service.js');

let failures = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  ok   ${label}`);
    } catch (err) {
        failures += 1;
        console.log(`  FAIL ${label}\n       ${err.message}`);
    }
};

const newUser = () => new mongoose.Types.ObjectId();
const balanceOf = async (userId, model = FoodUserWallet) => {
    const doc = await model.findOne({ userId }).lean();
    return Number(doc?.balance) || 0;
};
const rowsOf = async (userId, model = FoodUserWallet) => {
    const doc = await model.findOne({ userId }).lean();
    return (doc?.transactions || []).length;
};

console.log('\ntwo refunds landing together');
{
    const user = newUser();
    const results = await Promise.allSettled([
        qcWallet.refundWalletBalance(user, 118, 'Refund A'),
        qcWallet.refundWalletBalance(user, 150.4, 'Refund B'),
    ]);
    await check('THE BUG: neither is rejected by a version conflict', () => {
        const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message);
        assert.deepEqual(errors, []);
    });
    await check('the customer is credited both, not one', async () =>
        assert.equal(await balanceOf(user), 268.4));
    await check('and both show in their history', async () => assert.equal(await rowsOf(user), 2));
}

console.log('\nten at once, which is a support agent and a job racing');
{
    const user = newUser();
    await Promise.all(Array.from({ length: 10 }, (_, i) => qcWallet.refundWalletBalance(user, 10, `R${i}`)));
    await check('every one lands', async () => {
        assert.equal(await balanceOf(user), 100);
        assert.equal(await rowsOf(user), 10);
    });
}

console.log('\ntwo orders paid from one wallet at the same moment');
{
    const user = newUser();
    await qcWallet.refundWalletBalance(user, 100, 'Top-up');
    const results = await Promise.allSettled([
        qcWallet.deductWalletBalance(user, 80, 'Order A'),
        qcWallet.deductWalletBalance(user, 80, 'Order B'),
    ]);
    await check('THE BUG IT PREVENTS: the wallet cannot go negative', async () => {
        const balance = await balanceOf(user);
        assert.ok(balance >= 0, `balance went to ${balance}`);
        assert.equal(balance, 20, `expected one payment of 80 to be refused, balance ${balance}`);
    });
    await check('exactly one is refused, and told why', () => {
        const rejected = results.filter((r) => r.status === 'rejected');
        assert.equal(rejected.length, 1);
        assert.match(rejected[0].reason?.message || '', /Insufficient wallet balance/);
    });
}

console.log('\nthe food wallet, which carries the same code');
{
    const user = newUser();
    const results = await Promise.allSettled([
        foodWallet.refundWalletBalance(user, 60, 'Refund A'),
        foodWallet.refundWalletBalance(user, 40, 'Refund B'),
    ]);
    await check('two refunds both land there too', async () => {
        assert.deepEqual(results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message), []);
        assert.equal(await balanceOf(user, FoodSideWallet), 100);
    });
    await check('and it will not overdraw', async () => {
        const out = await Promise.allSettled([
            foodWallet.deductWalletBalance(user, 70, 'Order A'),
            foodWallet.deductWalletBalance(user, 70, 'Order B'),
        ]);
        assert.equal(out.filter((r) => r.status === 'rejected').length, 1);
        assert.equal(await balanceOf(user, FoodSideWallet), 30);
    });
}

console.log('\nthe ordinary single move still behaves');
{
    const user = newUser();
    await qcWallet.refundWalletBalance(user, 55.75, 'One refund');
    await check('credits the amount and records one row', async () => {
        assert.equal(await balanceOf(user), 55.75);
        assert.equal(await rowsOf(user), 1);
    });
    await check('a nonsense amount changes nothing', async () => {
        await qcWallet.refundWalletBalance(user, -10, 'Nonsense');
        await qcWallet.refundWalletBalance(user, 0, 'Nothing');
        assert.equal(await balanceOf(user), 55.75);
        assert.equal(await rowsOf(user), 1);
    });
    await check('a debit larger than the balance is refused', async () => {
        await assert.rejects(
            () => qcWallet.deductWalletBalance(user, 500, 'Too much'),
            /Insufficient wallet balance/,
        );
        assert.equal(await balanceOf(user), 55.75);
    });
}

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} FAILED\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
