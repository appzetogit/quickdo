// Restaurant payout balance audit: money already paid out must stay deducted.
//
// Runs the REAL getRestaurantFinance against a throwaway in-memory Mongo and
// walks a restaurant through the earn / request / approve / reject lifecycle.
//
// Run:  node src/modules/food/restaurant/audits/payout-balance.audit.mjs
//       (exits non-zero on failure)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..'));
dotenv.config();
const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri('payout_balance_audit'));

const { FoodTransaction } = await import('../../orders/models/foodTransaction.model.js');
const { FoodRestaurantWithdrawal } = await import('../models/foodRestaurantWithdrawal.model.js');
const { getRestaurantFinance } = await import('../services/restaurantFinance.service.js');

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
};

const restaurantId = new mongoose.Types.ObjectId();
const ACCOUNT = { accountNumber: '000', ifscCode: 'AAAA0000000', accountHolderName: 'x' };

async function earn(share) {
    await FoodTransaction.create({
        orderId: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        restaurantId,
        paymentMethod: 'razorpay',
        status: 'captured',
        amounts: {
            totalCustomerPaid: share * 1.2, restaurantShare: share,
            restaurantCommission: share * 0.2, riderShare: 0, platformNetProfit: share * 0.2,
        },
    });
}
const available = async () => {
    const f = await getRestaurantFinance(String(restaurantId), {});
    return Number(f?.currentCycle?.netAvailable ?? 0);
};
const withdraw = (amount) =>
    FoodRestaurantWithdrawal.create({ restaurantId, amount, status: 'pending', accountDetails: ACCOUNT });
const setStatus = (w, status) =>
    FoodRestaurantWithdrawal.updateOne({ _id: w._id }, { $set: { status, processedAt: new Date() } });

// ── the lifecycle ────────────────────────────────────────────────────────────
await earn(1000); await earn(1000); await earn(1000);
check('1  earnings show as available', (await available()) === 3000, `available = ${await available()} (earned 3000)`);

const w1 = await withdraw(3000);
check('2  a pending request holds the money', (await available()) === 0, `available = ${await available()}`);

await setStatus(w1, 'approved');
const afterPaid = await available();
check('3  money stays deducted once paid', afterPaid === 0,
    `available = ${afterPaid} — a restaurant paid 3000 must not see 3000 again`);

await earn(500);
check('4  new earnings after a payout are available', (await available()) === 500,
    `available = ${await available()} (earned 500 more)`);

const w2 = await withdraw(500);
await setStatus(w2, 'rejected');
check('5  a rejected request releases the money', (await available()) === 500,
    `available = ${await available()} — nothing was paid, so it is owed again`);

const w3 = await withdraw(200);
check('6  partial request holds only its own amount', (await available()) === 300,
    `available = ${await available()} (500 earned, 200 requested)`);

await setStatus(w3, 'approved');
check('7  partial payout leaves the remainder', (await available()) === 300,
    `available = ${await available()} (500 earned, 200 paid)`);

// A refunded order must not count toward payout at all.
const refunded = await FoodTransaction.create({
    orderId: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(), restaurantId,
    paymentMethod: 'razorpay', status: 'refunded',
    amounts: { totalCustomerPaid: 1200, restaurantShare: 1000, restaurantCommission: 200, riderShare: 0, platformNetProfit: 200 },
});
check('8  a refunded order is not payable', (await available()) === 300,
    `available = ${await available()} — refunded order of 1000 must not be added`);

console.log('\n' + '─'.repeat(66));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));

await mongoose.disconnect();
await mongod.stop();
process.exit(failed.length ? 1 : 0);
