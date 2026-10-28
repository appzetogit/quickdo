/**
 * Quick-commerce rider money is counted, and a withdrawal made through the grocery
 * app actually leaves the balance.
 *
 * Run: node tests/rider-finance-qc.smoke.mjs
 *
 * core/finance/riderFinance.service.js is the one rider balance for taxi, food and
 * quick commerce. It read the food_* collections only, on the belief -- written in
 * its own comment -- that quick commerce shared them. It does not: every QC model
 * passes an explicit collection to mongoose.model() ('qc_orders',
 * 'qc_delivery_withdrawals', ...), which overrides the schema's `collection` option.
 * So, on production:
 *
 *   - QC earnings, bonuses and cash on delivery were invisible to the balance and to
 *     the shared cash limit;
 *   - an APPROVED QC withdrawal was never subtracted. Money paid out through the
 *     grocery app still read as available, and could be requested again.
 *
 * Drives the real QC wallet, withdrawal and admin approval services, and the real
 * getRiderFinance, against an in-memory Mongo -- with every QC row written through
 * the QC models, so it lands where production puts it.
 */
import assert from 'node:assert/strict';

process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';

const { default: mongoose } = await import('mongoose');
const { MongoMemoryServer } = await import('mongodb-memory-server');

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
    await mongoose.connect(mongo.getUri(), { dbName: 'rider_finance_qc' });

    const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
    const { FoodDeliveryPartner: FoodPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
    const { FoodOrder: FoodOrderModel } = await import('../src/modules/food/orders/models/order.model.js');
    const { FoodDeliveryPartner: QCPartner } = await import('../src/modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js');
    const { FoodOrder: QCOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
    const { FoodDeliveryWithdrawal: QCWithdrawal } = await import('../src/modules/quickCommerce/modules/food/delivery/models/foodDeliveryWithdrawal.model.js');
    const { FoodDeliveryCashDeposit: QCDeposit } = await import('../src/modules/quickCommerce/modules/food/delivery/models/foodDeliveryCashDeposit.model.js');
    const { DeliveryBonusTransaction: QCBonus } = await import('../src/modules/quickCommerce/modules/food/admin/models/deliveryBonusTransaction.model.js');
    const qcFinance = await import('../src/modules/quickCommerce/modules/food/delivery/services/deliveryFinance.service.js');
    const qcAdmin = await import('../src/modules/quickCommerce/modules/food/admin/services/admin.service.js');
    const { getRiderFinance, resolveRiderIdentity, combineDeliveryMoney } = await import('../src/core/finance/riderFinance.service.js');

    await check('precondition: the QC models really are separate collections', async () => {
        // If this ever stops being true the rest of the file tests nothing, so say so.
        assert.equal(QCOrder.collection.collectionName, 'qc_orders');
        assert.equal(QCWithdrawal.collection.collectionName, 'qc_delivery_withdrawals');
        assert.equal(QCDeposit.collection.collectionName, 'qc_delivery_cash_deposits');
        assert.equal(QCBonus.collection.collectionName, 'qc_delivery_bonus_transactions');
        assert.notEqual(FoodOrderModel.collection.collectionName, QCOrder.collection.collectionName);
    });

    const oid = () => new mongoose.Types.ObjectId();
    let phone = 9300000000;
    const qcRider = async () => {
        const id = oid();
        await QCPartner.collection.insertOne({ _id: id, name: 'QC Rider', phone: String(phone++), status: 'approved' });
        return id;
    };
    const qcOrder = (rider, { earning = 0, total = 0, method = 'razorpay', status = 'delivered' } = {}) =>
        QCOrder.collection.insertOne({
            _id: oid(), orderStatus: status, dispatch: { deliveryPartnerId: rider },
            payment: { method }, pricing: { total }, riderEarning: earning, createdAt: new Date(),
        });

    // --- an unlinked quick-commerce rider -----------------------------------
    console.log('\nan unlinked quick-commerce rider');
    const r1 = await qcRider();
    await qcOrder(r1, { earning: 300, total: 900 });
    await qcOrder(r1, { earning: 40, total: 250, method: 'cash' });
    await qcOrder(r1, { earning: 999, total: 999, status: 'cancelled' });
    await QCBonus.collection.insertOne({ _id: oid(), deliveryPartnerId: r1, amount: 60, createdAt: new Date() });

    await check('is labelled a quick-commerce partner, not a food partner', async () => {
        const identity = await resolveRiderIdentity(r1);
        assert.equal(String(identity.qcPartnerId), String(r1));
        assert.equal(identity.foodPartnerId, null);
    });
    await check('QC earnings and bonus are in the balance: 300 + 40 + 60 = 400', async () => {
        const f = await getRiderFinance(r1);
        assert.equal(f.walletBalance, 400);
        assert.equal(f.breakdown.delivery.byVertical.quickCommerce.totalEarned, 340);
        assert.equal(f.breakdown.delivery.totalDeliveries, 2, 'the cancelled order does not count');
    });
    await check('QC cash on delivery counts toward cash in hand', async () => {
        assert.equal((await getRiderFinance(r1)).cashInHand, 250);
    });
    await check('a completed QC deposit settles it', async () => {
        await QCDeposit.collection.insertOne({ _id: oid(), deliveryPartnerId: r1, amount: 100, status: 'Completed', createdAt: new Date() });
        assert.equal((await getRiderFinance(r1)).cashInHand, 150);
    });
    await check('the grocery app wallet shows the same balance', async () => {
        assert.equal((await qcFinance.getDeliveryPartnerWalletEnhanced(r1)).pocketBalance, 400);
    });

    // --- withdrawing through the grocery app --------------------------------
    console.log('\nwithdrawing through the grocery app');
    let w1;
    await check('a Rs 300 withdrawal is accepted against Rs 400', async () => {
        w1 = await qcFinance.requestDeliveryWithdrawal(r1, { amount: 300 });
        assert.equal(w1.status, 'pending');
        assert.equal((await getRiderFinance(r1)).walletBalance, 100);
    });
    await check('once approved, it has left the balance', async () => {
        const out = await qcAdmin.updateDeliveryWithdrawalStatus(String(w1._id), { status: 'approved' });
        assert.equal(out.status, 'approved');
        assert.equal((await getRiderFinance(r1)).walletBalance, 100);
    });
    await check('so the same Rs 300 cannot be requested a second time', async () => {
        await assert.rejects(() => qcFinance.requestDeliveryWithdrawal(r1, { amount: 300 }), /insufficient/i);
    });

    // --- one person, two apps ------------------------------------------------
    console.log('\none person with a food and a quick-commerce identity');
    const foodId = oid();
    const qcId = await qcRider();
    const driverId = oid();
    await FoodPartner.collection.insertOne({ _id: foodId, name: 'Food Rider', phone: String(phone++), status: 'approved', driverId });
    await QCPartner.collection.updateOne({ _id: qcId }, { $set: { driverId } });
    await Driver.collection.insertOne({
        _id: driverId, name: 'Rider', phone: `+91${phone++}`,
        legacyDeliveryPartnerId: foodId, legacyQcPartnerId: qcId, wallet: { balance: 0 },
    });
    await FoodOrderModel.collection.insertOne({
        _id: oid(), orderStatus: 'delivered', dispatch: { deliveryPartnerId: foodId },
        payment: { method: 'cash' }, pricing: { total: 400 }, riderEarning: 500, createdAt: new Date(),
    });
    await qcOrder(qcId, { earning: 0, total: 300, method: 'cash' });

    await check('cash from both apps is one cash-in-hand, from any of the three ids', async () => {
        for (const id of [driverId, foodId, qcId]) {
            assert.equal((await getRiderFinance(id)).cashInHand, 700, `from ${id}`);
        }
    });

    let w2;
    await check('food earnings withdrawn through the grocery app...', async () => {
        w2 = await qcFinance.requestDeliveryWithdrawal(qcId, { amount: 500 });
        await qcAdmin.updateDeliveryWithdrawalStatus(String(w2._id), { status: 'approved' });
        assert.equal((await getRiderFinance(driverId)).walletBalance, 0);
    });
    await check('...cannot be withdrawn again through either app', async () => {
        await assert.rejects(() => qcFinance.requestDeliveryWithdrawal(qcId, { amount: 500 }), /insufficient/i);
        const food = await import('../src/modules/food/delivery/services/deliveryFinance.service.js');
        await assert.rejects(() => food.requestDeliveryWithdrawal(foodId, { amount: 500 }), /insufficient/i);
    });

    // --- the pure combination --------------------------------------------------
    console.log('\ncombining verticals');
    await check('sums first and derives once, so a withdrawal in one app settles money earned in the other', async () => {
        const out = combineDeliveryMoney([
            { totalEarned: 500, grossCashCollected: 0, totalDeposited: 0, totalBonus: 0, totalWithdrawn: 0, pendingWithdrawals: 0, totalDeliveries: 1 },
            { totalEarned: 0, grossCashCollected: 0, totalDeposited: 0, totalBonus: 0, totalWithdrawn: 500, pendingWithdrawals: 0, totalDeliveries: 0 },
        ]);
        assert.equal(out.pocketBalanceRaw, 0);
        assert.equal(out.totalDeliveries, 1);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
