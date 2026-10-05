/**
 * Which jobs one person may hold at once, across every vertical.
 *
 * Today this question cannot even be asked. The busy-lock is a single embedded
 * slot -- `Driver.activeAssignment: {type, id, at} | null` -- so "one at a time"
 * is not a configured policy, it is the shape of the data. Stacking a second food
 * order, or letting a rider carry a grocery order to the same building, is not
 * switched off; it is unrepresentable. And quick-commerce never takes the lock at
 * all, so a rider on a QC order still reads as free to food and taxi.
 *
 * This module is the policy, kept pure so the combination matrix can be checked
 * without a database. The service beside it does the atomic write.
 *
 * The default policy reproduces TODAY'S BEHAVIOUR EXACTLY: one job, any vertical,
 * no stacking. Nothing changes the day this ships except that quick-commerce
 * finally participates. Stacking becomes a configuration change later, not a
 * rewrite -- which is the whole point of doing it this way rather than copying
 * food's wrapper into the QC fork.
 */

/** The job kinds a partner can be holding. One vocabulary for all four verticals. */
export const JOB_TYPES = Object.freeze({
    FOOD_DELIVERY: 'foodDelivery',
    QUICK_COMMERCE_DELIVERY: 'quickCommerceDelivery',
    TAXI_RIDE: 'taxiRide',
    SERVICE_BOOKING: 'serviceBooking',
});

export const ALL_JOB_TYPES = Object.freeze(Object.values(JOB_TYPES));

/**
 * The legacy `activeAssignment.type` vocabulary, which only ever had two values.
 * Kept so a lock written before this module can still be understood.
 */
export const LEGACY_TYPE_MAP = Object.freeze({
    ride: JOB_TYPES.TAXI_RIDE,
    delivery: JOB_TYPES.FOOD_DELIVERY,
});

export const toLegacyType = (jobType) =>
    jobType === JOB_TYPES.TAXI_RIDE ? 'ride' : 'delivery';

/**
 * Today's policy, stated explicitly for the first time.
 *
 * `allowedCombinations` is a map from a job type to the set of OTHER types it may
 * be held alongside. Empty set means "this job must be held alone". It is
 * deliberately symmetric-by-construction below rather than symmetric-by-promise:
 * an asymmetric matrix (food may stack onto taxi, taxi may not stack onto food)
 * would make the outcome depend on arrival order, which is exactly the kind of
 * race this whole exercise exists to remove.
 */
export const DEFAULT_POLICY = Object.freeze({
    maxConcurrentJobs: 1,
    allowedCombinations: Object.freeze({
        [JOB_TYPES.FOOD_DELIVERY]: Object.freeze([]),
        [JOB_TYPES.QUICK_COMMERCE_DELIVERY]: Object.freeze([]),
        [JOB_TYPES.TAXI_RIDE]: Object.freeze([]),
        [JOB_TYPES.SERVICE_BOOKING]: Object.freeze([]),
    }),
});

/**
 * An illustrative stacking policy, NOT the default and not enabled anywhere.
 * Written down so the shape of a real configuration is obvious when the config
 * resolver arrives, and so the checks can prove the engine actually honours one.
 *
 * A passenger in the car is the hard case: a taxi ride may never be stacked with
 * anything, because the constraint is not time or distance, it is that there is a
 * human being in the vehicle expecting to go where they asked.
 */
export const EXAMPLE_STACKING_POLICY = Object.freeze({
    maxConcurrentJobs: 2,
    allowedCombinations: Object.freeze({
        [JOB_TYPES.FOOD_DELIVERY]: Object.freeze([JOB_TYPES.FOOD_DELIVERY, JOB_TYPES.QUICK_COMMERCE_DELIVERY]),
        [JOB_TYPES.QUICK_COMMERCE_DELIVERY]: Object.freeze([JOB_TYPES.QUICK_COMMERCE_DELIVERY, JOB_TYPES.FOOD_DELIVERY]),
        [JOB_TYPES.TAXI_RIDE]: Object.freeze([]),
        [JOB_TYPES.SERVICE_BOOKING]: Object.freeze([]),
    }),
});

const asArray = (value) => (Array.isArray(value) ? value : []);

/**
 * May this partner take `incoming` while already holding `current`?
 *
 * @param {Array<{jobType: string, jobId: any}>} current
 * @param {{jobType: string, jobId: any}} incoming
 * @param {{maxConcurrentJobs: number, allowedCombinations: object}} policy
 * @returns {{allowed: boolean, reason: string|null, idempotent: boolean}}
 *
 * `idempotent: true` means they already hold exactly this job -- a double-tap, a
 * network retry, a second device. That is a success, not a conflict: the caller
 * should return the existing assignment rather than an error, or the rider sees
 * "you are already on another job" about the job they just accepted.
 */
export function canAccept(current, incoming, policy = DEFAULT_POLICY) {
    const held = asArray(current);
    const max = Number(policy?.maxConcurrentJobs) || 1;

    if (!incoming?.jobType || incoming?.jobId === undefined || incoming?.jobId === null || incoming?.jobId === '') {
        return { allowed: false, reason: 'INVALID_JOB', idempotent: false };
    }
    if (!ALL_JOB_TYPES.includes(incoming.jobType)) {
        // An unknown job type is refused rather than assumed compatible: a typo
        // must not become a way to bypass the concurrency rule.
        return { allowed: false, reason: 'UNKNOWN_JOB_TYPE', idempotent: false };
    }

    const alreadyHeld = held.some((a) => String(a?.jobId) === String(incoming.jobId));
    if (alreadyHeld) {
        return { allowed: true, reason: null, idempotent: true };
    }

    if (held.length >= max) {
        return { allowed: false, reason: 'MAX_CONCURRENT_JOBS', idempotent: false };
    }

    const compatibleWithIncoming = new Set(asArray(policy?.allowedCombinations?.[incoming.jobType]));
    for (const existing of held) {
        const existingType = existing?.jobType;
        // Both directions must permit it. Checking only one would let arrival
        // order decide whether a pairing is legal.
        const compatibleWithExisting = new Set(asArray(policy?.allowedCombinations?.[existingType]));
        if (!compatibleWithIncoming.has(existingType) || !compatibleWithExisting.has(incoming.jobType)) {
            return { allowed: false, reason: 'INCOMPATIBLE_JOB_COMBINATION', idempotent: false };
        }
    }

    return { allowed: true, reason: null, idempotent: false };
}

/**
 * The job types that may NOT be held alongside `incoming` under this policy.
 *
 * The claim query needs this as a plain list so the incompatibility test can live
 * in the database filter -- checking it in JavaScript after a read would reopen
 * the read-then-write gap the atomic claim exists to close.
 */
export function forbiddenAlongside(incoming, policy = DEFAULT_POLICY) {
    const compatible = new Set(asArray(policy?.allowedCombinations?.[incoming]));
    return ALL_JOB_TYPES.filter((t) => !compatible.has(t));
}

export const __testables = { asArray };
