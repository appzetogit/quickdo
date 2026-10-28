/**
 * Self-check for the packaging-charge and order-quantity rules.
 * Run: node src/modules/food/shared/__checks__/packagingAndQuantity.check.js
 */
import assert from 'node:assert/strict';
import {
    ABSOLUTE_MAX_ORDER_QUANTITY,
    assertOrderQuantity,
    assertOrderQuantityRange,
    clampOrderQuantity,
    formatOrderQuantityLimits,
    normalizeOrderQuantityInput,
    resolveOrderQuantityRules
} from '../orderQuantityRules.js';
import {
    computeFoodPackagingFee,
    normalizeItemPackagingChargeInput,
    normalizePackagingConfig,
    resolveItemPackagingAmount
} from '../packagingCharge.js';

const throws = (fn) => assert.throws(fn, { name: 'ValidationError' });

// --- quantity rules -------------------------------------------------------
// `hasMin` sits beside `hasCap` so a stored 0 ("no minimum") stays
// distinguishable from an explicit minimum -- the effective `min` is 1 either
// way, since nobody orders zero of something.
assert.deepEqual(resolveOrderQuantityRules(null), {
    min: 1,
    max: ABSOLUTE_MAX_ORDER_QUANTITY,
    hasMin: false,
    hasCap: false,
    ceiling: ABSOLUTE_MAX_ORDER_QUANTITY
});
assert.deepEqual(resolveOrderQuantityRules({ minOrderQuantity: 4, maxOrderQuantity: 10 }), {
    min: 4,
    max: 10,
    hasMin: true,
    hasCap: true,
    ceiling: ABSOLUTE_MAX_ORDER_QUANTITY
});
// max below min is pulled up to min rather than producing an empty range
assert.equal(resolveOrderQuantityRules({ minOrderQuantity: 6, maxOrderQuantity: 2 }).max, 6);
// 0 means "no item cap", so the platform ceiling applies
assert.equal(resolveOrderQuantityRules({ maxOrderQuantity: 0 }).max, ABSOLUTE_MAX_ORDER_QUANTITY);

assert.deepEqual(formatOrderQuantityLimits({ minOrderQuantity: 4, maxOrderQuantity: 0 }), {
    minOrderQuantity: 4,
    maxOrderQuantity: 0
});

assert.equal(clampOrderQuantity(1, resolveOrderQuantityRules({ minOrderQuantity: 4 })), 4);
assert.equal(clampOrderQuantity(50, resolveOrderQuantityRules({ maxOrderQuantity: 10 })), 10);

const rasgulla = resolveOrderQuantityRules({ minOrderQuantity: 4, maxOrderQuantity: 12 });
assert.equal(assertOrderQuantity(4, rasgulla, 'Rasgulla'), 4);
throws(() => assertOrderQuantity(3, rasgulla, 'Rasgulla'));
throws(() => assertOrderQuantity(13, rasgulla, 'Rasgulla'));
throws(() => assertOrderQuantity(0, rasgulla, 'Rasgulla'));
throws(() => assertOrderQuantity('abc', rasgulla, 'Rasgulla'));
// no item cap still hits the platform ceiling
throws(() => assertOrderQuantity(100, resolveOrderQuantityRules(null), 'Coke'));

// partial updates never reset a stored limit
assert.equal(normalizeOrderQuantityInput({}), undefined);
assert.deepEqual(normalizeOrderQuantityInput({ minOrderQuantity: 4 }), { minOrderQuantity: 4 });
// 0 is a valid minimum -- it means "no minimum", matching what 0 already means
// for the cap. It is stored as 0; the effective minimum at order time is still 1
// (see line 59: ordering 0 items is refused). Only a negative is nonsense.
assert.deepEqual(normalizeOrderQuantityInput({ minOrderQuantity: 0 }), { minOrderQuantity: 0 });
throws(() => normalizeOrderQuantityInput({ minOrderQuantity: -1 }));
throws(() => normalizeOrderQuantityInput({ maxOrderQuantity: 500 }));
throws(() => assertOrderQuantityRange({ minOrderQuantity: 5, maxOrderQuantity: 2 }));
assertOrderQuantityRange({ minOrderQuantity: 5, maxOrderQuantity: 0 }); // 0 = uncapped, valid

// --- packaging charge -----------------------------------------------------
assert.deepEqual(normalizePackagingConfig(null), {
    isEnabled: false,
    mode: 'ADMIN',
    adminChargePerOrder: 0,
    adminItemsPerCharge: 0
});
assert.equal(
    normalizePackagingConfig({ packagingCharge: { mode: 'restaurant' } }).mode,
    'RESTAURANT'
);

assert.equal(normalizeItemPackagingChargeInput(undefined), undefined);
// disabled keeps the typed amount so toggling back on restores it
assert.deepEqual(normalizeItemPackagingChargeInput({ isEnabled: false, amount: 12 }), {
    isEnabled: false,
    amount: 12
});
throws(() => normalizeItemPackagingChargeInput({ isEnabled: true, amount: 0 }));
throws(() => normalizeItemPackagingChargeInput({ isEnabled: true, amount: 99999 }));

assert.equal(resolveItemPackagingAmount({ packagingCharge: { isEnabled: false, amount: 5 } }), 0);
assert.equal(resolveItemPackagingAmount({ packagingCharge: { isEnabled: true, amount: 5 } }), 5);

const lines = [
    { foodPackagingCharge: 5, quantity: 2 },
    { foodPackagingCharge: 0, quantity: 3 },
    { foodPackagingCharge: 2.5, quantity: 2 }
];
assert.deepEqual(computeFoodPackagingFee({ items: lines, config: normalizePackagingConfig(null) }), {
    packagingFee: 0,
    packagingMode: ''
}); // disabled => free

assert.deepEqual(
    computeFoodPackagingFee({
        items: lines,
        config: { isEnabled: true, mode: 'RESTAURANT', adminChargePerOrder: 99 }
    }),
    { packagingFee: 15, packagingMode: 'RESTAURANT' }
); // 5*2 + 2.5*2, admin flat ignored in RESTAURANT mode

assert.deepEqual(
    computeFoodPackagingFee({
        items: lines,
        config: { isEnabled: true, mode: 'ADMIN', adminChargePerOrder: 7 }
    }),
    { packagingFee: 7, packagingMode: 'ADMIN' }
); // flat, regardless of line count

assert.equal(
    computeFoodPackagingFee({ items: [], config: { isEnabled: true, mode: 'ADMIN', adminChargePerOrder: 7 } })
        .packagingFee,
    0
); // no items, no fee

// --- one charge per N units ------------------------------------------------
const restaurantMode = { isEnabled: true, mode: 'RESTAURANT', adminChargePerOrder: 0 };
const fee = (items, config = restaurantMode) => computeFoodPackagingFee({ items, config }).packagingFee;
const box = (quantity, extra = {}) => ({ itemId: 'biryani', foodPackagingCharge: 10, foodPackagingUnits: 3, quantity, ...extra });
assert.equal(fee([box(1)]), 10); // 1-3 -> one charge
assert.equal(fee([box(3)]), 10);
assert.equal(fee([box(4)]), 20); // 4-6 -> two
assert.equal(fee([box(7)]), 30); // 7-9 -> three
// The same item in two sizes is pooled: 2 + 1 = 3 units -> one charge.
assert.equal(fee([box(2, { variantName: 'Half' }), box(1, { variantName: 'Full' })]), 10);
// Different items count separately; no units set = per unit, as before.
assert.equal(fee([box(2), { itemId: 'raita', foodPackagingCharge: 5, quantity: 2 }]), 20);
// Admin mode: one charge per N items in the whole order, or once per order when N is 0.
const adminEvery5 = { isEnabled: true, mode: 'ADMIN', adminChargePerOrder: 15, adminItemsPerCharge: 5 };
assert.equal(fee([box(3), { itemId: 'raita', quantity: 2 }], adminEvery5), 15); // 5 items
assert.equal(fee([box(3), { itemId: 'raita', quantity: 3 }], adminEvery5), 30); // 6 items
assert.equal(fee([box(9)], { ...adminEvery5, adminItemsPerCharge: 0 }), 15);
// Item input: units kept when sent, undefined when not (stored value is kept), bounds checked.
assert.equal(normalizeItemPackagingChargeInput({ isEnabled: true, amount: 10, unitsPerCharge: 3 }).unitsPerCharge, 3);
assert.equal(normalizeItemPackagingChargeInput({ isEnabled: true, amount: 10 }).unitsPerCharge, undefined);
throws(() => normalizeItemPackagingChargeInput({ isEnabled: true, amount: 10, unitsPerCharge: 0 }));
throws(() => normalizeItemPackagingChargeInput({ isEnabled: true, amount: 10, unitsPerCharge: 2.5 }));

console.log('packaging + quantity checks passed');
