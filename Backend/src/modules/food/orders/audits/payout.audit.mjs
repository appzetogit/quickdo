// Payout ledger audit: every rupee the customer pays must land somewhere --// the restaurant, the rider, the platform, or the government.//// Runs the REAL createInitialTransaction against a throwaway in-memory Mongo// and reconciles the ledger it writes against what was charged.//// Run:  node src/modules/food/orders/audits/payout.audit.mjs   (non-zero on failure)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { computeBill } from '../../shared/billing.js';

// Runs against its own throwaway database, so it needs nothing set up and
// touches no real data.
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..'));
dotenv.config();
const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri('quickdrop_payout_audit'));

const { FoodRestaurantCommission } = await import('../../admin/models/restaurantCommission.model.js');
const { FoodOffer } = await import('../../admin/models/offer.model.js');
const { FoodTransaction } = await import('../models/foodTransaction.model.js');
const txn = await import('../services/foodTransaction.service.js');

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

const rows = [];

const restaurantId = new mongoose.Types.ObjectId();
await FoodRestaurantCommission.create({
    restaurantId, defaultCommission: { type: 'percentage', value: 20 }, status: true,
});
await FoodOffer.updateOne({ couponCode: 'ADMIN100' }, { $set: { createdByRole: 'ADMIN', discountValue: 100 } }, { upsert: true });
await FoodOffer.updateOne({ couponCode: 'RESTO100' }, { $set: { createdByRole: 'RESTAURANT', discountValue: 100 } }, { upsert: true });
txn.invalidateCommissionScheduleCache?.();

let n = 0;
async function run(label, { items, packaging = 0, packagingMode = 'RESTAURANT', delivery = 10,
    platformFee = 10, surge = 0, tip = 0, discount = 0, couponCode = null,
    gstRate = 5, inclusive = false } = {}) {
    n += 1;
    const bill = computeBill({
        itemAmount: items, packagingFee: packaging, deliveryFee: delivery, platformFee,
        surgeAmount: surge, discount, tip, gstRate, platformFeeGstRate: 18,
        pricesIncludeGst: inclusive,
        gstInclusiveItemAmount: inclusive ? items : 0,
        packagingBelongsToRestaurant: packagingMode === 'RESTAURANT',
    });

    // The rider is paid the delivery fee and surge (no admin delivery commission here).
    const riderBeforeTip = r2(delivery + surge);

    const order = {
        _id: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        restaurantId,
        payment: { method: 'cash', status: 'cod_pending', amountDue: bill.grandTotal },
        riderTotalPayout: riderBeforeTip,
        riderEarning: riderBeforeTip,
        pricing: {
            subtotal: bill.itemAmount,
            packagingFee: bill.packagingFee,
            packagingMode,
            netPackagingFee: bill.netPackagingFee,
            commissionableAmount: bill.commissionBase,
            deliveryFee: bill.deliveryFee,
            platformFee: bill.platformFee,
            surgeAmount: bill.surgeAmount,
            tip: bill.tip,
            discount: bill.discount,
            couponCode,
            tax: bill.gstOnItems,
            total: bill.grandTotal,
            restaurantCommission: 0, // let the service resolve it from the rule
            bill,
        },
    };

    await txn.createInitialTransaction(order);
    const t = await FoodTransaction.findOne({ orderId: order._id }).lean();

    const restaurantShare = Number(t?.amounts?.restaurantShare ?? 0);
    const riderShare = Number(t?.amounts?.riderTotalPayout ?? 0);
    const platformProfit = Number(t?.amounts?.platformNetProfit ?? 0);
    const govTax = r2(bill.gstOnItems + bill.platformFeeGst);

    // Every rupee the customer paid must be accounted for.
    const accounted = r2(restaurantShare + riderShare + platformProfit + govTax);
    const gap = r2(bill.grandTotal - accounted);

    rows.push({
        label,
        paid: bill.grandTotal,
        restaurant: r2(restaurantShare),
        rider: r2(riderShare),
        platform: r2(platformProfit),
        tax: govTax,
        accounted,
        gap,
        ok: near(gap, 0, 0.51), // half a rupee of round-off is expected
    });
}

// ── ordinary orders ──────────────────────────────────────────────────────────
await run('plain exclusive order',            { items: 200 });
await run('plain inclusive order',            { items: 200, inclusive: true });
await run('with tip',                         { items: 200, tip: 40 });
await run('with surge',                       { items: 200, surge: 25 });
await run('restaurant packaging',             { items: 200, packaging: 30, packagingMode: 'RESTAURANT' });
await run('platform packaging',               { items: 200, packaging: 30, packagingMode: 'ADMIN' });
await run('inclusive + restaurant packaging', { items: 200, packaging: 30, inclusive: true });
await run('large order',                      { items: 2400, delivery: 60, platformFee: 25, surge: 30, tip: 50 });

// ── coupons ──────────────────────────────────────────────────────────────────
await run('small admin coupon',        { items: 500, discount: 50,  couponCode: 'ADMIN100' });
await run('small restaurant coupon',   { items: 500, discount: 50,  couponCode: 'RESTO100' });
await run('big admin coupon',          { items: 200, discount: 150, couponCode: 'ADMIN100' });
await run('big restaurant coupon',     { items: 200, discount: 150, couponCode: 'RESTO100' });
await run('admin coupon = whole food', { items: 200, discount: 200, couponCode: 'ADMIN100' });
await run('resto coupon = whole food', { items: 200, discount: 200, couponCode: 'RESTO100' });
await run('admin coupon at break-even',{ items: 200, discount: 50,  couponCode: 'ADMIN100' });
await run('admin coupon just over',    { items: 200, discount: 60,  couponCode: 'ADMIN100' });

// ── report ───────────────────────────────────────────────────────────────────
const w = (s, n) => String(s).padEnd(n);
const p = (s, n) => String(s).padStart(n);
console.log(`${w('SCENARIO', 30)}${p('PAID', 9)}${p('RESTO', 9)}${p('RIDER', 8)}${p('PLATFORM', 10)}${p('TAX', 8)}${p('GAP', 9)}`);
console.log('─'.repeat(83));
for (const r of rows) {
    console.log(`${w(r.label, 30)}${p(r.paid, 9)}${p(r.restaurant, 9)}${p(r.rider, 8)}${p(r.platform, 10)}${p(r.tax, 8)}${p(r.gap, 9)}${r.ok ? '' : '  <-- UNACCOUNTED'}`);
}
const bad = rows.filter((r) => !r.ok);
console.log('─'.repeat(83));
console.log(bad.length
    ? `${bad.length} of ${rows.length} orders do not reconcile`
    : `all ${rows.length} orders reconcile`);

await mongoose.disconnect();
await mongod.stop();
process.exit(bad.length ? 1 : 0);
