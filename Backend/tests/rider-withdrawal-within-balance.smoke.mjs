/**
 * A rider can never withdraw more than they have, and a paid withdrawal stays paid.
 *
 * Run: node tests/rider-withdrawal-within-balance.smoke.mjs
 *
 * Found in the finance audit, two holes in the food delivery withdrawal path:
 *
 *  - requestDeliveryWithdrawal read the balance, then created the request. Two
 *    requests of Rs 400 against Rs 500, sent together, both read 500 and both
 *    succeeded: Rs 800 pending. The admin approval never looked at the balance
 *    again, so both could be paid.
 *  - updateDeliveryWithdrawalStatus wrote whatever status it was sent. Approved
 *    -> Rejected on a PAID Rs 400 withdrawal put the 400 back in the rider's
 *    balance, withdrawable a second time. And findByIdAndUpdate skipped the
 *    schema validators, so a status outside the enum ('processed') was saved and
 *    then dropped out of the balance maths altogether.
 *
 * Drives the real food deliveryFinance and admin services against an in-memory Mongo.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

const main = async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'rider_withdrawal' });

    const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
    const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
    const { FoodDeliveryWithdrawal } = await import('../src/modules/food/delivery/models/foodDeliveryWithdrawal.model.js');
    const finance = await import('../src/modules/food/delivery/services/deliveryFinance.service.js');
    const admin = await import('../src/modules/food/admin/services/admin.service.js');

    // A rider who has earned `earned` on delivered online orders.
    const makeRider = async (earned) => {
        const rider = new mongoose.Types.ObjectId();
        await FoodDeliveryPartner.collection.insertOne({ _id: rider, name: 'Rider', phone: `9${String(Date.now()).slice(-9)}`, status: 'approved' });
        await FoodOrder.collection.insertOne({
            _id: new mongoose.Types.ObjectId(), orderStatus: 'delivered', dispatch: { deliveryPartnerId: rider },
            payment: { method: 'razorpay' }, pricing: { total: earned + 100 }, riderEarning: earned, createdAt: new Date(),
        });
        return rider;
    };
    const balance = async (rider) => (await finance.getDeliveryPartnerWalletEnhanced(rider)).pocketBalance;
    const pendingTotal = async (rider) => (await FoodDeliveryWithdrawal.find({ deliveryPartnerId: rider, status: 'pending' }).lean())
        .reduce((s, w) => s + w.amount, 0);

    console.log('\ntwo Rs 400 requests at once against Rs 500');
    const r1 = await makeRider(500);
    const results = await Promise.allSettled([
        finance.requestDeliveryWithdrawal(r1, { amount: 400 }),
        finance.requestDeliveryWithdrawal(r1, { amount: 400 }),
    ]);
    await check('exactly one succeeds', async () => {
        const ok = results.filter((r) => r.status === 'fulfilled').length;
        assert.equal(ok, 1, `${ok} succeeded: ${results.map((r) => r.reason?.message || 'ok').join(' | ')}`);
    });
    await check('Rs 400 pending, not 800', async () => {
        assert.equal(await pendingTotal(r1), 400);
    });
    await check('the one that lost was told the balance is insufficient', async () => {
        const lost = results.find((r) => r.status === 'rejected');
        assert.match(String(lost?.reason?.message), /insufficient/i);
    });

    console.log('\napproval re-checks the balance');
    const r2 = await makeRider(500);
    // Two requests already queued over the balance -- what the race left behind.
    const [a, b] = await FoodDeliveryWithdrawal.create([
        { deliveryPartnerId: r2, amount: 400, status: 'pending' },
        { deliveryPartnerId: r2, amount: 400, status: 'pending' },
    ]);
    await check('the first Rs 400 is approved', async () => {
        const out = await admin.updateDeliveryWithdrawalStatus(String(a._id), { status: 'approved' });
        assert.equal(out.status, 'approved');
    });
    await check('the second is refused: only Rs 100 is left to pay it from', async () => {
        await assert.rejects(() => admin.updateDeliveryWithdrawalStatus(String(b._id), { status: 'approved' }), /balance/i);
        assert.equal((await FoodDeliveryWithdrawal.findById(b._id).lean()).status, 'pending');
    });
    await check('it can still be rejected', async () => {
        const out = await admin.updateDeliveryWithdrawalStatus(String(b._id), { status: 'rejected' });
        assert.equal(out.status, 'rejected');
    });

    console.log('\na paid withdrawal stays paid');
    await check('before: Rs 500 earned - 400 paid = Rs 100', async () => {
        assert.equal(await balance(r2), 100);
    });
    await check('Approved -> Rejected is refused', async () => {
        await assert.rejects(() => admin.updateDeliveryWithdrawalStatus(String(a._id), { status: 'rejected' }));
        assert.equal((await FoodDeliveryWithdrawal.findById(a._id).lean()).status, 'approved');
    });
    await check('Approved -> Pending is refused', async () => {
        await assert.rejects(() => admin.updateDeliveryWithdrawalStatus(String(a._id), { status: 'pending' }));
        assert.equal((await FoodDeliveryWithdrawal.findById(a._id).lean()).status, 'approved');
    });
    await check('Rejected -> Approved is refused', async () => {
        await assert.rejects(() => admin.updateDeliveryWithdrawalStatus(String(b._id), { status: 'approved' }));
        assert.equal((await FoodDeliveryWithdrawal.findById(b._id).lean()).status, 'rejected');
    });
    await check('after: the balance is still Rs 100, not 500', async () => {
        assert.equal(await balance(r2), 100);
    });

    console.log('\nonly real statuses are saved');
    const r3 = await makeRider(500);
    const c = await FoodDeliveryWithdrawal.create({ deliveryPartnerId: r3, amount: 200, status: 'pending' });
    await check("a status outside the enum is refused, not saved", async () => {
        await assert.rejects(() => admin.updateDeliveryWithdrawalStatus(String(c._id), { status: 'bogus' }));
        assert.equal((await FoodDeliveryWithdrawal.findById(c._id).lean()).status, 'pending');
    });
    await check("'processed' is stored as 'approved', so it still counts as paid", async () => {
        const out = await admin.updateDeliveryWithdrawalStatus(String(c._id), { status: 'processed' });
        assert.equal(out.status, 'approved');
        assert.equal(await balance(r3), 300);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
