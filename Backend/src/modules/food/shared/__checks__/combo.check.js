/**
 * Pure-logic checks for combos.
 *
 * Run: node Backend/src/modules/food/shared/__checks__/combo.check.js
 */
import assert from 'node:assert/strict';
import {
    MIN_COMBO_COMPONENTS,
    MAX_COMBO_COMPONENTS,
    MAX_COMBO_UNITS,
    componentKey,
    normalizeComboComponents,
    validateComboComposition,
    computeComponentTotal,
    validateComboPrice,
    computeComboSaving,
    resolveComboAvailability,
    allocateComboPrice,
    describeCombo,
} from '../combo.js';

const key = (itemId, variantId = null) => componentKey({ itemId, variantId });

// --- normalizeComboComponents ------------------------------------------------
{
    const rows = normalizeComboComponents([
        { itemId: 'burger' },
        { itemId: 'fries', quantity: 2 },
        { itemId: '', quantity: 5 },
        { itemId: 'burger', quantity: 1 },
    ]);
    assert.equal(rows.length, 2, 'blank dish dropped, duplicate merged');
    assert.deepEqual(rows[0], { itemId: 'burger', variantId: null, quantity: 2 }, 'same dish twice means two of it');
    assert.deepEqual(rows[1], { itemId: 'fries', variantId: null, quantity: 2 });
}
assert.deepEqual(normalizeComboComponents(null), [], 'a non-array is not a crash');
assert.equal(normalizeComboComponents([{ itemId: 'a', quantity: 0 }])[0].quantity, 1, 'zero falls back to one');
assert.equal(normalizeComboComponents([{ itemId: 'a', quantity: -3 }])[0].quantity, 1, 'negatives too');
assert.equal(normalizeComboComponents([{ itemId: 'a', quantity: 2.7 }])[0].quantity, 2, 'fractional units floor');
{
    // Same dish, different sizes: two legitimate rows, not a duplicate.
    const rows = normalizeComboComponents([
        { itemId: 'pizza', variantId: 'small' },
        { itemId: 'pizza', variantId: 'large' },
    ]);
    assert.equal(rows.length, 2, 'variants of one dish stay separate');
}
assert.equal(normalizeComboComponents([{ _id: 'x' }])[0].itemId, 'x', 'accepts _id');
assert.equal(normalizeComboComponents([{ foodId: 'y' }])[0].itemId, 'y', 'accepts foodId');

// --- validateComboComposition ------------------------------------------------
assert.equal(MIN_COMBO_COMPONENTS, 2);
{
    const pair = [{ itemId: 'a', quantity: 1 }, { itemId: 'b', quantity: 1 }];
    assert.equal(validateComboComposition(pair).ok, true, 'a pair of dishes is the core case');
}
assert.equal(validateComboComposition([]).ok, false, 'nothing is not a combo');
assert.equal(validateComboComposition([{ itemId: 'a', quantity: 1 }]).ok, false, 'one dish is not a combo');
assert.equal(
    validateComboComposition([{ itemId: 'a', quantity: 3 }, { itemId: 'a', variantId: 'l', quantity: 1 }]).ok,
    false,
    'two sizes of the same dish is still one dish',
);
{
    const tooMany = Array.from({ length: MAX_COMBO_COMPONENTS + 1 }, (_, i) => ({ itemId: 'd' + i, quantity: 1 }));
    assert.equal(validateComboComposition(tooMany).ok, false, 'past the component cap');
}
{
    const heavy = [{ itemId: 'a', quantity: MAX_COMBO_UNITS }, { itemId: 'b', quantity: 1 }];
    assert.equal(validateComboComposition(heavy).ok, false, 'past the total-units cap');
}
assert.ok(validateComboComposition([]).reason.length > 0, 'a rejection always explains itself');

// Picking the same dish twice is refused, and the message has to say WHY.
// normalizeComboComponents merges duplicate rows, so this arrives as one row of
// quantity two -- and a bare "pick at least 2 dishes" would be baffling to
// somebody who just picked two. A live run of the flow caught exactly that.
{
    const merged = normalizeComboComponents([{ itemId: 'burger' }, { itemId: 'burger' }]);
    assert.equal(merged.length, 1, 'duplicates merge into one row');
    const verdict = validateComboComposition(merged);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /different dishes/, 'the reason names the actual problem');
}
// The empty and single-dish cases get the same honest wording.
assert.match(validateComboComposition([]).reason, /different dishes/);
assert.match(validateComboComposition([{ itemId: 'a', quantity: 1 }]).reason, /different dishes/);

// --- computeComponentTotal ---------------------------------------------------
{
    const components = [{ itemId: 'burger', variantId: null, quantity: 1 }, { itemId: 'fries', variantId: null, quantity: 2 }];
    const prices = new Map([[key('burger'), 150], [key('fries'), 60]]);
    assert.equal(computeComponentTotal(components, prices), 270, '150 + 2x60');
    // A plain object works as well as a Map, since that is what JSON gives us.
    assert.equal(computeComponentTotal(components, { [key('burger')]: 150, [key('fries')]: 60 }), 270);
    // An unpriced component contributes nothing rather than NaN.
    assert.equal(computeComponentTotal(components, new Map([[key('burger'), 150]])), 150);
}

// --- validateComboPrice ------------------------------------------------------
assert.equal(validateComboPrice(199, 270).ok, true);
assert.equal(validateComboPrice(0, 270).ok, false, 'free is not a combo');
assert.equal(validateComboPrice(-5, 270).ok, false);
assert.equal(validateComboPrice(270, 270).ok, false, 'no saving is not an offer');
assert.equal(validateComboPrice(300, 270).ok, false, 'a combo may not cost more than its parts');
assert.equal(validateComboPrice(199, 0).ok, false, 'unpriced dishes cannot form a priced combo');
assert.match(validateComboPrice(300, 270).reason, /cheaper than its parts/);

// --- computeComboSaving ------------------------------------------------------
{
    const saving = computeComboSaving(270, 199);
    assert.equal(saving.amount, 71);
    assert.equal(saving.percent, 26);
    assert.equal(saving.comboPrice, 199);
    assert.equal(saving.componentTotal, 270);
}
assert.equal(computeComboSaving(0, 0).percent, 0, 'no division by zero');
assert.equal(computeComboSaving(100, 150).amount, 0, 'a negative saving reads as zero, never as minus');

// --- resolveComboAvailability ------------------------------------------------
{
    const components = [{ itemId: 'a', variantId: null, quantity: 1 }, { itemId: 'b', variantId: null, quantity: 1 }];
    const allGood = new Map([
        [key('a'), { isAvailable: true, approvalStatus: 'approved', name: 'Burger' }],
        [key('b'), { isAvailable: true, approvalStatus: 'approved', name: 'Fries' }],
    ]);
    assert.equal(resolveComboAvailability(components, allGood).available, true);

    const oneOut = new Map(allGood);
    oneOut.set(key('b'), { isAvailable: false, approvalStatus: 'approved', name: 'Fries' });
    const blocked = resolveComboAvailability(components, oneOut);
    assert.equal(blocked.available, false, 'one sold-out dish takes the whole combo down');
    assert.equal(blocked.blockedBy[0].name, 'Fries');

    const pending = new Map(allGood);
    pending.set(key('a'), { isAvailable: true, approvalStatus: 'pending', name: 'Burger' });
    assert.equal(resolveComboAvailability(components, pending).available, false, 'unapproved blocks too');

    // A deleted dish must not silently vanish from a combo the customer pays for.
    const missing = new Map([[key('a'), { isAvailable: true, approvalStatus: 'approved', name: 'Burger' }]]);
    const gone = resolveComboAvailability(components, missing);
    assert.equal(gone.available, false, 'a dish the menu has never heard of blocks the combo');
    assert.match(gone.blockedBy[0].reason, /no longer on the menu/);
}

// --- allocateComboPrice ------------------------------------------------------
{
    // The headline property: the parts sum to exactly the price charged.
    const components = [{ itemId: 'biryani', variantId: null, quantity: 1 }, { itemId: 'papad', variantId: null, quantity: 1 }];
    const prices = new Map([[key('biryani'), 250], [key('papad'), 20]]);
    const rows = allocateComboPrice(components, prices, 199);
    const sum = rows.reduce((t, r) => t + r.comboLineTotal, 0);
    assert.equal(Math.round(sum * 100), 19900, 'shares sum to the combo price to the paisa');
    // Pro-rata, so the expensive dish carries most of the price.
    assert.ok(rows[0].comboLineTotal > rows[1].comboLineTotal * 5, 'the biryani carries the biryani share');
    assert.equal(rows[0].listLineTotal, 250);
}
{
    // Three-way split of a price that does not divide cleanly: 100 / 3.
    const components = ['a', 'b', 'c'].map((id) => ({ itemId: id, variantId: null, quantity: 1 }));
    const prices = new Map(components.map((c) => [componentKey(c), 50]));
    const rows = allocateComboPrice(components, prices, 100);
    const paise = rows.reduce((t, r) => t + Math.round(r.comboLineTotal * 100), 0);
    assert.equal(paise, 10000, 'no paisa is lost to rounding on an uneven split');
}
{
    // Quantities are respected: two fries carry twice one fries' weight.
    const components = [{ itemId: 'burger', variantId: null, quantity: 1 }, { itemId: 'fries', variantId: null, quantity: 2 }];
    const prices = new Map([[key('burger'), 100], [key('fries'), 50]]);
    const rows = allocateComboPrice(components, prices, 180);
    assert.equal(rows[0].comboLineTotal, 90, 'burger is 100 of 200, so half of 180');
    assert.equal(rows[1].comboLineTotal, 90, 'two fries are 100 of 200 as well');
    assert.equal(rows[1].comboUnitPrice, 45, 'per-unit price is the line divided by quantity');
}
{
    // Unpriced components still produce a priceable, exactly-summing order.
    const components = [{ itemId: 'a', variantId: null, quantity: 1 }, { itemId: 'b', variantId: null, quantity: 1 }];
    const rows = allocateComboPrice(components, new Map(), 100);
    const paise = rows.reduce((t, r) => t + Math.round(r.comboLineTotal * 100), 0);
    assert.equal(paise, 10000, 'falls back to an even split rather than charging nothing');
}

// --- describeCombo -----------------------------------------------------------
{
    const components = [{ itemId: 'a', quantity: 1 }, { itemId: 'b', quantity: 2 }];
    const text = describeCombo(components, computeComboSaving(270, 199));
    assert.match(text, /3 items/);
    assert.match(text, /save/);
    assert.equal(describeCombo(components, null), '3 items', 'no saving, no saving text');
}

// --- manual components --------------------------------------------------------
{
    // A manual row (no itemId, just a typed name and price) normalizes like a
    // real one and merges on name+price, same as a real dish merges on itemId.
    const rows = normalizeComboComponents([
        { manualName: 'Cold Drink', manualPrice: 40 },
        { manualName: 'cold drink', manualPrice: 40, quantity: 1 },
        { manualName: 'Ice Cream', manualPrice: 60 },
        { manualName: '', manualPrice: 10 }, // no name: dropped
    ]);
    assert.equal(rows.length, 2, 'blank-named row dropped, matching manual rows merged');
    assert.equal(rows[0].manualName, 'Cold Drink');
    assert.equal(rows[0].quantity, 2, 'case-insensitive name+price match merges quantities');
    assert.equal(rows[0].itemId, null);
}
{
    // A real dish and a manual one together are two DIFFERENT dishes.
    const mixed = normalizeComboComponents([
        { itemId: 'burger' },
        { manualName: 'Cold Drink', manualPrice: 40 },
    ]);
    assert.equal(validateComboComposition(mixed).ok, true, 'one real + one manual clears the minimum');
}
{
    // Two manual rows alone are a valid pair too.
    const bothManual = normalizeComboComponents([
        { manualName: 'A', manualPrice: 10 },
        { manualName: 'B', manualPrice: 20 },
    ]);
    assert.equal(validateComboComposition(bothManual).ok, true, 'a fully manual combo is still a combo');
}
{
    // Manual price is used directly -- there is no priceByKey lookup for it.
    const components = [
        { itemId: 'burger', variantId: null, quantity: 1 },
        { itemId: null, variantId: null, manualName: 'Cold Drink', manualPrice: 40, quantity: 2 },
    ];
    const prices = new Map([[key('burger'), 150]]);
    assert.equal(computeComponentTotal(components, prices), 230, '150 + 2x40, the manual price used as-is');
}
{
    // A manual row can never block a combo -- it has no catalogue state to check.
    const components = [
        { itemId: 'a', variantId: null, quantity: 1 },
        { itemId: null, variantId: null, manualName: 'Gift', manualPrice: 10, quantity: 1 },
    ];
    // Deliberately empty: a manual row has nothing in stateByKey and must not
    // be read as "a removed dish", the way a real one with no entry would be.
    const result = resolveComboAvailability(components, new Map([[key('a'), { isAvailable: true, approvalStatus: 'approved', name: 'A' }]]));
    assert.equal(result.available, true, 'the manual row is silently skipped, not treated as missing');
}
{
    // Mixed real + manual still sums to exactly the combo price.
    const components = [
        { itemId: 'burger', variantId: null, quantity: 1 },
        { itemId: null, variantId: null, manualName: 'Cold Drink', manualPrice: 40, quantity: 1 },
    ];
    const prices = new Map([[key('burger'), 160]]);
    const rows = allocateComboPrice(components, prices, 149);
    const paise = rows.reduce((t, r) => t + Math.round(r.comboLineTotal * 100), 0);
    assert.equal(paise, 14900, 'a manual component still allocates its share exactly');
    const manualRow = rows.find((r) => r.itemId === null);
    assert.equal(manualRow.manualName, 'Cold Drink', 'the allocation row keeps the manual name for the caller');
}

console.log('All combo checks passed.');
