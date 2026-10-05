/**
 * Pure-logic checks for the platform-funded free delivery rule.
 *
 * Run: node Backend/src/modules/food/shared/__checks__/freeDeliveryRule.check.js
 */
import assert from 'node:assert/strict';
import {
    DEFAULT_FREE_DELIVERY_RULE,
    normalizeFreeDeliveryRule,
    validateFreeDeliveryRule,
    qualifiesForFreeDelivery,
    describeFreeDeliveryRule,
    describeFreeDeliveryGap,
    normalizeRestaurantFreeDelivery,
    validateRestaurantFreeDelivery,
    resolveEffectiveFreeDeliveryRule,
    mergeRestaurantFreeDelivery,
} from '../freeDeliveryRule.js';

const rule = (over = {}) => ({ isEnabled: true, maxDistanceKm: 3, minOrderAmount: 300, ...over });

// --- normalize ---------------------------------------------------------------
assert.equal(DEFAULT_FREE_DELIVERY_RULE.isEnabled, false, 'off until an admin turns it on');
assert.deepEqual(normalizeFreeDeliveryRule(null), { isEnabled: false, maxDistanceKm: 3, minOrderAmount: 300 });
assert.equal(normalizeFreeDeliveryRule({ isEnabled: 'yes' }).isEnabled, false, 'only a real true enables it');
assert.equal(normalizeFreeDeliveryRule({ maxDistanceKm: 'abc' }).maxDistanceKm, 3, 'junk falls back');
assert.equal(normalizeFreeDeliveryRule({ maxDistanceKm: -2 }).maxDistanceKm, 3, 'negatives fall back');
assert.equal(normalizeFreeDeliveryRule({ minOrderAmount: 0 }).minOrderAmount, 0, 'zero is a real value, not junk');

// --- validate ----------------------------------------------------------------
assert.equal(validateFreeDeliveryRule(rule()).ok, true);
assert.equal(validateFreeDeliveryRule({ isEnabled: false }).ok, true, 'a rule that is off needs no numbers');
assert.equal(validateFreeDeliveryRule(rule({ maxDistanceKm: 0 })).ok, false);
assert.equal(validateFreeDeliveryRule(rule({ minOrderAmount: 0 })).ok, false);
assert.equal(validateFreeDeliveryRule(rule({ maxDistanceKm: 500 })).ok, false, 'a 500 km radius is a typo');
assert.ok(validateFreeDeliveryRule(rule({ maxDistanceKm: 0 })).reason.length > 0, 'rejections explain themselves');

// --- qualifies ---------------------------------------------------------------
const q = (over, distanceKm, subtotal) =>
    qualifiesForFreeDelivery({ rule: rule(over), distanceKm, subtotal });

assert.equal(q({}, 2, 350), true, 'near enough and spent enough');
assert.equal(q({}, 3, 300), true, 'both edges are inclusive, as the wording promises');
assert.equal(q({}, 3.01, 300), false, 'just outside the radius');
assert.equal(q({}, 3, 299.99), false, 'just short of the amount');
assert.equal(q({}, 10, 5000), false, 'a big basket does not buy a long trip');
assert.equal(q({}, 0.5, 50), false, 'a short trip does not buy a small basket');
assert.equal(q({}, 0, 300), true, 'collection from next door still qualifies');

// Distance unknown must never qualify: a geocoding failure is not a free trip.
assert.equal(q({}, null, 5000), false, 'unmeasured distance never qualifies');
assert.equal(q({}, undefined, 5000), false);
assert.equal(q({}, NaN, 5000), false);
assert.equal(q({}, -1, 5000), false, 'a nonsense distance never qualifies');

// Off means off, whatever the numbers say.
assert.equal(qualifiesForFreeDelivery({ rule: rule({ isEnabled: false }), distanceKm: 1, subtotal: 9999 }), false);
assert.equal(qualifiesForFreeDelivery({}), false, 'no rule at all is not a free delivery');
assert.equal(qualifiesForFreeDelivery({ rule: rule({ maxDistanceKm: 0 }), distanceKm: 0, subtotal: 400 }), false,
    'a zero radius cannot be satisfied by a zero distance');

// --- copy --------------------------------------------------------------------
assert.equal(describeFreeDeliveryRule({ isEnabled: false }), '', 'nothing to say when it is off');
assert.match(describeFreeDeliveryRule(rule()), /within 3 km/);
assert.match(describeFreeDeliveryRule(rule()), /300/);

// --- the nudge ---------------------------------------------------------------
{
    const gap = describeFreeDeliveryGap({ rule: rule(), distanceKm: 2, subtotal: 250 });
    assert.equal(gap.shortBy, 50, 'tells the customer exactly how much more');
    assert.equal(gap.minOrderAmount, 300);
}
assert.equal(describeFreeDeliveryGap({ rule: rule(), distanceKm: 2, subtotal: 300 }), null, 'already earned it');
assert.equal(describeFreeDeliveryGap({ rule: rule(), distanceKm: 9, subtotal: 100 }), null,
    'too far, so never nudge toward something unreachable');
assert.equal(describeFreeDeliveryGap({ rule: rule({ isEnabled: false }), distanceKm: 1, subtotal: 10 }), null);

// --- per-restaurant overrides -----------------------------------------------
const platformOn = { isEnabled: true, maxDistanceKm: 3, minOrderAmount: 300 };
const platformOff = { isEnabled: false, maxDistanceKm: 3, minOrderAmount: 300 };

// Default: a restaurant that has never been touched follows the platform.
assert.equal(normalizeRestaurantFreeDelivery(null).mode, 'inherit');
assert.equal(normalizeRestaurantFreeDelivery({ mode: 'nonsense' }).mode, 'inherit', 'an unknown mode is not trusted');

{
    const { rule, source } = resolveEffectiveFreeDeliveryRule({ restaurant: null, platform: platformOn });
    assert.equal(rule.isEnabled, true, 'inherit picks up the platform rule');
    assert.equal(rule.maxDistanceKm, 3);
    assert.equal(source, 'platform');
}
{
    const { rule, source } = resolveEffectiveFreeDeliveryRule({ restaurant: null, platform: platformOff });
    assert.equal(rule.isEnabled, false);
    assert.equal(source, 'none', 'nothing is funding this trip');
}

// An explicit opt-out beats an enabled platform rule. This is the whole point of
// 'off' existing separately from a disabled custom rule.
{
    const { rule, source } = resolveEffectiveFreeDeliveryRule({
        restaurant: { mode: 'off', maxDistanceKm: 9, minOrderAmount: 900 },
        platform: platformOn,
    });
    assert.equal(rule.isEnabled, false, 'excluded restaurant stays excluded');
    assert.equal(source, 'restaurant_off');
}

// A custom rule wins outright, including when the platform rule is off.
{
    const { rule, source } = resolveEffectiveFreeDeliveryRule({
        restaurant: { mode: 'custom', maxDistanceKm: 7, minOrderAmount: 150 },
        platform: platformOff,
    });
    assert.equal(rule.isEnabled, true, 'a restaurant may run its own promotion when the platform runs none');
    assert.equal(rule.maxDistanceKm, 7);
    assert.equal(rule.minOrderAmount, 150);
    assert.equal(source, 'restaurant');
}

// The resolved rule feeds qualifiesForFreeDelivery unchanged.
{
    const { rule } = resolveEffectiveFreeDeliveryRule({
        restaurant: { mode: 'custom', maxDistanceKm: 7, minOrderAmount: 150 },
        platform: platformOff,
    });
    assert.equal(qualifiesForFreeDelivery({ rule, distanceKm: 6.5, subtotal: 200 }), true);
    assert.equal(qualifiesForFreeDelivery({ rule, distanceKm: 7.5, subtotal: 200 }), false, 'outside the custom radius');
    assert.equal(qualifiesForFreeDelivery({ rule, distanceKm: 6.5, subtotal: 149 }), false, 'under the custom minimum');
    // The unmeasured-distance guard still holds through the override path.
    assert.equal(qualifiesForFreeDelivery({ rule, distanceKm: null, subtotal: 500 }), false);
}

// Validation only judges a custom rule; inherit and off save whatever is there.
assert.equal(validateRestaurantFreeDelivery({ mode: 'inherit', maxDistanceKm: 0 }).ok, true);
assert.equal(validateRestaurantFreeDelivery({ mode: 'off', minOrderAmount: 0 }).ok, true,
    'an opt-out saves even with empty numbers beside it');
assert.equal(validateRestaurantFreeDelivery({ mode: 'custom', maxDistanceKm: 0, minOrderAmount: 300 }).ok, false);
assert.equal(validateRestaurantFreeDelivery({ mode: 'custom', maxDistanceKm: 80, minOrderAmount: 300 }).ok, false,
    'a 80 km radius is a typo, not a rule');
assert.equal(validateRestaurantFreeDelivery({ mode: 'custom', maxDistanceKm: 5, minOrderAmount: 0 }).ok, false);
assert.equal(validateRestaurantFreeDelivery({ mode: 'custom', maxDistanceKm: 5, minOrderAmount: 250 }).ok, true);

// --- mergeRestaurantFreeDelivery --------------------------------------------
// A live run caught this: switching a restaurant to 'inherit' reset its custom
// radius to the module default, so switching back to 'custom' silently lost the
// numbers the admin had typed.
{
    const stored = { mode: 'custom', maxDistanceKm: 7, minOrderAmount: 150 };
    const merged = mergeRestaurantFreeDelivery({ mode: 'inherit' }, stored);
    assert.equal(merged.mode, 'inherit', 'the mode change lands');
    assert.equal(merged.maxDistanceKm, 7, 'the radius survives the switch');
    assert.equal(merged.minOrderAmount, 150, 'so does the minimum');
}
{
    // A panel that sends 0 for a disabled input means "nothing here", not "zero".
    const stored = { mode: 'custom', maxDistanceKm: 7, minOrderAmount: 150 };
    const merged = mergeRestaurantFreeDelivery({ mode: 'off', maxDistanceKm: 0, minOrderAmount: 0 }, stored);
    assert.equal(merged.maxDistanceKm, 7);
    assert.equal(merged.minOrderAmount, 150);
}
// Real edits still land.
assert.equal(mergeRestaurantFreeDelivery({ maxDistanceKm: 5 }, { mode: 'custom', maxDistanceKm: 7 }).maxDistanceKm, 5);
// An unknown mode keeps the stored one rather than silently reverting to inherit.
assert.equal(mergeRestaurantFreeDelivery({ mode: 'bogus' }, { mode: 'off' }).mode, 'off');
// Nothing stored: module defaults, which is the first-save case.
assert.deepEqual(mergeRestaurantFreeDelivery({ mode: 'custom' }, null),
    { mode: 'custom', maxDistanceKm: 3, minOrderAmount: 300 });

console.log('All free delivery rule checks passed.');
