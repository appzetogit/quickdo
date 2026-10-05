import { logger } from '../../utils/logger.js';
import { config } from '../../config/env.js';
import { filterEligible } from './eligibility.service.js';

/**
 * Run the master eligibility engine beside a vertical's own gate and report where
 * they disagree. Decides nothing.
 *
 * The three verticals currently answer "may this partner take this job" with three
 * different calculations applied at three different moments. Replacing them
 * outright is a real behaviour change -- taxi has never had a cash gate at
 * candidate selection at all, so switching one on could stop drivers earning on
 * the day it ships. The responsible order is: run both, look at the differences,
 * decide which are bugs being fixed and which are regressions, THEN cut over.
 *
 * This is that middle step. Every guarantee it makes is about what it does NOT do:
 *
 *   - it never changes which partners are dispatched;
 *   - it never throws into the dispatch path;
 *   - it never runs at all unless ELIGIBILITY_SHADOW_ENABLED is set, because it
 *     costs a riderFinance call per candidate and that is not free on a hot path;
 *   - it is not awaited by the caller.
 *
 * Read the output as two distinct populations, which mean opposite things:
 *
 *   WOULD_BLOCK  the engine refuses someone the vertical dispatched. Either a hole
 *                being closed (a rider over the COMBINED cash ceiling that this
 *                vertical could not see) or a rule that is too strict.
 *   WOULD_ALLOW  the engine permits someone the vertical refused. Either a gate the
 *                engine is missing, or a vertical being stricter than the platform
 *                intends.
 *
 * A cutover is ready when WOULD_BLOCK is only ever the first kind and WOULD_ALLOW
 * is empty.
 */

const MAX_CANDIDATES = 25;

/**
 * @param {object} args
 * @param {string} args.vertical
 * @param {Array}  args.candidates       everything considered, before the vertical's gate
 * @param {Array}  args.legacyEligible   what the vertical's own gate returned
 * @param {any}    args.jobId            for the log line
 * @param {number} args.jobCashExposure
 */
export function compareInBackground({
    vertical,
    candidates = [],
    legacyEligible = [],
    jobId = null,
    jobCashExposure = 0,
} = {}) {
    if (!config.eligibilityShadowEnabled) return;
    if (!Array.isArray(candidates) || candidates.length === 0) return;

    // Deliberately not awaited: the dispatcher must not wait on, or fail because
    // of, a measurement.
    void (async () => {
        try {
            const idOf = (c) => String(c?.partnerId || c?._id || c);
            const legacyIds = new Set((legacyEligible || []).map(idOf));

            const { rejected } = await filterEligible(
                candidates.slice(0, MAX_CANDIDATES),
                { vertical, jobCashExposure },
            );
            const engineRejectedIds = new Set(rejected.map((r) => r.partnerId));

            const wouldBlock = rejected.filter((r) => legacyIds.has(r.partnerId));
            const wouldAllow = candidates
                .slice(0, MAX_CANDIDATES)
                .map(idOf)
                .filter((id) => !legacyIds.has(id) && !engineRejectedIds.has(id));

            if (wouldBlock.length === 0 && wouldAllow.length === 0) return;

            if (wouldBlock.length) {
                logger.info(
                    `ELIGIBILITY SHADOW [${vertical}] job=${jobId || '?'} WOULD_BLOCK ${wouldBlock.length}: `
                    + wouldBlock
                        .map((r) => `${r.partnerId}(${r.reasons.join('|')}${
                            r.detail?.projectedCashInHand !== undefined
                                ? ` cash ${r.detail.cashInHand}+${jobCashExposure}=${r.detail.projectedCashInHand}/${r.detail.cashLimit}`
                                : ''
                        })`)
                        .join(' '),
                );
            }
            if (wouldAllow.length) {
                // The more interesting direction: the engine is missing a gate the
                // vertical has, or the vertical is stricter than the platform means.
                logger.info(
                    `ELIGIBILITY SHADOW [${vertical}] job=${jobId || '?'} WOULD_ALLOW ${wouldAllow.length}: ${wouldAllow.join(' ')}`,
                );
            }
        } catch (err) {
            logger.warn(`ELIGIBILITY SHADOW [${vertical}] comparison failed: ${err.message}`);
        }
    })();
}
