/**
 * "Minimum balance to get an order" is the least a driver must have, so a
 * balance exactly at the minimum passes.
 *
 * Run: node tests/wallet-minimum-balance.smoke.mjs
 *
 * The rule was `balance <= minimum`. With the admin's minimum at 0, every driver
 * at Rs 0 -- every new driver -- stayed blocked ("wallet blocked"), and no
 * setting short of a negative number could clear it.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
process.env.REDIS_ENABLED = 'false';

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
const oid = () => new mongoose.Types.ObjectId();

const main = async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'wallet_minimum' });

    const { getRiderFinance } = await import('../src/core/finance/riderFinance.service.js');
    const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
    const { AdminAppSetting } = await import('../src/modules/taxi/admin/models/AdminAppSetting.js');
    const { applyDriverWalletAdjustment } = await import('../src/modules/taxi/driver/services/walletService.js');

    await mongoose.connection.db.collection('food_delivery_cash_limits')
        .insertOne({ isActive: true, deliveryCashLimit: 1500, deliveryWithdrawalLimit: 100, createdAt: new Date() });
    const setMinimum = (value) => AdminAppSetting.collection.updateOne(
        { scope: 'default' },
        { $set: { 'wallet_setting.driver_wallet_minimum_amount_to_get_an_order': value } },
        { upsert: true },
    );
    const driver = async (balance) => {
        const _id = oid();
        await Driver.collection.insertOne({ _id, name: 'D', phone: `+9197${String(Math.random()).slice(2, 10)}`, wallet: { balance, isBlocked: false } });
        return _id;
    };

    await setMinimum(0);

    await check('minimum 0: a new driver at Rs 0 is not blocked', async () => {
        const f = await getRiderFinance(await driver(0));
        assert.equal(f.isBlocked, false, `blocked: ${f.blockReason}`);
    });

    await check('minimum 0: a driver below it (owes money) is blocked', async () => {
        const f = await getRiderFinance(await driver(-50));
        assert.equal(f.isBlocked, true);
        assert.equal(f.blockReason, 'below_minimum_balance');
    });

    await check('the taxi wallet flag agrees: a wallet write landing on exactly 0 leaves it unblocked', async () => {
        const id = await driver(100);
        await applyDriverWalletAdjustment({ driverId: id, amount: -100, type: 'adjustment', description: 'test' }).catch(() => {});
        const d = await Driver.findById(id).select('wallet').lean();
        assert.equal(Number(d.wallet.balance), 0);
        assert.equal(d.wallet.isBlocked, false);
    });

    await check('a negative minimum (debt allowance): exactly at the floor passes, past it blocks', async () => {
        await setMinimum(-500);
        assert.equal((await getRiderFinance(await driver(-500))).isBlocked, false);
        assert.equal((await getRiderFinance(await driver(-501))).blockReason, 'below_minimum_balance');
    });

    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
