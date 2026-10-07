import { asyncHandler } from '../../../../utils/asyncHandler.js';
import {
  listSos,
  recordSosLocation,
  resolveSos,
  triggerSos,
} from '../services/sos.service.js';
import { getPublicTripView } from '../services/tripShare.service.js';

/*
 * The SOS endpoints. All of them go through safety/services/sos.service.js,
 * which saves the alert, tells the admins (socket + FCM), texts the person's
 * contacts the live trip link, and records their position until resolved.
 */
const readTrigger = (req) => ({
  rideId: req.body?.rideId || req.body?.trip_id,
  serviceType: req.body?.serviceType,
  location: req.body?.location
    || (req.body?.latitude !== undefined ? { lat: req.body.latitude, lng: req.body.longitude } : null),
  locationLabel: req.body?.locationLabel,
  pickupAddress: req.body?.pickupAddress,
  dropAddress: req.body?.dropAddress,
  notes: req.body?.notes,
  tripCode: req.body?.tripCode,
  vehicleLabel: req.body?.vehicleLabel,
});

export const triggerUserSosAlert = asyncHandler(async (req, res) => {
  const payload = await triggerSos({ sourceApp: 'user', actorId: req.auth.sub, ...readTrigger(req) });
  res.json({ success: true, data: payload });
});

export const triggerDriverSosAlert = asyncHandler(async (req, res) => {
  const payload = await triggerSos({ sourceApp: 'driver', actorId: req.auth.sub, ...readTrigger(req) });
  res.json({ success: true, data: payload });
});

/** POST /users/sos/:alertId/location and /drivers/sos/:alertId/location -- every 10 s while open. */
export const updateUserSosLocation = asyncHandler(async (req, res) => {
  const result = await recordSosLocation({
    alertId: req.params.alertId,
    sourceApp: 'user',
    actorId: req.auth.sub,
    coordinates: req.body?.location || req.body,
  });
  res.json({ success: true, data: result });
});

export const updateDriverSosLocation = asyncHandler(async (req, res) => {
  const result = await recordSosLocation({
    alertId: req.params.alertId,
    sourceApp: 'driver',
    actorId: req.auth.sub,
    coordinates: req.body?.location || req.body,
  });
  res.json({ success: true, data: result });
});

export const listSafetyAlerts = asyncHandler(async (req, res) => {
  const data = await listSos({ status: req.query?.status, page: req.query?.page, limit: req.query?.limit });
  res.json({ success: true, data });
});

export const resolveSafetyAlert = asyncHandler(async (req, res) => {
  const payload = await resolveSos({ alertId: req.params.id, adminId: req.auth?.sub, note: req.body?.note });
  res.json({ success: true, data: payload });
});

/**
 * GET /public/trip/:token -- the page behind a shared trip link (plan §4.8).
 * No sign-in. Only live status, position, the driver's first name and the
 * vehicle number.
 */
export const getPublicTrip = asyncHandler(async (req, res) => {
  const data = await getPublicTripView(req.params.token);
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data });
});
