/**
 * What a driver records during a trip besides its status: reaching each stop
 * (SOW plan §4.1) and tolls paid on the way (§4.3) -- and an admin's review of
 * those tolls.
 *
 * Money rules (plan §11):
 *   - A toll reaches the rider's fare only once approved, and only at
 *     completion, as its own line (rideService.updateRideLifecycle).
 *   - A toll approved after the ride was settled cannot be billed to a rider
 *     who has already paid. The platform pays it to the driver instead, once,
 *     keyed `taxi_toll:<rideId>:<tollId>` so a repeated approval cannot pay
 *     twice.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { logger } from '../../../utils/logger.js';
import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../constants/index.js';
import { Ride } from '../user/models/Ride.js';
import {
  MAX_TOLLS_PER_RIDE,
  MAX_TOLL_AMOUNT,
  shouldAutoApproveToll,
} from '../common/tripExtras.js';
import { getTransportRideSettings } from './transportSettingsService.js';
import { serializeRideStops, serializeRideTolls } from './rideService.js';

const ON_TRIP = [RIDE_LIVE_STATUS.STARTED, RIDE_LIVE_STATUS.ARRIVED];
const money = (value) => Math.round(Number(value || 0) * 100) / 100;

const assertObjectId = (value, field) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
    throw new ApiError(400, `${field} is invalid`);
  }
};

const loadDriverRide = async ({ rideId, driverId }) => {
  assertObjectId(rideId, 'rideId');
  const ride = await Ride.findOne({ _id: rideId, driverId });
  if (!ride) {
    throw new ApiError(404, 'Assigned ride not found');
  }
  return ride;
};

/* ----------------------------------------------------------------- stops -- */

/**
 * The driver has reached stop `order`. Idempotent: reaching it again keeps the
 * first time. Only while the rider is on board -- a stop is on the trip, not on
 * the way to the pickup.
 */
export const markRideStopReached = async ({ rideId, driverId, order }) => {
  const ride = await loadDriverRide({ rideId, driverId });
  if (!ON_TRIP.includes(ride.liveStatus)) {
    throw new ApiError(409, 'Stops can be marked only once the trip has started');
  }

  const stopOrder = Number(order);
  const stop = (ride.stops || []).find((item) => Number(item.order) === stopOrder);
  if (!stop) {
    throw new ApiError(404, 'This ride has no such stop');
  }

  if (!stop.reachedAt) {
    // Conditional on the stop still being open, so two taps keep one time.
    await Ride.updateOne(
      { _id: ride._id, stops: { $elemMatch: { order: stopOrder, reachedAt: null } } },
      { $set: { 'stops.$.reachedAt': new Date() } },
    );
  }

  const updated = await Ride.findById(ride._id).select('stops').lean();
  const stops = serializeRideStops(updated?.stops);
  return {
    rideId: String(ride._id),
    order: stopOrder,
    reachedAt: stops.find((item) => item.order === stopOrder)?.reachedAt || null,
    stops,
  };
};

/* ----------------------------------------------------------------- tolls -- */

/** The admin's per-ride auto-approve limit, in rupees. 0 approves nothing. */
export const getTollAutoApproveLimit = async () => {
  const settings = await getTransportRideSettings();
  const limit = Number(settings?.toll_auto_approve_limit ?? 0);
  return Number.isFinite(limit) && limit > 0 ? limit : 0;
};

export const addRideToll = async ({ rideId, driverId, amount, receiptPhotoUrl, lat, lng, at }) => {
  const ride = await loadDriverRide({ rideId, driverId });
  if (!ON_TRIP.includes(ride.liveStatus)) {
    throw new ApiError(409, 'Tolls can be added only during the trip');
  }

  const tollAmount = money(amount);
  if (!(tollAmount > 0) || tollAmount > MAX_TOLL_AMOUNT) {
    throw new ApiError(400, `amount must be more than 0 and at most ${MAX_TOLL_AMOUNT}`);
  }
  const receipt = String(receiptPhotoUrl || '').trim();
  if (!/^https?:\/\//i.test(receipt)) {
    throw new ApiError(400, 'receiptPhotoUrl is required: upload the receipt photo first');
  }
  if ((ride.tolls || []).length >= MAX_TOLLS_PER_RIDE) {
    throw new ApiError(400, `A ride can carry at most ${MAX_TOLLS_PER_RIDE} tolls`);
  }

  const latNumber = Number(lat);
  const lngNumber = Number(lng);
  const fallback = ride.lastDriverLocation?.coordinates || [];
  const hasPoint = Number.isFinite(latNumber) && Number.isFinite(lngNumber)
    && Math.abs(latNumber) <= 90 && Math.abs(lngNumber) <= 180;
  const paidAt = at ? new Date(at) : new Date();

  const limit = await getTollAutoApproveLimit();
  const autoApproved = shouldAutoApproveToll({ tolls: ride.tolls || [], amount: tollAmount, limit });

  ride.tolls.push({
    amount: tollAmount,
    receiptPhotoUrl: receipt,
    at: Number.isNaN(paidAt.getTime()) ? new Date() : paidAt,
    lat: hasPoint ? latNumber : (Number.isFinite(Number(fallback[1])) ? Number(fallback[1]) : null),
    lng: hasPoint ? lngNumber : (Number.isFinite(Number(fallback[0])) ? Number(fallback[0]) : null),
    status: autoApproved ? 'approved' : 'pending',
    autoApproved,
    reviewedAt: autoApproved ? new Date() : null,
    reviewedBy: autoApproved ? 'auto' : '',
  });
  await ride.save();

  const toll = ride.tolls[ride.tolls.length - 1];
  return {
    rideId: String(ride._id),
    toll: serializeRideTolls([toll])[0],
    tolls: serializeRideTolls(ride.tolls),
    autoApproveLimit: limit,
  };
};

/**
 * An admin approves or rejects a pending toll.
 * Returns { ride, toll, settledToDriver } -- settledToDriver when the ride was
 * already settled and the platform paid the driver instead.
 */
export const reviewRideToll = async ({ rideId, tollId, decision, note = '', adminId = '' }) => {
  assertObjectId(rideId, 'rideId');
  assertObjectId(tollId, 'tollId');
  const normalizedDecision = String(decision || '').trim().toLowerCase();
  const status = { approve: 'approved', approved: 'approved', reject: 'rejected', rejected: 'rejected' }[normalizedDecision];
  if (!status) {
    throw new ApiError(400, "decision must be 'approve' or 'reject'");
  }

  // Claimed atomically: only a toll still pending moves, so two admins acting
  // at once cannot both decide it.
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, tolls: { $elemMatch: { _id: tollId, status: 'pending' } } },
    {
      $set: {
        'tolls.$.status': status,
        'tolls.$.reviewedAt': new Date(),
        'tolls.$.reviewedBy': String(adminId || ''),
        'tolls.$.note': String(note || '').trim().slice(0, 300),
      },
    },
    { returnDocument: 'after' },
  );

  if (!ride) {
    const exists = await Ride.exists({ _id: rideId, 'tolls._id': tollId });
    throw new ApiError(exists ? 409 : 404, exists ? 'This toll has already been reviewed' : 'Toll not found');
  }

  const toll = ride.tolls.id(tollId);
  let settledToDriver = false;

  // Already settled: the rider's fare is final, so the platform pays the toll.
  const isSettled = ride.status === RIDE_STATUS.COMPLETED || Boolean(ride.walletSettledAt);
  if (status === 'approved' && isSettled && ride.driverId) {
    const { applyDriverWalletAdjustmentByReference } = await import('./dispatchService.js');
    const result = await applyDriverWalletAdjustmentByReference({
      driverId: ride.driverId,
      amount: Number(toll.amount || 0),
      rideId: ride._id,
      description: 'Toll reimbursed (approved after the ride was completed)',
      referenceKey: `taxi_toll:${ride._id}:${toll._id}`,
      metadata: { reason: 'taxi_toll_after_completion', tollId: String(toll._id) },
    });
    settledToDriver = result.status !== 'skipped';
    await Ride.updateOne(
      { _id: ride._id, 'tolls._id': toll._id },
      { $set: { 'tolls.$.settledAfterCompletion': true } },
    );
    toll.settledAfterCompletion = true;
    logger.info(`[taxi-toll] ride ${ride._id} toll ${toll._id} approved after completion; driver reimbursed (${result.status})`);
  }

  return { ride, toll: serializeRideTolls([toll])[0], settledToDriver };
};

/** The tolls waiting for an admin (or any status), newest first. */
export const listRideTollsForReview = async ({ status = 'pending', page = 1, limit = 25 } = {}) => {
  const safeStatus = ['pending', 'approved', 'rejected', 'all'].includes(String(status)) ? String(status) : 'pending';
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const safePage = Math.max(1, Number(page) || 1);
  const tollMatch = safeStatus === 'all' ? {} : { 'tolls.status': safeStatus };

  const [rows, totals] = await Promise.all([
    Ride.aggregate([
      { $match: safeStatus === 'all' ? { 'tolls.0': { $exists: true } } : tollMatch },
      { $unwind: '$tolls' },
      { $match: tollMatch },
      { $sort: { 'tolls.at': -1 } },
      { $skip: (safePage - 1) * safeLimit },
      { $limit: safeLimit },
      {
        $lookup: {
          from: 'taxidrivers',
          localField: 'driverId',
          foreignField: '_id',
          as: 'driver',
          pipeline: [{ $project: { name: 1, phone: 1, vehicleNumber: 1 } }],
        },
      },
      {
        $project: {
          rideId: '$_id',
          status: 1,
          liveStatus: 1,
          pickupAddress: 1,
          dropAddress: 1,
          fare: 1,
          completedAt: 1,
          toll: '$tolls',
          driver: { $arrayElemAt: ['$driver', 0] },
        },
      },
    ]),
    Ride.aggregate([
      { $match: safeStatus === 'all' ? { 'tolls.0': { $exists: true } } : tollMatch },
      { $unwind: '$tolls' },
      { $match: tollMatch },
      { $count: 'total' },
    ]),
  ]);

  const total = totals[0]?.total || 0;
  return {
    results: rows.map((row) => ({
      rideId: String(row.rideId),
      rideStatus: row.status,
      liveStatus: row.liveStatus,
      pickupAddress: row.pickupAddress || '',
      dropAddress: row.dropAddress || '',
      fare: Number(row.fare || 0),
      completedAt: row.completedAt || null,
      driver: row.driver
        ? { id: String(row.driver._id), name: row.driver.name || '', phone: row.driver.phone || '', vehicleNumber: row.driver.vehicleNumber || '' }
        : null,
      toll: { ...serializeRideTolls([row.toll])[0], settledAfterCompletion: Boolean(row.toll?.settledAfterCompletion) },
    })),
    paginator: {
      current_page: safePage,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
      total,
    },
  };
};
