/**
 * Buy-one-get-one.
 *
 * The cases that matter are the ones where a wrong answer gives away food that
 * was not earned: an odd quantity rounding up, a per-order cap applied afresh to
 * every variant of the same dish, an expired row still running, and add-ons or
 * packaging being waived along with the item price.
 *
 * Run: node src/modules/food/shared/__checks__/bogoOffer.check.js
 */
import assert from 'node:assert';
import {
    normalizeBogoOffersInput,
    isBogoOfferLive,
    computeFreeUnits,
    splitBogoLine,
    describeBogoSaving,
    describeNextBogoUnits,
    describeBogoOffer,
    MAX_BOGO_OFFERS,
    DEFAULT_BUY_QTY,
    DEFAULT_GET_QTY,
} from '../bogoOffer.js';

let failures = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    } catch (error) {
        failures += 1;
        console.log(`  FAIL  ${label} -- ${error.message}`);
    }
};

const ITEM_A = '6a8e71ac4339a70e13961f16';
const ITEM_B = '6a8e71ac4339a70e13961f17';

const b1g1 = { buyQty: 1, getQty: 1 };

const line = (over = {}) => ({
    itemId: ITEM_A,
    name: 'Margherita',
    price: 200,
    quantity: 2,
    variantName: 'Large',
    addons: [{ addonId: 'a1', name: 'Extra cheese', price: 30 }],
    addonsTotal: 30,
    foodPackagingCharge: 10,
    ...over,
});

// ---- how many units are free ----------------------------------------------
check('one unit earns nothing', () => {
    assert.equal(computeFreeUnits(1, b1g1), 0);
});

check('two units earn one free', () => {
    assert.equal(computeFreeUnits(2, b1g1), 1);
});

check('three units earn one free, not one and a half', () => {
    // A complete pair plus a spare. The spare is paid for.
    assert.equal(computeFreeUnits(3, b1g1), 1);
});

check('four units earn two free', () => {
    assert.equal(computeFreeUnits(4, b1g1), 2);
});

check('buy 2 get 1 needs three units before anything is free', () => {
    const b2g1 = { buyQty: 2, getQty: 1 };
    assert.equal(computeFreeUnits(2, b2g1), 0);
    assert.equal(computeFreeUnits(3, b2g1), 1);
    assert.equal(computeFreeUnits(5, b2g1), 1);
    assert.equal(computeFreeUnits(6, b2g1), 2);
});

check('an absent ratio falls back to the classic offer', () => {
    assert.equal(DEFAULT_BUY_QTY, 1);
    assert.equal(DEFAULT_GET_QTY, 1);
    assert.equal(computeFreeUnits(2, {}), 1);
});

check('a malformed ratio gives nothing away', () => {
    // Not "everything away": a bad config should cost the restaurant nothing.
    assert.equal(computeFreeUnits(10, { buyQty: 0, getQty: 1 }), 0);
    assert.equal(computeFreeUnits(10, { buyQty: 1, getQty: -1 }), 0);
    assert.equal(computeFreeUnits(10, { buyQty: 1.5, getQty: 1 }), 0);
});

check('a non-numeric quantity gives nothing away', () => {
    assert.equal(computeFreeUnits('abc', b1g1), 0);
    assert.equal(computeFreeUnits(null, b1g1), 0);
});

// ---- the per-order cap -----------------------------------------------------
check('the cap limits free units', () => {
    assert.equal(computeFreeUnits(10, b1g1, 2), 2);
});

check('an exhausted allowance gives nothing', () => {
    // This is the second line of the same dish, after the first consumed the cap.
    assert.equal(computeFreeUnits(10, b1g1, 0), 0);
});

check('an uncapped allowance is not treated as zero', () => {
    assert.equal(computeFreeUnits(10, b1g1, null), 5);
    assert.equal(computeFreeUnits(10, b1g1, undefined), 5);
});

check('a generous cap does not inflate free units', () => {
    assert.equal(computeFreeUnits(2, b1g1, 99), 1);
});

// ---- the offer window ------------------------------------------------------
check('a row with no window is always live', () => {
    assert.equal(isBogoOfferLive({}, new Date('2026-06-01')), true);
});

check('a row is dead before it starts', () => {
    const offer = { startDate: new Date('2026-06-01') };
    assert.equal(isBogoOfferLive(offer, new Date('2026-05-31')), false);
    assert.equal(isBogoOfferLive(offer, new Date('2026-06-01')), true);
});

check('the end of the window is exclusive', () => {
    // "Ends on the 1st" must not quietly include the whole of the 1st.
    const offer = { endDate: new Date('2026-06-01') };
    assert.equal(isBogoOfferLive(offer, new Date('2026-05-31')), true);
    assert.equal(isBogoOfferLive(offer, new Date('2026-06-01')), false);
});

// ---- splitting the line ----------------------------------------------------
check('two units split into one paid and one free', () => {
    const [paid, free] = splitBogoLine(line(), 1, b1g1);
    assert.equal(paid.quantity, 1);
    assert.equal(paid.price, 200);
    assert.equal(free.quantity, 1);
    assert.equal(free.price, 0);
    assert.equal(free.isBogoFree, true);
});

check('the paid line comes first', () => {
    const [first] = splitBogoLine(line(), 1, b1g1);
    assert.equal(first.price, 200);
});

check('add-ons stay chargeable on the free unit', () => {
    // Extra cheese on a free pizza is still cheese somebody has to pay for.
    const [, free] = splitBogoLine(line(), 1, b1g1);
    assert.equal(free.addonsTotal, 30);
    assert.equal(free.addons.length, 1);
});

check('packaging still applies to the free unit', () => {
    const [, free] = splitBogoLine(line(), 1, b1g1);
    assert.equal(free.foodPackagingCharge, 10);
});

check('the split preserves the total number of units', () => {
    const parts = splitBogoLine(line({ quantity: 5 }), 2, b1g1);
    assert.equal(parts.reduce((sum, p) => sum + p.quantity, 0), 5);
});

check('the free line records the ratio it came from', () => {
    const [, free] = splitBogoLine(line(), 1, { buyQty: 2, getQty: 1 });
    assert.equal(free.bogo.buyQty, 2);
    assert.equal(free.bogo.getQty, 1);
    assert.equal(free.bogo.sourceItemId, ITEM_A);
});

check('the free line keeps the variant it was ordered as', () => {
    // A free LARGE pizza for a paid large pizza, never a small one.
    const [, free] = splitBogoLine(line(), 1, b1g1);
    assert.equal(free.variantName, 'Large');
});

check('nothing free leaves the line untouched', () => {
    const parts = splitBogoLine(line({ quantity: 1 }), 0, b1g1);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].quantity, 1);
    assert.equal(parts[0].price, 200);
});

check('an entire line is never made free', () => {
    // Unreachable from the formula while buyQty >= 1, so reaching it means a
    // malformed offer -- which should cost the restaurant nothing, not everything.
    const parts = splitBogoLine(line({ quantity: 2 }), 2, b1g1);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].price, 200);
});

// ---- what the subtotal comes out as ----------------------------------------
check('the subtotal drops by exactly the free item price', () => {
    // The reduce the pricing service runs, over the split lines.
    const subtotalOf = (lines) =>
        lines.reduce((sum, it) => sum + ((Number(it.price) || 0) + (Number(it.addonsTotal) || 0)) * it.quantity, 0);

    const before = subtotalOf([line()]);            // 2 x (200 + 30)
    const after = subtotalOf(splitBogoLine(line(), 1, b1g1));

    assert.equal(before, 460);
    assert.equal(after, 260);                        // 230 paid + 30 add-on on the free unit
    assert.equal(before - after, 200);               // one item price, no add-ons
});

// ---- the saving shown to the customer --------------------------------------
check('the saving counts the item price only', () => {
    const saving = describeBogoSaving(line(), 1);
    assert.equal(saving.savedAmount, 200);
    assert.equal(saving.freeQuantity, 1);
    assert.equal(saving.name, 'Margherita');
    assert.equal(saving.variantName, 'Large');
});

check('nothing free describes no saving', () => {
    assert.equal(describeBogoSaving(line(), 0), null);
});

// ---- the "add one more" nudge ----------------------------------------------
check('one unit is one away from a free one', () => {
    // The nudge that matters: one tap from a second pizza costing nothing.
    const step = describeNextBogoUnits(1, b1g1);
    assert.equal(step.unitsAway, 1);
    assert.equal(step.freeQuantity, 1);
});

check('a clean multiple is not nagged', () => {
    // Two on a buy one get one has already taken the offer. Telling them to add
    // two more to take it again is nagging, not helping.
    assert.equal(describeNextBogoUnits(2, b1g1), null);
    assert.equal(describeNextBogoUnits(4, b1g1), null);
});

check('an odd quantity above the first pair is still one away', () => {
    assert.equal(describeNextBogoUnits(3, b1g1).unitsAway, 1);
});

check('buy 2 get 1 counts the distance to the full group', () => {
    const b2g1 = { buyQty: 2, getQty: 1 };
    assert.equal(describeNextBogoUnits(1, b2g1).unitsAway, 2);
    assert.equal(describeNextBogoUnits(2, b2g1).unitsAway, 1);
    assert.equal(describeNextBogoUnits(3, b2g1), null);
});

check('a dish that has hit its cap is not offered another', () => {
    // Otherwise the cart promises a free unit the order would refuse to grant.
    assert.equal(describeNextBogoUnits(1, b1g1, 0), null);
});

check('a remaining allowance below the ratio shrinks what is promised', () => {
    const step = describeNextBogoUnits(1, { buyQty: 1, getQty: 3 }, 2);
    assert.equal(step.freeQuantity, 2);
});

check('an uncapped offer promises the full ratio', () => {
    assert.equal(describeNextBogoUnits(1, b1g1, null).freeQuantity, 1);
});

check('an empty cart line is not nudged', () => {
    assert.equal(describeNextBogoUnits(0, b1g1), null);
});

// ---- the menu badge --------------------------------------------------------
check('the badge words the classic offer', () => {
    assert.equal(describeBogoOffer(b1g1).label, 'Buy 1 Get 1 Free');
});

check('the badge words an uneven ratio', () => {
    assert.equal(describeBogoOffer({ buyQty: 2, getQty: 1 }).label, 'Buy 2 Get 1 Free');
});

check('a missing or malformed offer has no badge', () => {
    assert.equal(describeBogoOffer(null), null);
    assert.equal(describeBogoOffer(undefined), null);
    assert.equal(describeBogoOffer({ buyQty: 0, getQty: 1 }), null);
});

// ---- what the panel may submit ---------------------------------------------
check('a body without offers leaves the stored rows alone', () => {
    assert.equal(normalizeBogoOffersInput({ isActive: false }), undefined);
});

check('an empty list is a real instruction to clear the rows', () => {
    assert.deepEqual(normalizeBogoOffersInput({ offers: [] }), { offers: [] });
});

check('a row defaults to the classic ratio', () => {
    const { offers } = normalizeBogoOffersInput({ offers: [{ itemId: ITEM_A }] });
    assert.equal(offers[0].buyQty, 1);
    assert.equal(offers[0].getQty, 1);
    assert.equal(offers[0].maxFreeUnitsPerOrder, null);
});

check('a row without a dish is refused', () => {
    assert.throws(() => normalizeBogoOffersInput({ offers: [{ buyQty: 1 }] }), /needs a dish/);
});

check('the same dish twice is refused', () => {
    // Otherwise the ratio a customer gets depends on array order.
    assert.throws(
        () => normalizeBogoOffersInput({ offers: [{ itemId: ITEM_A }, { itemId: ITEM_A }] }),
        /listed twice/,
    );
});

check('two different dishes are fine', () => {
    const { offers } = normalizeBogoOffersInput({ offers: [{ itemId: ITEM_A }, { itemId: ITEM_B }] });
    assert.equal(offers.length, 2);
});

check('a fractional or zero ratio is refused', () => {
    assert.throws(() => normalizeBogoOffersInput({ offers: [{ itemId: ITEM_A, buyQty: 0 }] }), /Buy quantity/);
    assert.throws(() => normalizeBogoOffersInput({ offers: [{ itemId: ITEM_A, getQty: 1.5 }] }), /Free quantity/);
});

check('a zero cap is refused rather than silently meaning uncapped', () => {
    assert.throws(
        () => normalizeBogoOffersInput({ offers: [{ itemId: ITEM_A, maxFreeUnitsPerOrder: 0 }] }),
        /Maximum free units/,
    );
});

check('a blank cap means uncapped', () => {
    const { offers } = normalizeBogoOffersInput({ offers: [{ itemId: ITEM_A, maxFreeUnitsPerOrder: '' }] });
    assert.equal(offers[0].maxFreeUnitsPerOrder, null);
});

check('an end date before its start is refused', () => {
    assert.throws(
        () => normalizeBogoOffersInput({
            offers: [{ itemId: ITEM_A, startDate: '2026-06-10', endDate: '2026-06-01' }],
        }),
        /after its start date/,
    );
});

check('an unparseable date is refused', () => {
    assert.throws(
        () => normalizeBogoOffersInput({ offers: [{ itemId: ITEM_A, startDate: 'next tuesday' }] }),
        /not a valid date/,
    );
});

check('more rows than the cap are refused', () => {
    const many = Array.from({ length: MAX_BOGO_OFFERS + 1 }, (_, i) => ({
        itemId: `6a8e71ac4339a70e13961${String(i).padStart(3, '0')}`,
    }));
    assert.throws(() => normalizeBogoOffersInput({ offers: many }), /At most/);
});

console.log(failures === 0 ? '\nAll BOGO checks passed.' : `\n${failures} BOGO check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
