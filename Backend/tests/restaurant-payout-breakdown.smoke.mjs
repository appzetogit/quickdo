/**
 * What the restaurant app shows the restaurant it earned, against what the
 * payout ledger actually credits it.
 *
 * Run: node tests/restaurant-payout-breakdown.smoke.mjs
 *
 * The restaurant's order screen showed the CUSTOMER's bill -- delivery fee,
 * platform fee, grand total -- none of which the restaurant is paid. It now
 * shows its own: food, the GST inside or on top of it, packaging, commission,
 * and the payout. Every figure has to agree with foodTransaction.service.js,
 * which is what actually pays; a payout screen that disagrees with the payout
 * is worse than no screen.
 *
 * The bill is built by the real computeBill and mapped exactly as
 * order-pricing.service.js maps it onto the order.
 */
import assert from 'node:assert/strict';
import { computeBill } from '../src/modules/food/shared/billing.js';
import { buildRestaurantPayoutBreakdown } from '../src/modules/food/shared/restaurantPayout.js';

let failures = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  ok   ${label}`);
    } catch (err) {
        failures += 1;
        console.log(`  FAIL ${label}\n       ${err.message}`);
    }
};
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** An order as the pricing service stores it, from a real bill. */
const orderFrom = ({ commissionPercent = 10, packagingMode = 'RESTAURANT', ...billInput }) => {
    const bill = computeBill({ deliveryFee: 25, platformFee: 10, ...billInput });
    const restaurantCommission = round2(bill.commissionBase * (commissionPercent / 100));
    return {
        _id: 'order-1',
        pricing: {
            subtotal: bill.itemAmount,
            packagingFee: bill.packagingFee,
            tax: bill.gstOnItems,
            deliveryFee: bill.deliveryFee,
            platformFee: bill.platformFee,
            discount: bill.discount,
            total: bill.grandTotal,
            bill,
            commissionableAmount: bill.commissionBase,
            pricesIncludeGst: bill.pricesIncludeGst,
            packagingMode,
            netItemAmount: bill.netItemAmount,
            netPackagingFee: bill.netPackagingFee,
            gstRate: bill.gstRate,
            restaurantCommission,
        },
    };
};

/**
 * The ledger's own sum, transcribed from foodTransaction.service.js:
 *   food net of GST + the restaurant's packaging - commission - what a
 *   coupon it funded took off.
 */
const ledgerPayout = (order, fundedDiscount = 0) => {
    const p = order.pricing;
    const food = Number(p.commissionableAmount ?? p.subtotal) || 0;
    const mode = String(p.packagingMode || '');
    const packaging = mode === '' || mode === 'RESTAURANT'
        ? Number(p.netPackagingFee ?? p.packagingFee) || 0
        : 0;
    return round2(food + packaging - (Number(p.restaurantCommission) || 0) - fundedDiscount);
};

console.log('\nRs 100 of food, prices EXCLUDE GST, 5% GST, Rs 5 packing, 10% commission');
{
    const order = orderFrom({ itemAmount: 100, packagingFee: 5, gstRate: 5, pricesIncludeGst: false });
    const b = buildRestaurantPayoutBreakdown(order);
    check('sub total is the Rs 100 listed', () => assert.equal(b.subTotal, 100));
    check('GST is Rs 5, added on top and collected from the customer', () => assert.equal(b.gstOnFood, 5));
    check('the whole Rs 100 is the taxable food value', () => assert.equal(b.taxableFoodValue, 100));
    check('packing Rs 5 is the restaurant\'s', () => assert.equal(b.packagingCharge, 5));
    check('commission is Rs 10, charged on the food only', () => assert.equal(b.commissionAmount, 10));
    check('shown as 10%', () => assert.equal(b.commissionPercent, 10));
    check('PAY TO YOU is Rs 95', () => assert.equal(b.payout, 95));
    check('  and that is exactly what the ledger credits', () => assert.equal(b.payout, ledgerPayout(order)));
}

console.log('\nthe percentage beside the tax is read off the tax, not a stored rate');
{
    /*
     * On an INCLUSIVE menu the tax is the gap between the listed price and the
     * taxable value, and the rate stored on the order takes no part in working
     * it out. So the two can drift: a rate edited in fee settings after the
     * order, a legacy order carrying somebody else's figure, and the line
     * prints a percentage that its own rupees contradict.
     *
     * A restaurant reading "GST 13%" against Rs 8.63 on Rs 172.50 has been told
     * two different things, and only one of them is what was charged. The
     * percentage is therefore computed from the money, like commissionPercent
     * already was.
     */
    const order = orderFrom({ itemAmount: 210, gstRate: 5, pricesIncludeGst: true });
    const honest = buildRestaurantPayoutBreakdown(order);
    check('an inclusive order prints the rate its own figures imply', () =>
        assert.equal(honest.gstRate, 5));

    // The same order, with a stale rate left on it.
    order.pricing.gstRate = 13;
    const stale = buildRestaurantPayoutBreakdown(order);
    check('THE BUG: a stale stored rate cannot change the printed one', () =>
        assert.equal(stale.gstRate, 5));
    check('  because the tax it is charged on has not moved', () =>
        assert.equal(stale.gstOnFood, honest.gstOnFood));
    check('  and the percentage still reconciles by hand', () =>
        assert.equal(
            Math.round(stale.taxableFoodValue * (stale.gstRate / 100) * 100) / 100,
            stale.gstOnFood,
        ));
}

{
    // Exclusive is the other direction and was never at risk: the tax is
    // computed FROM the stored rate, so the two move together. Pinned so the
    // ordinary case is not broken while protecting the other one.
    const order = orderFrom({ itemAmount: 172.5, packagingFee: 5, gstRate: 5, commissionPercent: 13 });
    const b = buildRestaurantPayoutBreakdown(order);
    check('an exclusive order prints its own rate', () => assert.equal(b.gstRate, 5));
    check('  which is not the commission rate beside it', () => {
        assert.equal(b.commissionPercent, 13);
        assert.notEqual(b.gstRate, b.commissionPercent);
    });
    check('  Rs 8.63 of tax on Rs 172.50', () => assert.equal(b.gstOnFood, 8.63));
    check('  PAY TO YOU is Rs 155.07', () => assert.equal(b.payout, 155.07));
}

{
    // No tax, no percentage: a "GST 0%" line is noise on a bill with no tax.
    const order = orderFrom({ itemAmount: 100, gstRate: 0 });
    const b = buildRestaurantPayoutBreakdown(order);
    check('no tax means no rate to show', () => {
        assert.equal(b.gstOnFood, 0);
        assert.equal(b.gstRate, 0);
    });
}

console.log('\nthe same Rs 100, prices INCLUDE GST');
{
    const order = orderFrom({ itemAmount: 100, packagingFee: 5, gstRate: 5, pricesIncludeGst: true });
    const b = buildRestaurantPayoutBreakdown(order);
    check('sub total is still the Rs 100 the customer was charged', () => assert.equal(b.subTotal, 100));
    check('the GST inside it is Rs 4.76, not Rs 5 (100 - 100/1.05, not 5% of 100)', () =>
        assert.equal(b.gstOnFood, 4.76));
    check('taxable food value is Rs 95.24', () => assert.equal(b.taxableFoodValue, 95.24));
    check('commission is 10% of that, Rs 9.52 -- never a cut of the tax', () =>
        assert.equal(b.commissionAmount, 9.52));
    // The Rs 5 packaging has its GST inside it on an inclusive menu (4.76 net).
    check('PAY TO YOU is Rs 90.48', () => assert.equal(b.payout, 90.48));
    check('  and that is exactly what the ledger credits', () => assert.equal(b.payout, ledgerPayout(order)));
    check('the customer paid the same Rs 100 either way', () =>
        assert.equal(order.pricing.subtotal, 100));
}

console.log('\npacking the platform sets and keeps');
{
    const order = orderFrom({ itemAmount: 100, packagingFee: 5, gstRate: 5, packagingMode: 'ADMIN' });
    const b = buildRestaurantPayoutBreakdown(order);
    check('THE BUG IT PREVENTS: it is not promised to the restaurant', () => {
        assert.equal(b.packagingCharge, 0);
        assert.equal(b.packagingIsRestaurants, false);
    });
    check('payout is food less commission, Rs 90', () => assert.equal(b.payout, 90));
    check('  matching the ledger', () => assert.equal(b.payout, ledgerPayout(order)));
}

console.log('\na coupon');
{
    const order = orderFrom({ itemAmount: 100, packagingFee: 5, gstRate: 5, discount: 20 });
    const platformFunded = buildRestaurantPayoutBreakdown(order);
    check('the platform\'s coupon costs the restaurant nothing', () => {
        assert.equal(platformFunded.discountFundedByRestaurant, 0);
        assert.equal(platformFunded.payout, 95);
        assert.equal(platformFunded.payout, ledgerPayout(order));
    });
    const funded = order.pricing.bill.discountOnNet;
    const restaurantFunded = buildRestaurantPayoutBreakdown(order, { restaurantFundedDiscount: funded });
    check('its own coupon comes off its payout, at what it took off the net lines', () => {
        assert.equal(restaurantFunded.discountFundedByRestaurant, round2(funded));
        assert.equal(restaurantFunded.payout, ledgerPayout(order, funded));
        assert.ok(restaurantFunded.payout < platformFunded.payout);
    });
}

console.log('\nan order from before any of these fields were stored');
{
    const legacy = { _id: 'legacy', pricing: { subtotal: 200, packagingFee: 10, restaurantCommission: 20 } };
    const b = buildRestaurantPayoutBreakdown(legacy);
    check('falls back to the listed food, as the ledger does', () => {
        assert.equal(b.taxableFoodValue, 200);
        assert.equal(b.packagingCharge, 10);
        assert.equal(b.payout, 190);
        assert.equal(b.payout, ledgerPayout(legacy));
    });
    check('and claims no GST it cannot prove', () => assert.equal(b.gstOnFood, 0));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
