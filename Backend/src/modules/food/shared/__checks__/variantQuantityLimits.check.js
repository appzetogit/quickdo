/**
 * Per-variant order quantity limits.
 *
 * A dish's sizes do not sell alike, so a variant may set its own minimum and
 * maximum. These checks pin the fallback behaviour, which is where the surprises
 * live: each bound falls back to the dish independently.
 *
 * Run: node Backend/src/modules/food/shared/__checks__/variantQuantityLimits.check.js
 */
import assert from 'node:assert/strict';
import {
    ABSOLUTE_MAX_ORDER_QUANTITY,
    resolveVariantQuantityLimits,
    resolveOrderQuantityRules,
    formatOrderQuantityLimits,
    assertOrderQuantity,
} from '../orderQuantityRules.js';

const dish = (over = {}) => ({
    minOrderQuantity: 1,
    maxOrderQuantity: 10,
    variantsEnabled: true,
    variants: [
        { _id: 'half', name: 'Half', price: 100 },
        { _id: 'full', name: 'Full', price: 180, minOrderQuantity: 2, maxOrderQuantity: 4 },
        { _id: 'family', name: 'Family', price: 400, maxOrderQuantity: 2 },
        { _id: 'piece', name: 'Piece', price: 15, minOrderQuantity: 6 },
    ],
    ...over,
});

// --- resolveVariantQuantityLimits -------------------------------------------
{
    // No variant named: the dish's own limits, exactly as before this existed.
    const d = resolveVariantQuantityLimits(dish(), null);
    assert.equal(d.minOrderQuantity, 1);
    assert.equal(d.maxOrderQuantity, 10);
}
{
    // A variant that sets both wins outright.
    const v = resolveVariantQuantityLimits(dish(), 'full');
    assert.equal(v.minOrderQuantity, 2);
    assert.equal(v.maxOrderQuantity, 4);
}
{
    // A variant that sets neither inherits both.
    const v = resolveVariantQuantityLimits(dish(), 'half');
    assert.equal(v.minOrderQuantity, 1);
    assert.equal(v.maxOrderQuantity, 10);
}
{
    // The case worth pinning: each bound falls back on its own. A variant that
    // sets only a max must keep the dish's min, not reset it to the default.
    const v = resolveVariantQuantityLimits(dish(), 'family');
    assert.equal(v.minOrderQuantity, 1, 'inherits the dish minimum');
    assert.equal(v.maxOrderQuantity, 2, 'uses its own maximum');
}
{
    // ...and the mirror image.
    const v = resolveVariantQuantityLimits(dish({ minOrderQuantity: 3 }), 'piece');
    assert.equal(v.minOrderQuantity, 6, 'uses its own minimum');
    assert.equal(v.maxOrderQuantity, 10, 'inherits the dish maximum');
}
{
    // An unknown variant id falls back rather than throwing: a stale cart line
    // must not be able to crash pricing.
    const v = resolveVariantQuantityLimits(dish(), 'no-such-size');
    assert.equal(v.minOrderQuantity, 1);
    assert.equal(v.maxOrderQuantity, 10);
}
{
    // Variants switched off: the dish's own fields decide, whatever the stored
    // rows still say. The same rule pricing follows.
    const v = resolveVariantQuantityLimits(dish({ variantsEnabled: false }), 'full');
    assert.equal(v.minOrderQuantity, 1, 'stored variant limits are ignored when the toggle is off');
    assert.equal(v.maxOrderQuantity, 10);
}
assert.deepEqual(
    resolveVariantQuantityLimits(null, 'full'),
    { minOrderQuantity: undefined, maxOrderQuantity: undefined },
    'no dish is not a crash',
);

// --- resolveOrderQuantityRules ----------------------------------------------
{
    const r = resolveOrderQuantityRules(dish(), 99, 'full');
    assert.equal(r.min, 2);
    assert.equal(r.max, 4);
    assert.equal(r.hasCap, true);
}
{
    // Backwards compatible: omitting the variant behaves exactly as before.
    const r = resolveOrderQuantityRules(dish(), 99);
    assert.equal(r.min, 1);
    assert.equal(r.max, 10);
}
{
    // A variant cap of 0 means "no cap of my own", so the platform ceiling applies.
    const d = dish({ maxOrderQuantity: 0, variants: [{ _id: 'x', name: 'X', price: 10, maxOrderQuantity: 0 }] });
    const r = resolveOrderQuantityRules(d, 99, 'x');
    assert.equal(r.hasCap, false);
    assert.equal(r.max, 99);
}
{
    // The platform ceiling still wins over a larger per-variant cap.
    const d = dish({ variants: [{ _id: 'x', name: 'X', price: 10, maxOrderQuantity: 500 }] });
    const r = resolveOrderQuantityRules(d, 20, 'x');
    assert.equal(r.max, 20, 'the admin ceiling is the hard limit');
}

// --- formatOrderQuantityLimits ----------------------------------------------
{
    const f = formatOrderQuantityLimits(dish(), 99, 'family');
    assert.equal(f.minOrderQuantity, 1);
    assert.equal(f.maxOrderQuantity, 2, 'the client is told this size caps at 2');
}
{
    const f = formatOrderQuantityLimits(dish(), 99);
    assert.equal(f.maxOrderQuantity, 10, 'the dish-level figure is unchanged');
}

// --- assertOrderQuantity, through the variant rules --------------------------
{
    const rules = resolveOrderQuantityRules(dish(), 99, 'full');
    assert.equal(assertOrderQuantity(3, rules, 'Biryani (Full)'), 3, 'inside the range');
    assert.throws(() => assertOrderQuantity(1, rules, 'Biryani (Full)'), /at least 2/);
    assert.throws(() => assertOrderQuantity(5, rules, 'Biryani (Full)'), /at most 4/);
}
{
    // The other size of the same dish is judged on its own limits.
    const rules = resolveOrderQuantityRules(dish(), 99, 'half');
    assert.equal(assertOrderQuantity(1, rules, 'Biryani (Half)'), 1, 'one half plate is fine');
    assert.throws(() => assertOrderQuantity(11, rules, 'Biryani (Half)'), /at most 10/);
}
{
    const rules = resolveOrderQuantityRules(dish(), 99, 'piece');
    assert.throws(() => assertOrderQuantity(4, rules, 'Rasgulla'), /at least 6/);
    assert.equal(assertOrderQuantity(6, rules, 'Rasgulla'), 6);
}

assert.equal(ABSOLUTE_MAX_ORDER_QUANTITY, 99);

console.log('All per-variant quantity limit checks passed.');
