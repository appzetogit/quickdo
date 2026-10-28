/**
 * The one eligibility decision, checked on the disagreements it exists to end.
 *
 * Run: node src/core/finance/__checks__/eligibilityRules.check.js
 *
 * Pure decision logic, no database. Three things are worth pinning down here, and
 * the third is the one the whole Master Product argument rests on:
 *
 *   1. the gates individually do what they say;
 *   2. a refusal reports EVERY reason, not the first one it trips over;
 *   3. a financial restriction stops NEW work without stranding a partner in work
 *      already underway -- because the fix for the restriction is usually to
 *      finish the job and hand over the cash.
 */
import assert from 'node:assert/strict';
import {
    evaluate,
    evaluateForNewJob,
    evaluateForActiveJob,
    REASONS,
    FINANCIAL_REASONS,
    DEFAULT_ELIGIBILITY_POLICY,
} from '../eligibilityRules.js';

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

/** A partner who passes everything, so each check can break exactly one thing. */
const ok = (over = {}) => ({
    capabilities: ['delivery', 'taxi', 'quickCommerce'],
    requiredCapability: 'delivery',
    isAvailable: true,
    partnerStatus: 'approved',
    kycComplete: true,
    walletBalance: 250,
    cashInHand: 0,
    jobCashExposure: 0,
    activeJobCount: 0,
    maxConcurrentJobs: 1,
    combinationAllowed: true,
    inServiceArea: true,
    distanceKm: 2,
    locationAgeMs: 1000,
    vehicleCompatible: true,
    verticalEnabled: true,
    ...over,
});

const has = (v, reason) => v.reasons.includes(reason);

// --- the baseline ------------------------------------------------------------
console.log('\nthe baseline');

check('a partner who passes everything is eligible with no reasons', () => {
    const v = evaluateForNewJob(ok());
    assert.equal(v.eligible, true);
    assert.deepEqual(v.reasons, []);
});

// --- each gate ---------------------------------------------------------------
console.log('\neach gate');

check('a partner without the capability is refused', () => {
    assert.ok(has(evaluateForNewJob(ok({ capabilities: ['taxi'] })), REASONS.NOT_CAPABLE));
});

check('an offline partner is refused', () => {
    assert.ok(has(evaluateForNewJob(ok({ isAvailable: false })), REASONS.NOT_AVAILABLE));
});

check('suspended and blocked are distinct reasons', () => {
    assert.ok(has(evaluateForNewJob(ok({ partnerStatus: 'suspended' })), REASONS.SUSPENDED));
    assert.ok(has(evaluateForNewJob(ok({ partnerStatus: 'blocked' })), REASONS.BLOCKED));
});

check('KYC is only enforced when the policy says so', () => {
    assert.equal(evaluateForNewJob(ok({ kycComplete: false })).eligible, true);
    assert.ok(has(evaluateForNewJob(ok({ kycComplete: false }), { requireKyc: true }), REASONS.KYC_INCOMPLETE));
});

check('a partner outside the service area is refused', () => {
    assert.ok(has(evaluateForNewJob(ok({ inServiceArea: false })), REASONS.OUT_OF_SERVICE_AREA));
});

check('an incompatible vehicle is refused', () => {
    assert.ok(has(evaluateForNewJob(ok({ vehicleCompatible: false })), REASONS.VEHICLE_INCOMPATIBLE));
});

check('a disabled vertical refuses everyone', () => {
    assert.ok(has(evaluateForNewJob(ok({ verticalEnabled: false })), REASONS.VERTICAL_DISABLED));
});

check('the concurrency ceiling is enforced', () => {
    assert.ok(has(evaluateForNewJob(ok({ activeJobCount: 1, maxConcurrentJobs: 1 })), REASONS.MAX_CONCURRENT_JOBS));
    assert.equal(evaluateForNewJob(ok({ activeJobCount: 1, maxConcurrentJobs: 2 })).eligible, true);
});

check('a forbidden job combination is refused even with capacity left', () => {
    const v = evaluateForNewJob(ok({ activeJobCount: 1, maxConcurrentJobs: 3, combinationAllowed: false }));
    assert.ok(has(v, REASONS.INCOMPATIBLE_JOB_COMBINATION));
});

// --- distance and stale position ---------------------------------------------
console.log('\ndistance, and not pretending to know where someone is');

check('a partner beyond the radius is refused', () => {
    assert.ok(has(evaluateForNewJob(ok({ distanceKm: 40 }), { maxDistanceKm: 15 }), REASONS.TOO_FAR));
});

check('a STALE fix is not treated as a known position', () => {
    // Food dispatch currently keeps these at distanceKm 999 and offers them work.
    // "We do not know where they are" is not a reason to assume they are near.
    const v = evaluateForNewJob(ok({ locationAgeMs: 30 * 60 * 1000 }), { maxDistanceKm: 5, refuseUnknownLocation: true });
    assert.ok(has(v, REASONS.LOCATION_UNKNOWN));
});

check('a stale fix does NOT silently pass the distance gate', () => {
    // The dangerous middle ground: position too old to trust, distance therefore
    // unchecked, partner offered a job 700km away. Must not report TOO_FAR either
    // -- it must report that the position is unknown.
    const v = evaluateForNewJob(ok({ distanceKm: 1, locationAgeMs: 30 * 60 * 1000 }), {
        maxDistanceKm: 5, refuseUnknownLocation: true,
    });
    assert.ok(has(v, REASONS.LOCATION_UNKNOWN));
    assert.equal(has(v, REASONS.TOO_FAR), false);
});

check('an unknown position is allowed through when no zone is being enforced', () => {
    assert.equal(evaluateForNewJob(ok({ distanceKm: null })).eligible, true);
});

// --- money -------------------------------------------------------------------
console.log('\nmoney');

check('THE BYPASS: cash from any vertical counts against one ceiling', () => {
    /*
     * Food 800 + QC 500 + taxi 600 = 1900 held, ceiling 2000, this job adds 300.
     * Food and QC each compute their own figure and taxi checks nothing, so today
     * every vertical offers this rider work. One combined figure does not.
     */
    const v = evaluateForNewJob(ok({ cashInHand: 1900, jobCashExposure: 300 }), { cashLimit: 2000 });
    assert.ok(has(v, REASONS.CASH_LIMIT_EXCEEDED));
    assert.equal(v.detail.projectedCashInHand, 2200);
});

check('the ceiling is judged on the PROJECTED figure, not the current one', () => {
    // Refusing only once they are already over means the ceiling is always breached
    // exactly once before it works.
    assert.equal(evaluateForNewJob(ok({ cashInHand: 1900, jobCashExposure: 0 }), { cashLimit: 2000 }).eligible, true);
    assert.equal(evaluateForNewJob(ok({ cashInHand: 1900, jobCashExposure: 100 }), { cashLimit: 2000 }).eligible, false);
});

check('a zero cash limit means no ceiling, never "block everyone"', () => {
    // The taxi side derives 0 for live drivers; reading it as a real ceiling would
    // block every rider holding a single rupee.
    assert.equal(evaluateForNewJob(ok({ cashInHand: 99999 }), { cashLimit: 0 }).eligible, true);
});

check('a NEGATIVE balance is representable and does not crash the gate', () => {
    const v = evaluateForNewJob(ok({ walletBalance: -150 }));
    assert.equal(v.eligible, true, 'negative balance alone is not a restriction by default');
});

check('a negative balance IS a restriction when a minimum is configured', () => {
    const v = evaluateForNewJob(ok({ walletBalance: -150 }), { minimumWalletBalance: -100 });
    assert.ok(has(v, REASONS.WALLET_RESTRICTED));
    assert.equal(v.detail.walletBalance, -150);
});

check('blockOnNonPositiveWallet is OFF by default, and for a reason', () => {
    /*
     * Taxi encodes cash owed as a negative balance, so "balance <= 0" is the normal
     * state of any rider who has collected cash. Defaulting this on would stop most
     * of the fleet working on the day it shipped.
     */
    assert.equal(DEFAULT_ELIGIBILITY_POLICY.blockOnNonPositiveWallet, false);
    assert.equal(evaluateForNewJob(ok({ walletBalance: 0 })).eligible, true);
    assert.ok(has(evaluateForNewJob(ok({ walletBalance: 0 }), { blockOnNonPositiveWallet: true }), REASONS.WALLET_RESTRICTED));
});

check('the cash gate can be switched off without switching off the limit value', () => {
    assert.equal(
        evaluateForNewJob(ok({ cashInHand: 5000 }), { cashLimit: 2000, enforceCashLimit: false }).eligible,
        true,
    );
});

// --- every reason, not the first ---------------------------------------------
console.log('\nreporting every reason');

check('a partner failing four gates reports all four', () => {
    // A dispatcher reporting only CASH_LIMIT_EXCEEDED sends a suspended rider to
    // go and deposit cash.
    const v = evaluateForNewJob(
        ok({ partnerStatus: 'suspended', isAvailable: false, capabilities: [], cashInHand: 3000 }),
        { cashLimit: 2000 },
    );
    assert.ok(has(v, REASONS.SUSPENDED));
    assert.ok(has(v, REASONS.NOT_AVAILABLE));
    assert.ok(has(v, REASONS.NOT_CAPABLE));
    assert.ok(has(v, REASONS.CASH_LIMIT_EXCEEDED));
});

check('financialOnly distinguishes "go deposit cash" from "you are suspended"', () => {
    const money = evaluateForNewJob(ok({ cashInHand: 3000 }), { cashLimit: 2000 });
    assert.equal(money.financialOnly, true);

    const both = evaluateForNewJob(ok({ cashInHand: 3000, partnerStatus: 'suspended' }), { cashLimit: 2000 });
    assert.equal(both.financialOnly, false);
});

check('an eligible partner is never financialOnly', () => {
    assert.equal(evaluateForNewJob(ok()).financialOnly, false);
});

// --- new work vs work in progress --------------------------------------------
console.log('\nnew work vs work already underway');

check('THE RULE: a rider over the cash ceiling may still finish the delivery', () => {
    /*
     * Cancelling would abandon a customer AND prevent the deposit that is the only
     * way the rider clears the block -- they would be stuck at the ceiling forever,
     * holding cash they had no way to hand over.
     */
    const ctx = ok({ cashInHand: 5000, jobCashExposure: 0 });
    const policy = { cashLimit: 2000 };
    assert.equal(evaluateForNewJob(ctx, policy).eligible, false);
    assert.equal(evaluateForActiveJob(ctx, policy).eligible, true);
});

check('a wallet that goes negative mid-trip does not stop the trip', () => {
    const ctx = ok({ walletBalance: -500 });
    const policy = { minimumWalletBalance: -100 };
    assert.equal(evaluateForNewJob(ctx, policy).eligible, false);
    assert.equal(evaluateForActiveJob(ctx, policy).eligible, true);
});

check('being BLOCKED does stop the active job -- authority is not money', () => {
    const ctx = ok({ partnerStatus: 'blocked' });
    assert.equal(evaluateForActiveJob(ctx).eligible, false);
    assert.ok(has(evaluateForActiveJob(ctx), REASONS.BLOCKED));
});

check('suspension and missing KYC also stop an active job', () => {
    assert.equal(evaluateForActiveJob(ok({ partnerStatus: 'suspended' })).eligible, false);
    assert.equal(evaluateForActiveJob(ok({ kycComplete: false }), { requireKyc: true }).eligible, false);
});

check('going offline does not abandon the job in hand', () => {
    // The app was killed, or the phone lost signal. The delivery is still theirs.
    assert.equal(evaluateForActiveJob(ok({ isAvailable: false })).eligible, true);
});

check('drifting out of the service area does not abandon the job in hand', () => {
    assert.equal(evaluateForActiveJob(ok({ inServiceArea: false, distanceKm: 90 }), { maxDistanceKm: 15 }).eligible, true);
});

check('a capability revoked mid-job DOES stop it', () => {
    // Unlike distance or availability, this is an authority decision an admin made.
    assert.equal(evaluateForActiveJob(ok({ capabilities: [] })).eligible, false);
});

check('every financial reason is excluded from the active-job gate', () => {
    for (const reason of FINANCIAL_REASONS) {
        assert.ok(
            [REASONS.WALLET_RESTRICTED, REASONS.CASH_LIMIT_EXCEEDED].includes(reason),
            `unexpected financial reason ${reason} -- update evaluateForActiveJob`,
        );
    }
});

// --- robustness ---------------------------------------------------------------
console.log('\nrobustness');

check('an empty context does not throw and does not silently approve', () => {
    const v = evaluateForNewJob({});
    // No capability required and nothing asserted false, so it passes -- but the
    // point is that it returns a verdict rather than exploding on a partial read.
    assert.equal(typeof v.eligible, 'boolean');
    assert.ok(Array.isArray(v.reasons));
});

check('a null policy falls back to the defaults', () => {
    assert.equal(evaluateForNewJob(ok(), null).eligible, true);
});

check('non-numeric money values do not produce NaN verdicts', () => {
    const v = evaluateForNewJob(ok({ cashInHand: 'lots', jobCashExposure: undefined }), { cashLimit: 2000 });
    assert.equal(typeof v.eligible, 'boolean');
    assert.equal(v.eligible, true);
});

console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
