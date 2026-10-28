/**
 * Which jobs one person may hold at once -- the cross-vertical matrix the whole
 * Master Product argument rests on.
 *
 * Run: node src/core/assignment/__checks__/assignmentRules.check.js
 *
 * Pure policy, no database. These are the tests the brief asks for by name:
 * Food+Food, Food+QC, Food+Taxi, Taxi+Taxi, Taxi+SP, QC+Taxi -- each asserted
 * against its configured rule rather than against an assumption baked into the
 * schema. The claim FILTER is checked too, because the filter is the security
 * boundary: a rule that is not in the query is a rule that is applied too late.
 */
import assert from 'node:assert/strict';
import {
    canAccept,
    forbiddenAlongside,
    JOB_TYPES,
    ALL_JOB_TYPES,
    DEFAULT_POLICY,
    EXAMPLE_STACKING_POLICY,
} from '../assignmentRules.js';
import { buildClaimFilter, buildReleaseFilter, jobTypeOf } from '../assignment.service.js';

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

const held = (...types) => types.map((t, i) => ({ jobType: t, jobId: `job_${i}` }));
const incoming = (type, id = 'new_job') => ({ jobType: type, jobId: id });
const { FOOD_DELIVERY: FOOD, QUICK_COMMERCE_DELIVERY: QC, TAXI_RIDE: TAXI, SERVICE_BOOKING: SP } = JOB_TYPES;

// --- the default: one job, exactly as today ---------------------------------
console.log('\ndefault policy reproduces today: one job, no stacking');

check('a free partner may take anything', () => {
    for (const t of ALL_JOB_TYPES) {
        assert.equal(canAccept([], incoming(t)).allowed, true, `${t} refused when free`);
    }
});

check('THE LIVE HOLE: a partner on a QC order may not be given a taxi ride', () => {
    // This is what quick-commerce never enforced -- it filtered on the lock but
    // never took it, so the rider read as free to food and taxi alike.
    const v = canAccept(held(QC), incoming(TAXI));
    assert.equal(v.allowed, false);
    assert.equal(v.reason, 'MAX_CONCURRENT_JOBS');
});

check('a partner on a QC order may not be given a food order', () => {
    assert.equal(canAccept(held(QC), incoming(FOOD)).allowed, false);
});

check('a partner on a taxi ride may not be given a QC order', () => {
    assert.equal(canAccept(held(TAXI), incoming(QC)).allowed, false);
});

check('every pairing is refused under the default policy', () => {
    for (const a of ALL_JOB_TYPES) {
        for (const b of ALL_JOB_TYPES) {
            assert.equal(canAccept(held(a), incoming(b)).allowed, false, `${a} + ${b} was allowed`);
        }
    }
});

// --- idempotency -------------------------------------------------------------
console.log('\nholding the same job twice is success, not conflict');

check('re-claiming the job you already hold succeeds and is flagged idempotent', () => {
    // A double-tap, a retry, a second device. Reporting a conflict here tells the
    // rider "you are already on another job" about the job they just accepted.
    const current = [{ jobType: FOOD, jobId: 'order_1' }];
    const v = canAccept(current, incoming(FOOD, 'order_1'));
    assert.equal(v.allowed, true);
    assert.equal(v.idempotent, true);
});

check('a DIFFERENT job of the same type is still refused', () => {
    const current = [{ jobType: FOOD, jobId: 'order_1' }];
    assert.equal(canAccept(current, incoming(FOOD, 'order_2')).allowed, false);
});

check('an id compares by value, not by reference', () => {
    const oid = { toString: () => 'order_1' };
    assert.equal(canAccept([{ jobType: FOOD, jobId: oid }], incoming(FOOD, 'order_1')).idempotent, true);
});

// --- stacking, when a policy actually permits it ----------------------------
console.log('\nstacking is representable, and honoured when configured');

check('Food + Food stacks under the example policy', () => {
    assert.equal(canAccept(held(FOOD), incoming(FOOD), EXAMPLE_STACKING_POLICY).allowed, true);
});

check('Food + QC stacks under the example policy', () => {
    assert.equal(canAccept(held(FOOD), incoming(QC), EXAMPLE_STACKING_POLICY).allowed, true);
    assert.equal(canAccept(held(QC), incoming(FOOD), EXAMPLE_STACKING_POLICY).allowed, true);
});

check('Food + Taxi does NOT stack, even under the stacking policy', () => {
    const v = canAccept(held(FOOD), incoming(TAXI), EXAMPLE_STACKING_POLICY);
    assert.equal(v.allowed, false);
    assert.equal(v.reason, 'INCOMPATIBLE_JOB_COMBINATION');
});

check('a passenger in the car blocks everything', () => {
    // The constraint is not time or distance: there is a person in the vehicle
    // expecting to go where they asked.
    for (const t of ALL_JOB_TYPES) {
        assert.equal(canAccept(held(TAXI), incoming(t), EXAMPLE_STACKING_POLICY).allowed, false, `taxi + ${t}`);
    }
});

check('Taxi + SP does not stack', () => {
    assert.equal(canAccept(held(TAXI), incoming(SP), EXAMPLE_STACKING_POLICY).allowed, false);
    assert.equal(canAccept(held(SP), incoming(TAXI), EXAMPLE_STACKING_POLICY).allowed, false);
});

check('the concurrency ceiling still binds once the combination is legal', () => {
    const two = held(FOOD, QC);
    const v = canAccept(two, incoming(FOOD), EXAMPLE_STACKING_POLICY);
    assert.equal(v.allowed, false);
    assert.equal(v.reason, 'MAX_CONCURRENT_JOBS');
});

check('compatibility is checked against EVERY held job, not just the first', () => {
    const policy = {
        maxConcurrentJobs: 3,
        allowedCombinations: {
            [FOOD]: [FOOD, QC], [QC]: [QC, FOOD], [TAXI]: [], [SP]: [],
        },
    };
    // Legal so far...
    assert.equal(canAccept(held(FOOD, QC), incoming(FOOD), policy).allowed, true);
    // ...but one incompatible job anywhere in the list must refuse.
    const withTaxi = [{ jobType: FOOD, jobId: 'a' }, { jobType: TAXI, jobId: 'b' }];
    assert.equal(canAccept(withTaxi, incoming(FOOD), policy).allowed, false);
});

check('an asymmetric policy is refused in both directions', () => {
    // Otherwise arrival order decides whether a pairing is legal -- exactly the
    // race this exists to remove.
    const lopsided = {
        maxConcurrentJobs: 2,
        allowedCombinations: { [FOOD]: [TAXI], [TAXI]: [], [QC]: [], [SP]: [] },
    };
    assert.equal(canAccept(held(TAXI), incoming(FOOD), lopsided).allowed, false);
    assert.equal(canAccept(held(FOOD), incoming(TAXI), lopsided).allowed, false);
});

// --- bad input fails closed --------------------------------------------------
console.log('\nbad input fails closed');

check('an unknown job type is refused, never assumed compatible', () => {
    assert.equal(canAccept([], { jobType: 'teleportation', jobId: 'x' }).reason, 'UNKNOWN_JOB_TYPE');
});

check('a missing job id is refused', () => {
    assert.equal(canAccept([], { jobType: FOOD, jobId: null }).reason, 'INVALID_JOB');
    assert.equal(canAccept([], { jobType: FOOD, jobId: '' }).reason, 'INVALID_JOB');
});

check('a malformed current-assignment list does not crash the gate', () => {
    assert.equal(canAccept(null, incoming(FOOD)).allowed, true);
    assert.equal(canAccept(undefined, incoming(FOOD)).allowed, true);
});

// --- the claim filter IS the rule -------------------------------------------
console.log('\nthe claim filter carries the rule into the database');

check('the filter refuses a driver whose LEGACY lock is set', () => {
    // A driver locked before this module has activeAssignment set and no array.
    // $size of a missing array is 0, so without the legacy guard they would read
    // as free and be double-booked by the very code meant to prevent it.
    const f = buildClaimFilter('d1', { jobType: FOOD, jobId: 'j1' }, DEFAULT_POLICY);
    const capacity = f.$or[2];
    assert.deepEqual(capacity.$or, [{ activeAssignment: null }, { activeAssignment: { $exists: false } }]);
});

check('the legacy guard is dropped once stacking is enabled', () => {
    // Keeping it would make the mirror (non-null whenever holding anything)
    // forbid every second job and silently disable the stacking just configured.
    const f = buildClaimFilter('d1', { jobType: FOOD, jobId: 'j1' }, EXAMPLE_STACKING_POLICY);
    assert.equal(f.$or[2].$or, undefined);
});

check('the filter allows an idempotent re-claim from either storage shape', () => {
    const f = buildClaimFilter('d1', { jobType: FOOD, jobId: 'j1' }, DEFAULT_POLICY);
    assert.deepEqual(f.$or[0], { 'activeAssignments.jobId': 'j1' });
    assert.deepEqual(f.$or[1], { 'activeAssignment.id': 'j1' });
});

check('the filter encodes the concurrency ceiling, not just the combination', () => {
    const f = buildClaimFilter('d1', { jobType: FOOD, jobId: 'j1' }, EXAMPLE_STACKING_POLICY);
    assert.deepEqual(f.$or[2].$expr, { $lt: [{ $size: { $ifNull: ['$activeAssignments', []] } }, 2] });
});

check('the filter forbids exactly the incompatible types', () => {
    const f = buildClaimFilter('d1', { jobType: FOOD, jobId: 'j1' }, EXAMPLE_STACKING_POLICY);
    assert.deepEqual(f.$or[2]['activeAssignments.jobType'].$nin.sort(), [SP, TAXI].sort());
});

check('under the default policy a job is forbidden alongside everything', () => {
    for (const t of ALL_JOB_TYPES) {
        assert.deepEqual(forbiddenAlongside(t, DEFAULT_POLICY).sort(), [...ALL_JOB_TYPES].sort());
    }
});

check('a release only matches a driver who actually holds that job', () => {
    /*
     * Regression. The release pipeline re-derives the legacy mirror from the
     * array, so an unguarded filter made releasing a job the driver does NOT hold
     * destructive: array untouched, mirror rewritten from an empty array to null,
     * clearing a live lock held by a different job. A late release from a finished
     * order would have freed a driver who had since been claimed for a new one.
     */
    const f = buildReleaseFilter('d1', 'j1');
    assert.equal(f._id, 'd1');
    assert.deepEqual(f.$or, [{ 'activeAssignments.jobId': 'j1' }, { 'activeAssignment.id': 'j1' }]);
});

check('a release matches a lock held in the legacy field alone', () => {
    // Drivers locked before this module have no array at all; their lock must
    // still be releasable, or reconcile can never free them.
    const f = buildReleaseFilter('d1', 'j1');
    assert.ok(f.$or.some((c) => c['activeAssignment.id'] === 'j1'));
});

check('every vertical maps to a job type', () => {
    assert.equal(jobTypeOf('food'), FOOD);
    assert.equal(jobTypeOf('quickCommerce'), QC);
    assert.equal(jobTypeOf('taxi'), TAXI);
    assert.equal(jobTypeOf('serviceProvider'), SP);
    assert.equal(jobTypeOf('nonsense'), null);
});

console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
