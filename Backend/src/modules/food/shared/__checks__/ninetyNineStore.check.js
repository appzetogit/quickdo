/**
 * Pure-logic checks for the Rs 99 auto-mark rule.
 *
 * Run: node Backend/src/modules/food/shared/__checks__/ninetyNineStore.check.js
 */
import assert from 'node:assert/strict';
import {
    NINETY_NINE_STORE_MAX_PRICE,
    isWithin99Cap,
    shouldAutoMark99,
    crossedInto99Cap,
    resolveNinetyNineCap,
    shouldBackfillInto99Store,
    describeCapChange,
} from '../ninetyNineStore.js';

assert.equal(NINETY_NINE_STORE_MAX_PRICE, 99);

// --- isWithin99Cap ----------------------------------------------------------
assert.equal(isWithin99Cap({ price: 99 }), true, 'exactly 99 is on the shelf');
assert.equal(isWithin99Cap({ price: 99.01 }), false, 'a paisa over is not');
assert.equal(isWithin99Cap({ price: 50 }), true);
assert.equal(isWithin99Cap({ price: 0 }), false, 'unpriced never qualifies');
assert.equal(isWithin99Cap({ price: -5 }), false);
assert.equal(isWithin99Cap({}), false);
assert.equal(isWithin99Cap({ price: 'abc' }), false);

// Variant dishes use their effective (lowest) price, as the shelf filter does.
assert.equal(isWithin99Cap({ variantsEnabled: true, variants: [{ name: 'S', price: 80 }, { name: 'L', price: 150 }] }), true);
assert.equal(isWithin99Cap({ variantsEnabled: true, variants: [{ name: 'S', price: 120 }, { name: 'L', price: 150 }] }), false);
// Variants switched off: the dish's own price decides, whatever the rows say.
assert.equal(isWithin99Cap({ variantsEnabled: false, price: 120, variants: [{ name: 'half', price: 26 }] }), false);

// --- shouldAutoMark99 --------------------------------------------------------
assert.equal(shouldAutoMark99({ approvalStatus: 'approved', price: 60 }), true);
assert.equal(shouldAutoMark99({ approvalStatus: 'approved', price: 160 }), false);
assert.equal(shouldAutoMark99({ approvalStatus: 'pending', price: 60 }), false, 'pending waits for approval');
assert.equal(shouldAutoMark99({ approvalStatus: 'rejected', price: 60 }), false, 'rejected never');
assert.equal(shouldAutoMark99({ price: 60 }), false, 'no status is not approved');

// --- crossedInto99Cap -------------------------------------------------------
// The whole point: a transition, not a state.
assert.equal(crossedInto99Cap({ price: 120 }, { price: 90 }), true, 'crossing in');
assert.equal(crossedInto99Cap({ price: 90 }, { price: 80 }), false, 'already in: no re-tick');
assert.equal(crossedInto99Cap({ price: 90 }, { price: 120 }), false, 'crossing out is not our concern');
assert.equal(crossedInto99Cap({ price: 120 }, { price: 150 }), false, 'still out');
assert.equal(crossedInto99Cap({ price: 120 }, { price: 99 }), true, 'landing exactly on the cap counts');
assert.equal(crossedInto99Cap({}, { price: 50 }), true, 'from unpriced to cheap counts');

// --- a configurable cap -----------------------------------------------------
// Every rule defaults to 99, which is what keeps behaviour identical for callers
// that know nothing about the setting.
assert.equal(resolveNinetyNineCap(59), 59);
assert.equal(resolveNinetyNineCap(0), 99, 'zero is not a price point');
assert.equal(resolveNinetyNineCap(-5), 99);
assert.equal(resolveNinetyNineCap('abc'), 99);
assert.equal(resolveNinetyNineCap(null), 99, 'unset falls back to the old constant');

assert.equal(isWithin99Cap({ price: 70 }, 59), false, 'Rs 70 is off a Rs 59 shelf');
assert.equal(isWithin99Cap({ price: 59 }, 59), true, 'exactly the cap is on it');
assert.equal(isWithin99Cap({ price: 200 }, 250), true, 'and a raised cap admits more');
assert.equal(isWithin99Cap({ price: 70 }), true, 'no cap given still means 99');

assert.equal(shouldAutoMark99({ approvalStatus: 'approved', price: 70 }, 59), false);
assert.equal(shouldAutoMark99({ approvalStatus: 'approved', price: 50 }, 59), true);

// Both sides of a transition are judged against the SAME cap. Judging `before`
// against the old cap and `after` against a new one would make a cap change look
// like a price change on every dish at once.
assert.equal(crossedInto99Cap({ price: 80 }, { price: 50 }, 59), true);
assert.equal(crossedInto99Cap({ price: 50 }, { price: 55 }, 59), false, 'already inside');
assert.equal(crossedInto99Cap({ price: 70 }, { price: 70 }, 59), false, 'outside, and unchanged');

// --- describeCapChange ------------------------------------------------------
// Raising needs a backfill: nothing else is going to touch the newly eligible
// dishes, so the shelf would fill in only as dishes happened to be saved.
assert.deepEqual(describeCapChange(99, 250), { direction: 'raised', needsBackfill: true, before: 99, after: 250 });
// Lowering needs nothing: dishes stop qualifying at read time and leave on their
// own. Their flags are deliberately left alone so raising it back restores the
// shelf -- lowering is a reversible experiment, clearing curation is not.
assert.deepEqual(describeCapChange(99, 59), { direction: 'lowered', needsBackfill: false, before: 99, after: 59 });
assert.deepEqual(describeCapChange(99, 99), { direction: 'unchanged', needsBackfill: false, before: 99, after: 99 });
assert.equal(describeCapChange(null, 59).direction, 'lowered', 'unset counts as the default 99');

// --- shouldBackfillInto99Store ----------------------------------------------
// The reason the exclusion flag exists: a cap rise must not undo curation.
assert.equal(shouldBackfillInto99Store({ approvalStatus: 'approved', price: 150 }, 250), true,
    'newly eligible and never touched');
assert.equal(shouldBackfillInto99Store(
    { approvalStatus: 'approved', price: 150, ninetyNineStoreExcluded: true }, 250), false,
    'an admin removed this by hand; a cap rise must not put it back');
assert.equal(shouldBackfillInto99Store(
    { approvalStatus: 'approved', price: 150, showIn99Store: true }, 250), false,
    'already on the shelf, nothing to do');
assert.equal(shouldBackfillInto99Store({ approvalStatus: 'pending', price: 150 }, 250), false,
    'unapproved never gets flagged');
assert.equal(shouldBackfillInto99Store({ approvalStatus: 'approved', price: 300 }, 250), false,
    'still above the new cap');

console.log('All Rs 99 auto-mark checks passed.');
