import { Ride } from '../user/models/Ride.js';
import { Driver } from '../driver/models/Driver.js';
import { User } from '../user/models/User.js';
import { RIDE_STATUS, RIDE_LIVE_STATUS } from '../constants/index.js';
import { logger } from '../../../utils/logger.js';

/**
 * Rides nothing ever times out.
 *
 * Dispatch state lives in memory, so a restart, a crashed app or a driver who
 * simply walks away left rides in searching / accepted / arriving for ever --
 * the driver stuck "on a ride" and never offered another, the customer unable
 * to book (their current ride never ends).
 *
 *   searching, untouched 30 min   -> cancelled (nobody took it)
 *   accepted/arriving, 2 hours    -> cancelled, driver and customer freed
 *
 * A started trip is left alone: it carries a fare, and ending it is the
 * driver's or an admin's call, not a timer's.
 */
const SEARCHING_MS = 30 * 60 * 1000;
const ASSIGNED_MS = 2 * 60 * 60 * 1000;

export async function sweepStaleRides(now = Date.now()) {
  const stale = await Ride.find({
    $or: [
      { status: RIDE_STATUS.SEARCHING, updatedAt: { $lte: new Date(now - SEARCHING_MS) } },
      {
        status: RIDE_STATUS.ACCEPTED,
        liveStatus: { $in: [RIDE_LIVE_STATUS.ACCEPTED, RIDE_LIVE_STATUS.ARRIVING] },
        updatedAt: { $lte: new Date(now - ASSIGNED_MS) },
      },
    ],
  }).select('_id userId driverId status').limit(500).lean();

  let cancelled = 0;
  for (const ride of stale) {
    const res = await Ride.updateOne(
      { _id: ride._id, status: ride.status },
      { $set: { status: RIDE_STATUS.CANCELLED, liveStatus: RIDE_LIVE_STATUS.CANCELLED, cancelReason: 'Timed out' } },
    );
    if (res.modifiedCount !== 1) continue;
    cancelled += 1;
    await Promise.all([
      ride.driverId ? Driver.updateOne({ _id: ride.driverId }, { $set: { isOnRide: false } }) : null,
      ride.userId ? User.updateOne({ _id: ride.userId, currentRideId: ride._id }, { $set: { currentRideId: null } }) : null,
    ]);
  }
  if (cancelled) logger.info(`[taxi] stale ride sweep cancelled ${cancelled} ride(s)`);
  return { cancelled };
}
