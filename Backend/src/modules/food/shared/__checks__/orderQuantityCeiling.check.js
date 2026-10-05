/**
 * Self-check for the configurable platform order-quantity ceiling.
 * Run: node src/modules/food/shared/__checks__/orderQuantityCeiling.check.js
 */
import assert from 'node:assert/strict';
import {
    ABSOLUTE_MAX_ORDER_QUANTITY,
    assertOrderQuantity,
    formatOrderQuantityLimits,
    normalizeOrderQuantityInput,
    resolveCeiling,
    resolveOrderQuantityRules,
} from '../orderQuantityRules.js';

const throws = (fn, re) => assert.throws(fn, (e) => e.name === 'ValidationError' && (!re || re.test(e.message)));

// --- resolveCeiling: anything unusable falls back to the constant ---------
assert.equal(resolveCeiling(25), 25);
assert.equal(resolveCeiling('25'), 25);
assert.equal(resolveCeiling(25.9), 25);          // floored
assert.equal(resolveCeiling(undefined), ABSOLUTE_MAX_ORDER_QUANTITY);
assert.equal(resolveCeiling(null), ABSOLUTE_MAX_ORDER_QUANTITY);
assert.equal(resolveCeiling(0), ABSOLUTE_MAX_ORDER_QUANTITY);   // 0 would block every item
assert.equal(resolveCeiling(-5), ABSOLUTE_MAX_ORDER_QUANTITY);
assert.equal(resolveCeiling('abc'), ABSOLUTE_MAX_ORDER_QUANTITY);

// --- default behaviour is unchanged when no ceiling is passed -------------
assert.equal(resolveOrderQuantityRules(null).max, ABSOLUTE_MAX_ORDER_QUANTITY);
assert.equal(resolveOrderQuantityRules(null).ceiling, ABSOLUTE_MAX_ORDER_QUANTITY);
assert.equal(resolveOrderQuantityRules({ maxOrderQuantity: 0 }).max, ABSOLUTE_MAX_ORDER_QUANTITY);

// --- a configured ceiling applies where the item sets no cap -------------
{
    const r = resolveOrderQuantityRules({ maxOrderQuantity: 0 }, 10);
    assert.equal(r.max, 10);
    assert.equal(r.hasCap, false);
    assert.equal(r.ceiling, 10);
}
// --- an item cap under the ceiling still wins ---------------------------
{
    const r = resolveOrderQuantityRules({ maxOrderQuantity: 4 }, 10);
    assert.equal(r.max, 4);
    assert.equal(r.hasCap, true);
}
// --- an item cap ABOVE the ceiling is clamped to it ---------------------
{
    const r = resolveOrderQuantityRules({ maxOrderQuantity: 50 }, 10);
    assert.equal(r.max, 10);
}
// --- a minimum above the ceiling is clamped too -------------------------
assert.equal(resolveOrderQuantityRules({ minOrderQuantity: 40 }, 10).min, 10);

// --- enforcement: the ceiling binds items that set no cap of their own ---
{
    const rules = resolveOrderQuantityRules({ maxOrderQuantity: 0 }, 10);
    assert.equal(assertOrderQuantity(10, rules, 'Item'), 10);          // at the ceiling
    throws(() => assertOrderQuantity(11, rules, 'Item'), /at most 10 of "Item" in a single order/);
}
// --- an item cap produces its own message, not the platform one ---------
{
    const rules = resolveOrderQuantityRules({ maxOrderQuantity: 3 }, 10);
    throws(() => assertOrderQuantity(4, rules, 'Item'), /at most 3 of "Item"/);
}
// --- with no ceiling passed, the old constant still binds ---------------
{
    const rules = resolveOrderQuantityRules({ maxOrderQuantity: 0 });
    assert.equal(assertOrderQuantity(99, rules, 'Item'), 99);
    throws(() => assertOrderQuantity(100, rules, 'Item'), /at most 99 of "Item" in a single order/);
}
// --- a rules object from an older caller (no ceiling key) still works ----
throws(() => assertOrderQuantity(100, { min: 1, max: 99, hasCap: false }, 'Item'), /at most 99 of "Item" in a single order/);

// --- admin/seller input is validated against the configured ceiling ------
assert.deepEqual(
    normalizeOrderQuantityInput({ maxOrderQuantity: 8 }, { ceiling: 10 }),
    { maxOrderQuantity: 8 }
);
throws(() => normalizeOrderQuantityInput({ maxOrderQuantity: 11 }, { ceiling: 10 }), /largest order quantity can be at most 10/);
throws(() => normalizeOrderQuantityInput({ minOrderQuantity: 11 }, { ceiling: 10 }), /smallest order quantity cannot be more than 10/);
// Without a ceiling the original limit message stands.
throws(() => normalizeOrderQuantityInput({ maxOrderQuantity: 100 }, {}), /largest order quantity can be at most 99/);

// --- what the client is told reflects the ceiling ------------------------
/*
 * 0 means "not set" on BOTH ends now. It always did for the maximum; the minimum
 * used to report its EFFECTIVE value of 1 instead, so an editor redisplayed 1 for
 * a dish that had no minimum and 0 could never be entered or kept.
 *
 * Ordering is unchanged -- resolveOrderQuantityRules still turns a stored 0 into
 * an effective min of 1, because nobody orders zero of something.
 */
assert.deepEqual(formatOrderQuantityLimits({ maxOrderQuantity: 0 }, 10), {
    minOrderQuantity: 0, // no minimum set
    maxOrderQuantity: 0, // 0 still means "no item cap"; the ceiling is not an item cap
});
assert.deepEqual(formatOrderQuantityLimits({ maxOrderQuantity: 50 }, 10), {
    minOrderQuantity: 0,
    maxOrderQuantity: 10, // clamped to the ceiling
});
// An explicit minimum is still reported as itself.
assert.deepEqual(formatOrderQuantityLimits({ minOrderQuantity: 3, maxOrderQuantity: 0 }, 10), {
    minOrderQuantity: 3,
    maxOrderQuantity: 0,
});
// And a stored 0 still yields an effective minimum of 1 at order time.
assert.equal(resolveOrderQuantityRules({ minOrderQuantity: 0 }, 10).min, 1);
assert.equal(resolveOrderQuantityRules({ minOrderQuantity: 0 }, 10).hasMin, false);

console.log('All order-quantity-ceiling checks passed.');
