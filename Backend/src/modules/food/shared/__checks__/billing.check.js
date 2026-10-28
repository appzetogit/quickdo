/**
 * Checks for the customer bill.
 *
 * The bill is the one screen where an arithmetic slip is visible to every
 * customer on every order, so the property these checks care about most is not
 * any single figure but reconciliation: whatever the inputs, the lines printed
 * add up to the total charged. Everything else -- what is taxed, at what rate,
 * who keeps it -- is asserted line by line underneath.
 *
 * Run: node Backend/src/modules/food/shared/__checks__/billing.check.js
 */
import assert from 'node:assert/strict';
import { computeBill, billAddsUp, normalizeTip, MAX_TIP, DEFAULT_PLATFORM_FEE_GST_RATE } from '../billing.js';

const round = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

// --- the agreed bill, line for line -----------------------------------------
{
    const b = computeBill({
        itemAmount: 200, deliveryFee: 25, platformFee: 10, tip: 10,
        gstRate: 5, platformFeeGstRate: 18,
    });
    assert.equal(b.itemAmount, 200);
    assert.equal(b.netItemAmount, 200);
    assert.equal(b.gstOnItems, 10, 'GST 5% on the food');
    assert.equal(b.deliveryFee, 25, 'the rider is not taxed');
    assert.equal(b.platformFee, 10);
    assert.equal(b.platformFeeGst, 1.8, 'govt fee 18% on the platform fee');
    assert.equal(b.tip, 10);
    assert.equal(b.totalBeforeTip, 246.8);
    assert.equal(b.payableBeforeRounding, 256.8);
    assert.equal(b.roundOff, 0.2);
    assert.equal(b.grandTotal, 257);
    assert.ok(billAddsUp(b));
}

// --- the same bill with every line in play ----------------------------------
{
    const b = computeBill({
        itemAmount: 200, packagingFee: 15, deliveryFee: 25, surgeAmount: 10,
        platformFee: 10, tip: 10, gstRate: 5, platformFeeGstRate: 18,
    });
    assert.equal(b.netItemAmount, 200, 'the food stands on its own line');
    assert.equal(b.netPackagingFee, 15, 'so does the packaging');
    assert.equal(b.gstOnItems, 10.75, 'food and packaging are one supply: 5% of 215');
    assert.equal(b.surgeAmount, 10, 'surge is its own line');
    assert.equal(b.deliveryFee, 25);
    assert.equal(b.platformFeeGst, 1.8);
    assert.equal(b.totalBeforeTip, round(200 + 15 + 10.75 + 25 + 10 + 10 + 1.8));
    assert.ok(billAddsUp(b));
}

// --- the lines always add up to the total -----------------------------------
// The property that matters: whatever the inputs, the printed figures reconcile.
for (const item of [0, 1, 99.99, 200, 357, 1234.56]) {
    for (const gst of [0, 5, 5.6, 18]) {
        for (const tip of [0, 10, 37.5]) {
            for (const delivery of [0, 25, 149]) {
                for (const packaging of [0, 7, 15.5]) {
                    for (const surge of [0, 10]) {
                        for (const inclusive of [false, true]) {
                            const b = computeBill({
                                itemAmount: item, packagingFee: packaging, surgeAmount: surge,
                                deliveryFee: delivery, platformFee: 10, tip,
                                gstRate: gst, platformFeeGstRate: 18,
                                pricesIncludeGst: inclusive,
                                packagingBelongsToRestaurant: inclusive,
                            });
                            assert.ok(billAddsUp(b),
                                `does not reconcile: item ${item} gst ${gst} tip ${tip} `
                                + `delivery ${delivery} packaging ${packaging} surge ${surge} inc ${inclusive}`);
                            assert.equal(b.grandTotal, Math.round(b.grandTotal), 'the grand total is a whole rupee');
                            assert.ok(Math.abs(b.roundOff) <= 0.5 + 1e-9, `round off out of range: ${b.roundOff}`);
                        }
                    }
                }
            }
        }
    }
}

// --- rounding is at the END, not per line -----------------------------------
{
    // 5.6% of 357 is 19.992. The old code rounded that to 20 immediately; the
    // bill now carries the paise and settles up once at the bottom.
    const b = computeBill({ itemAmount: 357, gstRate: 5.6, deliveryFee: 25, platformFee: 10 });
    assert.equal(b.gstOnItems, 19.99, 'the tax line keeps its paise');
    assert.ok(billAddsUp(b));
}

// --- what is and is not taxed ------------------------------------------------
{
    const b = computeBill({
        itemAmount: 100, deliveryFee: 50, surgeAmount: 30, tip: 20,
        platformFee: 0, gstRate: 10,
    });
    assert.equal(b.gstOnItems, 10, 'only the food and its packaging are taxed');
    assert.equal(b.platformFeeGst, 0, 'no platform fee, no fee tax');
    // Delivery 50, surge 30 and tip 20 contributed nothing to tax -- all three
    // are the rider's money.
    assert.equal(b.grandTotal, Math.round(100 + 10 + 50 + 30 + 20));
}
{
    // The two rates are genuinely different and applied to different things.
    const b = computeBill({ itemAmount: 100, platformFee: 100, gstRate: 5, platformFeeGstRate: 18 });
    assert.equal(b.gstOnItems, 5);
    assert.equal(b.platformFeeGst, 18);
}

// --- discount comes off before tax ------------------------------------------
{
    const b = computeBill({ itemAmount: 200, discount: 50, gstRate: 10, platformFee: 0 });
    assert.equal(b.netItemAmount, 150);
    assert.equal(b.gstOnItems, 15, 'tax follows the discounted food, not the list price');
}
// A coupon eats the food first, then the packaging, and never the rider's money.
{
    const b = computeBill({
        itemAmount: 100, packagingFee: 20, deliveryFee: 40, surgeAmount: 10,
        discount: 110, gstRate: 10, platformFee: 0,
    });
    assert.equal(b.discount, 110);
    assert.equal(b.netItemAmount, 0, 'the food is fully discounted');
    assert.equal(b.netPackagingFee, 10, 'the remaining 10 came off the packaging');
    assert.equal(b.deliveryFee, 40, 'the coupon never reaches the delivery fee');
    assert.equal(b.surgeAmount, 10, 'nor the surge');
    assert.ok(billAddsUp(b));
}
{
    const b = computeBill({ itemAmount: 100, discount: 500, gstRate: 5 });
    assert.equal(b.discount, 100);
    assert.equal(b.taxableAmount, 0);
    assert.equal(b.gstOnItems, 0);
    assert.ok(b.grandTotal >= 0, 'never negative');
}

// --- what commission is charged on -------------------------------------------
{
    // The listed food, before any coupon: the discount is settled separately in
    // the payout ledger, so taking it off here would deduct it twice.
    const b = computeBill({ itemAmount: 200, packagingFee: 50, discount: 40, gstRate: 5 });
    assert.equal(b.commissionBase, 200, 'not the discounted food');
    assert.notEqual(b.commissionBase, b.taxableAmount, 'and not the packaging either');
}
{
    // An inclusive restaurant is commissioned on what it actually earns.
    const b = computeBill({ itemAmount: 200, gstRate: 5, pricesIncludeGst: true });
    assert.equal(b.commissionBase, 190.48);
}

// --- tips --------------------------------------------------------------------
assert.equal(normalizeTip(0), 0);
assert.equal(normalizeTip(-5), 0, 'a negative tip is no tip');
assert.equal(normalizeTip('abc'), 0);
assert.equal(normalizeTip(null), 0);
assert.equal(normalizeTip(12.345), 12.35, 'rounded to paise');
assert.equal(normalizeTip(999999), MAX_TIP, 'capped, so a fat finger cannot bill a fortune');

// --- defaults and junk -------------------------------------------------------
assert.equal(DEFAULT_PLATFORM_FEE_GST_RATE, 18);
{
    const b = computeBill();
    assert.equal(b.grandTotal, 0);
    assert.ok(billAddsUp(b));
}
{
    // Nonsense in, zeroes out -- never NaN on a bill.
    const b = computeBill({
        itemAmount: 'x', packagingFee: [], deliveryFee: null, surgeAmount: NaN,
        platformFee: undefined, gstRate: 'y', tip: {},
    });
    for (const [k, v] of Object.entries(b)) {
        if (typeof v === 'boolean') continue;
        assert.ok(Number.isFinite(Number(v)), `${k} is not a number: ${v}`);
    }
}
// A rate above 100 is a typo, not a tax.
assert.equal(computeBill({ itemAmount: 100, gstRate: 5000 }).gstOnItems, 100);

// --- GST-inclusive menus -----------------------------------------------------
// The customer still pays the listed price; the tax comes out of it.
{
    const b = computeBill({
        itemAmount: 200, deliveryFee: 25, platformFee: 10, tip: 10,
        gstRate: 5, platformFeeGstRate: 18, pricesIncludeGst: true,
    });
    assert.equal(b.listedFoodAmount, 200, 'the menu price is unchanged');
    assert.equal(b.netItemAmount, 190.48, 'the restaurant earns the net');
    assert.equal(b.gstOnItems, 9.52, 'the tax was inside the 200');
    assert.equal(round(b.netItemAmount + b.gstOnItems), 200, 'net + tax is the listed price');
    assert.ok(billAddsUp(b));
}

// Extracting is NOT the same sum as adding. Taking 5% off the gross would give
// 10.00 and overstate the tax on every inclusive dish.
{
    const inc = computeBill({ itemAmount: 200, gstRate: 5, pricesIncludeGst: true, platformFee: 0 });
    const exc = computeBill({ itemAmount: 200, gstRate: 5, pricesIncludeGst: false, platformFee: 0 });
    assert.equal(inc.gstOnItems, 9.52);
    assert.equal(exc.gstOnItems, 10);
    assert.notEqual(inc.gstOnItems, exc.gstOnItems, 'extraction and addition must differ');
    // And the customer pays a different total for the same listed price.
    assert.equal(inc.grandTotal, 200);
    assert.equal(exc.grandTotal, 210);
}

// The default is exclusive, so nothing that predates the flag moves.
{
    const withFlag = computeBill({ itemAmount: 200, gstRate: 5, platformFee: 0, pricesIncludeGst: false });
    const without = computeBill({ itemAmount: 200, gstRate: 5, platformFee: 0 });
    assert.deepEqual(without, withFlag, 'omitting the flag behaves exactly as exclusive');
}

// The restaurant's own packaging charge follows its inclusive setting; a
// platform-wide one, which the admin typed, does not.
{
    const ours = computeBill({
        itemAmount: 200, packagingFee: 21, gstRate: 5,
        pricesIncludeGst: true, packagingBelongsToRestaurant: true, platformFee: 0,
    });
    assert.equal(ours.netPackagingFee, 20, 'the tax came out of the 21');
    assert.equal(ours.grandTotal, 221, 'the customer pays the listed 200 + 21');

    const theirs = computeBill({
        itemAmount: 200, packagingFee: 21, gstRate: 5,
        pricesIncludeGst: true, packagingBelongsToRestaurant: false, platformFee: 0,
    });
    assert.equal(theirs.netPackagingFee, 21, 'the admin figure is net');
    assert.equal(theirs.gstOnItems, round(9.52 + 1.05), 'extracted from the food, added to the packaging');
    assert.ok(billAddsUp(theirs), 'a bill that mixes the two still reconciles');
}

// A coupon comes off before the tax is extracted, so the customer is not taxed
// on money nobody paid.
{
    const b = computeBill({ itemAmount: 200, discount: 100, gstRate: 5, pricesIncludeGst: true, platformFee: 0 });
    assert.equal(b.listedFoodAmount, 100);
    assert.equal(round(b.netItemAmount + b.gstOnItems), 100);
    assert.equal(b.grandTotal, 100);
}

// Zero rate: inclusive and exclusive are the same thing.
{
    const inc = computeBill({ itemAmount: 200, gstRate: 0, pricesIncludeGst: true, platformFee: 0 });
    assert.equal(inc.gstOnItems, 0);
    assert.equal(inc.netItemAmount, 200);
}

// The food half always sums back to what was listed, within a paisa of rounding.
for (const item of [1, 99.99, 200, 357, 1234.56]) {
    for (const gst of [0, 5, 5.6, 12, 18]) {
        for (const packaging of [0, 15]) {
            const b = computeBill({
                itemAmount: item, packagingFee: packaging, deliveryFee: 25, platformFee: 10,
                gstRate: gst, platformFeeGstRate: 18,
                pricesIncludeGst: true, packagingBelongsToRestaurant: true,
            });
            const food = round(b.taxableAmount + b.gstOnItems);
            assert.ok(Math.abs(food - b.listedFoodAmount) < 0.02,
                `net + tax ${food} should be the listed ${b.listedFoodAmount}`);
        }
    }
}

// --- a summary that shows the coupon as its own line still lands on the total ---
// item (before coupon) - coupon + packaging + tax + fees + tip + round off.
for (const inclusive of [false, true]) {
    for (const discount of [0, 25, 60, 210]) {
        for (const packaging of [0, 21]) {
            const b = computeBill({
                itemAmount: 200, packagingFee: packaging, discount,
                deliveryFee: 25, surgeAmount: 10, platformFee: 10, tip: 10,
                gstRate: 5, platformFeeGstRate: 18,
                pricesIncludeGst: inclusive, packagingBelongsToRestaurant: inclusive,
            });
            const shown = round(
                b.netItemAmountBeforeDiscount
                + b.netPackagingFeeBeforeDiscount
                - b.discountOnNet
                + b.gstOnItems + b.deliveryFee + b.surgeAmount
                + b.platformFee + b.platformFeeGst + b.tip + b.roundOff,
            );
            assert.ok(Math.abs(shown - b.grandTotal) < 0.005,
                `coupon-line summary ${shown} should be ${b.grandTotal} `
                + `(inc ${inclusive} discount ${discount} packaging ${packaging})`);
        }
    }
}
// Printing the raw `discount` beside the discounted line would be the double
// count this exists to prevent.
{
    const b = computeBill({ itemAmount: 200, discount: 50, gstRate: 5, platformFee: 0 });
    assert.equal(b.netItemAmountBeforeDiscount, 200);
    assert.equal(b.discountOnNet, 50, 'exclusive: what the coupon took is what it was worth');
}
{
    // Inclusive: the coupon came off a price that still had tax in it, so less
    // than the full 100 reached the net line.
    const b = computeBill({ itemAmount: 200, discount: 100, gstRate: 5, pricesIncludeGst: true, platformFee: 0 });
    assert.equal(b.discountOnNet, 95.24);
    assert.notEqual(b.discountOnNet, b.discount);
}

// --- the summary, at the rate production actually charges ------------------
// The app prints netItemAmountBeforeDiscount, netPackagingFeeBeforeDiscount and
// gstOnItems as three rows. At 5.6% those rows must come to the menu price for
// an inclusive menu, and to the menu price plus tax for an exclusive one. These
// are the exact figures on the screen, so they are pinned here rather than
// described.
{
    const exc = computeBill({ itemAmount: 200, gstRate: 5.6, platformFee: 0 });
    assert.equal(exc.netItemAmountBeforeDiscount, 200);
    assert.equal(exc.gstOnItems, 11.2, '5.6% of 200 added on top');
    assert.equal(round(exc.netItemAmountBeforeDiscount + exc.gstOnItems), 211.2);

    const inc = computeBill({ itemAmount: 200, gstRate: 5.6, platformFee: 0, pricesIncludeGst: true });
    assert.equal(inc.netItemAmountBeforeDiscount, 189.39, 'the 5.6% inside 200 leaves 189.39');
    assert.equal(inc.gstOnItems, 10.61);
    assert.equal(round(inc.netItemAmountBeforeDiscount + inc.gstOnItems), 200,
        'the inclusive rows come back to the menu price exactly');

    // 5.6% of 200 is 11.20; the 5.6% inside 200 is 10.61. Using the first for an
    // inclusive menu would overstate the tax by 59 paise on this dish alone.
    assert.notEqual(inc.gstOnItems, exc.gstOnItems);
}
{
    // The same with the restaurant's own packaging charge in play.
    const exc = computeBill({ itemAmount: 200, packagingFee: 20, gstRate: 5.6, platformFee: 0 });
    assert.equal(exc.netPackagingFeeBeforeDiscount, 20);
    assert.equal(exc.gstOnItems, 12.32, '5.6% of 220');
    assert.equal(round(200 + 20 + exc.gstOnItems), 232.32);

    const inc = computeBill({
        itemAmount: 200, packagingFee: 20, gstRate: 5.6, platformFee: 0,
        pricesIncludeGst: true, packagingBelongsToRestaurant: true,
    });
    assert.equal(inc.netItemAmountBeforeDiscount, 189.39);
    assert.equal(inc.netPackagingFeeBeforeDiscount, 18.94);
    assert.equal(inc.gstOnItems, 11.67);
    assert.equal(
        round(inc.netItemAmountBeforeDiscount + inc.netPackagingFeeBeforeDiscount + inc.gstOnItems),
        220,
        'both listed prices, back to the paisa',
    );
}

// --- one cart, two tax treatments -------------------------------------------
// The answer is per dish, so a cart can hold both. The tax is extracted from
// the half that already contained it and added to the half that did not.
{
    // A Rs 200 inclusive dish and a Rs 200 exclusive one, at the live rate.
    const b = computeBill({
        itemAmount: 400, gstInclusiveItemAmount: 200,
        gstRate: 5.6, platformFee: 0,
    });
    assert.equal(b.gstInclusiveItemAmount, 200);
    assert.equal(b.pricesIncludeGst, false, 'not the whole cart, so the wording flag is off');
    // 200 inclusive -> 189.39 net; 200 exclusive stays 200.
    assert.equal(b.netItemAmountBeforeDiscount, round(189.39 + 200));
    // 10.61 out of the first, 11.20 onto the second.
    assert.equal(b.gstOnItems, round(10.61 + 11.2));
    // The customer pays the inclusive dish's listed price and the exclusive
    // dish's price plus tax.
    assert.equal(b.grandTotal, Math.round(200 + 211.2));
    assert.ok(billAddsUp(b));
}
{
    // All of it inclusive, expressed the per-dish way, must equal the shorthand.
    const perDish = computeBill({ itemAmount: 200, gstInclusiveItemAmount: 200, gstRate: 5.6, platformFee: 0 });
    const whole = computeBill({ itemAmount: 200, pricesIncludeGst: true, gstRate: 5.6, platformFee: 0 });
    assert.deepEqual(perDish, whole, 'every dish inclusive is the same bill as an inclusive menu');
}
{
    // None of it inclusive must equal plain exclusive.
    const perDish = computeBill({ itemAmount: 200, gstInclusiveItemAmount: 0, gstRate: 5.6, platformFee: 0 });
    const whole = computeBill({ itemAmount: 200, gstRate: 5.6, platformFee: 0 });
    assert.deepEqual(perDish, whole);
}
{
    // A coupon on a mixed cart is shared in proportion, so the tax does not
    // swing on which half an arbitrary rule decided to discount.
    const b = computeBill({
        itemAmount: 400, gstInclusiveItemAmount: 200, discount: 100,
        gstRate: 5.6, platformFee: 0,
    });
    assert.equal(b.discount, 100);
    // 50 off each half. Inclusive 150 -> 142.05 net, tax 7.95.
    // Exclusive 150 stays 150, tax 8.40.
    assert.equal(b.netItemAmount, round(142.05 + 150));
    assert.equal(b.gstOnItems, round(7.95 + 8.4));
    assert.equal(b.grandTotal, Math.round(150 + 158.4));
    assert.ok(billAddsUp(b));
    // And the printable pair still reconciles.
    const shown = round(b.netItemAmountBeforeDiscount - b.discountOnNet + b.gstOnItems);
    assert.equal(shown, b.grandTotal - b.roundOff);
}
// A cart that mixes the two still reconciles, whatever the proportions.
for (const inclusive of [0, 1, 37.5, 200, 399.99, 400]) {
    for (const gst of [0, 5, 5.6, 18]) {
        for (const discount of [0, 40, 400, 900]) {
            const b = computeBill({
                itemAmount: 400, gstInclusiveItemAmount: inclusive, discount,
                packagingFee: 21, deliveryFee: 25, surgeAmount: 10,
                platformFee: 10, tip: 10, gstRate: gst, platformFeeGstRate: 18,
            });
            assert.ok(billAddsUp(b),
                `mixed cart does not reconcile: inclusive ${inclusive} gst ${gst} discount ${discount}`);
            assert.ok(b.netItemAmount >= 0 && b.gstOnItems >= 0, 'no negative lines');
        }
    }
}
// More inclusive than there is food is a caller error, not a credit.
{
    const b = computeBill({ itemAmount: 100, gstInclusiveItemAmount: 5000, gstRate: 5, platformFee: 0 });
    assert.equal(b.gstInclusiveItemAmount, 100);
    assert.ok(billAddsUp(b));
}

console.log('All billing checks passed.');
