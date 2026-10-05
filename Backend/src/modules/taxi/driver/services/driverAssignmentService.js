import { Driver } from '../models/Driver.js';

/**
 * Cross-service busy-lock for a unified driver.
 *
 * A driver may hold exactly ONE active assignment at a time — a taxi ride OR a food delivery.
 * Both dispatchers acquire the lock atomically before assigning, so a driver can never be
 * double-booked across services. Pool rides are the deliberate exception (a driver runs one
 * pool GROUP that holds several rides), so pooled assignment does not use this lock.
 *
 * The lock lives on Driver.activeAssignment: { type:'ride'|'delivery', id, at } | null.
 */

/**
 * Atomically claim the lock. Succeeds only if the driver is currently free (activeAssignment null)
 * OR already holds this exact assignment (idempotent re-acquire). Returns true if the caller holds it.
 */
/*
 * Food and taxi's entry points to the busy-lock, now delegating to the master one.
 *
 * These used to write `activeAssignment` directly, while quick-commerce claimed
 * through core/assignment/assignment.service.js and its `activeAssignments` array.
 * The mirror kept the two interoperable, but it meant two primitives deciding the
 * same question -- the exact shape this branch exists to remove. Now there is one:
 * every vertical claims through the master service, and `activeAssignments` is the
 * record for all of them.
 *
 * Signatures and return values are unchanged, so no call site in food or taxi moves.
 * `type` maps onto a vertical: 'ride' is taxi, 'delivery' is food. Quick-commerce
 * calls the master service directly and never came through here.
 */
const verticalForLegacyType = (type) => (type === 'ride' ? 'taxi' : 'food');

const loadMaster = () => import('../../../../core/assignment/assignment.service.js');

export const acquireDriverAssignment = async (driverId, type, id, session = null) => {
  if (!driverId || !type || !id) return false;
  const { claimAssignment } = await loadMaster();
  const { claimed } = await claimAssignment(
    driverId,
    { vertical: verticalForLegacyType(type), jobId: id },
    { session },
  );
  return claimed;
};

/**
 * Release the lock, but only if it still points at THIS assignment — so a stale release
 * (late completion of an old ride) can't clear a lock that a newer assignment already took.
 *
 * Note for anyone reading the taxi dispatcher: its release calls are NOT behind
 * UNIFIED_DISPATCH_ENABLED and run in production today. With the flag off nothing
 * is ever claimed, so these match no driver and change nothing -- the same no-op
 * the previous implementation was.
 */
export const releaseDriverAssignment = async (driverId, id, session = null) => {
  if (!driverId || !id) return false;
  const { releaseAssignment } = await loadMaster();
  return releaseAssignment(driverId, id, { session });
};

/**
 * Force-clear the lock regardless of what it holds (admin/recovery use only).
 *
 * Clears BOTH fields. Clearing only the mirror, as this used to, would leave the
 * array still holding the job -- and the array is what every claim now reads.
 */
export const forceClearDriverAssignment = async (driverId, session = null) => {
  if (!driverId) return false;
  const res = await Driver.updateOne(
    {
      _id: driverId,
      $or: [
        { activeAssignment: { $ne: null } },
        { 'activeAssignments.0': { $exists: true } },
      ],
    },
    { $set: { activeAssignment: null, activeAssignments: [] } },
    { session },
  );
  return Boolean(res?.modifiedCount);
};

// The terminal-status tables moved to core/assignment/assignment.service.js, where
// they are per-vertical. Keeping a second copy here is how the two would drift.

/**
 * Self-heal a stale busy-lock.
 *
 * A lock can outlive its job — the driver force-quits mid-delivery, a release is missed on an
 * unusual exit path, or the job is cancelled by a flow that doesn't route through the normal
 * terminal handlers. Without this the driver is permanently unassignable.
 *
 * Looks up whatever the lock points at and clears it if that job is gone or already terminal.
 * A lock on a genuinely live job is left alone. Safe to call often; only writes when stale.
 *
 * @returns {Promise<boolean>} true if a stale lock was cleared
 */
export const reconcileDriverAssignment = async (driverId) => {
  if (!driverId) return false;

  /*
   * Delegates to the master reconciler.
   *
   * The implementation that used to live here resolved EVERY `type: 'delivery'`
   * lock against FoodOrder. Quick-commerce orders live in their own collection,
   * so once QC started taking the lock every QC hold would have been read as
   * "job not found, therefore stale" and cleared on sight -- handing the rider a
   * second job while they were still carrying the first. Simply making QC call
   * the old primitive would have been worse than leaving it alone; the reconciler
   * had to learn about verticals first.
   *
   * Signature and semantics are unchanged for the two existing callers
   * (driverController going online, and the sweep): still boolean, still writes
   * only when something is genuinely stale.
   */
  const { reconcileAssignments } = await import('../../../../core/assignment/assignment.service.js');
  const cleared = await reconcileAssignments(driverId);
  return cleared > 0;
};
