import { logger } from '../../utils/logger.js';
import { getRiderFinance } from './riderFinance.service.js';
import {
    evaluateForNewJob as decideNewJob,
    evaluateForActiveJob as decideActiveJob,
    DEFAULT_ELIGIBILITY_POLICY,
    REASONS,
} from './eligibilityRules.js';

/**
 * The gathering half of the one eligibility decision.
 *
 * `eligibilityRules` decides; this fetches what it decides on, so every vertical
 * ends up consuming the SAME verdict rather than a similar one computed from its
 * own numbers. Today food recomputes cash from orders, quick-commerce reads a
 * stored field, taxi checks a cached flag at a different moment, and service
 * provider checks nothing.
 *
 * Money comes from `getRiderFinance`, which is already the correct combined
 * answer across taxi, food and quick commerce -- it was simply never the answer
 * any dispatcher asked for. Nothing new is computed here.
 *
 * Everything is passed in where the caller already knows it (distance, zone,
 * vehicle), because the dispatchers have that in hand and a second lookup would
 * be both slower and capable of disagreeing with the candidate query that
 * produced it.
 */

/** Which capability a vertical's work requires. */
const CAPABILITY_FOR_VERTICAL = Object.freeze({
    food: 'delivery',
    quickCommerce: 'quickCommerce',
    taxi: 'taxi',
});

/**
 * Assemble the context for one partner and one job.
 *
 * @param {object} args
 * @param {string} args.vertical            'food' | 'quickCommerce' | 'taxi'
 * @param {any}    args.partnerId           a partner id OR a driver id -- riderFinance resolves either
 * @param {object} [args.partner]           the partner/driver doc, if the caller already has it
 * @param {number} [args.jobCashExposure]   cash this job would add to their float
 * @param {number} [args.distanceKm]
 * @param {number} [args.locationAgeMs]
 * @param {boolean}[args.inServiceArea]
 * @param {boolean}[args.vehicleCompatible]
 * @param {boolean}[args.combinationAllowed]
 * @param {number} [args.activeJobCount]
 * @param {number} [args.maxConcurrentJobs]
 */
export async function buildContext({
    vertical,
    partnerId,
    partner = null,
    jobCashExposure = 0,
    distanceKm = null,
    locationAgeMs = null,
    inServiceArea = undefined,
    vehicleCompatible = undefined,
    combinationAllowed = undefined,
    activeJobCount = undefined,
    maxConcurrentJobs = undefined,
} = {}) {
    const finance = await getRiderFinance(partnerId);

    /*
     * Capabilities live on the unified driver. A partner who was never linked has
     * none to read, and is treated as capable of the vertical asking -- the same
     * waiver every dispatcher already applies, and for the same reason: refusing
     * work to every un-backfilled rider would be a worse outage than the rule it
     * enforces. It disappears with the backfill, not before.
     */
    let capabilities = null;
    let partnerStatus = partner?.status || null;
    let isAvailable = partner?.availabilityStatus
        ? partner.availabilityStatus === 'online'
        : (partner?.isOnline ?? undefined);

    if (finance.driverId) {
        try {
            const { Driver } = await import('../../modules/taxi/driver/models/Driver.js');
            const driver = await Driver.findById(finance.driverId)
                .select('serviceCapabilities workMode status approve isOnline activeAssignments')
                .lean();
            if (driver) {
                capabilities = Array.isArray(driver.serviceCapabilities) ? driver.serviceCapabilities : [];
                if (!partnerStatus) {
                    partnerStatus = driver.approve === false ? 'pending' : (driver.status || 'approved');
                }
                if (isAvailable === undefined) isAvailable = driver.isOnline;
                if (activeJobCount === undefined) {
                    activeJobCount = Array.isArray(driver.activeAssignments) ? driver.activeAssignments.length : 0;
                }
            }
        } catch (err) {
            // A failed capability read must not silently approve. Left null, which
            // the rules module reads as "not asserted" -- the caller decides.
            logger.warn(`eligibility: capability lookup failed for ${finance.driverId}: ${err.message}`);
        }
    }

    return {
        requiredCapability: capabilities ? CAPABILITY_FOR_VERTICAL[vertical] : null,
        capabilities: capabilities || [],
        isAvailable,
        partnerStatus,
        kycComplete: partner?.kycComplete,
        // SIGNED, and never clamped here. riderFinance is the combined figure.
        walletBalance: finance.walletBalance,
        cashInHand: finance.cashInHand,
        jobCashExposure,
        activeJobCount,
        maxConcurrentJobs,
        combinationAllowed,
        inServiceArea,
        distanceKm,
        locationAgeMs,
        vehicleCompatible,
        verticalEnabled: true,
        // Carried through so a caller can show the operator where a figure came
        // from rather than only that the answer was "no".
        _finance: finance,
    };
}

/**
 * Build the policy for this job, resolved through PARTNER > ZONE > VERTICAL > GLOBAL.
 *
 * The precedence and the provenance live in core/config. What matters here is the
 * FALLBACK, and why it is the shape it is.
 *
 * `platform_settings` is empty until somebody administers it, and the config
 * resolver correctly returns each key's registered default for a key nobody has
 * set. But the registered default for `finance.cashLimit` is 0 -- meaning "no
 * ceiling" -- while the platform today has a real, administered ceiling living in
 * `FoodFeeSettings`, which `riderFinance` already surfaces as the shared figure.
 *
 * So resolving naively would REMOVE the cash limit on the day this shipped. The
 * legacy figure is therefore used whenever no level has explicitly set the key:
 * an administered override wins, and until one exists nothing changes. That is
 * what makes this safe to land before the settings are migrated rather than after.
 */
export async function resolvePolicy(vertical, context, overrides = {}) {
    const legacyCashLimit = Number(context?._finance?.cashLimit) || 0;

    let resolved = {};
    try {
        const { getMany } = await import('../config/resolver.service.js');
        resolved = await getMany(
            [
                'finance.cashLimit',
                'finance.enforceCashLimit',
                'finance.minimumWalletBalance',
                'finance.blockOnNonPositiveWallet',
                'assignment.maxDistanceKm',
                'assignment.refuseUnknownLocation',
                'assignment.staleLocationMs',
                'partner.requireKyc',
            ],
            {
                vertical,
                partnerId: context?._finance?.driverId || undefined,
                zoneId: context?.zoneId || undefined,
            },
        );
    } catch (err) {
        // Settings must never be the reason dispatch stops. Fall back to the
        // legacy figures, which is exactly today's behaviour.
        logger.warn(`eligibility: config resolve failed, using legacy limits: ${err.message}`);
    }

    /**
     * Administered value > today's behaviour > the registry default.
     *
     * The middle term is the one that matters and the one that is easy to get
     * wrong. A first cut preferred `legacy` over the registry default
     * unconditionally, which meant a key with no legacy source -- most of them --
     * could never take its registered default, so `assignment.maxDistanceKm: 15`
     * sat in the registry looking meaningful and doing nothing.
     *
     * Legacy wins only where a legacy value ACTUALLY EXISTS. For the cash limit it
     * always does, and that is the case this ordering exists to protect: the
     * registry default is 0 (no ceiling), so preferring it would silently remove a
     * real administered limit on the day this shipped.
     */
    const pick = (key, legacy) => {
        const row = resolved[key];
        if (row && !row.isDefault) return row.value;          // somebody administered it
        if (legacy !== null && legacy !== undefined) return legacy; // keep today's behaviour
        return row ? row.value : legacy;                       // registry default
    };

    return {
        ...DEFAULT_ELIGIBILITY_POLICY,
        cashLimit: pick('finance.cashLimit', legacyCashLimit),
        enforceCashLimit: pick('finance.enforceCashLimit', DEFAULT_ELIGIBILITY_POLICY.enforceCashLimit),
        minimumWalletBalance: pick('finance.minimumWalletBalance', DEFAULT_ELIGIBILITY_POLICY.minimumWalletBalance),
        blockOnNonPositiveWallet: pick('finance.blockOnNonPositiveWallet', DEFAULT_ELIGIBILITY_POLICY.blockOnNonPositiveWallet),
        maxDistanceKm: pick('assignment.maxDistanceKm', DEFAULT_ELIGIBILITY_POLICY.maxDistanceKm),
        refuseUnknownLocation: pick('assignment.refuseUnknownLocation', DEFAULT_ELIGIBILITY_POLICY.refuseUnknownLocation),
        staleLocationMs: pick('assignment.staleLocationMs', DEFAULT_ELIGIBILITY_POLICY.staleLocationMs),
        requireKyc: pick('partner.requireKyc', DEFAULT_ELIGIBILITY_POLICY.requireKyc),
        ...overrides,
    };
}

/**
 * May this partner be OFFERED or ASSIGNED this job? Every gate applies.
 */
export async function evaluateForNewJob(args, policyOverrides = {}) {
    const context = await buildContext(args);
    const policy = await resolvePolicy(args?.vertical, context, policyOverrides);
    const verdict = decideNewJob(context, policy);
    return { ...verdict, context, policy };
}

/**
 * May this partner FINISH the job they are already doing?
 *
 * Money is not consulted. See eligibilityRules for why: completing the job is
 * usually the thing that clears the restriction.
 */
export async function evaluateForActiveJob(args, policyOverrides = {}) {
    const context = await buildContext(args);
    const policy = await resolvePolicy(args?.vertical, context, policyOverrides);
    const verdict = decideActiveJob(context, policy);
    return { ...verdict, context, policy };
}

/**
 * The bulk form dispatchers actually need: filter a candidate list in one pass.
 *
 * Returns both the eligible ids and, for every rejection, the reasons -- so
 * "why was nobody offered this order" is answerable from a log line rather than
 * by re-running the query by hand.
 */
export async function filterEligible(candidates, args, policyOverrides = {}) {
    const eligible = [];
    const rejected = [];

    for (const candidate of candidates || []) {
        const partnerId = candidate?.partnerId || candidate?._id || candidate;
        try {
            const verdict = await evaluateForNewJob(
                { ...args, partnerId, distanceKm: candidate?.distanceKm ?? args?.distanceKm },
                policyOverrides,
            );
            if (verdict.eligible) eligible.push(candidate);
            else rejected.push({ partnerId: String(partnerId), reasons: verdict.reasons, detail: verdict.detail });
        } catch (err) {
            // A partner whose eligibility could not be determined is NOT offered
            // work. Failing open here would route around every gate in this file.
            logger.error(`eligibility: evaluation failed for ${partnerId}: ${err.message}`);
            rejected.push({ partnerId: String(partnerId), reasons: ['EVALUATION_FAILED'], detail: {} });
        }
    }

    return { eligible, rejected };
}

export { REASONS };
