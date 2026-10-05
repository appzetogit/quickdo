/**
 * Which add-ons a line may offer, once add-ons can belong to a single variant.
 *
 * The rule is a union, not a replacement: an add-on that applies to the whole
 * dish is set once on the item, and a variant contributes extras of its own. Get
 * that backwards and either every size loses the shared add-ons, or a
 * large-only add-on becomes orderable on the small.
 *
 * Run: node src/modules/food/shared/__checks__/variantAddons.check.js
 */
import assert from 'node:assert';
import { resolveAllowedAddonIds, resolveLineAddons, resolveVariantAddonPriceOverrides } from '../orderAddons.js';

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

const NAPKIN = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const CHEESE = 'bbbbbbbbbbbbbbbbbbbbbbb2';
const SMALL = 'ccccccccccccccccccccccc3';
const LARGE = 'ddddddddddddddddddddddd4';

// Napkins on the whole dish; cheese only on the large.
const item = {
    name: 'Pizza',
    addonIds: [NAPKIN],
    variants: [
        { _id: SMALL, name: 'Small', price: 100, addonIds: [] },
        { _id: LARGE, name: 'Large', price: 200, addonIds: [CHEESE] },
    ],
};

const addonsById = new Map([
    [NAPKIN, { _id: NAPKIN, name: 'Extra napkins', price: 5 }],
    [CHEESE, { _id: CHEESE, name: 'Extra cheese', price: 40 }],
]);

check('the large offers both the shared and its own add-on', () => {
    const allowed = resolveAllowedAddonIds(item, LARGE);
    assert.ok(allowed.has(NAPKIN), 'shared add-on missing on the large');
    assert.ok(allowed.has(CHEESE), 'variant add-on missing on the large');
});

check('the small offers only the shared add-on', () => {
    const allowed = resolveAllowedAddonIds(item, SMALL);
    assert.ok(allowed.has(NAPKIN));
    assert.ok(!allowed.has(CHEESE), 'cheese leaked onto the small');
});

check('with no variant chosen, only the item-level add-ons apply', () => {
    // Otherwise a variant-only add-on becomes orderable by omitting the variant.
    const allowed = resolveAllowedAddonIds(item, null);
    assert.ok(allowed.has(NAPKIN));
    assert.ok(!allowed.has(CHEESE));
});

check('an unknown variant id does not widen what is allowed', () => {
    const allowed = resolveAllowedAddonIds(item, 'eeeeeeeeeeeeeeeeeeeeeee5');
    assert.ok(allowed.has(NAPKIN));
    assert.ok(!allowed.has(CHEESE));
});

check('cheese is accepted and priced on the large', () => {
    const { addons, addonsTotal } = resolveLineAddons(item, [CHEESE], addonsById, LARGE);
    assert.equal(addons.length, 1);
    assert.equal(addons[0].name, 'Extra cheese');
    assert.equal(addonsTotal, 40);
});

check('cheese is refused on the small', () => {
    assert.throws(
        () => resolveLineAddons(item, [CHEESE], addonsById, SMALL),
        /cannot be added/,
    );
});

check('cheese is refused when no variant was chosen', () => {
    assert.throws(
        () => resolveLineAddons(item, [CHEESE], addonsById, null),
        /cannot be added/,
    );
});

check('the shared add-on works on every variant and on none', () => {
    for (const variant of [SMALL, LARGE, null]) {
        const { addonsTotal } = resolveLineAddons(item, [NAPKIN], addonsById, variant);
        assert.equal(addonsTotal, 5, `napkins failed for variant ${variant}`);
    }
});

check('an item with no variants is unaffected', () => {
    // The shape every existing dish has.
    const plain = { name: 'Roti', addonIds: [NAPKIN] };
    const { addonsTotal } = resolveLineAddons(plain, [NAPKIN], addonsById, null);
    assert.equal(addonsTotal, 5);
    assert.throws(() => resolveLineAddons(plain, [CHEESE], addonsById, null), /cannot be added/);
});

check('a variant with no add-on list of its own still gets the shared ones', () => {
    // Every variant stored before this feature has no addonIds at all.
    const legacy = {
        name: 'Pizza',
        addonIds: [NAPKIN],
        variants: [{ _id: SMALL, name: 'Small', price: 100 }],
    };
    const { addonsTotal } = resolveLineAddons(legacy, [NAPKIN], addonsById, SMALL);
    assert.equal(addonsTotal, 5);
});

// ---- per-pairing pricing ----------------------------------------------------
// The price of an add-on is the price of a pairing: cheese on the large is more
// cheese than on the small. These pin the precedence rules. The published price
// of cheese in addonsById is 40, napkins 5.

const PAIRED = {
    name: 'Burger',
    addonIds: [CHEESE],
    variants: [
        { _id: SMALL, name: 'Small', price: 100, addonIds: [CHEESE], addons: [{ addonId: CHEESE, price: 20 }] },
        { _id: LARGE, name: 'Large', price: 200, addonIds: [CHEESE], addons: [{ addonId: CHEESE, price: 60 }] },
    ],
};

check('the same add-on prices differently per variant', () => {
    assert.equal(resolveLineAddons(PAIRED, [CHEESE], addonsById, SMALL).addonsTotal, 20);
    assert.equal(resolveLineAddons(PAIRED, [CHEESE], addonsById, LARGE).addonsTotal, 60);
});

check('a pairing with no price falls back to the published price', () => {
    const dish = {
        name: 'Burger', addonIds: [],
        variants: [{ _id: SMALL, name: 'Small', price: 100, addonIds: [CHEESE], addons: [{ addonId: CHEESE, price: null }] }],
    };
    assert.equal(resolveLineAddons(dish, [CHEESE], addonsById, SMALL).addonsTotal, 40);
});

check('no variant chosen means no override applies', () => {
    const dish = {
        name: 'Burger', addonIds: [NAPKIN],
        variants: [{ _id: SMALL, name: 'Small', price: 100, addonIds: [NAPKIN], addons: [{ addonId: NAPKIN, price: 1 }] }],
    };
    assert.equal(resolveLineAddons(dish, [NAPKIN], addonsById, null).addonsTotal, 5);
});

check('a free pairing (price 0) is honoured, not treated as unset', () => {
    // "Free cheese on the large" is a real offer; 0 must not fall back to 40.
    const dish = {
        name: 'Burger', addonIds: [],
        variants: [{ _id: LARGE, name: 'Large', price: 200, addonIds: [CHEESE], addons: [{ addonId: CHEESE, price: 0 }] }],
    };
    assert.equal(resolveLineAddons(dish, [CHEESE], addonsById, LARGE).addonsTotal, 0);
});

check('an override on one variant never leaks to another', () => {
    assert.equal(resolveVariantAddonPriceOverrides(PAIRED, SMALL).get(CHEESE), 20);
    assert.equal(resolveVariantAddonPriceOverrides(PAIRED, LARGE).get(CHEESE), 60);
});

check('legacy variants with only addonIds still price from the record', () => {
    // Every pairing made before this feature has no addons array at all.
    const legacy = {
        name: 'Pizza', addonIds: [],
        variants: [{ _id: SMALL, name: 'Small', price: 100, addonIds: [CHEESE] }],
    };
    assert.equal(resolveLineAddons(legacy, [CHEESE], addonsById, SMALL).addonsTotal, 40);
});

console.log(failures ? `\n${failures} FAILED` : '\nall variant add-on checks passed');
process.exit(failures ? 1 : 0);
