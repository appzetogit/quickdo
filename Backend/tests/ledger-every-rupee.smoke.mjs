/**
 * Every rupee a customer pays lands with exactly one party: the restaurant or
 * store, the rider, the platform, or the government.
 *
 * Run: node tests/ledger-every-rupee.smoke.mjs
 *
 * Found on production, 11 Sep. The ledger never counted the bill's round-off:
 * FOD-0243696 was charged Rs 348 (Rs 347.80 rounded up) and its ledger accounted
 * for Rs 347.80, leaving 20 paise credited to nobody -- on every order, since
 * almost every bill rounds. The payout audit let up to 51 paise through as
 * "expected". Quick commerce booked the 18% GST on its delivery fee as platform
 * profit, when that money is owed to the government.
 *
 * Drives the real createInitialTransaction of both verticals against an
 * in-memory Mongo, on bills built by the real computeBill.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let failed = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const id = () => new mongoose.Types.ObjectId();

const main = async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'ledger_every_rupee' });

    const { computeBill } = await import('../src/modules/food/shared/billing.js');
    const { FoodRestaurantCommission } = await import('../src/modules/food/admin/models/restaurantCommission.model.js');
    const { FoodOffer } = await import('../src/modules/food/admin/models/offer.model.js');
    const food = await import('../src/modules/food/orders/services/foodTransaction.service.js');
    const qc = await import('../src/modules/quickCommerce/modules/food/orders/services/foodTransaction.service.js');

    const restaurantId = id();
    await FoodRestaurantCommission.create({ restaurantId, defaultCommission: { type: 'percentage', value: 12 }, status: true });
    await FoodOffer.updateOne({ couponCode: 'ADMIN50' }, { $set: { createdByRole: 'ADMIN', discountValue: 50 } }, { upsert: true });
    await FoodOffer.updateOne({ couponCode: 'RESTO50' }, { $set: { createdByRole: 'RESTAURANT', discountValue: 50 } }, { upsert: true });
    food.invalidateCommissionScheduleCache?.();

    // ------------------------------------------------------------------ food
    const foodOrder = async (label, {
        items, packaging = 0, packagingMode = 'RESTAURANT', delivery = 30, riderPay = delivery,
        platformFee = 10, surge = 0, tip = 0, discount = 0, couponCode = null, inclusive = false,
    }) => {
        const bill = computeBill({
            itemAmount: items, packagingFee: packaging, deliveryFee: delivery, platformFee,
            surgeAmount: surge, discount, tip, gstRate: 5, platformFeeGstRate: 18,
            pricesIncludeGst: inclusive, gstInclusiveItemAmount: inclusive ? items : 0,
            packagingBelongsToRestaurant: packagingMode === 'RESTAURANT',
        });
        const riderBeforeTip = r2(riderPay + surge);
        const order = {
            _id: id(), userId: id(), restaurantId,
            payment: { method: 'cash', status: 'cod_pending', amountDue: bill.grandTotal },
            riderTotalPayout: riderBeforeTip,
            riderEarning: riderBeforeTip,
            pricing: {
                subtotal: bill.itemAmount, packagingFee: bill.packagingFee, packagingMode,
                netPackagingFee: bill.netPackagingFee, commissionableAmount: bill.commissionBase,
                deliveryFee: bill.deliveryFee, platformFee: bill.platformFee, surgeAmount: bill.surgeAmount,
                tip: bill.tip, discount: bill.discount, couponCode, tax: bill.gstOnItems,
                total: bill.grandTotal, roundOff: bill.roundOff, restaurantCommission: 0, bill,
            },
        };
        const t = await food.createInitialTransaction(order);
        const a = t.amounts;
        const government = r2(bill.gstOnItems + bill.platformFeeGst);
        const accounted = r2(a.restaurantShare + a.riderTotalPayout + a.platformNetProfit + government);
        check(`${label}: Rs ${bill.grandTotal} paid, every rupee credited (round-off ${bill.roundOff >= 0 ? '+' : ''}${bill.roundOff})`, () => {
            assert.ok(Math.abs(accounted - bill.grandTotal) < 0.011,
                `restaurant ${a.restaurantShare} + rider ${a.riderTotalPayout} + platform ${a.platformNetProfit} + govt ${government} = ${accounted}, customer paid ${bill.grandTotal}`);
        });
        return { bill, a };
    };

    console.log('\nfood');
    // The production order: Rs 320 exclusive, free delivery with the rider paid 29.
    const prod = await foodOrder('FOD-0243696 as placed', { items: 320, delivery: 0, riderPay: 29 });
    check('  the platform is credited the 20-paise round-off', () => {
        // 38.40 commission + 10 platform fee + 0.20 round-off - 29 rider = 19.60
        assert.equal(prod.a.platformNetProfit, 19.6);
    });
    await foodOrder('exclusive, rounds up', { items: 197 });
    await foodOrder('inclusive', { items: 200, inclusive: true });
    await foodOrder('inclusive, rounds down', { items: 89, delivery: 0, riderPay: 29, inclusive: true });
    await foodOrder('with a tip', { items: 200, tip: 40 });
    await foodOrder('with surge', { items: 200, surge: 25 });
    await foodOrder('restaurant packaging', { items: 200, packaging: 15, packagingMode: 'RESTAURANT' });
    await foodOrder('platform packaging', { items: 200, packaging: 15, packagingMode: 'ADMIN' });
    await foodOrder('inclusive + restaurant packaging', { items: 200, packaging: 15, inclusive: true });
    await foodOrder('admin-funded coupon', { items: 300, discount: 50, couponCode: 'ADMIN50' });
    await foodOrder('restaurant-funded coupon', { items: 300, discount: 50, couponCode: 'RESTO50' });
    await foodOrder('inclusive + coupon + tip + surge', { items: 450, discount: 50, couponCode: 'ADMIN50', tip: 20, surge: 10, inclusive: true });
    const loss = await foodOrder('free delivery the platform pays for', { items: 60, delivery: 0, riderPay: 49 });
    check('  a loss is recorded as a loss, not floored at zero', () => {
        assert.ok(loss.a.platformNetProfit < 0, `platform ${loss.a.platformNetProfit}`);
    });

    // --------------------------------------------------------- quick commerce
    console.log('\nquick commerce');
    const qcOrder = {
        _id: id(), userId: id(), restaurantId: id(),
        payment: { method: 'cash', status: 'cod_pending', amountDue: 250.4 },
        riderEarning: 30,
        pricing: { subtotal: 200, tax: 10, packagingFee: 0, deliveryFee: 30, deliveryFeeGst: 5.4, platformFee: 5, discount: 0, total: 250.4 },
    };
    const qt = await qc.createInitialTransaction(qcOrder);
    check('delivery-fee GST is booked as tax, not platform profit', () => {
        assert.equal(qt.amounts.taxAmount, 15.4, `tax ${qt.amounts.taxAmount}`);
        assert.equal(qt.amounts.platformNetProfit, 5, `platform ${qt.amounts.platformNetProfit}`);
    });
    check('Rs 250.40 paid, every rupee credited', () => {
        const accounted = r2(qt.amounts.restaurantShare + qt.amounts.riderShare + qt.amounts.platformNetProfit + qt.amounts.taxAmount);
        assert.equal(accounted, 250.4, `accounted ${accounted}`);
    });

    await mongoose.disconnect();
    await mongo.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
