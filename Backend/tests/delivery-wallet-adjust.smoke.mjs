/**
 * The admin sets a rider's pocket balance and cash in hand from the
 * Deliveryman list, and the rider's real balance reads what was typed.
 *
 * Run: node tests/delivery-wallet-adjust.smoke.mjs
 *
 * The page called adminAPI.updateDeliveryBoyWallet, which did not exist, and the
 * server had no route for it -- every save said "Failed to update wallet".
 * Neither figure is stored (core/finance/riderFinance.service.js derives both),
 * so a change is written as a record for the difference; this drives the real
 * derivation to show the figures land.
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

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'delivery_wallet_adjust' });

const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { FoodDeliveryWithdrawal } = await import('../src/modules/food/delivery/models/foodDeliveryWithdrawal.model.js');
const { FoodDeliveryCashDeposit } = await import('../src/modules/food/delivery/models/foodDeliveryCashDeposit.model.js');
const { DeliveryBonusTransaction } = await import('../src/modules/food/admin/models/deliveryBonusTransaction.model.js');
const { getRiderFinance } = await import('../src/core/finance/riderFinance.service.js');
const { setDeliveryWalletFigures } = await import('../src/modules/food/admin/services/deliveryWalletAdjust.service.js');

const oid = () => new mongoose.Types.ObjectId();
const rider = oid();
const admin = oid();
await FoodDeliveryPartner.collection.insertOne({ _id: rider, name: 'Rider', phone: '9311111111', status: 'approved' });
// Rs 200 earned, Rs 500 COD collected on one cash order.
await FoodOrder.collection.insertOne({ _id: oid(), orderStatus: 'delivered', dispatch: { deliveryPartnerId: rider }, payment: { method: 'cash' }, pricing: { total: 500 }, riderEarning: 200, createdAt: new Date() });

await check('starting point: pocket 200, cash 500', async () => {
    const f = await getRiderFinance(rider);
    assert.equal(f.walletBalance, 200);
    assert.equal(f.cashInHand, 500);
});

await check('raising the pocket balance to 1000 records an 800 adjustment, and the balance reads 1000', async () => {
    const out = await setDeliveryWalletFigures(rider, { pocketBalance: 1000, cashInHand: 500 }, { adminId: admin });
    assert.equal(out.changed, true);
    assert.equal(out.pocketChange, 800);
    assert.equal(out.pocketBalance, 1000);
    const bonus = await DeliveryBonusTransaction.findOne({ deliveryPartnerId: rider }).lean();
    assert.equal(bonus.amount, 800);
    assert.match(bonus.reference, /Admin wallet adjustment/);
    assert.equal(String(bonus.createdByAdminId), String(admin));
    assert.equal((await getRiderFinance(rider)).walletBalance, 1000);
});

await check('lowering it to 250 records a 750 approved adjustment withdrawal', async () => {
    const out = await setDeliveryWalletFigures(rider, { pocketBalance: 250, cashInHand: 500 }, { adminId: admin });
    assert.equal(out.pocketBalance, 250);
    const w = await FoodDeliveryWithdrawal.findOne({ deliveryPartnerId: rider }).lean();
    assert.equal(w.amount, 750);
    assert.equal(w.status, 'approved');
    assert.equal(w.paymentMethod, 'admin_adjustment');
});

await check('lowering cash in hand to 100 records a 400 completed deposit', async () => {
    const out = await setDeliveryWalletFigures(rider, { pocketBalance: 250, cashInHand: 100 }, { adminId: admin });
    assert.equal(out.cashInHand, 100);
    assert.equal(out.cashChange, -400);
    const d = await FoodDeliveryCashDeposit.findOne({ deliveryPartnerId: rider }).lean();
    assert.equal(d.amount, 400);
    assert.equal(d.status, 'Completed');
});

await check('raising cash in hand is refused with a reason, and nothing is written', async () => {
    const before = await FoodDeliveryCashDeposit.countDocuments({});
    await assert.rejects(() => setDeliveryWalletFigures(rider, { pocketBalance: 250, cashInHand: 900 }), /only goes up when the rider collects cash/);
    assert.equal(await FoodDeliveryCashDeposit.countDocuments({}), before);
});

await check('saving the figures as shown changes nothing; bad input is refused', async () => {
    const out = await setDeliveryWalletFigures(rider, { pocketBalance: 250, cashInHand: 100 });
    assert.equal(out.changed, false);
    await assert.rejects(() => setDeliveryWalletFigures(rider, { pocketBalance: -5 }), /0 or more/);
    await assert.rejects(() => setDeliveryWalletFigures(oid(), { pocketBalance: 5 }), /not found/);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
