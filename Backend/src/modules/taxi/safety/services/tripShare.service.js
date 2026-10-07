/**
 * Live trip sharing (SOW plan §4.8).
 *
 * A rider (or an SOS on their ride) makes a link /track-trip/<token>. Whoever
 * opens it sees the ride's live status and position, the driver's first name
 * and the vehicle number -- and nothing else: no phone numbers, no surnames,
 * no addresses, no fare, no OTP. The link stops showing a position once the
 * ride ends, and stops working at its expiry.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { logger } from '../../../../utils/logger.js';
import TripShareLink from '../models/TripShareLink.js';
import { Ride } from '../../user/models/Ride.js';
import { RIDE_STATUS } from '../../constants/index.js';

export const TRIP_SHARE_TTL_HOURS = 24;
const TOKEN_RE = /^[a-f0-9]{48}$/;

/**
 * The web origin the link points at: TRIP_SHARE_BASE_URL, else the first
 * FRONTEND_URL. Logged once when neither is set, and the link is then a path
 * the apps can prefix themselves.
 */
let warnedNoBase = false;
export const tripShareBaseUrl = () => {
  const explicit = String(process.env.TRIP_SHARE_BASE_URL || '').trim();
  const fromFrontend = String(process.env.FRONTEND_URL || '').split(',').map((v) => v.trim()).filter(Boolean)[0] || '';
  const base = (explicit || fromFrontend).replace(/\/+$/, '');
  if (!base && !warnedNoBase) {
    warnedNoBase = true;
    logger.warn('[trip-share] TRIP_SHARE_BASE_URL / FRONTEND_URL not set; share links are relative paths');
  }
  return base;
};

export const buildTripShareUrl = (token) => `${tripShareBaseUrl()}/track-trip/${token}`;

const serializeLink = (link) => ({
  _id: link._id,
  token: link.token,
  trip_id: link.trip_id,
  expiry_time: link.expiry_time,
  status: link.status,
  url: buildTripShareUrl(link.token),
});

/**
 * A share link for the rider's own ride. Reuses one still valid, so tapping
 * Share twice (or an SOS after a share) sends the same link.
 */
export const createTripShareLink = async ({ userId, rideId }) => {
  if (!mongoose.Types.ObjectId.isValid(String(rideId || ''))) {
    throw new ApiError(400, 'trip_id is invalid');
  }
  // Only the rider's own ride: this used to accept any ride id.
  const ride = await Ride.findOne({ _id: rideId, userId }).select('_id').lean();
  if (!ride) {
    throw new ApiError(404, 'Ride not found');
  }
  return serializeLink(await ensureTripShareLink({ rideId: ride._id, userId }));
};

/** The ride's live link, made if there is none still valid. For the SOS flow too. */
export const ensureTripShareLink = async ({ rideId, userId }) => {
  const existing = await TripShareLink.findOne({
    trip_id: rideId,
    status: 'active',
    expiry_time: { $gt: new Date() },
  }).sort({ expiry_time: -1 });
  if (existing) return existing;

  return TripShareLink.create({
    user_id: userId,
    trip_id: rideId,
    token: crypto.randomBytes(24).toString('hex'),
    expiry_time: new Date(Date.now() + TRIP_SHARE_TTL_HOURS * 60 * 60 * 1000),
  });
};

const STATUS_LABELS = {
  searching: 'Looking for a driver',
  accepted: 'Driver on the way',
  arriving: 'Driver arriving',
  started: 'On trip',
  arrived: 'Reached destination',
  completed: 'Trip completed',
  cancelled: 'Trip cancelled',
};

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/**
 * GET /public/trip/:token -- the public view. 404 for a token that does not
 * exist, 410 for one expired or revoked.
 */
export const getPublicTripView = async (token) => {
  const value = String(token || '').trim().toLowerCase();
  if (!TOKEN_RE.test(value)) {
    throw new ApiError(404, 'Tracking link not found');
  }

  const link = await TripShareLink.findOne({ token: value }).lean();
  if (!link) {
    throw new ApiError(404, 'Tracking link not found');
  }
  if (link.status !== 'active' || new Date(link.expiry_time).getTime() <= Date.now()) {
    throw new ApiError(410, 'This tracking link has expired');
  }

  const ride = await Ride.findById(link.trip_id)
    .select('status liveStatus lastDriverLocation driverId tripType stops updatedAt')
    .populate('driverId', 'name vehicleNumber vehicleType vehicleColor vehicleMake vehicleModel')
    .lean();
  if (!ride) {
    throw new ApiError(404, 'Tracking link not found');
  }

  const isLive = [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING].includes(ride.status);
  const coords = ride.lastDriverLocation?.coordinates;
  const driver = ride.driverId;

  return {
    status: ride.status,
    liveStatus: ride.liveStatus,
    statusLabel: STATUS_LABELS[ride.liveStatus] || STATUS_LABELS[ride.status] || '',
    isLive,
    tripType: ride.tripType || 'one_way',
    stopsTotal: Array.isArray(ride.stops) ? ride.stops.length : 0,
    stopsReached: Array.isArray(ride.stops) ? ride.stops.filter((stop) => stop.reachedAt).length : 0,
    // Only while the trip is live: after it ends the link no longer follows anyone.
    location: isLive && Array.isArray(coords) && coords.length === 2
      ? {
        lat: Number(coords[1]),
        lng: Number(coords[0]),
        heading: ride.lastDriverLocation?.heading ?? null,
        updatedAt: ride.lastDriverLocation?.updatedAt || null,
      }
      : null,
    driver: driver
      ? {
        firstName: firstName(driver.name),
        vehicleNumber: String(driver.vehicleNumber || '').trim(),
        vehicle: [driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(' ') || String(driver.vehicleType || ''),
      }
      : null,
    expiresAt: link.expiry_time,
    updatedAt: ride.updatedAt || null,
  };
};
