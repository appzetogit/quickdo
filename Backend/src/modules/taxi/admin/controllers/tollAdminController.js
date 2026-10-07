import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { emitToRideRoom } from '../../services/dispatchService.js';
import { listRideTollsForReview, reviewRideToll } from '../../services/rideExtrasService.js';
import { serializeRideTolls } from '../../services/rideService.js';
import { SOCKET_EVENTS } from '../../socket/events.js';

/** GET /admin/trips/tolls?status=pending|approved|rejected|all&page&limit */
export const listTollsForReview = asyncHandler(async (req, res) => {
  const data = await listRideTollsForReview({
    status: req.query?.status || 'pending',
    page: req.query?.page,
    limit: req.query?.limit,
  });
  res.json({ success: true, data });
});

/** PATCH /admin/trips/:rideId/tolls/:tollId { decision: 'approve'|'reject', note? } */
export const reviewToll = asyncHandler(async (req, res) => {
  const result = await reviewRideToll({
    rideId: req.params.rideId,
    tollId: req.params.tollId,
    decision: req.body?.decision,
    note: req.body?.note,
    adminId: req.auth?.sub,
  });

  emitToRideRoom(result.ride._id, SOCKET_EVENTS.RIDE_TOLLS_UPDATED, {
    rideId: String(result.ride._id),
    tolls: serializeRideTolls(result.ride.tolls),
  });

  res.json({
    success: true,
    data: { rideId: String(result.ride._id), toll: result.toll, settledToDriver: result.settledToDriver },
  });
});
