/**
 * A restaurant can never withdraw more than it has earned, and a paid
 * withdrawal stays paid.
 *
 * Run: node tests/restaurant-withdrawal-within-balance.smoke.mjs
 *
 * Found in the finance audit. The restaurant withdrawal controller read the
 * available balance, then saved the request: two Rs 800 requests against Rs 1000,
 * sent together, both got 201 -- Rs 1600 queued. The admin's updateWithdrawalStatus
 * wrote any status it was sent with no balance check and no transition guard, so
 * both could be approved, and an approved one could be flipped back.
 *
 * Drives the real controller (req/res mocks) and admin service against an
 * in-memory Mongo.
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
const mockRes = () => ({
    code: 200,
    body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
});

const main = async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'restaurant_withdrawal' });

    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    const { FoodTransaction } = await import('../src/modules/food/orders/models/foodTransaction.model.js');
    const { FoodRestaurantWithdrawal } = await import('../src/modules/food/restaurant/models/foodRestaurantWithdrawal.model.js');
    const controller = await import('../src/modules/food/restaurant/controllers/withdrawal.controller.js');
    const { getRestaurantFinance } = await import('../src/modules/food/restaurant/services/restaurantFinance.service.js');
    const admin = await import('../src/modules/food/admin/services/admin.service.js');

    // A restaurant with `earned` of unsettled captured payouts.
    const makeRestaurant = async (earned) => {
        const id = new mongoose.Types.ObjectId();
        await FoodRestaurant.collection.insertOne({
            _id: id, restaurantName: 'Test Kitchen', ownerName: 'Owner', ownerPhone: '9999999999',
            status: 'approved', location: { type: 'Point', coordinates: [76.53, 32.1] }, createdAt: new Date(),
        });
        await FoodTransaction.collection.insertOne({
            // Every ledger row belongs to one order; the collection enforces it.
            _id: new mongoose.Types.ObjectId(), orderId: new mongoose.Types.ObjectId(), restaurantId: id, status: 'captured',
            amounts: { restaurantShare: earned }, createdAt: new Date(),
        });
        return id;
    };
    const request = async (restaurantId, amount) => {
        const res = mockRes();
        let error = null;
        await controller.createWithdrawalRequestController(
            { user: { userId: String(restaurantId) }, body: { amount } }, res, (e) => { error = e; },
        );
        if (error) throw error;
        return res;
    };
    const available = async (id) => (await getRestaurantFinance(String(id))).currentCycle.netAvailable;

    console.log('\ntwo Rs 800 requests at once against Rs 1000');
    const rest1 = await makeRestaurant(1000);
    const [x, y] = await Promise.all([request(rest1, 800), request(rest1, 800)]);
    await check('exactly one gets 201', async () => {
        const created = [x, y].filter((r) => r.code === 201).length;
        assert.equal(created, 1, `codes ${x.code}, ${y.code}`);
    });
    await check('the other gets 400', async () => {
        assert.deepEqual([x.code, y.code].sort(), [201, 400]);
    });
    await check('Rs 800 queued, not 1600', async () => {
        const rows = await FoodRestaurantWithdrawal.find({ restaurantId: rest1 }).lean();
        assert.equal(rows.reduce((s, w) => s + w.amount, 0), 800);
    });

    console.log('\napproval re-checks the balance');
    const rest2 = await makeRestaurant(1000);
    const [a, b] = await FoodRestaurantWithdrawal.create([
        { restaurantId: rest2, amount: 800, status: 'pending' },
        { restaurantId: rest2, amount: 800, status: 'pending' },
    ]);
    await check('the first Rs 800 is approved', async () => {
        const out = await admin.updateWithdrawalStatus(String(a._id), { status: 'approved' });
        assert.equal(out.status, 'approved');
    });
    await check('the second is refused: only Rs 200 is left to pay it from', async () => {
        await assert.rejects(() => admin.updateWithdrawalStatus(String(b._id), { status: 'approved' }), /balance/i);
        assert.equal((await FoodRestaurantWithdrawal.findById(b._id).lean()).status, 'pending');
    });
    await check('it can still be rejected', async () => {
        const out = await admin.updateWithdrawalStatus(String(b._id), { status: 'rejected' });
        assert.equal(out.status, 'rejected');
    });

    console.log('\na paid withdrawal stays paid');
    await check('Approved -> Rejected is refused', async () => {
        await assert.rejects(() => admin.updateWithdrawalStatus(String(a._id), { status: 'rejected' }));
        assert.equal((await FoodRestaurantWithdrawal.findById(a._id).lean()).status, 'approved');
    });
    await check('Rejected -> Approved is refused', async () => {
        await assert.rejects(() => admin.updateWithdrawalStatus(String(b._id), { status: 'approved' }));
        assert.equal((await FoodRestaurantWithdrawal.findById(b._id).lean()).status, 'rejected');
    });
    await check('available stays Rs 1000 - 800 paid = Rs 200', async () => {
        assert.equal(await available(rest2), 200);
    });
    await check('a status outside the enum is refused, not saved', async () => {
        const c = await FoodRestaurantWithdrawal.create({ restaurantId: rest2, amount: 100, status: 'pending' });
        await assert.rejects(() => admin.updateWithdrawalStatus(String(c._id), { status: 'processed_manually' }));
        assert.equal((await FoodRestaurantWithdrawal.findById(c._id).lean()).status, 'pending');
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
