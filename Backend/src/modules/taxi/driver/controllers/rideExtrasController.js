import { emitToAdmins, emitToRideRoom } from '../../services/dispatchService.js';
import { addRideToll, markRideStopReached } from '../../services/rideExtrasService.js';
import { SOCKET_EVENTS } from '../../socket/events.js';

/**
 * POST /drivers/rides/:rideId/stops/:order/reached
 * The driver reached stop `order` (1-based). Same as the socket event
 * `ride:stop:reached`; both tell the ride room with `ride:stop:updated`.
 */
export const reachRideStop = async (req, res) => {
  const result = await markRideStopReached({
    rideId: req.params.rideId,
    driverId: req.auth.sub,
    order: req.params.order,
  });

  emitToRideRoom(result.rideId, SOCKET_EVENTS.RIDE_STOP_UPDATED, result);
  res.json({ success: true, data: result });
};

/**
 * POST /drivers/rides/:rideId/tolls
 * { amount, receiptPhotoUrl, lat?, lng?, at? }
 * Upload the receipt photo first (the existing upload endpoint), then send its URL.
 */
export const addRideTollEntry = async (req, res) => {
  const result = await addRideToll({
    rideId: req.params.rideId,
    driverId: req.auth.sub,
    amount: req.body?.amount,
    receiptPhotoUrl: req.body?.receiptPhotoUrl,
    lat: req.body?.lat,
    lng: req.body?.lng,
    at: req.body?.at,
  });

  emitToRideRoom(result.rideId, SOCKET_EVENTS.RIDE_TOLLS_UPDATED, { rideId: result.rideId, tolls: result.tolls });
  if (result.toll.status === 'pending') {
    emitToAdmins('taxi:toll:pending', { rideId: result.rideId, toll: result.toll });
  }

  res.status(201).json({ success: true, data: result });
};
