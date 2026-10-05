/**
 * Self-check for per-item order add-ons.
 * Run: node src/modules/food/shared/__checks__/orderAddons.check.js
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { normalizeRequestedAddonIds, resolveLineAddons } from '../orderAddons.js';

const throws = (fn, re) => assert.throws(fn, (e) => e.name === 'ValidationError' && (!re || re.test(e.message)));

const id = () => new mongoose.Types.ObjectId();
const CHEESE = id();
const BACON = id();
const RAITA = id();

const addonsById = new Map([
    [String(CHEESE), { _id: CHEESE, name: 'Extra Cheese', price: 30 }],
    [String(BACON), { _id: BACON, name: 'Bacon', price: 45.5 }],
    // RAITA deliberately absent: withdrawn, or from another restaurant.
]);

const burger = { name: 'Burger', addonIds: [CHEESE, BACON] };
const shake = { name: 'Shake', addonIds: [] };

// --- request parsing ------------------------------------------------------
assert.deepEqual(normalizeRequestedAddonIds({}), []);
assert.deepEqual(normalizeRequestedAddonIds({ addonIds: [] }), []);
assert.deepEqual(normalizeRequestedAddonIds({ addonIds: [String(CHEESE)] }), [String(CHEESE)]);
// Objects are accepted as well as bare ids, since clients send both shapes.
assert.deepEqual(normalizeRequestedAddonIds({ addons: [{ addonId: String(CHEESE) }] }), [String(CHEESE)]);
assert.deepEqual(normalizeRequestedAddonIds({ addons: [{ _id: String(BACON) }] }), [String(BACON)]);
// A single value, not an array.
assert.deepEqual(normalizeRequestedAddonIds({ addonIds: String(CHEESE) }), [String(CHEESE)]);
// Repeats are a quantity: "Cheese x2" is the id twice, or { addonId, quantity: 2 }.
assert.deepEqual(
    normalizeRequestedAddonIds({ addonIds: [String(CHEESE), String(CHEESE)] }),
    [String(CHEESE), String(CHEESE)]
);
assert.deepEqual(
    normalizeRequestedAddonIds({ addons: [{ addonId: String(CHEESE), quantity: 2 }] }),
    [String(CHEESE), String(CHEESE)]
);
// ...capped, so a broken client cannot pile them up.
assert.equal(normalizeRequestedAddonIds({ addons: [{ addonId: String(CHEESE), quantity: 500 }] }).length, 10);
{
    const { addons, addonsTotal } = resolveLineAddons(burger, [String(CHEESE), String(CHEESE), String(BACON)], addonsById);
    assert.equal(addons.length, 2, 'one entry per add-on');
    assert.equal(addons[0].quantity, 2);
    assert.equal(addonsTotal, 105.5); // 30 x 2 + 45.5
}
throws(() => normalizeRequestedAddonIds({ addonIds: ['not-an-id'] }), /not valid/);

// --- nothing requested, nothing charged ----------------------------------
assert.deepEqual(resolveLineAddons(burger, [], addonsById), { addons: [], addonsTotal: 0 });

// --- the happy path: priced from the published record, not the request ---
{
    const { addons, addonsTotal } = resolveLineAddons(burger, [String(CHEESE)], addonsById);
    assert.equal(addons.length, 1);
    assert.equal(addons[0].name, 'Extra Cheese');
    assert.equal(addons[0].price, 30);
    assert.equal(addonsTotal, 30);
}
{
    const { addonsTotal } = resolveLineAddons(burger, [String(CHEESE), String(BACON)], addonsById);
    assert.equal(addonsTotal, 75.5); // 30 + 45.5, no floating-point dust
}

// --- an add-on this dish does not offer is refused -----------------------
throws(
    () => resolveLineAddons(shake, [String(CHEESE)], addonsById),
    /"Extra Cheese" cannot be added to "Shake"/
);
// An item with an empty list takes NO add-ons -- not "all of them".
throws(() => resolveLineAddons(shake, [String(BACON)], addonsById), /cannot be added/);

// --- an add-on that is not sellable is refused ---------------------------
// Withdrawn, deleted, unapproved, or belonging to another restaurant all arrive
// here the same way: absent from the map.
throws(
    () => resolveLineAddons(burger, [String(RAITA)], addonsById),
    /no longer available for "Burger"/
);

// --- a crafted price in the request is ignored ---------------------------
// resolveLineAddons never reads a price off the request, so this is really a
// statement about the shape: only ids survive normalization.
{
    const requested = normalizeRequestedAddonIds({ addons: [{ addonId: String(CHEESE), price: 0, name: 'Free Cheese' }] });
    const { addons, addonsTotal } = resolveLineAddons(burger, requested, addonsById);
    assert.equal(addons[0].price, 30);            // the published price
    assert.equal(addons[0].name, 'Extra Cheese'); // the published name
    assert.equal(addonsTotal, 30);
}

// --- an item with no addonIds field at all behaves like an empty list ----
throws(() => resolveLineAddons({ name: 'Legacy Dish' }, [String(CHEESE)], addonsById), /cannot be added/);

console.log('All order add-on checks passed.');
