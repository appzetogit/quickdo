import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';
import {
    JOB_TYPES,
    DEFAULT_POLICY,
    LEGACY_TYPE_MAP,
    toLegacyType,
    forbiddenAlongside,
} from './assignmentRules.js';

/**
 * The one place a partner is marked busy, whatever kind of work it is.
 *
 * Replaces `driverAssignmentService`'s single-slot lock, which had three problems
 * this fixes and one it did not have:
 *
 *   - quick-commerce never called it, so a rider on a grocery order read as free
 *     and food or taxi would claim them (the live double-booking hole);
 *   - `reconcile` only understood FoodOrder, so a QC lock would have been judged
 *     "job not found, therefore stale" and cleared instantly -- which is why
 *     simply making QC call the old primitive would have been worse than useless;
 *   - one slot made concurrency a property of the schema rather than a policy.
 *
 * The thing it did have, and this keeps, is a genuinely atomic compare-and-set. A
 * claim is one `updateOne` whose FILTER carries the whole rule, so two dispatchers
 * arriving together cannot both win. Nothing is read first and decided in
 * JavaScript; that gap is the bug.
 *
 * ---------------------------------------------------------------------------
 * STORAGE, during the transition
 *
 * `activeAssignments: [{vertical, jobType, jobId, at}]` is the new truth.
 * `activeAssignment: {type, id, at} | null` is kept MIRRORED to its first element,
 * because a lot of existing code reads it: three dispatchers filter on
 * `activeAssignment: null`, and there is a compound index on
 * `'activeAssignment.type'`. Under the default policy (one job) the array holds 0
 * or 1 entries, so the mirror is exact and every existing query stays correct
 * without being touched. That is what makes this shippable in one step.
 *
 * Drivers whose lock predates this module have `activeAssignment` set and no
 * array. An empty array would make them look free, so while `maxConcurrentJobs`
 * is 1 the claim filter ALSO requires the legacy field to be free. Once a backfill
 * has populated the array and stacking is actually wanted, that condition is
 * dropped -- see `buildClaimFilter`.
 */

const jobTypeForVertical = Object.freeze({
    food: JOB_TYPES.FOOD_DELIVERY,
    quickCommerce: JOB_TYPES.QUICK_COMMERCE_DELIVERY,
    taxi: JOB_TYPES.TAXI_RIDE,
    serviceProvider: JOB_TYPES.SERVICE_BOOKING,
});

export const jobTypeOf = (vertical) => jobTypeForVertical[vertical] || null;

const loadDriver = async () => (await import('../../modules/taxi/driver/models/Driver.js')).Driver;

/**
 * The filter that IS the rule. Everything the policy says must be expressible
 * here, because anything checked outside it is checked too late.
 *
 * Exported for the checks: the filter is the security boundary, so it is worth
 * asserting on its shape directly rather than only through its effects.
 */
/*
 * Ids are normalised to ObjectId at the boundary.
 *
 * The claim is an aggregation-pipeline update, and mongoose does not cast literals
 * inside pipeline stages. A caller passing the order id as a string would store a
 * string in activeAssignments, and the idempotent re-claim -- `$in: [jobId, ...]` --
 * would then fail to match it against an ObjectId from another caller: a rider's
 * own retry reported as "already on another job". Food and taxi pass ObjectIds
 * today; this makes that an invariant rather than a habit.
 */
const asObjectId = (value) => (
    value instanceof mongoose.Types.ObjectId || !mongoose.Types.ObjectId.isValid(String(value))
        ? value
        : new mongoose.Types.ObjectId(String(value))
);

export function buildClaimFilter(driverId, { jobType, jobId }, policy = DEFAULT_POLICY) {
    const max = Number(policy?.maxConcurrentJobs) || 1;
    const forbidden = forbiddenAlongside(jobType, policy);

    const capacityAndCompatibility = {
        // Room for one more...
        $expr: { $lt: [{ $size: { $ifNull: ['$activeAssignments', []] } }, max] },
        // ...and nothing held that this job may not sit beside.
        'activeAssignments.jobType': { $nin: forbidden },
    };

    if (max === 1) {
        /*
         * Transition guard. A driver locked before this module exists has
         * `activeAssignment` set and no `activeAssignments` array; `$size` of a
         * missing array is 0, so without this they would read as free and could be
         * double-booked by the very code meant to prevent it.
         *
         * Dropped once max > 1, by which point the backfill has run -- keeping it
         * would make the mirror (always non-null while holding anything) forbid
         * every second job and silently disable stacking.
         */
        capacityAndCompatibility.$or = [
            { activeAssignment: null },
            { activeAssignment: { $exists: false } },
        ];
    }

    return {
        _id: driverId,
        $or: [
            // Idempotent re-claim: they already hold this exact job. A double-tap,
            // a retry, a second device. Succeeds rather than reporting a conflict
            // about the job they just accepted.
            { 'activeAssignments.jobId': jobId },
            { 'activeAssignment.id': jobId },
            capacityAndCompatibility,
        ],
    };
}

/**
 * Claim the partner for this job. Atomic; returns whether the caller now holds it.
 *
 * @param {any} driverId
 * @param {{vertical: string, jobId: any}} job
 * @param {{policy?: object, session?: any}} [opts]
 * @returns {Promise<{claimed: boolean, reason: string|null}>}
 */
export async function claimAssignment(driverId, { vertical, jobId: rawJobId }, { policy = DEFAULT_POLICY, session = null } = {}) {
    const jobId = rawJobId ? asObjectId(rawJobId) : rawJobId;
    const jobType = jobTypeOf(vertical);
    if (!driverId || !jobType || !jobId) {
        return { claimed: false, reason: 'INVALID_JOB' };
    }

    const Driver = await loadDriver();
    const entry = { vertical, jobType, jobId, at: new Date() };

    const res = await Driver.updateOne(
        buildClaimFilter(driverId, { jobType, jobId }, policy),
        [
            {
                $set: {
                    activeAssignments: {
                        $cond: [
                            // Re-claim adds nothing, so the original `at` is preserved
                            // and a retry cannot quietly extend the hold.
                            { $in: [jobId, { $ifNull: ['$activeAssignments.jobId', []] }] },
                            { $ifNull: ['$activeAssignments', []] },
                            { $concatArrays: [{ $ifNull: ['$activeAssignments', []] }, [entry]] },
                        ],
                    },
                },
            },
            {
                // Mirror, in the same atomic update, so no reader can observe the
                // array and the legacy field disagreeing.
                $set: {
                    activeAssignment: {
                        $let: {
                            vars: { first: { $arrayElemAt: [{ $ifNull: ['$activeAssignments', []] }, 0] } },
                            in: {
                                $cond: [
                                    { $eq: [{ $type: '$$first' }, 'missing'] },
                                    null,
                                    {
                                        type: {
                                            $cond: [
                                                { $eq: ['$$first.jobType', JOB_TYPES.TAXI_RIDE] },
                                                'ride',
                                                'delivery',
                                            ],
                                        },
                                        id: '$$first.jobId',
                                        at: '$$first.at',
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        ],
        { session },
    );

    // matchedCount, not modifiedCount: an idempotent re-claim matches and changes
    // nothing, and that is a success. Treating it as failure would refuse a rider
    // their own job on a retry.
    return res?.matchedCount ? { claimed: true, reason: null } : { claimed: false, reason: 'NOT_ELIGIBLE' };
}

/**
 * The filter that makes a release safe.
 *
 * It must match ONLY a driver who actually holds this job. Without that guard the
 * mirror step below is destructive: releasing a job the driver does not hold
 * leaves the array untouched, then re-derives `activeAssignment` from an empty
 * array and writes null -- clearing a live lock held in the legacy field by some
 * other job. A late release from a finished order would free a driver who had
 * since been claimed for a new one, which is the exact failure the original
 * single-slot release was careful to avoid.
 *
 * Checking both storage shapes, because a lock taken before this module exists
 * lives only in `activeAssignment`.
 */
export function buildReleaseFilter(driverId, jobId) {
    return {
        _id: driverId,
        $or: [
            { 'activeAssignments.jobId': jobId },
            { 'activeAssignment.id': jobId },
        ],
    };
}

/**
 * Release one job. Only clears an entry that IS this job, so a late release from
 * a finished order cannot free a lock a newer job already took.
 */
export async function releaseAssignment(driverId, rawJobId, { session = null } = {}) {
    const jobId = rawJobId ? asObjectId(rawJobId) : rawJobId;
    if (!driverId || !jobId) return false;
    const Driver = await loadDriver();

    const res = await Driver.updateOne(
        buildReleaseFilter(driverId, jobId),
        [
            {
                $set: {
                    activeAssignments: {
                        $filter: {
                            input: { $ifNull: ['$activeAssignments', []] },
                            as: 'a',
                            cond: { $ne: [{ $toString: '$$a.jobId' }, String(jobId)] },
                        },
                    },
                },
            },
            {
                $set: {
                    activeAssignment: {
                        $let: {
                            vars: { first: { $arrayElemAt: [{ $ifNull: ['$activeAssignments', []] }, 0] } },
                            in: {
                                $cond: [
                                    { $eq: [{ $type: '$$first' }, 'missing'] },
                                    null,
                                    {
                                        type: {
                                            $cond: [
                                                { $eq: ['$$first.jobType', JOB_TYPES.TAXI_RIDE] },
                                                'ride',
                                                'delivery',
                                            ],
                                        },
                                        id: '$$first.jobId',
                                        at: '$$first.at',
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        ],
        { session },
    );
    return Boolean(res?.modifiedCount);
}

/**
 * Which statuses mean a job is over, per vertical.
 *
 * The old reconcile knew only FoodOrder, so anything else looked like "job not
 * found" and its lock was cleared immediately -- the reason wiring QC into the old
 * primitive unchanged would have been actively harmful.
 */
const TERMINAL = Object.freeze({
    [JOB_TYPES.TAXI_RIDE]: ['completed', 'cancelled'],
    [JOB_TYPES.FOOD_DELIVERY]: [
        'delivered', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin',
    ],
    [JOB_TYPES.QUICK_COMMERCE_DELIVERY]: [
        'delivered', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin',
    ],
    [JOB_TYPES.SERVICE_BOOKING]: ['completed', 'cancelled', 'rejected'],
});

const resolveJobState = async (entry) => {
    const jobType = entry?.jobType || LEGACY_TYPE_MAP[entry?.type];
    const jobId = entry?.jobId ?? entry?.id;
    if (!jobType || !jobId) return { known: true, terminal: true };

    try {
        if (jobType === JOB_TYPES.TAXI_RIDE) {
            const { Ride } = await import('../../modules/taxi/user/models/Ride.js');
            const ride = await Ride.findById(jobId).select('status').lean();
            if (!ride) return { known: true, terminal: true };
            return { known: true, terminal: TERMINAL[jobType].includes(String(ride.status || '').toLowerCase()) };
        }
        if (jobType === JOB_TYPES.FOOD_DELIVERY) {
            const { FoodOrder } = await import('../../modules/food/orders/models/order.model.js');
            const order = await FoodOrder.findById(jobId).select('orderStatus').lean();
            if (!order) return { known: true, terminal: true };
            return { known: true, terminal: TERMINAL[jobType].includes(String(order.orderStatus || '').toLowerCase()) };
        }
        if (jobType === JOB_TYPES.QUICK_COMMERCE_DELIVERY) {
            const { FoodOrder: QCOrder } = await import(
                '../../modules/quickCommerce/modules/food/orders/models/order.model.js'
            );
            const order = await QCOrder.findById(jobId).select('orderStatus').lean();
            if (!order) return { known: true, terminal: true };
            return { known: true, terminal: TERMINAL[jobType].includes(String(order.orderStatus || '').toLowerCase()) };
        }
        if (jobType === JOB_TYPES.SERVICE_BOOKING) {
            const Booking = (await import('../../modules/serviceProvider/models/Booking.js')).default;
            const booking = await Booking.findById(jobId).select('status').lean();
            if (!booking) return { known: true, terminal: true };
            return { known: true, terminal: TERMINAL[jobType].includes(String(booking.status || '').toLowerCase()) };
        }
    } catch (err) {
        // A lookup that FAILED is not evidence the job is over. Freeing a lock on a
        // live job is worse than leaving a stale one: the rider gets a second job
        // while still carrying the first.
        logger.warn(`reconcileAssignments: could not resolve ${jobType}:${jobId} — ${err.message}`);
        return { known: false, terminal: false };
    }
    return { known: false, terminal: false };
};

/**
 * Drop entries whose job is gone or finished. Safe to call often; writes only when
 * something is actually stale. Returns how many were cleared.
 */
export async function reconcileAssignments(driverId) {
    if (!driverId) return 0;
    const Driver = await loadDriver();

    const driver = await Driver.findById(driverId).select('activeAssignments activeAssignment').lean();
    if (!driver) return 0;

    const entries = Array.isArray(driver.activeAssignments) && driver.activeAssignments.length
        ? driver.activeAssignments
        // Pre-migration driver: reconcile whatever the legacy slot holds.
        : (driver.activeAssignment ? [driver.activeAssignment] : []);

    let cleared = 0;
    for (const entry of entries) {
        const { known, terminal } = await resolveJobState(entry);
        if (known && terminal) {
            const jobId = entry?.jobId ?? entry?.id;
            if (await releaseAssignment(driverId, jobId)) cleared += 1;
        }
    }
    return cleared;
}

export { JOB_TYPES, DEFAULT_POLICY, toLegacyType };
