import mongoose from 'mongoose';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { sendTaxiInvoiceEmail } from '../../../services/email.service.js';
import { sendTaxiInvoiceWhatsApp } from '../../../services/whatsapp.service.js';
import { ApiError } from '../../../utils/ApiError.js';
import { normalizePoint, toPoint } from '../../../utils/geo.js';
import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../constants/index.js';
import { AdminBusinessSetting } from '../admin/models/AdminBusinessSetting.js';
import { SetPrice } from '../admin/models/SetPrice.js';
import { Vehicle } from '../admin/models/Vehicle.js';
import { Driver } from '../driver/models/Driver.js';
import { Zone } from '../driver/models/Zone.js';
import { WalletTransaction } from '../driver/models/WalletTransaction.js';
import { incrementDriverTodaySummaryForCompletedRide } from '../driver/services/driverTodaySummaryService.js';
import { applyDriverWalletAdjustment, ensureDriverWalletCanAcceptRide, settleCompletedRideWallet } from '../driver/services/walletService.js';
import { releaseDriverAssignment } from '../driver/services/driverAssignmentService.js';
import { RideBid } from '../user/models/RideBid.js';
import { Ride } from '../user/models/Ride.js';
import { User } from '../user/models/User.js';
import { UserWallet } from '../user/models/UserWallet.js';
import { consumeUserSubscriptionRide, resolveApplicableUserSubscription } from '../user/services/subscriptionService.js';
import { applyPromoToRideInTransaction } from './promoService.js';
import { getTipSettings } from './appSettingsService.js';
import { getBidRideSettings } from './transportSettingsService.js';
import { computeRideFare } from '../common/rideFare.js';
import { pickSurgeSlot, surgeFromPercent } from '../common/surgeSlot.js';
import { SurgeSlot } from '../admin/models/SurgeSlot.js';
import { measureTrip, measureTripRoad } from '../common/tripMeasure.js';
import {
  approvedTollTotal,
  computeExtraKmCharge,
  nightChargeSettings,
  normalizeRideStops,
  normalizeTripType,
  roundTripWaitMinutes,
  validateReturnAt,
} from '../common/tripExtras.js';

import { taxiReferralFor } from '../../../core/referral/referralSettings.service.js';
const clearUserActiveRideIfPresent = async (user) => {
  if (!user?.currentRideId) {
    return;
  }

  const activeRide = await Ride.findById(user.currentRideId);

  if (!activeRide) {
    user.currentRideId = null;
    await user.save();
    return;
  }

  if ([RIDE_STATUS.COMPLETED, RIDE_STATUS.CANCELLED].includes(activeRide.status)) {
    user.currentRideId = null;
    await user.save();
    return;
  }

  // Only a ride still looking for a driver is replaced by a new booking. A ride
  // a driver has accepted or started used to be cancelled here too -- so a
  // rider could book again mid-trip and end the trip with no fare and no fee.
  // (A ride untouched for 6 hours is abandoned -- nothing times rides out yet --
  // and must not block the rider forever.)
  const STALE_MS = 6 * 60 * 60 * 1000;
  const stale = activeRide.updatedAt && Date.now() - new Date(activeRide.updatedAt).getTime() > STALE_MS;
  if (activeRide.status !== RIDE_STATUS.SEARCHING && !stale) {
    throw new ApiError(409, 'You already have a ride in progress. Finish or cancel it before booking another.');
  }

  activeRide.status = RIDE_STATUS.CANCELLED;
  activeRide.liveStatus = RIDE_LIVE_STATUS.CANCELLED;
  await activeRide.save();

  await Promise.all([
    activeRide.driverId ? Driver.findByIdAndUpdate(activeRide.driverId, { isOnRide: false }) : Promise.resolve(),
    User.findByIdAndUpdate(activeRide.userId, { currentRideId: null }),
  ]);

  // Stop the old ride's dispatch flow (else retry timers keep firing) and tell the assigned/notified
  // drivers to drop it. Dynamic import avoids a circular dependency with dispatchService.
  try {
    const { stopDispatchFlow, getDispatchState, emitToDriver, emitToRoom, getRideRoom } =
      await import('./dispatchService.js');
    const state = getDispatchState(activeRide._id);
    stopDispatchFlow(activeRide._id);
    const notify = new Set([
      ...(Array.isArray(state?.notifiedDriverIds) ? state.notifiedDriverIds.map(String) : []),
      ...(activeRide.driverId ? [String(activeRide.driverId)] : []),
    ]);
    for (const dId of notify) {
      emitToDriver(dId, 'rideRequestClosed', {
        rideId: String(activeRide._id),
        reason: 'user-started-new-ride',
      });
    }
    emitToRoom(getRideRoom(activeRide._id), 'rideCancelled', {
      rideId: String(activeRide._id),
      reason: 'A new ride request was created.',
    });
  } catch (err) {
    logger.warn(`Failed to stop dispatch for superseded ride ${activeRide._id}: ${err.message}`);
  }

  user.currentRideId = null;
};

export const clearDriverActiveRideIfStale = async (driverOrId) => {
  const driver =
    typeof driverOrId === 'object' && driverOrId?._id
      ? driverOrId
      : await Driver.findById(driverOrId);

  if (!driver?.isOnRide) {
    return driver;
  }

  const activeRide = await Ride.findOne({
    driverId: driver._id,
    status: { $in: activeRideStatuses },
  }).select('_id status liveStatus');

  if (activeRide) {
    return driver;
  }

  driver.isOnRide = false;
  await driver.save();

  return driver;
};

const normalizeRidePaymentMethod = (paymentMethod) => (
  !paymentMethod || String(paymentMethod).trim().toLowerCase() === 'cash' ? 'cash' : 'online'
);

const normalizeServiceType = (serviceType) => {
  const normalized = String(serviceType || 'ride').trim().toLowerCase();
  return normalized === 'intercity' ? 'intercity' : 'ride';
};

/*
 * Parcel delivery was removed (not in the SOW). Old parcel rides keep their
 * serviceType and parcel fields so they still load and save; nothing may
 * create or quote a new one.
 */
const assertNotParcelBooking = ({ serviceType, transport_type } = {}) => {
  if (
    String(serviceType || '').trim().toLowerCase() === 'parcel'
    || String(transport_type || '').trim().toLowerCase() === 'delivery'
  ) {
    throw new ApiError(400, 'Parcel delivery is not available.');
  }
};

const ensureUserWallet = async (userId) => {
  if (!userId) {
    return;
  }

  await UserWallet.updateOne(
    { userId },
    { $setOnInsert: { userId, balance: 0, refundWallet: 0, transactions: [] } },
    { upsert: true },
  );
};

const getUserReferralProgramSettings = async () => {
  const setting = await AdminBusinessSetting.findOne({ scope: 'default' }).lean();
  const userReferral = await taxiReferralFor('user', setting?.referral?.user);

  return {
    enabled: Boolean(userReferral.enabled),
    type: String(userReferral.type || 'instant_referrer').trim().toLowerCase(),
    amount: Math.max(0, Number(userReferral.amount || 0) || 0),
    rideCount: Math.max(0, Number(userReferral.ride_count || 0) || 0),
  };
};

const getDriverReferralProgramSettings = async () => {
  const setting = await AdminBusinessSetting.findOne({ scope: 'default' }).lean();
  const driverReferral = await taxiReferralFor('driver', setting?.referral?.driver);

  return {
    enabled: Boolean(driverReferral.enabled),
    type: String(driverReferral.type || 'instant_referrer').trim().toLowerCase(),
    amount: Math.max(0, Number(driverReferral.amount || 0) || 0),
    rideCount: Math.max(0, Number(driverReferral.ride_count || 0) || 0),
  };
};

const creditUserWalletByReference = async ({ userId, amount, title, referenceKey }) => {
  const normalizedAmount = Math.max(0, Number(amount || 0) || 0);
  const normalizedReferenceKey = String(referenceKey || '').trim();

  if (!userId || normalizedAmount <= 0 || !normalizedReferenceKey) {
    return 'skipped';
  }

  await ensureUserWallet(userId);

  const existingTransaction = await UserWallet.findOne({
    userId,
    'transactions.referenceKey': normalizedReferenceKey,
  })
    .select('_id')
    .lean();

  if (existingTransaction) {
    return 'existing';
  }

  await UserWallet.updateOne(
    { userId },
    {
      $inc: { balance: normalizedAmount },
      $push: {
        transactions: {
          $each: [
            {
              kind: 'credit',
              amount: normalizedAmount,
              title: String(title || 'Referral Reward').trim(),
              referenceKey: normalizedReferenceKey,
            },
          ],
          $slice: -50,
        },
      },
    },
  );

  return 'credited';
};

const creditDriverWalletByReference = async ({ driverId, amount, title, referenceKey, metadata = {} }) => {
  const normalizedAmount = Math.max(0, Number(amount || 0) || 0);
  const normalizedReferenceKey = String(referenceKey || '').trim();

  if (!driverId || normalizedAmount <= 0 || !normalizedReferenceKey) {
    return 'skipped';
  }

  const existingTransaction = await WalletTransaction.findOne({
    driverId,
    'metadata.referenceKey': normalizedReferenceKey,
  })
    .select('_id')
    .lean();

  if (existingTransaction) {
    return 'existing';
  }

  await applyDriverWalletAdjustment({
    driverId,
    amount: normalizedAmount,
    type: 'adjustment',
    description: String(title || 'Referral Reward').trim(),
    metadata: {
      ...metadata,
      referenceKey: normalizedReferenceKey,
      source: 'driver_referral',
    },
  });

  return 'credited';
};

const processCompletedRideReferralReward = async (ride) => {
  if (!ride?.userId) {
    return;
  }

  const referredUser = await User.findById(ride.userId)
    .select('phone referredBy referredRideCompletionCount referralRewardGrantedAt')
    .lean();

  if (!referredUser?.referredBy || referredUser?.referralRewardGrantedAt) {
    return;
  }

  const settings = await getUserReferralProgramSettings();
  const isConditionalProgram =
    settings.enabled &&
    ['conditional_referrer', 'conditional_referrer_new'].includes(settings.type);

  if (!isConditionalProgram) {
    return;
  }

  const completedRideCount = await Ride.countDocuments({
    userId: ride.userId,
    status: RIDE_STATUS.COMPLETED,
    serviceType: { $in: ['ride', 'intercity'] },
  });

  const requiredRideCount = Math.max(1, settings.rideCount || 1);

  await User.updateOne(
    { _id: ride.userId },
    { $set: { referredRideCompletionCount: completedRideCount } },
  );

  if (completedRideCount < requiredRideCount || settings.amount <= 0) {
    return;
  }

  const rewardBaseKey = `user-referral:completed:${String(ride.userId)}:${requiredRideCount}`;
  const referrerResult = await creditUserWalletByReference({
    userId: referredUser.referredBy,
    amount: settings.amount,
    title: `Referral reward after ${completedRideCount} completed rides by ${referredUser.phone || 'referred user'}`,
    referenceKey: `${rewardBaseKey}:referrer`,
  });

  let newUserResult = 'skipped';
  if (settings.type === 'conditional_referrer_new') {
    newUserResult = await creditUserWalletByReference({
      userId: ride.userId,
      amount: settings.amount,
      title: `Referral completion reward after ${completedRideCount} rides`,
      referenceKey: `${rewardBaseKey}:new-user`,
    });
  }

  const rewardSatisfied =
    ['credited', 'existing'].includes(referrerResult) &&
    (settings.type !== 'conditional_referrer_new' || ['credited', 'existing'].includes(newUserResult));

  if (rewardSatisfied) {
    await User.updateOne(
      { _id: ride.userId },
      { $set: { referralRewardGrantedAt: new Date(), referredRideCompletionCount: completedRideCount } },
    );
  }
};

const processCompletedDriverReferralReward = async (ride) => {
  if (!ride?.driverId) {
    return;
  }

  const referredDriver = await Driver.findById(ride.driverId)
    .select('phone referredBy referredRideCompletionCount referralRewardGrantedAt')
    .lean();

  if (!referredDriver?.referredBy || referredDriver?.referralRewardGrantedAt) {
    return;
  }

  const settings = await getDriverReferralProgramSettings();
  const isConditionalProgram =
    settings.enabled &&
    ['conditional_referrer', 'conditional_referrer_new'].includes(settings.type);

  if (!isConditionalProgram) {
    return;
  }

  const completedRideCount = await Ride.countDocuments({
    driverId: ride.driverId,
    status: RIDE_STATUS.COMPLETED,
  });

  const requiredRideCount = Math.max(1, settings.rideCount || 1);

  await Driver.updateOne(
    { _id: ride.driverId },
    { $set: { referredRideCompletionCount: completedRideCount } },
  );

  if (completedRideCount < requiredRideCount || settings.amount <= 0) {
    return;
  }

  const rewardBaseKey = `driver-referral:completed:${String(ride.driverId)}:${requiredRideCount}`;
  const referrerResult = await creditDriverWalletByReference({
    driverId: referredDriver.referredBy,
    amount: settings.amount,
    title: `Referral reward after ${completedRideCount} completed rides by ${referredDriver.phone || 'referred driver'}`,
    referenceKey: `${rewardBaseKey}:referrer`,
    metadata: {
      referredDriverId: String(ride.driverId),
      completedRideCount,
    },
  });

  let newDriverResult = 'skipped';
  if (settings.type === 'conditional_referrer_new') {
    newDriverResult = await creditDriverWalletByReference({
      driverId: ride.driverId,
      amount: settings.amount,
      title: `Referral completion reward after ${completedRideCount} rides`,
      referenceKey: `${rewardBaseKey}:new-driver`,
      metadata: {
        referrerDriverId: String(referredDriver.referredBy),
        completedRideCount,
      },
    });
  }

  const rewardSatisfied =
    ['credited', 'existing'].includes(referrerResult) &&
    (settings.type !== 'conditional_referrer_new' || ['credited', 'existing'].includes(newDriverResult));

  if (rewardSatisfied) {
    await Driver.updateOne(
      { _id: ride.driverId },
      { $set: { referralRewardGrantedAt: new Date(), referredRideCompletionCount: completedRideCount } },
    );
  }
};

const normalizeAddress = (value = '') => String(value || '').trim();
const generateRideOtp = () => String(Math.floor(1000 + Math.random() * 9000));
const DEFAULT_BID_STEP_AMOUNT = 10;
const DEFAULT_MAX_BID_STEPS = 5;

const normalizeIntercityPayload = (intercity = {}) => ({
  bookingId: String(intercity.bookingId || '').trim(),
  fromCity: String(intercity.fromCity || '').trim(),
  toCity: String(intercity.toCity || '').trim(),
  tripType: String(intercity.tripType || '').trim(),
  travelDate: String(intercity.travelDate || intercity.date || '').trim(),
  passengers: Math.max(Number(intercity.passengers || 1), 1),
  distance: Math.max(Number(intercity.distance || 0), 0),
  vehicleName: String(intercity.vehicleName || '').trim(),
});

const normalizeScheduledAt = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const DRIVER_SCHEDULE_LOCK_WINDOW_MS = 30 * 60 * 1000;
const DRIVER_SCHEDULE_MIN_DURATION_MINUTES = 30;
const DRIVER_SCHEDULE_TURNOVER_BUFFER_MS = 15 * 60 * 1000;

const getScheduledRideTimestamp = (ride = {}) => {
  const scheduledAt = ride?.scheduledAt ? new Date(ride.scheduledAt) : null;
  const time = scheduledAt?.getTime?.() || NaN;
  return Number.isFinite(time) ? time : NaN;
};

export const isRideScheduledForFuture = (ride = {}, referenceTime = new Date()) => {
  const scheduledTime = getScheduledRideTimestamp(ride);
  return Number.isFinite(scheduledTime) && scheduledTime > new Date(referenceTime).getTime();
};

const getScheduledRideCommitmentWindow = (ride = {}) => {
  const scheduledTime = getScheduledRideTimestamp(ride);

  if (!Number.isFinite(scheduledTime)) {
    return null;
  }

  const durationMinutes = Math.max(
    DRIVER_SCHEDULE_MIN_DURATION_MINUTES,
    Number(ride?.estimatedDurationMinutes || 0),
  );

  return {
    startTime: scheduledTime - DRIVER_SCHEDULE_LOCK_WINDOW_MS,
    endTime:
      scheduledTime +
      (durationMinutes * 60 * 1000) +
      DRIVER_SCHEDULE_TURNOVER_BUFFER_MS,
  };
};

const doRideCommitmentWindowsOverlap = (firstWindow, secondWindow) => (
  Boolean(firstWindow)
  && Boolean(secondWindow)
  && firstWindow.startTime < secondWindow.endTime
  && secondWindow.startTime < firstWindow.endTime
);

export const findDriverConflictingScheduledRide = async ({
  driverId,
  ride,
  excludeRideId = null,
  session = null,
} = {}) => {
  const normalizedDriverId = String(driverId || '').trim();
  const targetWindow = getScheduledRideCommitmentWindow(ride);

  if (!normalizedDriverId || !targetWindow) {
    return null;
  }

  const query = {
    driverId: normalizedDriverId,
    scheduledAt: { $ne: null },
    status: { $in: [RIDE_STATUS.SEARCHING, RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] },
    liveStatus: { $nin: [RIDE_LIVE_STATUS.CANCELLED, RIDE_LIVE_STATUS.COMPLETED] },
  };

  if (excludeRideId) {
    query._id = { $ne: excludeRideId };
  }

  const ridesQuery = Ride.find(query)
    .select('_id scheduledAt estimatedDurationMinutes status liveStatus')
    .sort({ scheduledAt: 1 })
    .lean();

  if (session) {
    ridesQuery.session(session);
  }

  const rides = await ridesQuery;

  return rides.find((candidateRide) =>
    doRideCommitmentWindowsOverlap(
      targetWindow,
      getScheduledRideCommitmentWindow(candidateRide),
    )) || null;
};

export const getDriverIdsBlockedByUpcomingScheduledRides = async (
  driverIds = [],
  { referenceTime = new Date(), lockWindowMs = DRIVER_SCHEDULE_LOCK_WINDOW_MS, session = null } = {},
) => {
  const normalizedDriverIds = [...new Set((Array.isArray(driverIds) ? driverIds : [driverIds])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];

  if (normalizedDriverIds.length === 0) {
    return new Set();
  }

  const windowStart = new Date(referenceTime);
  const windowEnd = new Date(windowStart.getTime() + Math.max(0, Number(lockWindowMs) || 0));
  const query = {
    driverId: { $in: normalizedDriverIds },
    scheduledAt: {
      $ne: null,
      $lte: windowEnd,
    },
    status: { $in: [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] },
    liveStatus: { $nin: [RIDE_LIVE_STATUS.CANCELLED, RIDE_LIVE_STATUS.COMPLETED] },
  };

  const ridesQuery = Ride.find(query).select('driverId').lean();
  if (session) {
    ridesQuery.session(session);
  }

  const rides = await ridesQuery;
  return new Set(
    rides
      .map((ride) => String(ride?.driverId || '').trim())
      .filter(Boolean),
  );
};

const normalizeVehicleTypeIds = (vehicleTypeIds = [], vehicleTypeId = null) => {
  const values = Array.isArray(vehicleTypeIds) ? vehicleTypeIds : [vehicleTypeIds];

  if (vehicleTypeId) {
    values.push(vehicleTypeId);
  }

  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
};

const normalizeVehicleKey = (value = '') => String(value || '').trim().toLowerCase();

const normalizeVehicleKeys = (vehicles = []) => {
  const keys = vehicles.flatMap((vehicle) => [
    vehicle?.name,
    vehicle?.vehicle_type,
    vehicle?.icon_types,
    String(vehicle?.name || '').replace(/\s+/g, '_'),
    String(vehicle?.icon_types || '').replace(/\s+/g, '_'),
  ]);

  return [...new Set(keys.map(normalizeVehicleKey).filter(Boolean))];
};

const normalizeBidStepAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : DEFAULT_BID_STEP_AMOUNT;
};

const clampPercentage = (value, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, numericValue));
};

const toPositiveNumber = (value, fallback) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
};

const alignBidAmountToStep = ({ baseFare, amount, bidStepAmount, direction = 'up' }) => {
  const safeBaseFare = Math.max(0, Math.round(Number(baseFare || 0)));
  const safeStep = normalizeBidStepAmount(bidStepAmount);
  const safeAmount = Math.max(0, Math.round(Number(amount || 0)));
  const delta = safeAmount - safeBaseFare;

  if (delta === 0) {
    return safeBaseFare;
  }

  const absoluteDelta = Math.abs(delta);
  const rawSteps = absoluteDelta / safeStep;
  const normalizedSteps = direction === 'down'
    ? Math.floor(rawSteps)
    : direction === 'nearest'
      ? Math.round(rawSteps)
      : Math.ceil(rawSteps);

  const signedDelta = Math.sign(delta) * Math.max(0, normalizedSteps) * safeStep;
  return Math.max(0, safeBaseFare + signedDelta);
};

const resolveBidRideRange = ({ baseFare, bidStepAmount, settings = {} }) => {
  const safeBaseFare = Math.max(0, Math.round(Number(baseFare || 0)));
  const safeStep = normalizeBidStepAmount(bidStepAmount);
  const driverLowPercentage = clampPercentage(settings?.bidding_low_percentage, 10);
  const driverHighPercentage = clampPercentage(settings?.bidding_high_percentage, 20);
  const userLowPercentage = clampPercentage(settings?.user_bidding_low_percentage, 10);
  const userHighPercentage = clampPercentage(settings?.user_bidding_high_percentage, 20);

  const normalizedUserLowPercentage = Math.min(userLowPercentage, userHighPercentage);
  const normalizedUserHighPercentage = Math.max(userLowPercentage, userHighPercentage);
  const normalizedDriverLowPercentage = Math.min(driverLowPercentage, driverHighPercentage);
  const normalizedDriverHighPercentage = Math.max(driverLowPercentage, driverHighPercentage);

  const driverBidFloorFare = alignBidAmountToStep({
    baseFare: safeBaseFare,
    amount: safeBaseFare * (1 - (normalizedDriverLowPercentage / 100)),
    bidStepAmount: safeStep,
    direction: 'down',
  });
  const driverBidCeilingFare = alignBidAmountToStep({
    baseFare: safeBaseFare,
    amount: safeBaseFare * (1 + (normalizedDriverHighPercentage / 100)),
    bidStepAmount: safeStep,
    direction: 'up',
  });
  const userBidFloorFare = alignBidAmountToStep({
    baseFare: safeBaseFare,
    amount: safeBaseFare * (1 + (normalizedUserLowPercentage / 100)),
    bidStepAmount: safeStep,
    direction: 'up',
  });
  const userBidCeilingFare = alignBidAmountToStep({
    baseFare: safeBaseFare,
    amount: safeBaseFare * (1 + (normalizedUserHighPercentage / 100)),
    bidStepAmount: safeStep,
    direction: 'up',
  });

  return {
    safeBaseFare,
    safeStep,
    driverBidFloorFare: Math.min(driverBidFloorFare, safeBaseFare),
    driverBidCeilingFare: Math.max(driverBidCeilingFare, safeBaseFare),
    userBidFloorFare: Math.max(userBidFloorFare, safeBaseFare),
    userBidCeilingFare: Math.max(userBidCeilingFare, safeBaseFare),
  };
};

const clampBidAmountWithinRange = ({ amount, minFare, maxFare, baseFare, bidStepAmount }) => {
  const safeBaseFare = Math.max(0, Math.round(Number(baseFare || 0)));
  const safeMinFare = Math.max(0, Math.round(Number(minFare ?? safeBaseFare)));
  const safeMaxFare = Math.max(safeMinFare, Math.round(Number(maxFare ?? safeMinFare)));
  const safeRequestedFare = Number.isFinite(Number(amount))
    ? Math.round(Number(amount))
    : safeMinFare;
  const clampedFare = Math.min(safeMaxFare, Math.max(safeMinFare, safeRequestedFare));

  return alignBidAmountToStep({
    baseFare: safeBaseFare,
    amount: clampedFare,
    bidStepAmount,
    direction: 'nearest',
  });
};

const normalizeRideBidAmount = ({ ride, bidFare }) => {
  const safeBidFare = Math.round(Number(bidFare || 0));
  const baseFare = Math.max(0, Math.round(Number(ride?.baseFare || ride?.fare || 0)));
  const bidStepAmount = normalizeBidStepAmount(ride?.bidStepAmount);
  const bidFloorFare = Math.max(0, Math.round(Number(ride?.bidFloorFare ?? baseFare)));
  const userMaxBidFare = Math.max(bidFloorFare, Math.round(Number(ride?.userMaxBidFare || baseFare)));

  if (!Number.isFinite(safeBidFare) || safeBidFare < bidFloorFare) {
    throw new ApiError(400, 'Bid fare is below the minimum allowed floor');
  }

  if (safeBidFare > userMaxBidFare) {
    throw new ApiError(400, 'Bid fare exceeds rider ceiling');
  }

  const delta = safeBidFare - baseFare;
  if (Math.abs(delta) % bidStepAmount !== 0) {
    throw new ApiError(400, `Bid fare must increase in Rs ${bidStepAmount} steps`);
  }

  return {
    bidFare: safeBidFare,
    incrementAmount: delta,
  };
};

const serializeRideBid = (bid) => ({
  id: String(bid._id),
  rideId: String(bid.rideId?._id || bid.rideId),
  driverId: String(bid.driverId?._id || bid.driverId),
  bidFare: Number(bid.bidFare || 0),
  incrementAmount: Number(bid.incrementAmount || 0),
  status: String(bid.status || 'pending'),
  createdAt: bid.createdAt || null,
  updatedAt: bid.updatedAt || null,
  driver: bid.driverId && typeof bid.driverId === 'object'
    ? {
      id: String(bid.driverId._id),
      name: bid.driverId.name || '',
      phone: bid.driverId.phone || '',
      profileImage: bid.driverId.profileImage || '',
      vehicleType: bid.driverId.vehicleType || '',
      vehicleNumber: bid.driverId.vehicleNumber || '',
      vehicleColor: bid.driverId.vehicleColor || '',
      vehicleMake: bid.driverId.vehicleMake || '',
      vehicleModel: bid.driverId.vehicleModel || '',
      rating: bid.driverId.rating || '',
    }
    : null,
});

export const normalizeAllowedRidePaymentMethods = (paymentTypes = []) => {
  const rawItems = Array.isArray(paymentTypes)
    ? paymentTypes
    : typeof paymentTypes === 'string'
      ? paymentTypes.split(',')
      : [];

  const normalized = rawItems
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item === 'cash' ? 'cash' : item === 'online' || item === 'wallet' ? 'online' : null))
    .filter(Boolean);

  const unique = [...new Set(normalized)];
  return unique.length ? unique : ['cash', 'online'];
};

export const resolveSetPriceForRide = async ({ serviceLocationId = null, zoneId = null, transportType = 'taxi', vehicleTypeId = null }) => {
  if (!vehicleTypeId) {
    return null;
  }

  const normalizedTransportType = String(transportType || 'taxi').trim().toLowerCase() || 'taxi';
  
  const transportFilters = normalizedTransportType === 'intercity'
    ? [ { transport_type: 'intercity' }, { transport_type: 'both' }, { enable_outstation_ride: true } ]
    : [ { transport_type: normalizedTransportType }, { transport_type: 'both' } ];

  const filters = [];

  // Priority 1: Zone match
  for (const tFilter of transportFilters) {
    filters.push({
      vehicle_type: vehicleTypeId,
      active: 1,
      status: 'active',
      ...(serviceLocationId ? { service_location_id: serviceLocationId } : {}),
      ...(zoneId ? { zone_id: zoneId } : {}),
      ...tFilter,
    });
  }

  // Priority 2: Fallback to service location (no zone)
  for (const tFilter of transportFilters) {
    filters.push({
      vehicle_type: vehicleTypeId,
      active: 1,
      status: 'active',
      ...(serviceLocationId ? { service_location_id: serviceLocationId } : {}),
      zone_id: null,
      ...tFilter,
    });
  }

  // Priority 3: Global fallback
  for (const tFilter of transportFilters) {
    filters.push({
      vehicle_type: vehicleTypeId,
      active: 1,
      status: 'active',
      ...tFilter,
    });
  }

  for (const filter of filters) {
    const match = await SetPrice.findOne(filter).sort({ updatedAt: -1, createdAt: -1 }).lean();
    if (match) {
      return match;
    }
  }

  /*
   * No price row of its own: borrow the row of an older vehicle with the same
   * name, searched in the same priority order.
   *
   * A second "Bike" was added on 5 Sep and never given a price. Every ride on it
   * then found no row here, and the booking charged whatever the app sent --
   * which the app had priced at Sedan rates, so a 3.3 km bike ride was billed
   * Rs 113 instead of Rs 45. A namesake is the price an admin would expect it to
   * have; anything with no namesake still gets null, and the booking refuses it.
   */
  if (!mongoose.Types.ObjectId.isValid(String(vehicleTypeId))) {
    return null;
  }
  const vehicle = await Vehicle.findById(vehicleTypeId).select('name').lean();
  const name = String(vehicle?.name || '').trim();
  if (!name) {
    return null;
  }
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namesakes = await Vehicle.find({
    _id: { $ne: vehicle._id },
    name: new RegExp(`^\\s*${escapedName}\\s*$`, 'i'),
  })
    .sort({ createdAt: 1 })
    .select('_id')
    .lean();

  for (const namesake of namesakes) {
    for (const filter of filters) {
      const match = await SetPrice.findOne({ ...filter, vehicle_type: namesake._id })
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();
      if (match) {
        return { ...match, borrowedFromVehicleTypeId: namesake._id };
      }
    }
  }

  return null;
};

/**
 * The public tariff list, plus a row for every vehicle that prices itself from a
 * namesake (see resolveSetPriceForRide).
 *
 * Apps already in the field look a vehicle's price up here by id and, finding
 * none, fall back to whichever row happens to be first -- the Sedan's. Listing
 * the borrowed row under the vehicle's own id makes them price it from the same
 * row the booking will charge from.
 */
export const addBorrowedRidePriceRows = async (rows = []) => {
  const list = Array.isArray(rows) ? rows : [];
  const pricedIds = new Set(list.map((row) => String(row?.type_id || '')).filter(Boolean));

  const vehicles = await Vehicle.find({}).select('_id name createdAt').sort({ createdAt: 1 }).lean();
  const byName = new Map();
  for (const entry of vehicles) {
    const key = String(entry?.name || '').trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(entry);
  }

  const borrowed = [];
  for (const entry of vehicles) {
    const id = String(entry._id);
    if (pricedIds.has(id)) continue;
    const key = String(entry?.name || '').trim().toLowerCase();
    const donor = (byName.get(key) || []).find(
      (candidate) => String(candidate._id) !== id && pricedIds.has(String(candidate._id)),
    );
    if (!donor) continue;
    const row = list.find(
      (candidate) => String(candidate?.type_id) === String(donor._id)
        && (candidate?.pricing_scope || 'ride') === 'ride',
    );
    if (!row) continue;
    borrowed.push({ ...row, id: `${row.id}:${id}`, type_id: id, borrowed_from_type_id: String(donor._id) });
  }

  return [...list, ...borrowed];
};

export const getAllowedRidePaymentMethodsForPricing = async ({ serviceLocationId = null, zoneId = null, transportType = 'taxi', vehicleTypeId = null }) => {
  const pricingRule = await resolveSetPriceForRide({ serviceLocationId, zoneId, transportType, vehicleTypeId });

  return {
    pricingRule,
    allowedPaymentMethods: normalizeAllowedRidePaymentMethods(pricingRule?.payment_type),
  };
};

const normalizeRideTransportType = (value = 'taxi') => {
  const normalized = String(value || 'taxi').trim().toLowerCase() || 'taxi';

  if (normalized === 'both' || normalized === 'all') {
    return 'taxi';
  }

  return normalized;
};

/**
 * The active zone a pickup falls in, which decides surge.
 */
const findSurgeZoneForPickup = async ({ pickupPoint, serviceLocationId = null }) => {
  return Zone.findOne({
    ...(serviceLocationId ? { service_location_id: serviceLocationId } : {}),
    active: true,
    geometry: {
      $geoIntersects: {
        $geometry: {
          type: 'Point',
          coordinates: pickupPoint,
        },
      },
    },
  })
    .select('_id name ride_surge_enabled')
    .lean();
};

/**
 * The surge for one vehicle in the pickup zone. An admin's time slot, while it
 * runs, is a percentage of the fare and replaces the zone's flat surge; outside
 * every slot the flat surge applies as before (when the zone has it switched on).
 */
const loadZoneSurgeSlots = async (zoneId) =>
  zoneId ? SurgeSlot.find({ zone_ids: zoneId, active: true }).lean() : [];

export const resolveRideSurge = ({ surgeZone, pricingRule, slots = [], vehicleTypeId, fareBeforeSurge, at = new Date() }) => {
  const slot = pickSurgeSlot(slots, { zoneId: surgeZone?._id, vehicleTypeId, at });
  if (slot) {
    return {
      amount: surgeFromPercent(fareBeforeSurge, slot.percent),
      percent: Number(slot.percent),
      slotId: slot._id || null,
      slotName: slot.name || `${slot.start_time}-${slot.end_time}`,
    };
  }
  const amount = surgeZone?.ride_surge_enabled
    ? Math.max(0, Number(pricingRule?.ride_surge_amount || 0))
    : 0;
  return { amount, percent: 0, slotId: null, slotName: '' };
};

/**
 * What the booking screen shows: the fare each ride type would be booked at for
 * this trip. Same zone, same price lookup (borrowing included) and the same
 * calculation as createRideRecord, so the two cannot disagree.
 */
/*
 * A one-way or round trip's timing, checked: when it departs (the schedule, or
 * now), whether the return time makes sense, and how long the driver waits at
 * the destination. Shared by the quote and the booking so they price alike.
 */
const resolveTripTiming = ({ tripType, returnAt, scheduledAt, durationMinutes }) => {
  const normalizedTripType = normalizeTripType(tripType);
  const departAt = scheduledAt ? new Date(scheduledAt) : new Date();
  const pickupAt = Number.isNaN(departAt.getTime()) ? new Date() : departAt;
  if (normalizedTripType !== 'round_trip') {
    return { tripType: 'one_way', returnAt: null, pickupAt, waitMinutes: 0 };
  }
  const parsedReturnAt = returnAt ? new Date(returnAt) : null;
  const problem = validateReturnAt({ departAt: pickupAt, durationMinutes, returnAt: parsedReturnAt });
  if (problem) {
    throw new ApiError(400, problem);
  }
  return {
    tripType: 'round_trip',
    returnAt: parsedReturnAt,
    pickupAt,
    waitMinutes: roundTripWaitMinutes({ departAt: pickupAt, durationMinutes, returnAt: parsedReturnAt }),
  };
};

export const quoteRideFares = async ({
  pickupCoords,
  dropCoords,
  stops = [],
  vehicleTypeIds = [],
  transport_type,
  service_location_id,
  tripType,
  returnAt,
  scheduledAt,
}) => {
  assertNotParcelBooking({ transport_type });
  const transportType = normalizeRideTransportType(transport_type);
  const serviceLocationId =
    service_location_id && mongoose.Types.ObjectId.isValid(service_location_id)
      ? new mongoose.Types.ObjectId(service_location_id)
      : null;
  const pickupPoint = normalizePoint(pickupCoords, 'pickupCoords');
  const dropPoint = normalizePoint(dropCoords, 'dropCoords');
  // Priced through exactly the stops the booking stores.
  stops = normalizeRideStops(stops);
  // Refused at the quote, so the app says so as soon as the drop is chosen
  // rather than at "Book". Intercity quotes leave the zone by design.
  if (transportType !== 'intercity') {
    const { assertTripInsidePickupZone } = await import('./matchingService.js');
    await assertTripInsidePickupZone({ pickupCoords: pickupPoint, dropCoords: dropPoint, stops });
  }
  const surgeZone = await findSurgeZoneForPickup({ pickupPoint, serviceLocationId });
  const surgeSlots = await loadZoneSurgeSlots(surgeZone?._id);
  // Measured exactly as createRideRecord measures it.
  const trip = await measureTripRoad({ pickup: pickupPoint, drop: dropPoint, stops });
  const distanceMeters = trip ? trip.distanceMeters : 0;
  const durationMinutes = trip ? trip.durationMinutes : 0;
  const timing = resolveTripTiming({ tripType, returnAt, scheduledAt, durationMinutes });
  const tripOptions = {
    tripType: timing.tripType,
    roundTripWaitMinutes: timing.waitMinutes,
    pickupAt: timing.pickupAt,
  };

  const ids = [...new Set(
    (Array.isArray(vehicleTypeIds) ? vehicleTypeIds : [vehicleTypeIds])
      .map((id) => String(id || '').trim())
      .filter((id) => mongoose.Types.ObjectId.isValid(id)),
  )].slice(0, 20);

  return Promise.all(ids.map(async (vehicleTypeId) => {
    const { pricingRule } = await getAllowedRidePaymentMethodsForPricing({
      serviceLocationId,
      zoneId: surgeZone?._id || null,
      transportType,
      vehicleTypeId,
    });
    const base = computeRideFare({ pricingRule, transportType, distanceMeters, durationMinutes, ...tripOptions });
    const surge = base
      ? resolveRideSurge({ surgeZone, pricingRule, slots: surgeSlots, vehicleTypeId, fareBeforeSurge: base.fareBeforeSurge, at: timing.pickupAt })
      : null;
    const fare = base
      ? {
        ...computeRideFare({ pricingRule, transportType, distanceMeters, durationMinutes, surgeAmount: surge.amount, ...tripOptions }),
        surgePercent: surge.percent,
        surgeSlotName: surge.slotName,
        nightChargeWindow: base.nightCharge > 0 ? (nightChargeSettings(pricingRule)?.label || '') : '',
      }
      : null;
    // The measured trip travels with the quote so the app can SHOW the same
    // distance it is being charged for. Without it the app displayed its own
    // straight-line figure beside a road-distance fare -- two numbers for one
    // journey, and the smaller one on screen.
    return {
      vehicleTypeId,
      available: Boolean(fare),
      fare,
      measuredDistanceMeters: distanceMeters,
      measuredDurationMinutes: durationMinutes,
      distanceSource: trip ? (trip.source || 'straight_line') : 'unknown',
      tripType: timing.tripType,
      returnAt: timing.returnAt,
      stopCount: stops.length,
    };
  }));
};

const buildDriverVehicleAcceptFilter = async (ride) => {
  const vehicleTypeIds = normalizeVehicleTypeIds(ride.dispatchVehicleTypeIds || [], ride.vehicleTypeId);

  if (vehicleTypeIds.length === 0) {
    return {};
  }

  const vehicles = await Vehicle.find({ _id: { $in: vehicleTypeIds } }).select('name vehicle_type icon_types').lean();
  const vehicleTypeKeys = normalizeVehicleKeys(vehicles);
  const clauses = [
    { vehicleTypeId: { $in: vehicleTypeIds } },
    ...(vehicleTypeKeys.length
      ? [
        { vehicleType: { $in: vehicleTypeKeys } },
        { vehicleIconType: { $in: vehicleTypeKeys } },
      ]
      : []),
  ];

  return clauses.length > 1 ? { $or: clauses } : clauses[0];
};

export const createRideRecord = async ({
  userId,
  pickupCoords,
  dropCoords,
  pickupAddress,
  dropAddress,
  fare,
  // The trip's length is measured below, never taken from the caller.
  stops = [],
  vehicleTypeId,
  vehicleTypeIds,
  vehicleIconType,
  vehicleIconUrl,
  paymentMethod,
  serviceType,
  intercity,
  promo_code,
  service_location_id,
  transport_type,
  scheduledAt,
  bookingMode,
  userMaxBidFare,
  bidStepAmount,
  tripType,
  returnAt,
}) => {
  assertNotParcelBooking({ serviceType, transport_type });
  // The stops the quote priced, as the ride stores them (plan §4.1).
  const rideStops = normalizeRideStops(stops);
  stops = rideStops;

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  await clearUserActiveRideIfPresent(user);

  /*
   * Measured here rather than read from the app: the fare is priced from the
   * distance and duration, and an app that reported 0 km paid the base fare for
   * any trip. Measured the way the app measures it (common/tripMeasure.js), so
   * an honest booking is priced exactly as before.
   */
  /*
   * A ride can only start inside a service zone. Without this a pickup in no
   * zone was accepted and dispatched with no zone filter at all -- the request
   * went to any driver in range. Skipped while no zone exists, so a server not
   * yet set up keeps working.
   */
  /*
   * ...and ends in the same zone: the drop and every stop must be inside the
   * pickup's zone. Intercity trips leave it by design.
   */
  {
    const leavesZoneByDesign = normalizeServiceType(serviceType) === 'intercity'
      || normalizeRideTransportType(transport_type) === 'intercity';
    const { assertTripInsidePickupZone, findZoneByPickup } = await import('./matchingService.js');
    if (!leavesZoneByDesign) {
      await assertTripInsidePickupZone({ pickupCoords, dropCoords, stops });
    } else {
      const { Zone } = await import('../driver/models/Zone.js');
      if ((await Zone.estimatedDocumentCount()) > 0 && !(await findZoneByPickup(pickupCoords))) {
        throw new ApiError(400, 'Rides are not available at this pickup location yet. Please choose a pickup inside our service area.');
      }
    }
  }

  const measuredTrip = await measureTripRoad({ pickup: pickupCoords, drop: dropCoords, stops });
  const safeEstimatedDistanceMeters = measuredTrip ? measuredTrip.distanceMeters : 0;
  const safeEstimatedDurationMinutes = measuredTrip ? measuredTrip.durationMinutes : 0;
  const tripTiming = resolveTripTiming({
    tripType,
    returnAt,
    scheduledAt: normalizeScheduledAt(scheduledAt),
    durationMinutes: safeEstimatedDurationMinutes,
  });
  const clientFare = Number(fare);

  if (!Number.isFinite(clientFare) || clientFare < 0) {
    throw new ApiError(400, 'fare must be a positive number or zero');
  }

  const dispatchVehicleTypeIds = normalizeVehicleTypeIds(vehicleTypeIds, vehicleTypeId);

  if (dispatchVehicleTypeIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw new ApiError(400, 'vehicleTypeId is invalid');
  }

  const primaryVehicleTypeId = dispatchVehicleTypeIds[0] || null;
  const primaryVehicle = primaryVehicleTypeId
    ? await Vehicle.findById(primaryVehicleTypeId).select('icon map_icon image dispatch_type bid_step_amount bid_step_count bid_max_increase').lean()
    : null;
  const resolvedVehicleIconUrl = String(
    vehicleIconUrl || primaryVehicle?.map_icon || primaryVehicle?.icon || primaryVehicle?.image || '',
  ).trim();
  const normalizedTransportType = normalizeRideTransportType(transport_type);
  const resolvedServiceLocationId =
    service_location_id && mongoose.Types.ObjectId.isValid(service_location_id)
      ? new mongoose.Types.ObjectId(service_location_id)
      : null;
  const pickupPoint = normalizePoint(pickupCoords, 'pickupCoords');
  const surgeZone = await findSurgeZoneForPickup({
    pickupPoint,
    serviceLocationId: resolvedServiceLocationId,
  });

  const { pricingRule, allowedPaymentMethods } = await getAllowedRidePaymentMethodsForPricing({
    serviceLocationId: resolvedServiceLocationId,
    zoneId: surgeZone?._id || null,
    transportType: normalizedTransportType,
    vehicleTypeId: primaryVehicleTypeId,
  });

  /*
   * The fare, from the vehicle's price row -- by the same calculation as the
   * quote on the booking screen (common/rideFare.js, unit-checked against real
   * rides), so the fare a rider confirms is the fare they are charged. Surge is
   * added below via rideSurgeAmount, as before.
   */
  const fareQuote = computeRideFare({
    pricingRule,
    transportType: normalizedTransportType,
    distanceMeters: safeEstimatedDistanceMeters,
    durationMinutes: safeEstimatedDurationMinutes,
    tripType: tripTiming.tripType,
    roundTripWaitMinutes: tripTiming.waitMinutes,
    pickupAt: tripTiming.pickupAt,
  });

  if (!fareQuote) {
    /*
     * This used to charge whatever fare the app sent. With no price row that
     * was the app's guess -- the new Bike was billed at Sedan rates -- and any
     * modified app could book a ride for 0. A ride type nobody priced has
     * nothing honest to charge, so it is not bookable until it is priced.
     */
    throw new ApiError(400, 'This ride type is not available here yet. Please choose another.');
  }

  const safeFare = fareQuote.fareBeforeSurge;

  const normalizedPaymentMethod = normalizeRidePaymentMethod(paymentMethod);
  const resolvedRequestedPaymentMethod = allowedPaymentMethods.includes(normalizedPaymentMethod)
    ? normalizedPaymentMethod
    : (allowedPaymentMethods[0] || 'cash');
  const supportsBidding = ['bidding', 'both'].includes(String(primaryVehicle?.dispatch_type || '').trim().toLowerCase());
  const requestedBookingMode = String(bookingMode || '').trim().toLowerCase();
  const normalizedServiceType = normalizeServiceType(serviceType);
  const bidRideSettings = await getBidRideSettings();
  const fareIncreaseWaitMinutes = toPositiveNumber(
    bidRideSettings.user_fare_increase_wait_minutes,
    2,
  );
  const isOutstationBiddingFlow = normalizedServiceType === 'intercity';
  // What this vehicle lets a waiting rider add. Zero on the ceiling means
  // step x count, which is exactly what the buttons already add up to.
  const boostStepAmount = normalizeBidStepAmount(primaryVehicle?.bid_step_amount);
  const boostStepCount = Math.max(1, Math.round(Number(primaryVehicle?.bid_step_count || 4)));
  const boostCeilingIncrease = Number(primaryVehicle?.bid_max_increase || 0) > 0
    ? Math.round(Number(primaryVehicle.bid_max_increase))
    : boostStepAmount * boostStepCount;

  // A rider who asked to bid gets driver bidding. A rider on an ordinary
  // booking, on a bidding-capable vehicle, gets the boost buttons instead:
  // they raise their own fare and dispatch goes round again at the new one.
  const pricingNegotiationMode = !supportsBidding
    ? 'none'
    : requestedBookingMode === 'bidding'
      ? 'driver_bid'
      : 'user_increment_only';
  const effectiveBookingMode = pricingNegotiationMode === 'driver_bid' ? 'bidding' : 'normal';
  const configuredBidStepAmount = pricingNegotiationMode === 'user_increment_only'
    // Per vehicle, because the sensible bump is not the same for a bike and
    // a premium car: Rs 10 moves nobody on a Rs 900 fare.
    ? boostStepAmount
    : pricingNegotiationMode !== 'none'
      ? normalizeBidStepAmount(
        isOutstationBiddingFlow
          ? bidRideSettings.bidding_amount_increase_or_decrease
          : bidRideSettings.user_bidding_amount_increase_or_decrease,
      )
      : normalizeBidStepAmount(bidStepAmount);
  const effectiveBidStepAmount = configuredBidStepAmount || normalizeBidStepAmount(bidStepAmount);
  const bidRideRange = resolveBidRideRange({
    baseFare: safeFare,
    bidStepAmount: effectiveBidStepAmount,
    settings: bidRideSettings,
  });
  const effectiveUserMaxBidFare = pricingNegotiationMode === 'driver_bid'
    ? clampBidAmountWithinRange({
      amount: userMaxBidFare,
      minFare: bidRideRange.userBidFloorFare,
      maxFare: Math.min(bidRideRange.userBidCeilingFare, bidRideRange.driverBidCeilingFare),
      baseFare: safeFare,
      bidStepAmount: effectiveBidStepAmount,
    })
    // The rider agreed to the quote and may choose to add to it, so the
    // boost flow opens AT the quote rather than at the percentage floor the
    // outstation auction would have used.
    : safeFare;
  const effectiveBidFloorFare = pricingNegotiationMode === 'driver_bid'
    ? bidRideRange.driverBidFloorFare
    : safeFare;
  const effectiveBidCeilingMaxFare = pricingNegotiationMode === 'driver_bid'
    ? Math.min(bidRideRange.userBidCeilingFare, bidRideRange.driverBidCeilingFare)
    : pricingNegotiationMode === 'user_increment_only'
      // "Up to Rs X for this trip" -- the vehicle's own cap, not a percentage.
      ? safeFare + boostCeilingIncrease
      : safeFare;
  const rideSurge = resolveRideSurge({
    surgeZone,
    pricingRule,
    slots: await loadZoneSurgeSlots(surgeZone?._id),
    vehicleTypeId: primaryVehicleTypeId,
    fareBeforeSurge: safeFare,
    at: tripTiming.pickupAt,
  });
  const rideSurgeAmount = rideSurge.amount;
  const effectiveStartingFareWithoutSurge = pricingNegotiationMode === 'user_increment_only'
    ? effectiveUserMaxBidFare
    : safeFare;
  const effectiveStartingFare = effectiveStartingFareWithoutSurge + rideSurgeAmount;
  const effectiveBidFloorFareWithSurge = effectiveBidFloorFare + rideSurgeAmount;
  const effectiveUserMaxBidFareWithSurge = effectiveUserMaxBidFare + rideSurgeAmount;
  const effectiveBidCeilingMaxFareWithSurge = effectiveBidCeilingMaxFare + rideSurgeAmount;
  // Null, not now + wait: a rider watching "no captains yet" should be able
  // to add straight away. fareIncreaseWaitMinutes still spaces out the
  // increases after the first one, which is what the admin set it for.
  const nextFareIncreaseAt = null;
  const pricingSnapshot = {
    setPriceId: pricingRule?._id || null,
    starting_fare: effectiveStartingFare,
    admin_commission_type_from_driver: Number(pricingRule?.admin_commission_type_from_driver ?? 1),
    admin_commission_from_driver: Math.max(0, Number(pricingRule?.admin_commission_from_driver ?? 0)),
    waiting_charge: Math.max(0, Number(pricingRule?.waiting_charge ?? 0)),
    free_waiting_before: Math.max(0, Number(pricingRule?.free_waiting_before ?? 0)),
    free_waiting_after: Math.max(0, Number(pricingRule?.free_waiting_after ?? 0)),
    time_price: normalizedTransportType === 'intercity' && pricingRule?.outstation_time_price !== undefined && pricingRule?.outstation_time_price !== null
      ? Math.max(0, Number(pricingRule.outstation_time_price ?? 0))
      : Math.max(0, Number(pricingRule?.time_price ?? 0)),
    ride_surge_enabled: rideSurgeAmount > 0,
    ride_surge_amount: rideSurgeAmount,
    surge_percent: rideSurge.percent,
    surge_slot_id: rideSurge.slotId,
    surge_slot_name: rideSurge.slotName,
    fare_before_surge: effectiveStartingFareWithoutSurge,
    // What the rider agreed to. A promo lowers it below (see the promo branch);
    // an accepted bid replaces it (acceptRideBidAssignment).
    agreed_fare: effectiveStartingFare,
    promo_discount_applied: 0,
    surge_zone_id: surgeZone?._id || null,
    surge_zone_name: surgeZone?.name || '',
    trip_type: tripTiming.tripType,
    return_trip_fare: fareQuote.returnTripFare,
    round_trip_waiting_charge: fareQuote.roundTripWaitingCharge,
    night_charge_amount: fareQuote.nightCharge,
    service_tax_percent: Number(fareQuote.serviceTaxPercent) || 0,
    service_tax_amount: Number(fareQuote.serviceTax) || 0,
    night_charge_window: fareQuote.nightCharge > 0 ? (nightChargeSettings(pricingRule)?.label || '') : '',
    priced_distance_meters: tripTiming.tripType === 'round_trip'
      ? safeEstimatedDistanceMeters * 2
      : safeEstimatedDistanceMeters,
    price_per_distance: normalizedTransportType === 'intercity'
      ? Math.max(0, Number(pricingRule?.outstation_price_per_distance ?? 0))
      : Math.max(0, Number(pricingRule?.price_per_distance ?? 0)),
    extra_km_enabled: pricingRule?.extra_km_charge?.enabled === true,
    extra_km_tolerance_type: pricingRule?.extra_km_charge?.tolerance_type === 'km' ? 'km' : 'percent',
    extra_km_tolerance_value: Math.max(0, Number(pricingRule?.extra_km_charge?.tolerance_value ?? 10)),
    allowed_payment_methods: allowedPaymentMethods,
    user_cancellation_fee_type: pricingRule?.user_cancellation_fee_type || 'percentage',
    user_cancellation_fee: Number(pricingRule?.user_cancellation_fee ?? 0),
    driver_cancellation_fee_type: pricingRule?.driver_cancellation_fee_type || 'percentage',
    driver_cancellation_fee: Number(pricingRule?.driver_cancellation_fee ?? 0),
    enable_cancellation_charge: pricingRule?.enable_cancellation_charge !== false,
    free_cancellation_time: Number(pricingRule?.free_cancellation_time ?? 2),
    fixed_cancellation_charge: Number(pricingRule?.fixed_cancellation_charge ?? 0),
    percentage_cancellation_charge: Number(pricingRule?.percentage_cancellation_charge ?? 0),
    charge_after_driver_accepted: pricingRule?.charge_after_driver_accepted !== false,
    charge_after_driver_reached_pickup: pricingRule?.charge_after_driver_reached_pickup !== false,
    charge_after_otp: Boolean(pricingRule?.charge_after_otp),
    max_cancellation_fee: Number(pricingRule?.max_cancellation_fee ?? 0),
    enable_cancellation_reasons: pricingRule?.enable_cancellation_reasons !== false,
    cancellation_policy_message: pricingRule?.cancellation_policy_message || '',
    // Snapshotted so a cancellation on this ride pays the fee to whoever the
    // price row names. Without it every fee was treated as the admin's.
    cancellation_fee_goes_to: String(pricingRule?.cancellation_fee_goes_to || 'admin').trim().toLowerCase() === 'driver'
      ? 'driver'
      : 'admin',
    resolvedAt: pricingRule ? new Date() : null,
  };

  const promoCode = typeof promo_code === 'string' ? promo_code.trim() : '';
  const normalizedScheduledAt = normalizeScheduledAt(scheduledAt);
  const applicableSubscription = primaryVehicleTypeId
    ? await resolveApplicableUserSubscription({
      userId,
      vehicleTypeId: primaryVehicleTypeId,
    })
    : null;
  const isSubscriptionCovered = Boolean(applicableSubscription?._id);
  const subscriptionBenefitType = String(applicableSubscription?.benefit_type || '').trim().toLowerCase() === 'unlimited'
    ? 'unlimited'
    : 'limited';
  const subscriptionRideLimit = Math.max(0, Number(applicableSubscription?.ride_limit || 0));
  const subscriptionRidesUsed = Math.max(0, Number(applicableSubscription?.rides_used || 0));
  const subscriptionRidesRemaining = subscriptionBenefitType === 'unlimited'
    ? null
    : Math.max(0, subscriptionRideLimit - subscriptionRidesUsed);
  const effectiveDriverPaymentCollection = isSubscriptionCovered
    ? {
      provider: 'subscription',
      providerId: String(applicableSubscription._id),
      providerOrderId: '',
      providerPaymentId: '',
      providerMode: 'subscription_wallet',
      source: 'user_subscription',
      status: 'paid',
      amount: effectiveStartingFare,
      currency: 'INR',
      linkUrl: '',
      paidAt: new Date(),
      updatedAt: new Date(),
    }
    : undefined;
  const effectivePaymentMethod = isSubscriptionCovered ? 'online' : resolvedRequestedPaymentMethod;
  const effectiveSubscriptionUsage = isSubscriptionCovered
    ? {
      covered: true,
      subscriptionId: applicableSubscription._id,
      planId: applicableSubscription.planId || null,
      planName: applicableSubscription.name || '',
      vehicleTypeId: applicableSubscription.vehicle_type_id || primaryVehicleTypeId,
      benefitType: subscriptionBenefitType,
      fareCovered: effectiveStartingFare,
      ridesUsedBefore: subscriptionRidesUsed,
      ridesRemainingBefore: subscriptionRidesRemaining,
    }
    : undefined;

  if (scheduledAt && !normalizedScheduledAt) {
    throw new ApiError(400, 'scheduledAt is invalid');
  }

  if (isSubscriptionCovered && promoCode) {
    throw new ApiError(400, 'Promo codes cannot be combined with subscription rides');
  }

  if (!promoCode) {
    const ride = await Ride.create({
      userId,
      vehicleTypeId: primaryVehicleTypeId,
      dispatchVehicleTypeIds,
      vehicleIconType: vehicleIconType || '',
      vehicleIconUrl: resolvedVehicleIconUrl,
      serviceType: normalizedServiceType,
      pickupLocation: toPoint(pickupCoords, 'pickup'),
      pickupAddress: normalizeAddress(pickupAddress),
      dropLocation: toPoint(dropCoords, 'drop'),
      dropAddress: normalizeAddress(dropAddress),
      fare: effectiveStartingFare,
      baseFare: effectiveStartingFare,
      bookingMode: effectiveBookingMode,
      pricingNegotiationMode,
      biddingStatus: pricingNegotiationMode === 'driver_bid' ? 'open' : 'none',
      bidStepAmount: effectiveBidStepAmount,
      bidFloorFare: effectiveBidFloorFareWithSurge,
      userMaxBidFare: effectiveUserMaxBidFareWithSurge,
      bidCeilingMaxFare: effectiveBidCeilingMaxFareWithSurge,
      fareIncreaseWaitMinutes: pricingNegotiationMode === 'user_increment_only' ? fareIncreaseWaitMinutes : 0,
      nextFareIncreaseAt,
      estimatedDistanceMeters: safeEstimatedDistanceMeters,
      estimatedDurationMinutes: safeEstimatedDurationMinutes,
      paymentMethod: effectivePaymentMethod,
      driverPaymentCollection: effectiveDriverPaymentCollection,
      subscriptionUsage: effectiveSubscriptionUsage,
      otp: generateRideOtp(),
      service_location_id: resolvedServiceLocationId,
      transport_type: normalizedTransportType,
      pricingSnapshot,
      intercity: normalizeIntercityPayload(intercity),
      scheduledAt: normalizedScheduledAt,
      stops: rideStops,
      tripType: tripTiming.tripType,
      returnAt: tripTiming.returnAt,
      nightChargeAmount: fareQuote.nightCharge,
      status: RIDE_STATUS.SEARCHING,
      liveStatus: RIDE_LIVE_STATUS.SEARCHING,
      pending_cancellation_due: Number(user.pending_cancellation_due || 0),
    });

    user.currentRideId = ride._id;
    await user.save();

    return ride;
  }

  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const ride = await Ride.create(
        [
          {
            userId,
            vehicleTypeId: primaryVehicleTypeId,
            dispatchVehicleTypeIds,
            vehicleIconType: vehicleIconType || '',
            vehicleIconUrl: resolvedVehicleIconUrl,
            serviceType: normalizedServiceType,
            pickupLocation: toPoint(pickupCoords, 'pickup'),
            pickupAddress: normalizeAddress(pickupAddress),
            dropLocation: toPoint(dropCoords, 'drop'),
            dropAddress: normalizeAddress(dropAddress),
            fare: effectiveStartingFare,
            baseFare: effectiveStartingFare,
            bookingMode: effectiveBookingMode,
            pricingNegotiationMode,
            biddingStatus: pricingNegotiationMode === 'driver_bid' ? 'open' : 'none',
            bidStepAmount: effectiveBidStepAmount,
            bidFloorFare: effectiveBidFloorFareWithSurge,
            userMaxBidFare: effectiveUserMaxBidFareWithSurge,
            bidCeilingMaxFare: effectiveBidCeilingMaxFareWithSurge,
            fareIncreaseWaitMinutes: pricingNegotiationMode === 'user_increment_only' ? fareIncreaseWaitMinutes : 0,
            nextFareIncreaseAt,
            estimatedDistanceMeters: safeEstimatedDistanceMeters,
            estimatedDurationMinutes: safeEstimatedDurationMinutes,
            paymentMethod: effectivePaymentMethod,
            driverPaymentCollection: effectiveDriverPaymentCollection,
            subscriptionUsage: effectiveSubscriptionUsage,
            otp: generateRideOtp(),
            service_location_id: resolvedServiceLocationId,
            transport_type: normalizedTransportType,
            pricingSnapshot,
            intercity: normalizeIntercityPayload(intercity),
            scheduledAt: normalizedScheduledAt,
            stops: rideStops,
            tripType: tripTiming.tripType,
            returnAt: tripTiming.returnAt,
            nightChargeAmount: fareQuote.nightCharge,
            status: RIDE_STATUS.SEARCHING,
            liveStatus: RIDE_LIVE_STATUS.SEARCHING,
            pending_cancellation_due: Number(user.pending_cancellation_due || 0),
          },
        ],
        { session },
      );

      const rideDoc = ride[0];

      user.currentRideId = rideDoc._id;
      await user.save({ session });

      await applyPromoToRideInTransaction({
        session,
        ride: rideDoc,
        userId,
        code: promoCode,
        fare: safeFare,
        service_location_id,
        transport_type: transport_type || 'taxi',
        surgeAmount: rideSurgeAmount,
      });

      /*
       * The promo has set ride.fare to the discounted price. Record that as
       * the agreed fare, and the discount the platform is funding, so
       * completion charges the rider this and not the undiscounted
       * starting_fare, and the driver is still settled on the full price.
       */
      rideDoc.set('pricingSnapshot.agreed_fare', Number(rideDoc.fare || 0));
      rideDoc.set(
        'pricingSnapshot.promo_discount_applied',
        Math.max(0, Math.round((effectiveStartingFare - Number(rideDoc.fare || 0)) * 100) / 100),
      );
      await rideDoc.save({ session });

      await session.commitTransaction();
      return rideDoc;
    } catch (error) {
      lastError = error;
      await session.abortTransaction();

      const isTransient =
        typeof error?.hasErrorLabel === 'function' &&
        (error.hasErrorLabel('TransientTransactionError') || error.hasErrorLabel('UnknownTransactionCommitResult'));

      if (!isTransient || attempt === 2) {
        throw error;
      }
    } finally {
      session.endSession();
    }
  }

  throw lastError || new ApiError(500, 'Failed to create ride with promo');
};

export const getRideDetails = async (rideId) => {
  const ride = await Ride.findById(rideId)
    .populate('userId', 'name phone')
    .populate('driverId', 'name phone profileImage vehicleType vehicleIconType vehicleNumber vehicleColor vehicleMake vehicleModel vehicleImage rating vehicleTypeId');

  if (!ride) {
    throw new ApiError(404, 'Ride not found');
  }

  // If the ride was created before the icon was uploaded, fetch it fresh now
  if (!ride.vehicleIconUrl) {
    const vehicleTypeId = ride.vehicleTypeId || ride.driverId?.vehicleTypeId;
    if (vehicleTypeId) {
      const vehicleType = await Vehicle.findById(vehicleTypeId).select('map_icon icon image').lean();
      if (vehicleType) {
        ride.vehicleIconUrl = vehicleType.map_icon || vehicleType.icon || vehicleType.image || '';
      }
    }
  }

  return ride;
};

export const getRideRoom = (rideId) => `ride_${rideId}`;

const activeRideStatuses = [RIDE_STATUS.SEARCHING, RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING];

const populateRideRealtime = async (rideId) => {
  const ride = await Ride.findById(rideId)
    .populate('userId', 'name phone email')
    .populate('driverId', 'name phone profileImage vehicleType vehicleIconType vehicleNumber vehicleColor vehicleMake vehicleModel vehicleImage rating vehicleTypeId');

  if (ride && !ride.vehicleIconUrl) {
    const vehicleTypeId = ride.vehicleTypeId || ride.driverId?.vehicleTypeId;
    if (vehicleTypeId) {
      const vehicleType = await Vehicle.findById(vehicleTypeId).select('map_icon icon image').lean();
      if (vehicleType) {
        ride.vehicleIconUrl = vehicleType.map_icon || vehicleType.icon || vehicleType.image || '';
      }
    }
  }

  return ride;
};

/** A ride's stops as every app reads them: { address, lat, lng, order, reachedAt }. */
export const serializeRideStops = (stops = []) => (Array.isArray(stops) ? stops : [])
  .map((stop) => ({
    address: stop?.address || '',
    lat: Number(stop?.lat),
    lng: Number(stop?.lng),
    order: Number(stop?.order || 0),
    reachedAt: stop?.reachedAt || null,
  }))
  .sort((a, b) => a.order - b.order);

export const serializeRideTolls = (tolls = []) => (Array.isArray(tolls) ? tolls : []).map((toll) => ({
  id: String(toll?._id || ''),
  amount: Number(toll?.amount || 0),
  receiptPhotoUrl: toll?.receiptPhotoUrl || '',
  at: toll?.at || null,
  lat: toll?.lat ?? null,
  lng: toll?.lng ?? null,
  status: toll?.status || 'pending',
  autoApproved: Boolean(toll?.autoApproved),
  reviewedAt: toll?.reviewedAt || null,
  note: toll?.note || '',
}));

export const serializeRideRealtime = (ride) => ({
  rideId: String(ride._id),
  room: getRideRoom(ride._id),
  type: ride.serviceType || 'ride',
  serviceType: ride.serviceType || 'ride',
  status: ride.status,
  liveStatus: ride.liveStatus,
  fare: ride.fare,
  baseFare: Number(ride.baseFare || ride.fare || 0),
  waitingChargeAmount: Number(ride.waitingChargeAmount || 0),
  distanceChargeAmount: Number(ride.distanceChargeAmount || 0),
  timeChargeAmount: Number(ride.timeChargeAmount || 0),
  additionalCharge: Number(ride.additionalCharge || 0),
  adminExtraCharge: ride.adminExtraCharge?.amount ? {
    amount: Number(ride.adminExtraCharge.amount || 0),
    reason: ride.adminExtraCharge.reason || '',
  } : null,
  recovered_cancellation_due: Number(ride.recovered_cancellation_due || 0),
  bookingMode: ride.bookingMode || 'normal',
  pricingNegotiationMode: ride.pricingNegotiationMode || 'none',
  biddingStatus: ride.biddingStatus || 'none',
  bidStepAmount: Number(ride.bidStepAmount || DEFAULT_BID_STEP_AMOUNT),
  bidFloorFare: Number(ride.bidFloorFare ?? ride.baseFare ?? ride.fare ?? 0),
  userMaxBidFare: Number(ride.userMaxBidFare || ride.fare || 0),
  bidCeilingMaxFare: Number(ride.bidCeilingMaxFare || ride.userMaxBidFare || ride.fare || 0),
  fareIncreaseWaitMinutes: Number(ride.fareIncreaseWaitMinutes || 0),
  nextFareIncreaseAt: ride.nextFareIncreaseAt || null,
  acceptedBidId: ride.acceptedBidId ? String(ride.acceptedBidId) : null,
  estimatedDistanceMeters: ride.estimatedDistanceMeters || 0,
  estimatedDurationMinutes: ride.estimatedDurationMinutes || 0,
  paymentMethod: ride.paymentMethod,
  subscriptionUsage: ride.subscriptionUsage?.covered
    ? {
      covered: true,
      subscriptionId: ride.subscriptionUsage.subscriptionId ? String(ride.subscriptionUsage.subscriptionId) : '',
      planId: ride.subscriptionUsage.planId ? String(ride.subscriptionUsage.planId) : '',
      planName: ride.subscriptionUsage.planName || '',
      vehicleTypeId: ride.subscriptionUsage.vehicleTypeId ? String(ride.subscriptionUsage.vehicleTypeId) : '',
      benefitType: ride.subscriptionUsage.benefitType || '',
      fareCovered: Number(ride.subscriptionUsage.fareCovered || 0),
      ridesUsedBefore: Number(ride.subscriptionUsage.ridesUsedBefore || 0),
      ridesRemainingBefore: ride.subscriptionUsage.ridesRemainingBefore === null
        ? null
        : Number(ride.subscriptionUsage.ridesRemainingBefore || 0),
      ridesUsedAfter: ride.subscriptionUsage.ridesUsedAfter === null
        ? null
        : Number(ride.subscriptionUsage.ridesUsedAfter || 0),
      ridesRemainingAfter: ride.subscriptionUsage.ridesRemainingAfter === null
        ? null
        : Number(ride.subscriptionUsage.ridesRemainingAfter || 0),
    }
    : null,
  driverPaymentCollection: ride.driverPaymentCollection
    ? {
      provider: ride.driverPaymentCollection.provider || '',
      providerId: ride.driverPaymentCollection.providerId || '',
      providerOrderId: ride.driverPaymentCollection.providerOrderId || '',
      providerPaymentId: ride.driverPaymentCollection.providerPaymentId || '',
      providerMode: ride.driverPaymentCollection.providerMode || '',
      source: ride.driverPaymentCollection.source || '',
      status: ride.driverPaymentCollection.status || 'pending',
      amount: Number(ride.driverPaymentCollection.amount || 0),
      currency: ride.driverPaymentCollection.currency || 'INR',
      linkUrl: ride.driverPaymentCollection.linkUrl || '',
      paidAt: ride.driverPaymentCollection.paidAt || null,
      updatedAt: ride.driverPaymentCollection.updatedAt || null,
    }
    : null,
  otp: ride.otp || '',
  intercity: ride.intercity || null,
  commissionAmount: ride.commissionAmount,
  driverEarnings: ride.driverEarnings,
  promo: ride.promo?.code ? ride.promo : null,
  pricingSnapshot: ride.pricingSnapshot
    ? {
      setPriceId: ride.pricingSnapshot.setPriceId || null,
      admin_commission_type_from_driver: Number(ride.pricingSnapshot.admin_commission_type_from_driver ?? 1),
      admin_commission_from_driver: Number(ride.pricingSnapshot.admin_commission_from_driver ?? 0),
      waiting_charge: Number(ride.pricingSnapshot.waiting_charge ?? 0),
      free_waiting_before: Number(ride.pricingSnapshot.free_waiting_before ?? 0),
      free_waiting_after: Number(ride.pricingSnapshot.free_waiting_after ?? 0),
      time_price: Number(ride.pricingSnapshot.time_price ?? 0),
      ride_surge_enabled: Boolean(ride.pricingSnapshot.ride_surge_enabled),
      ride_surge_amount: Number(ride.pricingSnapshot.ride_surge_amount ?? 0),
      fare_before_surge: Number(ride.pricingSnapshot.fare_before_surge ?? 0),
      surge_zone_id: ride.pricingSnapshot.surge_zone_id ? String(ride.pricingSnapshot.surge_zone_id) : null,
      surge_zone_name: ride.pricingSnapshot.surge_zone_name || '',
      surge_percent: Number(ride.pricingSnapshot.surge_percent ?? 0),
      surge_slot_name: ride.pricingSnapshot.surge_slot_name || '',
      trip_type: ride.pricingSnapshot.trip_type || 'one_way',
      return_trip_fare: Number(ride.pricingSnapshot.return_trip_fare ?? 0),
      round_trip_waiting_charge: Number(ride.pricingSnapshot.round_trip_waiting_charge ?? 0),
      night_charge_amount: Number(ride.pricingSnapshot.night_charge_amount ?? 0),
      night_charge_window: ride.pricingSnapshot.night_charge_window || '',
      priced_distance_meters: Number(ride.pricingSnapshot.priced_distance_meters ?? 0),
      allowed_payment_methods: normalizeAllowedRidePaymentMethods(ride.pricingSnapshot.allowed_payment_methods),
      user_cancellation_fee_type: ride.pricingSnapshot.user_cancellation_fee_type || 'percentage',
      user_cancellation_fee: Number(ride.pricingSnapshot.user_cancellation_fee ?? 0),
      driver_cancellation_fee_type: ride.pricingSnapshot.driver_cancellation_fee_type || 'percentage',
      driver_cancellation_fee: Number(ride.pricingSnapshot.driver_cancellation_fee ?? 0),
      enable_cancellation_charge: ride.pricingSnapshot.enable_cancellation_charge !== false,
      free_cancellation_time: Number(ride.pricingSnapshot.free_cancellation_time ?? 2),
      fixed_cancellation_charge: Number(ride.pricingSnapshot.fixed_cancellation_charge ?? 0),
      percentage_cancellation_charge: Number(ride.pricingSnapshot.percentage_cancellation_charge ?? 0),
      charge_after_driver_accepted: ride.pricingSnapshot.charge_after_driver_accepted !== false,
      charge_after_driver_reached_pickup: ride.pricingSnapshot.charge_after_driver_reached_pickup !== false,
      charge_after_otp: Boolean(ride.pricingSnapshot.charge_after_otp),
      max_cancellation_fee: Number(ride.pricingSnapshot.max_cancellation_fee ?? 0),
      enable_cancellation_reasons: ride.pricingSnapshot.enable_cancellation_reasons !== false,
      cancellation_policy_message: ride.pricingSnapshot.cancellation_policy_message || '',
      resolvedAt: ride.pricingSnapshot.resolvedAt || null,
    }
    : null,
  vehicleIconType: ride.vehicleIconType || '',
  vehicleIconUrl: ride.vehicleIconUrl || '',
  pickupLocation: ride.pickupLocation,
  pickupAddress: ride.pickupAddress || '',
  dropLocation: ride.dropLocation,
  dropAddress: ride.dropAddress || '',
  scheduledAt: ride.scheduledAt || null,
  // Multiple stops, round trip, tolls, night charge and extra km (plan §4.1-4.5).
  stops: serializeRideStops(ride.stops),
  tripType: ride.tripType || 'one_way',
  returnAt: ride.returnAt || null,
  tolls: serializeRideTolls(ride.tolls),
  tollChargeAmount: Number(ride.tollChargeAmount || 0),
  nightChargeAmount: Number(ride.nightChargeAmount || 0),
  extraDistance: ride.extraDistance?.evaluatedAt
    ? {
      quotedMeters: Number(ride.extraDistance.quotedMeters || 0),
      tracedMeters: Number(ride.extraDistance.tracedMeters || 0),
      traceReliable: Boolean(ride.extraDistance.traceReliable),
      allowanceKm: Number(ride.extraDistance.allowanceKm || 0),
      extraKm: Number(ride.extraDistance.extraKm || 0),
    }
    : null,
  arrivedAt: ride.arrivedAt,
  destinationArrivedAt: ride.destinationArrivedAt || null,
  startedAt: ride.startedAt,
  completedAt: ride.completedAt,
  feedback: ride.feedback || null,
  lastDriverLocation: ride.lastDriverLocation?.coordinates?.length
    ? {
      type: ride.lastDriverLocation.type,
      coordinates: ride.lastDriverLocation.coordinates,
      heading: ride.lastDriverLocation.heading,
      speed: ride.lastDriverLocation.speed,
      updatedAt: ride.lastDriverLocation.updatedAt,
    }
    : null,
  user: ride.userId,
  driver: ride.driverId,
  cancelled_by: ride.cancelled_by || '',
  cancellation_reason: ride.cancellation_reason || '',
  cancellation_charge: Number(ride.cancellation_charge || 0),
  cancellation_status: ride.cancellation_status || 'none',
  pending_cancellation_due: Number(ride.pending_cancellation_due || 0),
  recovery_status: ride.recovery_status || 'none',
  recovered_in_ride: ride.recovered_in_ride ? String(ride.recovered_in_ride) : null,
  recovered_at: ride.recovered_at || null,
  cancellation_time: ride.cancellation_time || null,
  recovered_cancellation_due: Number(ride.recovered_cancellation_due || 0),
  messages: (ride.messages || []).slice(-30).map((message) => ({
    id: String(message._id),
    senderRole: message.senderRole,
    senderId: String(message.senderId),
    message: message.message,
    sentAt: message.sentAt,
  })),
});

export const ensureRideParticipantAccess = async ({ rideId, role, entityId }) => {
  const ride = await Ride.findById(rideId);
  if (!ride) throw new ApiError(404, 'Ride not found');
  // Only the ride's own rider and driver. Every other role used to pass: the
  // taxi socket accepts any platform token (restaurant, seller, an untranslated
  // delivery partner), so any of them could join any ride room and read live
  // location, the OTP and phone numbers. No admin screen joins ride rooms.
  const owner = role === 'user' ? ride.userId : role === 'driver' ? ride.driverId : null;
  if (!owner || !entityId || String(owner) !== String(entityId)) {
    throw new ApiError(403, 'Forbidden');
  }
  return ride;
};

export const getActiveRideForIdentity = async ({ role, entityId }) => {
  if (role === 'user') {
    const user = await User.findById(entityId).select('currentRideId');

    if (!user?.currentRideId) {
      return null;
    }

    return populateRideRealtime(user.currentRideId);
  }

  if (role === 'driver') {
    const rides = await Ride.find({
      driverId: entityId,
      status: { $in: activeRideStatuses },
    })
      .sort({ updatedAt: -1 })
      .populate('userId', 'name phone')
      .populate('driverId', 'name phone profileImage vehicleType vehicleIconType vehicleNumber vehicleColor vehicleMake vehicleModel vehicleImage rating');

    return rides.find((ride) => !isRideScheduledForFuture(ride)) || null;
  }

  return null;
};

export const listRideHistoryForIdentity = async ({ role, entityId, limit = 50, page = 1, category = 'all' }) => {
  if (!['user', 'driver'].includes(role)) {
    throw new ApiError(403, 'Only riders and drivers can access ride history');
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const query = role === 'driver' ? { driverId: entityId } : { userId: entityId };
  const normalizedCategory = String(category || 'all').trim().toLowerCase();

  if (normalizedCategory === 'rides') {
    query.serviceType = 'ride';
    query.scheduledAt = null;
  } else if (normalizedCategory === 'outstation') {
    query.scheduledAt = null;
    query.serviceType = 'intercity';
  } else if (normalizedCategory === 'scheduled') {
    query.scheduledAt = { $ne: null };
  }

  const counterpartPath = role === 'driver' ? 'userId' : 'driverId';
  const counterpartSelect =
    role === 'driver'
      ? 'name phone profileImage'
      : 'name phone profileImage vehicleType vehicleIconType vehicleNumber vehicleColor vehicleMake vehicleModel vehicleImage rating';

  const ridesQuery = Ride.find(query)
    .select([
      '_id',
      'serviceType',
      'status',
      'liveStatus',
      'fare',
      'baseFare',
      'bookingMode',
      'biddingStatus',
      'bidStepAmount',
      'userMaxBidFare',
      'acceptedBidId',
      'estimatedDistanceMeters',
      'estimatedDurationMinutes',
      'paymentMethod',
      'otp',
      'intercity',
      'pricingSnapshot',
      'commissionAmount',
      'driverEarnings',
      'waitingChargeAmount',
      'distanceChargeAmount',
      'timeChargeAmount',
      'additionalCharge',
      'adminExtraCharge',
      'promo',
      'vehicleIconType',
      'vehicleIconUrl',
      'pickupLocation',
      'pickupAddress',
      'dropLocation',
      'dropAddress',
      'scheduledAt',
      'acceptedAt',
      'arrivedAt',
      'startedAt',
      'completedAt',
      'feedback',
      'createdAt',
      'updatedAt',
      'userId',
      'driverId',
      'cancelled_by',
      'cancellation_reason',
      'cancellation_charge',
      'cancellation_status',
      'pending_cancellation_due',
      'recovery_status',
      'recovered_in_ride',
      'recovered_at',
      'cancellation_time',
      'recovered_cancellation_due',
    ].join(' '))
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit)
    .populate(counterpartPath, counterpartSelect)
    .lean();

  const [rides, total] = await Promise.all([
    ridesQuery,
    Ride.countDocuments(query),
  ]);

  return {
    results: rides.map((ride) => ({
      rideId: String(ride._id),
      type: ride.serviceType || 'ride',
      serviceType: ride.serviceType || 'ride',
      status: ride.status,
      liveStatus: ride.liveStatus,
      fare: ride.fare,
      baseFare: Number(ride.baseFare || ride.fare || 0),
      bookingMode: ride.bookingMode || 'normal',
      biddingStatus: ride.biddingStatus || 'none',
      bidStepAmount: Number(ride.bidStepAmount || DEFAULT_BID_STEP_AMOUNT),
      bidFloorFare: Number(ride.bidFloorFare ?? ride.baseFare ?? ride.fare ?? 0),
      userMaxBidFare: Number(ride.userMaxBidFare || ride.fare || 0),
      bidCeilingMaxFare: Number(ride.bidCeilingMaxFare || ride.userMaxBidFare || ride.fare || 0),
      acceptedBidId: ride.acceptedBidId ? String(ride.acceptedBidId) : null,
      estimatedDistanceMeters: ride.estimatedDistanceMeters || 0,
      estimatedDurationMinutes: ride.estimatedDurationMinutes || 0,
      paymentMethod: ride.paymentMethod,
      otp: ride.otp || '',
      intercity: ride.intercity || null,
      pricingSnapshot: ride.pricingSnapshot || null,
      commissionAmount: ride.commissionAmount,
      driverEarnings: ride.driverEarnings,
      waitingChargeAmount: Number(ride.waitingChargeAmount || 0),
      distanceChargeAmount: Number(ride.distanceChargeAmount || 0),
      timeChargeAmount: Number(ride.timeChargeAmount || 0),
      additionalCharge: Number(ride.additionalCharge || 0),
      adminExtraCharge: ride.adminExtraCharge || null,
      promo: ride.promo || null,
      vehicleIconType: ride.vehicleIconType,
      // Keep history responses light; giant data URLs can stall the activity screen.
      vehicleIconUrl: String(ride.vehicleIconUrl || '').startsWith('data:') ? '' : (ride.vehicleIconUrl || ''),
      pickupLocation: ride.pickupLocation,
      pickupAddress: ride.pickupAddress || '',
      dropLocation: ride.dropLocation,
      dropAddress: ride.dropAddress || '',
      scheduledAt: ride.scheduledAt || null,
      acceptedAt: ride.acceptedAt,
      arrivedAt: ride.arrivedAt,
      startedAt: ride.startedAt,
      completedAt: ride.completedAt,
      feedback: ride.feedback || null,
      createdAt: ride.createdAt,
      updatedAt: ride.updatedAt,
      user: role === 'driver' ? (ride.userId || null) : null,
      driver: role === 'user' ? (ride.driverId || null) : null,
      cancelled_by: ride.cancelled_by || '',
      cancellation_reason: ride.cancellation_reason || '',
      cancellation_charge: Number(ride.cancellation_charge || 0),
      cancellation_status: ride.cancellation_status || 'none',
      pending_cancellation_due: Number(ride.pending_cancellation_due || 0),
      recovery_status: ride.recovery_status || 'none',
      recovered_in_ride: ride.recovered_in_ride ? String(ride.recovered_in_ride) : null,
      recovered_at: ride.recovered_at || null,
      cancellation_time: ride.cancellation_time || null,
      recovered_cancellation_due: Number(ride.recovered_cancellation_due || 0),
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      hasNextPage: safePage * safeLimit < total,
      hasPrevPage: safePage > 1,
    },
  };
};

export const acceptRideAssignment = async ({ rideId, driverId }) => {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const ride = await Ride.findOne({
        _id: rideId,
        status: RIDE_STATUS.SEARCHING,
        driverId: null,
      }).session(session);

      if (!ride) {
        throw new ApiError(409, 'Ride is no longer available for acceptance');
      }

      if (ride.bookingMode === 'bidding') {
        throw new ApiError(409, 'Bidding rides must be won through bid acceptance');
      }

      const driverVehicleFilter = await buildDriverVehicleAcceptFilter(ride);

      const driverFilter = {
        _id: driverId,
        isOnline: true,
        'wallet.isBlocked': { $ne: true },
        // Suspended drivers accepted rides over the socket, which checks no approval.
        approve: { $ne: false },
        deletedAt: null,
        isOnRide: false,
        ...driverVehicleFilter,
      };

      const driver = await Driver.findOne(driverFilter).session(session);

      if (!driver) {
        throw new ApiError(409, 'Driver is unavailable to accept this ride');
      }

      const blockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides([driverId], { session });
      if (blockedDriverIds.has(String(driverId))) {
        throw new ApiError(409, 'Driver is blocked from new rides within 30 minutes of a scheduled trip');
      }

      const conflictingScheduledRide = await findDriverConflictingScheduledRide({
        driverId,
        ride,
        excludeRideId: ride._id,
        session,
      });
      if (conflictingScheduledRide) {
        throw new ApiError(409, 'Driver already has another scheduled trip in a similar time range');
      }

      await ensureDriverWalletCanAcceptRide(driver, { session });

      ride.driverId = driver._id;
      ride.status = RIDE_STATUS.ACCEPTED;
      ride.liveStatus = RIDE_LIVE_STATUS.ACCEPTED;
      ride.acceptedAt = new Date();
      driver.isOnRide = !isRideScheduledForFuture(ride);

      // Driver unification: claim the cross-service busy-lock so this driver cannot also be
      // assigned a food delivery.
      // Flag-gated: no-op until UNIFIED_DISPATCH_ENABLED is on.
      if (env.unifiedDispatchEnabled && !isRideScheduledForFuture(ride)) {
        const { acquireDriverAssignment } = await import('../driver/services/driverAssignmentService.js');
        const locked = await acquireDriverAssignment(driver._id, 'ride', ride._id, session);
        if (!locked) {
          throw new ApiError(409, 'Driver is already on another job');
        }
      }

      await ride.save({ session });
      await driver.save({ session });
      await session.commitTransaction();

      return ride;
    } catch (error) {
      lastError = error;
      await session.abortTransaction();

      const isTransient =
        typeof error?.hasErrorLabel === 'function' &&
        (error.hasErrorLabel('TransientTransactionError') || error.hasErrorLabel('UnknownTransactionCommitResult'));

      if (!isTransient || attempt === 2) {
        throw error;
      }
    } finally {
      session.endSession();
    }
  }

  throw lastError || new ApiError(500, 'Failed to accept ride');
};

const roundRideMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

/*
 * Waiting at pickup, charged from the ride's own clock and price row: the
 * driver reported arriving (arrivedAt) and the trip started (startedAt); the
 * first free_waiting_before minutes are free and each minute after costs
 * waiting_charge. Rounded up to the minute, as the driver app displays it.
 *
 * free_waiting_after (waiting once the trip has started) is not charged: no
 * timestamp records a stop mid-trip, and the figure the app sent for it was
 * exactly the unchecked charge this replaces.
 */
const computeRideWaitingCharge = (ride) => {
  if (!ride?.arrivedAt || !ride?.startedAt) {
    return 0;
  }

  const ratePerMinute = Math.max(0, Number(ride.pricingSnapshot?.waiting_charge ?? 0));
  const freeMinutes = Math.max(0, Number(ride.pricingSnapshot?.free_waiting_before ?? 0));
  const waitedMs = new Date(ride.startedAt).getTime() - new Date(ride.arrivedAt).getTime();
  const waitedMinutes = Number.isFinite(waitedMs) ? Math.max(0, Math.ceil(waitedMs / 60000)) : 0;

  return roundRideMoney(Math.max(0, waitedMinutes - freeMinutes) * ratePerMinute);
};

/*
 * The fare the rider agreed to, before anything the trip itself adds. Rides
 * booked since agreed_fare existed carry it; for one booked before, it is
 * rebuilt the same way: the accepted bid if there was one, else the starting
 * fare less its promo.
 */
const resolveAgreedFare = async (ride) => {
  const snapshotted = ride?.pricingSnapshot?.agreed_fare;
  if (snapshotted !== null && snapshotted !== undefined && Number.isFinite(Number(snapshotted))) {
    return roundRideMoney(Math.max(0, Number(snapshotted)));
  }

  if (ride?.acceptedBidId) {
    const bid = await RideBid.findById(ride.acceptedBidId).select('bidFare').lean();
    if (Number(bid?.bidFare) > 0) {
      return roundRideMoney(bid.bidFare);
    }
  }

  const startingFare = Number(ride?.pricingSnapshot?.starting_fare || ride?.baseFare || 0);
  return roundRideMoney(Math.max(0, startingFare - resolvePromoDiscountApplied(ride)));
};

const resolvePromoDiscountApplied = (ride) => {
  const snapshotted = ride?.pricingSnapshot?.promo_discount_applied;
  if (snapshotted !== null && snapshotted !== undefined && Number.isFinite(Number(snapshotted))) {
    return roundRideMoney(Math.max(0, Number(snapshotted)));
  }

  // An accepted bid replaced the promo-discounted price.
  return ride?.acceptedBidId ? 0 : roundRideMoney(Math.max(0, Number(ride?.promo?.discount_amount || 0)));
};

/*
 * The trip trace (plan §4.5): the distance driven with the rider on board,
 * summed here from the ride's own location updates rather than taken from the
 * driver's app.
 *
 * Built to err towards the rider:
 *   - a move of under TRACE_MIN_STEP_M is GPS jitter at a standstill and is not
 *     counted until the driver has really moved;
 *   - a jump no vehicle could make (over 1 km at over 70 m/s, the same rule the
 *     driver's position uses) is dropped and counted as a rejected jump;
 *   - a silence in the updates is bridged with the straight line, which can
 *     only under-count.
 */
const TRACE_MIN_STEP_M = 25;
const TRACE_MIN_POINTS = 10;
const TRACE_MAX_GAP_SECONDS = 180;
const TRACE_MAX_REJECTED_JUMPS = 3;

const traceMeters = (a, b) => {
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const h = Math.sin(toRad(b[1] - a[1]) / 2) ** 2
    + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(toRad(b[0] - a[0]) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

export const advanceTripTrace = (trace = {}, coordinates, at = new Date()) => {
  const next = {
    distanceMeters: Number(trace?.distanceMeters || 0),
    points: Number(trace?.points || 0),
    lastCoordinates: Array.isArray(trace?.lastCoordinates) && trace.lastCoordinates.length === 2
      ? [...trace.lastCoordinates]
      : null,
    lastAt: trace?.lastAt ? new Date(trace.lastAt) : null,
    maxGapSeconds: Number(trace?.maxGapSeconds || 0),
    rejectedJumps: Number(trace?.rejectedJumps || 0),
    startedAt: trace?.startedAt ? new Date(trace.startedAt) : new Date(at),
  };
  const now = new Date(at);
  if (!next.lastCoordinates) {
    // The first point after the start; the gap from the start counts too.
    const gap = (now.getTime() - next.startedAt.getTime()) / 1000;
    next.maxGapSeconds = Math.max(next.maxGapSeconds, Number.isFinite(gap) ? gap : 0);
    return { ...next, lastCoordinates: coordinates, lastAt: now, points: next.points + 1 };
  }
  const seconds = Math.max(1, (now.getTime() - (next.lastAt?.getTime() || now.getTime())) / 1000);
  const step = traceMeters(next.lastCoordinates, coordinates);
  if (step > 1000 && step / seconds > 70) {
    return { ...next, rejectedJumps: next.rejectedJumps + 1 };
  }
  next.maxGapSeconds = Math.max(next.maxGapSeconds, seconds);
  next.points += 1;
  next.lastAt = now;
  if (step >= TRACE_MIN_STEP_M) {
    next.distanceMeters += step;
    next.lastCoordinates = coordinates;
  }
  return next;
};

/** Whether a ride's trace is good enough to bill extra km from. */
export const isTripTraceReliable = (ride) => {
  const trace = ride?.tripTrace;
  if (!trace?.startedAt || !(Number(trace.distanceMeters) > 0)) return false;
  if (Number(trace.points || 0) < TRACE_MIN_POINTS) return false;
  if (Number(trace.rejectedJumps || 0) > TRACE_MAX_REJECTED_JUMPS) return false;
  // A long silence -- an app in the background, a dead phone -- leaves the
  // trace guessing, and a guess is not billed.
  if (Number(trace.maxGapSeconds || 0) > TRACE_MAX_GAP_SECONDS) return false;
  return true;
};

const rideStatusConfig = {
  [RIDE_LIVE_STATUS.ACCEPTED]: {
    persistedStatus: RIDE_STATUS.ACCEPTED,
    allowedCurrent: [RIDE_LIVE_STATUS.ACCEPTED, RIDE_LIVE_STATUS.ARRIVING],
  },
  [RIDE_LIVE_STATUS.ARRIVING]: {
    persistedStatus: RIDE_STATUS.ACCEPTED,
    allowedCurrent: [RIDE_LIVE_STATUS.ACCEPTED, RIDE_LIVE_STATUS.ARRIVING],
  },
  [RIDE_LIVE_STATUS.STARTED]: {
    persistedStatus: RIDE_STATUS.ONGOING,
    allowedCurrent: [RIDE_LIVE_STATUS.ACCEPTED, RIDE_LIVE_STATUS.ARRIVING, RIDE_LIVE_STATUS.STARTED],
  },
  [RIDE_LIVE_STATUS.ARRIVED]: {
    persistedStatus: RIDE_STATUS.ONGOING,
    allowedCurrent: [RIDE_LIVE_STATUS.STARTED, RIDE_LIVE_STATUS.ARRIVED],
  },
  [RIDE_LIVE_STATUS.COMPLETED]: {
    persistedStatus: RIDE_STATUS.COMPLETED,
    // ponytail: a ride must be started (or arrived at destination) before it can complete;
    // allowing ACCEPTED/ARRIVING here let a driver collect fare for a trip that never ran.
    allowedCurrent: [RIDE_LIVE_STATUS.STARTED, RIDE_LIVE_STATUS.ARRIVED],
  },
};

export const updateRideLifecycle = async ({ rideId, driverId, nextStatus, paymentMethod, fare, baseFare, waitingChargeAmount, timeChargeAmount, distanceChargeAmount, additionalCharge, driverPaymentCollection, otp }) => {
  const config = rideStatusConfig[nextStatus];

  if (!config) {
    throw new ApiError(400, 'Unsupported ride status');
  }

  const ride = await Ride.findOne({ _id: rideId, driverId });

  if (!ride) {
    throw new ApiError(404, 'Assigned ride not found');
  }

  if (ride.liveStatus === nextStatus) {
    return populateRideRealtime(ride._id);
  }

  if (!config.allowedCurrent.includes(ride.liveStatus)) {
    throw new ApiError(409, `Ride cannot move from ${ride.liveStatus} to ${nextStatus}`);
  }

  // Task 7: Verify OTP on ride start.
  // ponytail: enforce for every ride that has an OTP (all rides get one at creation),
  // otherwise a driver can start without the rider present.
  if (nextStatus === RIDE_LIVE_STATUS.STARTED && ride.otp) {
    if (!otp) {
      throw new ApiError(400, 'OTP is required to start the ride');
    }
    if (String(ride.otp) !== String(otp)) {
      throw new ApiError(400, 'Invalid OTP code');
    }
  }

  ride.liveStatus = nextStatus;
  ride.status = config.persistedStatus;

  if (nextStatus === RIDE_LIVE_STATUS.ACCEPTED) {
    ride.arrivedAt = null;
  }

  if (nextStatus === RIDE_LIVE_STATUS.ARRIVING && !ride.arrivedAt) {
    /*
     * The waiting clock (billed to the rider) and "driver reached pickup" (which
     * turns a rider's cancel into a fee) both run from arrivedAt. It was stamped
     * on this tap with no location check, so a driver who never moved could run
     * up waiting charges or force the rider to cancel and pay. It is stamped
     * only when the driver's last known position is near the pickup; the status
     * itself still moves, so the trip flow is unchanged.
     */
    const ARRIVAL_RADIUS_M = 500;
    const pickup = ride.pickupLocation?.coordinates;
    const driverDoc = await Driver.findById(driverId).select('location').lean();
    const here = driverDoc?.location?.coordinates;
    let nearPickup = false;
    if (Array.isArray(pickup) && Array.isArray(here) && pickup.length === 2 && here.length === 2) {
      const toRad = (d) => (Number(d) * Math.PI) / 180;
      const [lng1, lat1] = pickup;
      const [lng2, lat2] = here;
      const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
      nearPickup = 2 * 6371000 * Math.asin(Math.sqrt(a)) <= ARRIVAL_RADIUS_M;
    }
    if (nearPickup) {
      ride.arrivedAt = new Date();
    }
  }

  if (nextStatus === RIDE_LIVE_STATUS.STARTED && !ride.startedAt) {
    ride.startedAt = new Date();
  }

  if (nextStatus === RIDE_LIVE_STATUS.STARTED && !ride.tripTrace?.startedAt) {
    // The trace of the trip itself starts here; the drive to the pickup is not
    // the rider's distance.
    ride.tripTrace = { distanceMeters: 0, points: 0, maxGapSeconds: 0, rejectedJumps: 0, startedAt: new Date(), lastAt: null };
  }

  if (nextStatus === RIDE_LIVE_STATUS.ARRIVED && !ride.destinationArrivedAt) {
    ride.destinationArrivedAt = new Date();
  }

  if (paymentMethod !== undefined && paymentMethod !== null && String(paymentMethod).trim()) {
    ride.paymentMethod = normalizeRidePaymentMethod(paymentMethod);
  }

  /*
   * No money figure is taken from the driver's app. The fare, base fare and
   * the waiting / time / distance / additional charges it sends are all
   * ignored: completing a Rs 118 ride with additionalCharge 500 and
   * waitingChargeAmount 300 billed the rider Rs 918. Waiting is measured here
   * from the ride's own timestamps and price row; an additional charge is
   * whatever an admin put on the ride; the rest of the fare is the agreed fare.
   */
  if (nextStatus === RIDE_LIVE_STATUS.STARTED) {
    // Shown on the driver's "on trip" screen, so it is set as the wait ends.
    ride.waitingChargeAmount = computeRideWaitingCharge(ride);
  }

  if (nextStatus === RIDE_LIVE_STATUS.COMPLETED) {
    ride.completedAt = new Date();
  }

  // The fare is finalised on arrival at the destination and again on
  // completion. Both runs give the same figure: nothing below depends on
  // what the fare was before.
  const isFinalizingFare = (nextStatus === RIDE_LIVE_STATUS.ARRIVED || nextStatus === RIDE_LIVE_STATUS.COMPLETED);

  if (isFinalizingFare) {
    /*
     * A cancellation fee the rider still owes is added to what this ride
     * charges them, once. It used to be recorded on the ride and wiped from
     * the rider without ever being added to the fare, so the rider was never
     * asked for it -- and settlement, assuming the fare included it, took it
     * out of the driver's earnings instead.
     */
    if (!(Number(ride.recovered_cancellation_due || 0) > 0)) {
      const userDoc = await User.findById(ride.userId).select('pending_cancellation_due');
      const pendingDue = roundRideMoney(userDoc?.pending_cancellation_due || 0);
      if (pendingDue > 0) {
        ride.recovered_cancellation_due = pendingDue;
        await User.findByIdAndUpdate(ride.userId, { $set: { pending_cancellation_due: 0 } });
      }
    }

    /*
     * Built on the fare the rider agreed to -- the promo-discounted fare, or
     * the bid they accepted -- not on starting_fare. Rebuilding from
     * starting_fare completed a Rs 59 promo ride at Rs 118, and an accepted
     * Rs 148 bid at Rs 118.
     *
     * enable_eta_price_on_complete no longer changes this. Switched off, it
     * charged whatever fare the driver's app sent; the server has no meter of
     * its own to check that against, so there is nothing honest to charge but
     * the agreed fare.
     */
    const agreedFare = await resolveAgreedFare(ride);
    const promoDiscount = resolvePromoDiscountApplied(ride);
    const waitingCharge = computeRideWaitingCharge(ride);
    const adminAdditionalCharge = roundRideMoney(Math.max(0, Number(ride.additionalCharge || 0)));
    const recoveredDue = roundRideMoney(Math.max(0, Number(ride.recovered_cancellation_due || 0)));
    /*
     * Tolls (plan §4.3): only the ones approved -- within the admin's per-ride
     * auto-approve limit, or by an admin -- as their own line. What the driver's
     * app sends as additionalCharge is still ignored; a toll it wants paid is
     * added with POST /drivers/rides/:rideId/tolls and a receipt.
     */
    const tollCharge = approvedTollTotal(ride.tolls);
    /*
     * Extra km (plan §4.5): the distance the server traced while the rider was
     * on board, against the distance the rider was quoted. Charged only past
     * the price row's tolerance, only when the row switched it on at booking,
     * and only from a trace the server trusts -- with none, nothing extra.
     */
    const snapshot = ride.pricingSnapshot || {};
    const quotedMeters = Number(snapshot.priced_distance_meters || 0) > 0
      ? Number(snapshot.priced_distance_meters)
      : Number(ride.estimatedDistanceMeters || 0) * (ride.tripType === 'round_trip' ? 2 : 1);
    const tracedMeters = Math.max(0, Number(ride.tripTrace?.distanceMeters || 0));
    const traceReliable = isTripTraceReliable(ride);
    const extraKm = computeExtraKmCharge({
      settings: snapshot.extra_km_enabled
        ? { toleranceType: snapshot.extra_km_tolerance_type === 'km' ? 'km' : 'percent', toleranceValue: Number(snapshot.extra_km_tolerance_value ?? 10) }
        : null,
      quotedMeters,
      tracedMeters,
      traceReliable,
      perKm: Math.max(0, Number(snapshot.price_per_distance || 0)),
    });

    // baseFare is the pre-promo figure, so the breakdown the apps show
    // (base - promo + waiting + additional + tolls + extra km + recovered due)
    // adds up to fare.
    ride.baseFare = roundRideMoney(agreedFare + promoDiscount);
    ride.waitingChargeAmount = waitingCharge;
    ride.timeChargeAmount = 0;
    ride.distanceChargeAmount = extraKm.amount;
    ride.tollChargeAmount = tollCharge;
    ride.extraDistance = {
      quotedMeters: Math.round(quotedMeters),
      tracedMeters: Math.round(tracedMeters),
      traceReliable,
      allowanceKm: extraKm.allowanceKm,
      extraKm: extraKm.extraKm,
      evaluatedAt: new Date(),
    };
    ride.fare = roundRideMoney(agreedFare + waitingCharge + adminAdditionalCharge + tollCharge + extraKm.amount + recoveredDue);
  }

  /*
   * The driver's own record of how they were paid is kept only for a cash
   * ride, where it is their own word about cash in their own hand. For an
   * online ride it is not: the web driver app sends { status: 'paid' } for a
   * QR it merely polled, and doing so overwrote the server's verified record
   * of that QR (driverController.refreshDriverPaymentCollection). An online
   * ride's collection is only ever written by the server.
   */
  if (driverPaymentCollection && normalizeRidePaymentMethod(ride.paymentMethod) === 'cash') {
    ride.driverPaymentCollection = driverPaymentCollection;
  }

  await ride.save();

  let walletUpdate = null;

  if (nextStatus === RIDE_LIVE_STATUS.COMPLETED) {
    await Promise.all([
      User.findByIdAndUpdate(ride.userId, { currentRideId: null }),
      Driver.findByIdAndUpdate(driverId, { isOnRide: false }),
      // Release the cross-service busy-lock. Safe no-op if this driver's lock points elsewhere
      // (it only clears when activeAssignment.id === this ride) or when the flag is off.
      releaseDriverAssignment(driverId, ride._id),
    ]);

    if (String(ride.paymentMethod || 'cash').trim().toLowerCase() === 'cash') {
      await markUserCancellationDuesAsRecovered(ride.userId, ride._id);
    }

    walletUpdate = await settleCompletedRideWallet({ rideId: ride._id });
    await consumeUserSubscriptionRide({ ride });
    const settledRide = await Ride.findById(ride._id).select('completedAt driverEarnings estimatedDistanceMeters');

    await incrementDriverTodaySummaryForCompletedRide({
      driverId,
      completedAt: settledRide?.completedAt || ride.completedAt,
      driverEarnings: settledRide?.driverEarnings,
      distanceMeters: settledRide?.estimatedDistanceMeters,
    });

    await processCompletedRideReferralReward(ride);
    await processCompletedDriverReferralReward(ride);

    // Daily order-target incentive progress (counts toward the taxiAndPorter
    // target). Fire-and-forget and
    // idempotent per rider/rule/day — must never fail ride completion.
    import('../../../core/incentives/services/incentiveService.js')
      .then(({ onTaxiRideCompleted }) => onTaxiRideCompleted({ driverId, ride }))
      .catch((err) => logger.warn(`incentive progress hook failed for ride ${ride._id}: ${err?.message || err}`));
  }

  const populatedRide = await populateRideRealtime(ride._id);
  populatedRide.$locals.walletUpdate = walletUpdate;

  if (nextStatus === RIDE_LIVE_STATUS.COMPLETED) {
    // Trigger invoice email and WhatsApp asynchronously
    sendTaxiInvoiceEmail(populatedRide, populatedRide.userId).catch(err => logger.error('Error triggering taxi invoice email', err));
    sendTaxiInvoiceWhatsApp(populatedRide, populatedRide.userId).catch(err => logger.error('Error triggering taxi invoice WhatsApp', err));
  }

  return populatedRide;
};

export const appendRideMessage = async ({ rideId, role, senderId, message }) => {
  const trimmedMessage = String(message || '').trim();

  if (!trimmedMessage) {
    throw new ApiError(400, 'Message is required');
  }

  const ride = await Ride.findById(rideId);
  if (!ride) {
    throw new ApiError(404, 'Ride not found');
  }

  let actualRole = role;
  if (!['user', 'driver'].includes(actualRole)) {
    if (String(ride.userId) === String(senderId)) {
      actualRole = 'user';
    } else if (String(ride.driverId) === String(senderId)) {
      actualRole = 'driver';
    } else {
      throw new ApiError(403, 'Only rider and driver can send ride messages');
    }
  }

  await ensureRideParticipantAccess({ rideId, role: actualRole, entityId: senderId });

  ride.messages.push({
    senderRole: actualRole,
    senderId,
    message: trimmedMessage,
  });

  if (ride.messages.length > 200) {
    ride.messages = ride.messages.slice(-200);
  }

  await ride.save();

  const latestMessage = ride.messages[ride.messages.length - 1];

  return {
    id: String(latestMessage._id),
    rideId: String(ride._id),
    senderRole: latestMessage.senderRole,
    senderId: String(latestMessage.senderId),
    message: latestMessage.message,
    sentAt: latestMessage.sentAt,
  };
};

export const updateRideDriverLocation = async ({ rideId, driverId, coordinates, heading = null, speed = null }) => {
  const normalizedCoords = normalizePoint(coordinates, 'coordinates');
  const ride = await Ride.findOne({ _id: rideId, driverId });

  if (!ride) {
    throw new ApiError(404, 'Assigned ride not found');
  }

  ride.lastDriverLocation = {
    type: 'Point',
    coordinates: normalizedCoords,
    heading: Number.isFinite(Number(heading)) ? Number(heading) : null,
    speed: Number.isFinite(Number(speed)) ? Number(speed) : null,
    updatedAt: new Date(),
  };

  if ([RIDE_LIVE_STATUS.STARTED, RIDE_LIVE_STATUS.ARRIVED].includes(ride.liveStatus)) {
    ride.tripTrace = advanceTripTrace(ride.tripTrace, normalizedCoords, new Date());
  }

  await ride.save();

  return {
    rideId: String(ride._id),
    coordinates: normalizedCoords,
    heading: ride.lastDriverLocation.heading,
    speed: ride.lastDriverLocation.speed,
    updatedAt: ride.lastDriverLocation.updatedAt,
  };
};

export const listRideBidsForUser = async ({ rideId, userId }) => {
  const ride = await Ride.findOne({ _id: rideId, userId }).select(
    '_id userId status liveStatus fare baseFare bookingMode pricingNegotiationMode biddingStatus bidStepAmount bidFloorFare userMaxBidFare bidCeilingMaxFare fareIncreaseWaitMinutes nextFareIncreaseAt acceptedBidId',
  );

  if (!ride) {
    throw new ApiError(404, 'Ride not found');
  }

  const bids = await RideBid.find({ rideId: ride._id })
    .populate('driverId', 'name phone profileImage vehicleType vehicleNumber vehicleColor vehicleMake vehicleModel rating')
    .sort({ bidFare: 1, createdAt: 1 });

  return {
    ride: serializeRideRealtime(ride),
    bids: bids.map(serializeRideBid),
  };
};

export const submitRideBid = async ({ rideId, driverId, bidFare }) => {
  const ride = await Ride.findById(rideId).select(
    '_id userId driverId vehicleTypeId dispatchVehicleTypeIds status liveStatus fare baseFare bookingMode pricingNegotiationMode biddingStatus bidStepAmount bidFloorFare userMaxBidFare bidCeilingMaxFare',
  );

  if (!ride) {
    throw new ApiError(404, 'Ride not found');
  }

  if (ride.status !== RIDE_STATUS.SEARCHING || ride.liveStatus !== RIDE_LIVE_STATUS.SEARCHING) {
    throw new ApiError(409, 'Ride is no longer open for bidding');
  }

  if (ride.pricingNegotiationMode !== 'driver_bid' || ride.bookingMode !== 'bidding' || ride.biddingStatus !== 'open') {
    throw new ApiError(409, 'Ride is not open for bidding');
  }

  const driverVehicleFilter = await buildDriverVehicleAcceptFilter(ride);
  const driver = await Driver.findOne({
    _id: driverId,
    isOnline: true,
    isOnRide: false,
    'wallet.isBlocked': { $ne: true },
    ...driverVehicleFilter,
  }).select('name phone profileImage vehicleType vehicleNumber vehicleColor vehicleMake vehicleModel rating');

  if (!driver) {
    throw new ApiError(409, 'Driver is unavailable to bid on this ride');
  }

  const blockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides([driverId]);
  if (blockedDriverIds.has(String(driverId))) {
    throw new ApiError(409, 'Driver is blocked from new rides within 30 minutes of a scheduled trip');
  }

  const conflictingScheduledRide = await findDriverConflictingScheduledRide({
    driverId,
    ride,
  });
  if (conflictingScheduledRide) {
    throw new ApiError(409, 'Driver already has another scheduled trip in a similar time range');
  }

  const normalizedBid = normalizeRideBidAmount({ ride, bidFare });

  const bid = await RideBid.findOneAndUpdate(
    { rideId: ride._id, driverId },
    {
      rideId: ride._id,
      userId: ride.userId,
      driverId,
      bidFare: normalizedBid.bidFare,
      incrementAmount: normalizedBid.incrementAmount,
      status: 'pending',
    },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
    },
  ).populate('driverId', 'name phone profileImage vehicleType vehicleNumber vehicleColor vehicleMake vehicleModel rating');

  return {
    ride: serializeRideRealtime(ride),
    bid: serializeRideBid(bid),
  };
};

export const increaseRideBidCeiling = async ({ rideId, userId, incrementSteps = 1 }) => {
  const ride = await Ride.findOne({
    _id: rideId,
    userId,
    status: RIDE_STATUS.SEARCHING,
    liveStatus: RIDE_LIVE_STATUS.SEARCHING,
  });

  if (!ride) {
    throw new ApiError(404, 'Active ride not found');
  }

  const safeSteps = Math.max(1, Math.round(Number(incrementSteps || 1)));
  const safeStepAmount = normalizeBidStepAmount(ride.bidStepAmount);
  if (ride.pricingNegotiationMode === 'driver_bid') {
    if (ride.bookingMode !== 'bidding' || ride.biddingStatus !== 'open') {
      throw new ApiError(409, 'Ride is not open for bid increases');
    }

    const nextUserMaxBidFare = Math.max(
      Number(ride.baseFare || ride.fare || 0),
      Number(ride.userMaxBidFare || ride.fare || 0) + (safeSteps * safeStepAmount),
    );
    const updatedRide = await Ride.findOneAndUpdate(
      {
        _id: rideId,
        userId,
        status: RIDE_STATUS.SEARCHING,
        liveStatus: RIDE_LIVE_STATUS.SEARCHING,
        bookingMode: 'bidding',
        biddingStatus: 'open',
        pricingNegotiationMode: 'driver_bid',
      },
      {
        $set: {
          userMaxBidFare: nextUserMaxBidFare,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!updatedRide) {
      throw new ApiError(409, 'Ride is not open for bid increases');
    }

    return serializeRideRealtime(updatedRide);
  }

  if (ride.pricingNegotiationMode !== 'user_increment_only') {
    throw new ApiError(409, 'Ride is not open for fare increases');
  }

  const nextFareIncreaseAt = ride.nextFareIncreaseAt ? new Date(ride.nextFareIncreaseAt) : null;
  if (nextFareIncreaseAt && nextFareIncreaseAt.getTime() > Date.now()) {
    throw new ApiError(409, 'Fare can be increased after the waiting time completes');
  }

  const currentFare = Math.max(0, Number(ride.fare || ride.baseFare || 0));
  const maxAllowedFare = Math.max(currentFare, Number(ride.bidCeilingMaxFare || ride.userMaxBidFare || currentFare));
  if (currentFare >= maxAllowedFare) {
    throw new ApiError(409, 'Fare is already at the configured ceiling');
  }

  const nextFare = Math.min(maxAllowedFare, currentFare + (safeSteps * safeStepAmount));
  const waitMinutes = Math.max(0, Math.round(Number(ride.fareIncreaseWaitMinutes || 0)));
  const updatedRide = await Ride.findOneAndUpdate(
    {
      _id: rideId,
      userId,
      status: RIDE_STATUS.SEARCHING,
      liveStatus: RIDE_LIVE_STATUS.SEARCHING,
      pricingNegotiationMode: 'user_increment_only',
    },
    {
      $set: {
        fare: nextFare,
        userMaxBidFare: nextFare,
        // Billing reads the snapshot first (resolveAgreedFare), so a raise that
        // left it behind charged the rider the old fare and underpaid the driver
        // who accepted at the new one.
        'pricingSnapshot.agreed_fare': nextFare,
        nextFareIncreaseAt: waitMinutes > 0 ? new Date(Date.now() + waitMinutes * 60 * 1000) : null,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!updatedRide) {
    throw new ApiError(409, 'Ride is not open for fare increases');
  }

  return serializeRideRealtime(updatedRide);
};

export const acceptRideBidAssignment = async ({ rideId, bidId, userId }) => {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const ride = await Ride.findOne({
        _id: rideId,
        userId,
        status: RIDE_STATUS.SEARCHING,
        liveStatus: RIDE_LIVE_STATUS.SEARCHING,
        bookingMode: 'bidding',
        biddingStatus: 'open',
        driverId: null,
      }).session(session);

      if (!ride) {
        throw new ApiError(409, 'Ride is no longer available for bid acceptance');
      }

      const bid = await RideBid.findOne({
        _id: bidId,
        rideId: ride._id,
        status: 'pending',
      }).session(session);

      if (!bid) {
        throw new ApiError(404, 'Bid not found');
      }

      const driverVehicleFilter = await buildDriverVehicleAcceptFilter(ride);
      const driver = await Driver.findOne({
        _id: bid.driverId,
        isOnline: true,
        isOnRide: false,
        'wallet.isBlocked': { $ne: true },
        ...driverVehicleFilter,
      }).session(session);

      if (!driver) {
        throw new ApiError(409, 'Driver is unavailable to accept this bid');
      }

      const blockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides([String(bid.driverId || '')], { session });
      if (blockedDriverIds.has(String(bid.driverId || ''))) {
        throw new ApiError(409, 'Driver is blocked from new rides within 30 minutes of a scheduled trip');
      }

      const conflictingScheduledRide = await findDriverConflictingScheduledRide({
        driverId: String(bid.driverId || ''),
        ride,
        excludeRideId: ride._id,
        session,
      });
      if (conflictingScheduledRide) {
        throw new ApiError(409, 'Driver already has another scheduled trip in a similar time range');
      }

      await ensureDriverWalletCanAcceptRide(driver, { session });

      ride.driverId = driver._id;
      ride.fare = Number(bid.bidFare || ride.fare || 0);
      /*
       * The accepted bid is now the price. Completion used to rebuild the fare
       * from starting_fare and so paid the driver the base fare instead of his
       * bid (or charged the rider more than the bid he accepted). A bid is its
       * own price, so no promo reduction applies to it.
       */
      ride.set('pricingSnapshot.agreed_fare', ride.fare);
      ride.set('pricingSnapshot.promo_discount_applied', 0);
      ride.acceptedBidId = bid._id;
      ride.status = RIDE_STATUS.ACCEPTED;
      ride.liveStatus = RIDE_LIVE_STATUS.ACCEPTED;
      ride.biddingStatus = 'accepted';
      ride.acceptedAt = new Date();
      driver.isOnRide = !isRideScheduledForFuture(ride);
      bid.status = 'accepted';

      await ride.save({ session });
      await driver.save({ session });
      await bid.save({ session });
      await RideBid.updateMany(
        {
          rideId: ride._id,
          _id: { $ne: bid._id },
          status: 'pending',
        },
        { status: 'rejected' },
        { session },
      );

      await session.commitTransaction();

      return ride;
    } catch (error) {
      lastError = error;
      await session.abortTransaction();

      const isTransient =
        typeof error?.hasErrorLabel === 'function' &&
        (error.hasErrorLabel('TransientTransactionError') || error.hasErrorLabel('UnknownTransactionCommitResult'));

      if (!isTransient || attempt === 2) {
        throw error;
      }
    } finally {
      session.endSession();
    }
  }

  throw lastError || new ApiError(500, 'Failed to accept ride bid');
};

export const submitRideFeedback = async ({ rideId, userId, rating, comment = '', tipAmount = 0 }) => {
  const numericRating = Number(rating);
  const numericTip = Number(tipAmount || 0);

  if (!Number.isInteger(numericRating) || numericRating < 0 || numericRating > 5) {
    throw new ApiError(400, 'rating must be an integer between 0 and 5');
  }

  if (!Number.isFinite(numericTip) || numericTip < 0) {
    throw new ApiError(400, 'tipAmount must be zero or greater');
  }

  const tipSettings = await getTipSettings();
  const tipsEnabled = String(tipSettings.enable_tips || '1') === '1';
  const minimumTipAmount = Number(tipSettings.min_tip_amount || 0);

  if (!tipsEnabled && numericTip > 0) {
    throw new ApiError(400, 'Tips are currently disabled');
  }

  if (
    tipsEnabled &&
    numericTip > 0 &&
    Number.isFinite(minimumTipAmount) &&
    minimumTipAmount > 0 &&
    numericTip < minimumTipAmount
  ) {
    throw new ApiError(400, `tipAmount must be at least ${minimumTipAmount}`);
  }

  const ride = await Ride.findOne({
    _id: rideId,
    userId,
    status: RIDE_STATUS.COMPLETED,
  });

  if (!ride) {
    throw new ApiError(404, 'Completed ride not found');
  }

  if (!ride.driverId) {
    throw new ApiError(409, 'Ride has no assigned driver');
  }

  if (ride.feedback?.submittedAt && Number(ride.feedback?.rating || 0) > 0) {
    throw new ApiError(409, 'Feedback already submitted for this ride');
  }

  /*
   * A tip given here is recorded as cash the rider handed the driver, and it
   * is only that on a cash ride. On a ride paid online (booked online, or a
   * cash ride the rider then paid through the app) this used to be taken as a
   * rating-only update and the tip dropped without a word -- while the rating
   * screen had shown the rider "Total = fare + tip". Such a tip has to be
   * charged, through the tip payment (POST /rides/:id/tip/razorpay/order and
   * /verify), so it is refused here rather than lost.
   *
   * 400, not 409: the web rider app (RideComplete.jsx) reads any 409 from
   * this endpoint as "already submitted" and shows success -- the silent drop
   * all over again.
   */
  const isPaidOnline = String(ride.paymentMethod || 'cash').trim().toLowerCase() === 'online';
  if (numericTip > 0 && isPaidOnline) {
    throw new ApiError(
      400,
      'This ride was paid online, so a tip has to be paid online too. Please pay the tip to add it.',
    );
  }

  if (numericTip > 0 && Number(ride.feedback?.tipAmount || 0) > 0) {
    throw new ApiError(409, 'A tip has already been recorded for this ride');
  }

  const driver = await Driver.findById(ride.driverId);

  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  if (!ride.feedback) {
    ride.feedback = {};
  }
  
  if (numericRating > 0) {
    ride.feedback.rating = numericRating;
  }
  
  if (comment) {
    ride.feedback.comment = String(comment || '').trim();
  }
  
  // A tip already paid is never overwritten by a later rating-only call.
  if (numericTip > 0) {
    ride.feedback.tipAmount = numericTip;
  }

  ride.feedback.submittedAt = new Date();

  if (numericRating > 0) {
    driver.ratingCount = Number(driver.ratingCount || 0) + 1;
    driver.totalRatingScore = Number(driver.totalRatingScore || 0) + numericRating;
    driver.rating = Number((driver.totalRatingScore / driver.ratingCount).toFixed(1));
  }

  if (numericTip > 0) {
    ride.driverEarnings = Math.round(((ride.driverEarnings || 0) + numericTip) * 100) / 100;
    
    /*
     * A cash tip goes hand to hand. It never passes through the wallet, which is
     * why balanceBefore and balanceAfter are equal here -- correctly.
     *
     * But `amount` carried the tip, and a row whose amount does not equal its own
     * balance delta breaks the one property a ledger has to have: that folding
     * every amount reproduces the balance. Summing this collection would overstate
     * every driver's balance by their lifetime tips, and the reconciler built in
     * Phase 3 would report a discrepancy on every tipped driver with no way to
     * tell a real one from this.
     *
     * So the row keeps the tip in metadata, where it is still reportable as
     * earnings, and states an amount of 0 because that is what moved in the wallet.
     * The driver is not paid less: `ride.driverEarnings` above already has it, and
     * they are holding the cash.
     */
    await WalletTransaction.create([{
        driverId: ride.driverId,
        rideId: ride._id,
        type: 'adjustment',
        amount: 0,
        balanceBefore: driver.wallet?.balance || 0,
        balanceAfter: driver.wallet?.balance || 0,
        cashLimit: driver.wallet?.cashLimit || 0,
        isBlockedAfter: driver.wallet?.isBlocked || false,
        description: `Cash tip of ${numericTip} received directly from rider`,
        metadata: {
           source: 'ride_tip',
           provider: 'cash',
           // The figure itself, for earnings reporting. Deliberately NOT `amount`.
           tipAmount: numericTip,
           movesWallet: false,
           rideId: String(ride._id),
           userId: String(userId),
        }
    }]);
  }

  await Promise.all([ride.save(), driver.save()]);

  return populateRideRealtime(ride._id);
};

export const markUserCancellationDuesAsRecovered = async (userId, currentRideId, session = null) => {
  const queryOptions = session ? { session } : {};
  const pendingRides = await Ride.find({
    userId,
    cancellation_status: 'pending',
  }).session(session);

  if (pendingRides.length > 0) {
    for (const pendingRide of pendingRides) {
      pendingRide.cancellation_status = 'recovered';
      pendingRide.recovery_status = 'recovered';
      pendingRide.recovered_in_ride = currentRideId;
      pendingRide.recovered_at = new Date();
      await pendingRide.save({ session });
    }
  }

  await User.findByIdAndUpdate(userId, {
    $set: { pending_cancellation_due: 0 }
  }, queryOptions);
};
