/**
 * Two mongoose schemas, one `users` collection -- what actually happens.
 *
 * Run: node src/core/users/__checks__/sharedUsersCollection.check.js
 *
 * `core/users/user.model.js` declares `collection: 'users'`. So does
 * `modules/taxi/user/models/User.js`. They share 24 identity fields and diverge
 * additively: food alone has `isBlockedFromCOD`; taxi alone has `password`,
 * `status`, `active`, `deletedAt`, `deletionRequest`, `currentRideId`,
 * `pending_cancellation_due`, `referredRideCompletionCount`,
 * `referralRewardGrantedAt`.
 *
 * The audit hypothesised that this silently destroys data -- that a document
 * loaded by one schema and saved drops the other's fields, because mongoose's
 * default `strict` mode does not hydrate unknown paths.
 *
 * THAT HYPOTHESIS IS WORTH TESTING BEFORE IT IS ACTED ON, because the two
 * possible answers call for very different work: if a `save()` on a loaded
 * document destroys fields, this is a P0 needing an urgent shared schema; if
 * mongoose only sends a delta of the paths it changed, the unknown fields survive
 * and this is a latent P2 about specific write STYLES, not about sharing a
 * collection at all.
 *
 * No database: mongoose builds the update it WOULD send without one, which is
 * exactly the artefact in question.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

let failed = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

// Minimal stand-ins carrying the real divergence, so this check does not drag the
// whole app's imports (and its mongoose model registry) into a unit test.
const shared = {
    phone: { type: String, required: true },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
};

const FoodLike = mongoose.model(
    'CheckFoodUser',
    new mongoose.Schema({ ...shared, isBlockedFromCOD: { type: Boolean, default: false } }, { collection: 'users' }),
);

const TaxiLike = mongoose.model(
    'CheckTaxiUser',
    new mongoose.Schema(
        {
            ...shared,
            password: { type: String, default: '' },
            status: { type: String, default: 'active' },
            currentRideId: { type: mongoose.Schema.Types.ObjectId, default: null },
        },
        { collection: 'users' },
    ),
);

/** A row as it exists in `users`: written by taxi, carrying both verticals' fields. */
const storedRow = () => ({
    _id: new mongoose.Types.ObjectId(),
    phone: '9876543210',
    name: 'Asha',
    email: 'asha@example.com',
    isActive: true,
    isBlockedFromCOD: true,               // food's
    password: 'hashed-secret',            // taxi's
    status: 'active',                     // taxi's
    currentRideId: new mongoose.Types.ObjectId(), // taxi's
});

// --- what each schema can even see ------------------------------------------
console.log('\nwhat each schema sees of a shared row');

check('hydrate RETAINS the other vertical\'s fields rather than discarding them', () => {
    /*
     * Not what I expected, and it matters: `hydrate` marks a plain object as an
     * existing document without running it through strict-mode casting, so paths
     * the schema never declared are carried along in the document rather than
     * dropped. A read-modify-save therefore cannot lose them even in principle --
     * they are still there to be written back.
     *
     * This is the opposite of `new Model(row)` below, and the difference between
     * the two is the entire risk surface.
     */
    const asFood = FoodLike.hydrate(storedRow());
    assert.equal(asFood.get('password'), 'hashed-secret');
    assert.equal(asFood.isBlockedFromCOD, true);

    const asTaxi = TaxiLike.hydrate(storedRow());
    assert.equal(asTaxi.get('isBlockedFromCOD'), true);
    assert.equal(asTaxi.password, 'hashed-secret');
});

check('a typed path of the other vertical is still not usable through the wrong schema', () => {
    // Retained as raw data, but not a schema path: assigning it would not be cast
    // or validated, so cross-vertical WRITES still belong to the owning schema.
    assert.equal(FoodLike.schema.path('password'), undefined);
    assert.equal(TaxiLike.schema.path('isBlockedFromCOD'), undefined);
});

// --- THE question: does saving through one schema destroy the other's data? --
console.log('\ndoes a save through one schema destroy the other schema\'s fields?');

check('an UPDATE sends only the changed path -- no $unset of foreign fields', () => {
    /*
     * This is the finding. mongoose 8 issues an update built from modifiedPaths,
     * not a whole-document replace, so fields it never hydrated are simply not
     * mentioned and survive untouched in the database.
     */
    const doc = TaxiLike.hydrate(storedRow());
    doc.name = 'Asha K';
    const delta = doc.getChanges();

    assert.deepEqual(Object.keys(delta), ['$set'], `expected only $set, got ${JSON.stringify(delta)}`);
    assert.deepEqual(delta.$set, { name: 'Asha K' });
    assert.equal(delta.$unset, undefined);
});

check('the same is true saving through the food schema', () => {
    const doc = FoodLike.hydrate(storedRow());
    doc.isBlockedFromCOD = false;
    const delta = doc.getChanges();
    assert.deepEqual(Object.keys(delta), ['$set']);
    assert.equal('password' in (delta.$set || {}), false);
    assert.equal(delta.$unset, undefined);
});

check('a no-op save writes nothing at all', () => {
    const doc = FoodLike.hydrate(storedRow());
    assert.deepEqual(doc.getChanges(), {});
});

// --- the write styles that WOULD destroy data --------------------------------
console.log('\nthe write styles that would destroy it (none of which are in use on users)');

check('constructing a NEW document from a stored row drops the other vertical', () => {
    /*
     * `new Model(row)` is not an update, it is a fresh document -- strict mode
     * discards paths the schema does not declare. Saving one of these over an
     * existing _id is the write style that loses data, which is why the rule is
     * about HOW `users` is written, not about the collection being shared.
     */
    const rebuilt = new FoodLike(storedRow()).toObject();
    assert.equal(rebuilt.password, undefined);
    assert.equal(rebuilt.currentRideId, undefined);
    assert.equal(rebuilt.isBlockedFromCOD, true);
});

check('replaceOne-shaped payloads would drop it too', () => {
    // Documented here so the invariant is stated, not just implied: any
    // replace/overwrite against `users` must be built from a schema that knows
    // every vertical's fields.
    const payload = new TaxiLike(storedRow()).toObject();
    assert.equal(payload.isBlockedFromCOD, undefined);
});

// --- the shared constraint ---------------------------------------------------
console.log('\nthe constraint both schemas must keep agreeing about');

check('both schemas declare the same collection', () => {
    assert.equal(FoodLike.collection.collectionName, 'users');
    assert.equal(TaxiLike.collection.collectionName, 'users');
});

console.log(
    '\nVERDICT: sharing the `users` collection does NOT corrupt data on ordinary\n'
    + 'save()/update paths -- mongoose sends a delta, and unhydrated fields survive.\n'
    + 'The risk is real but narrow: `new Model(storedRow)` and replace/overwrite\n'
    + 'writes. P0-1 is therefore a P2 (a write-style rule plus a shared schema for\n'
    + 'clarity), not an emergency migration.\n',
);

console.log(failed ? `${failed} check(s) failed\n` : 'all checks passed\n');
process.exit(failed ? 1 : 0);
