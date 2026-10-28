/**
 * May this partner be given this job? One answer, for every vertical.
 *
 * Today there are three, and they disagree about both the arithmetic and the
 * moment it is applied:
 *
 *   food  order-dispatch.service.js:197  recomputes cash-in-hand from delivered
 *                                        orders minus completed deposits, clamps
 *                                        at zero, compares against FoodFeeSettings.
 *                                        Applied at DISPATCH. Never reads taxi.
 *   QC    order-dispatch.service.js:255  reads a STORED wallet.cashInHand field.
 *                                        Different number, different source, same
 *                                        business rule. Applied at DISPATCH.
 *   taxi  matchingService.js:80          filters on the cached wallet.isBlocked
 *                                        flag only; the real check happens in
 *                                        ensureDriverWalletCanAcceptRide at ACCEPT.
 *                                        No cash gate at candidate selection.
 *   SP                                   nothing.
 *
 * So a rider at the cash ceiling from food deliveries is still offered rides, and
 * an admin who changes the cash limit changes it for one vertical.
 *
 * This module is the decision, kept pure: no database, no models, no express. It
 * takes a fully-gathered context and returns a verdict. The service beside it does
 * the gathering. That split is what lets the whole matrix be checked, and it is
 * also what lets every vertical consume the SAME decision rather than a similar one.
 *
 * ---------------------------------------------------------------------------
 * NEW WORK vs WORK IN PROGRESS -- the distinction the brief asks for.
 *
 * A financial restriction must stop a partner being given the NEXT job. It must
 * NOT strand them in the one they are already doing. If a rider goes over the cash
 * ceiling halfway through a delivery, cancelling it would abandon a customer and
 * -- worse -- prevent the deposit that is the only way the rider clears the block.
 * The same is true of a wallet that goes negative mid-trip.
 *
 * So there are two entry points, deliberately not one function with a boolean:
 *
 *   evaluateForNewJob    every gate applies
 *   evaluateForActiveJob only gates about SAFETY and AUTHORITY apply
 *                        (blocked, suspended, KYC) -- never money
 *
 * A boolean parameter would make the caller's intent invisible at the call site,
 * which is exactly where it needs to be obvious.
 */

/** Why a partner was refused. Machine-readable: dispatchers log these, admins read them. */
export const REASONS = Object.freeze({
    NOT_CAPABLE: 'NOT_CAPABLE',
    NOT_AVAILABLE: 'NOT_AVAILABLE',
    SUSPENDED: 'SUSPENDED',
    BLOCKED: 'BLOCKED',
    KYC_INCOMPLETE: 'KYC_INCOMPLETE',
    OUT_OF_SERVICE_AREA: 'OUT_OF_SERVICE_AREA',
    TOO_FAR: 'TOO_FAR',
    LOCATION_UNKNOWN: 'LOCATION_UNKNOWN',
    VEHICLE_INCOMPATIBLE: 'VEHICLE_INCOMPATIBLE',
    WALLET_RESTRICTED: 'WALLET_RESTRICTED',
    CASH_LIMIT_EXCEEDED: 'CASH_LIMIT_EXCEEDED',
    MAX_CONCURRENT_JOBS: 'MAX_CONCURRENT_JOBS',
    INCOMPATIBLE_JOB_COMBINATION: 'INCOMPATIBLE_JOB_COMBINATION',
    VERTICAL_DISABLED: 'VERTICAL_DISABLED',
});

/** The gates that are about money. These never apply to a job already in progress. */
export const FINANCIAL_REASONS = Object.freeze([REASONS.WALLET_RESTRICTED, REASONS.CASH_LIMIT_EXCEEDED]);

export const DEFAULT_ELIGIBILITY_POLICY = Object.freeze({
    /**
     * Whether a zero-or-negative wallet balance stops new work.
     *
     * Off by default, and that is not timidity: taxi encodes cash owed as a
     * NEGATIVE balance, so for that vertical "balance <= 0" is the normal state of
     * a rider who has collected any cash at all. Switching this on platform-wide
     * before the ledger lands would stop most of the taxi fleet working. The cash
     * ceiling below is the gate that actually means something today.
     */
    blockOnNonPositiveWallet: false,
    /** Below this signed balance, no new work. Negative because taxi debt is signed. */
    minimumWalletBalance: null,
    /** Refuse when projected cash in hand would reach the ceiling. 0 = no ceiling. */
    cashLimit: 0,
    enforceCashLimit: true,
    maxDistanceKm: null,
    /** How old a GPS fix may be before position counts as unknown. */
    staleLocationMs: 10 * 60 * 1000,
    /** Whether an unknown position is refused. Zone enforcement makes this matter. */
    refuseUnknownLocation: false,
    requireKyc: false,
});

/*
 * "Is this a number I may compare against?" -- and null is not one.
 *
 * `Number.isFinite(Number(v))` alone says yes to null, '' and false, because
 * Number() coerces all three to 0. Every "unset" policy value in this file is
 * null, so that reading turned `maxDistanceKm: null` into a ceiling of ZERO
 * kilometres and refused every partner who was not standing on the restaurant,
 * and `minimumWalletBalance: null` into "block any balance at or below 0" --
 * which, given taxi encodes cash owed as a negative balance, would have blocked
 * most of the fleet. An unset limit must mean no limit.
 */
const isNum = (v) => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * @param {object} ctx  everything already gathered. No lookups happen in here.
 * @param {string[]} ctx.capabilities        e.g. ['taxi','delivery']
 * @param {string}   ctx.requiredCapability  what this job needs
 * @param {boolean}  ctx.isAvailable         online / on duty
 * @param {string}   ctx.partnerStatus       'approved' | 'pending' | 'suspended' | 'blocked'
 * @param {boolean}  ctx.kycComplete
 * @param {number}   ctx.walletBalance       SIGNED. may be negative.
 * @param {number}   ctx.cashInHand          combined, all verticals
 * @param {number}   ctx.jobCashExposure     cash this job would add
 * @param {number}   ctx.activeJobCount
 * @param {number}   ctx.maxConcurrentJobs
 * @param {boolean}  ctx.combinationAllowed
 * @param {boolean}  ctx.inServiceArea
 * @param {number}   ctx.distanceKm
 * @param {number}   ctx.locationAgeMs
 * @param {boolean}  ctx.vehicleCompatible
 * @param {boolean}  ctx.verticalEnabled
 * @param {object} policy
 * @returns {{eligible: boolean, reasons: string[], financialOnly: boolean, detail: object}}
 *
 * ALL failing reasons are returned, not the first. A dispatcher that reports only
 * "CASH_LIMIT_EXCEEDED" sends a rider to deposit cash when they are also suspended;
 * an admin asking "why is nobody being offered this order" needs the whole picture.
 */
export function evaluate(ctx = {}, policy = DEFAULT_ELIGIBILITY_POLICY) {
    const p = { ...DEFAULT_ELIGIBILITY_POLICY, ...(policy || {}) };
    const reasons = [];
    const detail = {};

    // --- authority: may this person work at all -----------------------------
    if (ctx.verticalEnabled === false) reasons.push(REASONS.VERTICAL_DISABLED);

    const status = String(ctx.partnerStatus || '').toLowerCase();
    if (status === 'blocked') reasons.push(REASONS.BLOCKED);
    if (status === 'suspended') reasons.push(REASONS.SUSPENDED);

    if (p.requireKyc && ctx.kycComplete === false) reasons.push(REASONS.KYC_INCOMPLETE);

    // --- capability ----------------------------------------------------------
    if (ctx.requiredCapability) {
        const caps = Array.isArray(ctx.capabilities) ? ctx.capabilities : [];
        if (!caps.includes(ctx.requiredCapability)) reasons.push(REASONS.NOT_CAPABLE);
    }

    if (ctx.isAvailable === false) reasons.push(REASONS.NOT_AVAILABLE);

    // --- workload ------------------------------------------------------------
    const active = Number(ctx.activeJobCount) || 0;
    const max = Number(ctx.maxConcurrentJobs) || 1;
    if (active >= max) reasons.push(REASONS.MAX_CONCURRENT_JOBS);
    if (ctx.combinationAllowed === false) reasons.push(REASONS.INCOMPATIBLE_JOB_COMBINATION);

    // --- place ---------------------------------------------------------------
    if (ctx.inServiceArea === false) reasons.push(REASONS.OUT_OF_SERVICE_AREA);

    const locationKnown = isNum(ctx.distanceKm)
        && (!isNum(ctx.locationAgeMs) || Number(ctx.locationAgeMs) <= p.staleLocationMs);

    if (!locationKnown && p.refuseUnknownLocation) {
        // "We do not know where they are" is not a reason to assume they are near.
        reasons.push(REASONS.LOCATION_UNKNOWN);
    } else if (locationKnown && isNum(p.maxDistanceKm) && Number(ctx.distanceKm) > Number(p.maxDistanceKm)) {
        reasons.push(REASONS.TOO_FAR);
        detail.distanceKm = round2(ctx.distanceKm);
    }

    if (ctx.vehicleCompatible === false) reasons.push(REASONS.VEHICLE_INCOMPATIBLE);

    // --- money ---------------------------------------------------------------
    const balance = isNum(ctx.walletBalance) ? round2(ctx.walletBalance) : null;

    if (balance !== null) {
        if (isNum(p.minimumWalletBalance) && balance <= Number(p.minimumWalletBalance)) {
            reasons.push(REASONS.WALLET_RESTRICTED);
            detail.walletBalance = balance;
            detail.minimumWalletBalance = Number(p.minimumWalletBalance);
        } else if (p.blockOnNonPositiveWallet && balance <= 0) {
            reasons.push(REASONS.WALLET_RESTRICTED);
            detail.walletBalance = balance;
        }
    }

    const cashLimit = Number(p.cashLimit) || 0;
    if (p.enforceCashLimit && cashLimit > 0) {
        // The projected figure, not the current one. A job that would take the
        // rider over the ceiling must be refused BEFORE they collect the cash.
        const projected = round2((Number(ctx.cashInHand) || 0) + (Number(ctx.jobCashExposure) || 0));
        if (projected >= cashLimit) {
            reasons.push(REASONS.CASH_LIMIT_EXCEEDED);
            detail.cashInHand = round2(ctx.cashInHand);
            detail.projectedCashInHand = projected;
            detail.cashLimit = cashLimit;
        }
    }

    const financialOnly = reasons.length > 0 && reasons.every((r) => FINANCIAL_REASONS.includes(r));

    return { eligible: reasons.length === 0, reasons, financialOnly, detail };
}

/**
 * Every gate. Use when deciding whether to OFFER or ASSIGN work.
 */
export function evaluateForNewJob(ctx, policy) {
    return evaluate(ctx, policy);
}

/**
 * Only the gates about safety and authority. Use when a partner is already doing
 * the job and the question is whether they may finish it.
 *
 * Money is deliberately absent. A rider whose balance went negative mid-delivery
 * keeps delivering: the customer is waiting, and completing is what lets the rider
 * hand over the cash that clears the restriction. Stopping them would strand both.
 */
export function evaluateForActiveJob(ctx, policy) {
    const full = evaluate(ctx, policy);
    const reasons = full.reasons.filter(
        (r) => ![...FINANCIAL_REASONS,
            // Workload and placement are about choosing a partner, not about a job
            // already underway -- being "too far" now is not grounds to abandon it.
            REASONS.MAX_CONCURRENT_JOBS,
            REASONS.INCOMPATIBLE_JOB_COMBINATION,
            REASONS.TOO_FAR,
            REASONS.LOCATION_UNKNOWN,
            REASONS.NOT_AVAILABLE,
            REASONS.OUT_OF_SERVICE_AREA,
        ].includes(r),
    );
    return { eligible: reasons.length === 0, reasons, financialOnly: false, detail: full.detail };
}

export const __testables = { round2, isNum };
