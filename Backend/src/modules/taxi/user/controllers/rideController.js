import crypto from 'node:crypto';
import { razorpayKeyId, razorpayKeySecret } from '../../../../core/settings/platformProfile.service.js';
import { safeSignatureEqual } from '../../../../utils/safeCompare.js';
import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { mirrorTaxiPayment } from '../../services/paymentMirror.service.js';
import { normalizePoint } from '../../../../utils/geo.js';
import { resolveConfiguredGatewayCredentials } from '../../services/paymentGatewayService.js';
import { Driver } from '../../driver/models/Driver.js';
import { WalletTransaction } from '../../driver/models/WalletTransaction.js';
import { applyDriverWalletAdjustment, creditOnlineRideEarnings } from '../../driver/services/walletService.js';
import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../../constants/index.js';
import {
  acceptRideBidAssignment,
  createRideRecord,
  ensureRideParticipantAccess,
  getAllowedRidePaymentMethodsForPricing,
  getActiveRideForIdentity,
  getRideDetails,
  getRideRoom,
  increaseRideBidCeiling,
  listRideBidsForUser,
  listRideHistoryForIdentity,
  serializeRideRealtime,
  submitRideFeedback,
  updateRideLifecycle,
  markUserCancellationDuesAsRecovered,
  quoteRideFares,
} from '../../services/rideService.js';
import {
  cancelRideByUser,
  emitToDriver,
  emitToRideRoom,
  notifyRideAccepted,
  notifyRideBiddingUpdated,
  restartRideDispatchWithLatestFare,
  startDispatchFlow,
} from '../../services/dispatchService.js';
import { buildDriverMatchFilters } from '../../services/matchingService.js';
import { SOCKET_EVENTS } from '../../socket/events.js';
import { getTipSettings } from '../../services/appSettingsService.js';
import { Ride } from '../models/Ride.js';
import { UserWallet } from '../models/UserWallet.js';

const EARTH_RADIUS_METERS = 6371000;
const AVERAGE_CITY_SPEED_KMPH = 24;
const PAYMENT_PAID_STATUSES = new Set(['paid', 'captured', 'completed']);

const toRadians = (value) => (Number(value) * Math.PI) / 180;

const calculateDistanceMeters = (fromCoords = [], toCoords = []) => {
  const [fromLng, fromLat] = fromCoords;
  const [toLng, toLat] = toCoords;

  if (![fromLng, fromLat, toLng, toLat].every((value) => Number.isFinite(Number(value)))) {
    return null;
  }

  const latDelta = toRadians(toLat - fromLat);
  const lngDelta = toRadians(toLng - fromLng);
  const startLat = toRadians(fromLat);
  const endLat = toRadians(toLat);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_METERS * c);
};

const estimateEtaMinutes = (distanceMeters) => {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return 1;
  }

  const metersPerMinute = (AVERAGE_CITY_SPEED_KMPH * 1000) / 60;
  return Math.max(1, Math.round(distanceMeters / metersPerMinute));
};

const normalizeMoneyAmount = (value, fieldName = 'amount') => {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, `${fieldName} must be greater than zero`);
  }

  return Math.round(amount * 100) / 100;
};

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

/*
 * The `mock_order_<paise>_x` + 'mock_signature_bypass' pair lets a developer
 * finish a payment without Razorpay. It was honoured in production: the
 * amount was read out of the order id and Razorpay was never asked, so a cash
 * ride could be marked paid online (the driver credited its fare from the
 * platform) and a made-up Rs 5000 tip credited the driver Rs 5000. NODE_ENV
 * alone decides. Do not widen this.
 */
const isMockPaymentAllowed = () => process.env.NODE_ENV !== 'production';

/*
 * A real payment has to be for THIS ride, and for what it is being used as.
 * The order is read back from Razorpay, and its notes were written by our own
 * create-order endpoints, so they say which ride and what for. Checking only
 * the amount let a payment for one ride (or for its tip) settle another ride
 * of the same amount.
 */
const ensureOrderIsForRide = (order, { rideId, purpose }) => {
  const notes = order?.notes || {};
  const isForThisRide = String(notes.rideId || '').trim() === String(rideId);
  const isForThisPurpose = purpose === 'tip'
    ? String(notes.kind || '') === 'ride_tip'
    : String(notes.source || '') === 'ride_completion';

  if (!isForThisRide || !isForThisPurpose) {
    throw new ApiError(400, 'This payment was not made for this ride');
  }
};

/*
 * A payment settles one thing, once. "Already used" was looked up only in the
 * wallet history of this ride's driver, so one payment could settle a second
 * ride with a different driver. Callers have already answered an idempotent
 * replay of the same payment on the same ride, so any use found here is reuse.
 */
const ensurePaymentNotUsed = async (paymentId) => {
  const [walletUse, rideUse] = await Promise.all([
    WalletTransaction.findOne({ 'metadata.providerPaymentId': paymentId }).select('_id').lean(),
    Ride.findOne({
      $or: [
        { 'driverPaymentCollection.providerPaymentId': paymentId },
        { 'feedback.tipPaymentId': paymentId },
      ],
    }).select('_id').lean(),
  ]);

  if (walletUse || rideUse) {
    throw new ApiError(409, 'This payment has already been used');
  }
};

const ensureUserWallet = async (userId, session = null) => {
  if (!userId) return;
  await UserWallet.updateOne(
    { userId },
    { $setOnInsert: { userId, balance: 0, refundWallet: 0, transactions: [] } },
    { upsert: true, ...(session ? { session } : {}) },
  );
};

const isDriverCollectionPaid = (ride = {}) =>
  Boolean(ride?.driverPaymentCollection?.paidAt) ||
  PAYMENT_PAID_STATUSES.has(String(ride?.driverPaymentCollection?.status || '').trim().toLowerCase());

const buildCompletionAmounts = (ride, tipAmount = 0) => {
  const fare = roundMoney(ride?.fare || 0);
  const recoveredDue = roundMoney(ride?.recovered_cancellation_due || 0);
  const normalizedTipAmount = roundMoney(tipAmount || 0);
  const fareDue = isDriverCollectionPaid(ride) ? 0 : fare;
  return {
    fare,
    fareDue,
    recovered_cancellation_due: recoveredDue,
    tipAmount: normalizedTipAmount,
    totalCharge: roundMoney(fareDue + normalizedTipAmount),
  };
};

const validateRideCompletionFeedback = async ({ rating, tipAmount }) => {
  const numericRating = Number(rating);
  const numericTip = roundMoney(tipAmount || 0);

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

  if (tipsEnabled && numericTip > 0 && minimumTipAmount > 0 && numericTip < minimumTipAmount) {
    throw new ApiError(400, `tipAmount must be at least ${minimumTipAmount}`);
  }

  return {
    rating: numericRating,
    tipAmount: numericTip,
  };
};

const loadCompletedRideForUser = async (rideId, userId, session = null) => {
  const ride = await Ride.findOne({
    _id: rideId,
    userId,
    status: RIDE_STATUS.COMPLETED,
  }).session(session);

  if (!ride) {
    throw new ApiError(404, 'Completed ride not found');
  }

  if (!ride.driverId) {
    throw new ApiError(409, 'Ride has no assigned driver');
  }

  return ride;
};

const finalizeRideCompletion = async ({
  ride,
  userId,
  rating,
  comment = '',
  tipAmount = 0,
  paymentRecord = null,
  paymentSource = '',
  session = null,
}) => {
  if (ride.feedback?.submittedAt) {
    const samePayment =
      (paymentRecord?.providerPaymentId && String(ride.driverPaymentCollection?.providerPaymentId || '') === paymentRecord.providerPaymentId) ||
      (paymentRecord?.providerPaymentId && String(ride.feedback?.tipPaymentId || '') === paymentRecord.providerPaymentId);

    if (samePayment) {
      return getRideDetails(ride._id);
    }

    throw new ApiError(409, 'Feedback already submitted for this ride');
  }

  const driver = await Driver.findById(ride.driverId).session(session);
  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const { fare, fareDue, totalCharge } = buildCompletionAmounts(ride, tipAmount);
  const previousPaymentMethod = String(ride.paymentMethod || 'cash').trim().toLowerCase() === 'cash' ? 'cash' : 'online';
  const driverCreditAmount = roundMoney(
    tipAmount + (fareDue > 0 && previousPaymentMethod === 'cash' ? fare : 0),
  );

  let walletResult = null;
  if (driverCreditAmount > 0) {
    walletResult = await applyDriverWalletAdjustment({
      driverId: ride.driverId,
      rideId: ride._id,
      amount: driverCreditAmount,
      type: 'adjustment',
      description: fareDue > 0
        ? 'Ride completion payment credited from rider'
        : 'Ride tip credited from rider',
      metadata: {
        source: paymentSource || 'ride_completion',
        rideId: String(ride._id),
        userId: String(userId),
        farePortion: fareDue > 0 ? fare : 0,
        tipAmount,
        totalCharge,
        provider: paymentRecord?.provider || '',
        providerOrderId: paymentRecord?.providerOrderId || '',
        providerPaymentId: paymentRecord?.providerPaymentId || '',
      },
      session,
    });
  }

  if (fareDue > 0) {
    ride.paymentMethod = 'online';
    ride.driverPaymentCollection = {
      provider: paymentRecord?.provider || ride.driverPaymentCollection?.provider || '',
      providerId: paymentRecord?.providerId || ride.driverPaymentCollection?.providerId || paymentRecord?.providerPaymentId || '',
      providerOrderId: paymentRecord?.providerOrderId || '',
      providerPaymentId: paymentRecord?.providerPaymentId || '',
      providerMode: paymentRecord?.providerMode || ride.driverPaymentCollection?.providerMode || '',
      source: paymentRecord?.source || paymentSource || '',
      status: 'paid',
      amount: totalCharge,
      currency: paymentRecord?.currency || ride.driverPaymentCollection?.currency || 'INR',
      linkUrl: paymentRecord?.linkUrl || ride.driverPaymentCollection?.linkUrl || '',
      paidAt: paymentRecord?.paidAt || new Date(),
      updatedAt: new Date(),
    };
  } else if (paymentRecord?.providerPaymentId && !isDriverCollectionPaid(ride) && paymentRecord?.provider) {
    ride.driverPaymentCollection = {
      provider: paymentRecord.provider,
      providerId: paymentRecord.providerId || paymentRecord.providerPaymentId || '',
      providerOrderId: paymentRecord.providerOrderId || '',
      providerPaymentId: paymentRecord.providerPaymentId || '',
      providerMode: paymentRecord.providerMode || '',
      source: paymentRecord.source || paymentSource || '',
      status: 'paid',
      amount: totalCharge,
      currency: paymentRecord.currency || 'INR',
      linkUrl: paymentRecord.linkUrl || '',
      paidAt: paymentRecord.paidAt || new Date(),
      updatedAt: new Date(),
    };
  }

  ride.feedback = {
    rating,
    comment: String(comment || '').trim(),
    tipAmount,
    tipPaymentId: paymentRecord?.providerPaymentId || '',
    tipOrderId: paymentRecord?.providerOrderId || '',
    tipPaidAt: paymentRecord?.providerPaymentId ? (paymentRecord?.paidAt || new Date()) : null,
    submittedAt: new Date(),
  };

  if (rating > 0) {
    driver.ratingCount = Number(driver.ratingCount || 0) + 1;
    driver.totalRatingScore = Number(driver.totalRatingScore || 0) + rating;
    driver.rating = Number((driver.totalRatingScore / driver.ratingCount).toFixed(1));
  }

  if (tipAmount > 0) {
    ride.driverEarnings = roundMoney((ride.driverEarnings || 0) + tipAmount);
  }

  await Promise.all([
    ride.save({ session }),
    driver.save({ session }),
    markUserCancellationDuesAsRecovered(userId, ride._id, session),
  ]);

  /*
   * The rider has now paid an online ride's fare, and this -- not completion
   * -- is when its earnings reach the driver (creditOnlineRideEarnings, once
   * only). A cash ride was settled in cash at completion; a cash fare paid
   * here instead is credited to the driver in full above.
   */
  let earningsResult = null;
  if (fareDue > 0 && previousPaymentMethod === 'online') {
    earningsResult = await creditOnlineRideEarnings({
      rideId: ride._id,
      session,
      source: paymentSource || 'ride_completion',
    });
  }

  return {
    ride: await getRideDetails(ride._id),
    walletResult: earningsResult || walletResult,
  };
};

const resolveRazorpayCredentials = async () => {
  return resolveConfiguredGatewayCredentials('razor_pay');
};

const razorpayRequest = async ({ method, path, body, keyId, keySecret }) => {
  const makeRequest = async (kid, ksecret) => {
    return fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${kid}:${ksecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  let response = await makeRequest(keyId, keySecret);
  
  if (response.status === 401) {
    const envKeyId = razorpayKeyId();
    const envKeySecret = razorpayKeySecret();
    if (envKeyId && envKeySecret && envKeyId !== keyId) {
      console.warn(`Razorpay 401 with DB key. Retrying with env key: ${envKeyId.substring(0, 12)}...`);
      response = await makeRequest(envKeyId, envKeySecret);
      keyId = envKeyId; // Update keyId for error logging if it fails again
      keySecret = envKeySecret;
    }
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('RAZORPAY_ERROR:', {
      status: response.status,
      payload,
      keyId,
      keySecretLength: keySecret?.length
    });
    const keyPrefix = keyId ? keyId.substring(0, 12) + '...' : 'NONE';
    throw new ApiError(response.status || 502, `Razorpay error: ${payload?.error?.description || payload?.error?.message || 'Unauthorized'}. (Using key: ${keyPrefix})`);
  }

  return payload;
};

/**
 * The fare each ride type would be booked at for this trip -- what the booking
 * screen shows. Priced by the same lookup and calculation as createRide, so the
 * fare a rider confirms is the fare they are charged. A ride type that cannot be
 * booked here comes back with `available: false` and no fare.
 */
export const quoteRide = async (req, res) => {
  const {
    pickup,
    drop,
    stops,
    vehicleTypeIds,
    vehicleTypeId,
    transport_type,
    service_location_id,
    serviceLocationId,
    tripType,
    returnAt,
    scheduledAt,
  } = req.body || {};

  // The trip is measured from these, exactly as the booking measures it: any
  // distance or duration the app sends is ignored.
  if (!pickup || !drop) {
    throw new ApiError(400, 'pickup and drop are required');
  }

  const quotes = await quoteRideFares({
    pickupCoords: normalizePoint(pickup, 'pickup'),
    dropCoords: normalizePoint(drop, 'drop'),
    stops,
    vehicleTypeIds: Array.isArray(vehicleTypeIds) ? vehicleTypeIds : [vehicleTypeId].filter(Boolean),
    transport_type,
    service_location_id: service_location_id || serviceLocationId,
    // one_way (default) or round_trip; a round trip prices the return leg and
    // the wait until returnAt (plan §4.2). scheduledAt sets the pickup time the
    // night charge is judged on.
    tripType,
    returnAt,
    scheduledAt,
  });

  res.json({ success: true, data: { quotes } });
};

export const createRide = async (req, res) => {
  const { pickup, drop, stops, pickupAddress, dropAddress, fare, vehicleTypeId, vehicleTypeIds, vehicleIconType, vehicleIconUrl, paymentMethod, serviceType, intercity, promo_code, service_location_id, transport_type, scheduledAt, bookingMode, userMaxBidFare, bidStepAmount, tripType, returnAt } =
    req.body;

  if (!pickup || !drop) {
    throw new ApiError(400, 'pickup and drop are required');
  }

  const ride = await createRideRecord({
    userId: req.auth.sub,
    pickupCoords: normalizePoint(pickup, 'pickup'),
    dropCoords: normalizePoint(drop, 'drop'),
    pickupAddress,
    dropAddress,
    fare: Number(fare || 0),
    // The server measures the trip itself; stops only ever lengthen it.
    stops,
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
  });

  await startDispatchFlow(ride);

  res.status(201).json({
    success: true,
    data: {
      ride,
      realtime: {
        room: getRideRoom(ride._id),
        rideId: String(ride._id),
      },
    },
  });
};

export const getRideById = async (req, res) => {
  await ensureRideParticipantAccess({
    rideId: req.params.rideId,
    role: req.auth.role,
    entityId: req.auth.sub,
  });

  const ride = await getRideDetails(req.params.rideId);

  res.json({
    success: true,
    data: serializeRideRealtime(ride),
  });
};

export const getMyActiveRide = async (req, res) => {
  const ride = await getActiveRideForIdentity({
    role: req.auth.role,
    entityId: req.auth.sub,
  });

  res.json({
    success: true,
    data: ride ? serializeRideRealtime(ride) : null,
  });
};

export const listMyRides = async (req, res) => {
  const history = await listRideHistoryForIdentity({
    role: req.auth.role,
    entityId: req.auth.sub,
    limit: req.query.limit,
    page: req.query.page,
    category: req.query.category,
  });

  res.json({
    success: true,
    data: {
      results: history.results,
      total: history.pagination.total,
      pagination: history.pagination,
    },
  });
};

export const updateRideStatus = async (req, res) => {
  if (req.auth.role !== 'driver') {
    throw new ApiError(403, 'Only drivers can update ride status');
  }

  const nextStatus = String(req.body.status || '').trim().toLowerCase();

  if (![RIDE_LIVE_STATUS.ACCEPTED, RIDE_LIVE_STATUS.ARRIVING, RIDE_LIVE_STATUS.STARTED, RIDE_LIVE_STATUS.ARRIVED, RIDE_LIVE_STATUS.COMPLETED].includes(nextStatus)) {
    throw new ApiError(400, 'status must be accepted, arriving, started, arrived, or completed');
  }

  const ride = await updateRideLifecycle({
    rideId: req.params.rideId,
    driverId: req.auth.sub,
    nextStatus,
    paymentMethod: req.body.paymentMethod,
    fare: req.body.fare,
    baseFare: req.body.baseFare,
    waitingChargeAmount: req.body.waitingChargeAmount,
    timeChargeAmount: req.body.timeChargeAmount,
    distanceChargeAmount: req.body.distanceChargeAmount,
    additionalCharge: req.body.additionalCharge,
    driverPaymentCollection: req.body.driverPaymentCollection,
    otp: req.body.otp,
  });

  const payload = {
    rideId: String(ride._id),
    status: ride.status,
    liveStatus: ride.liveStatus,
    acceptedAt: ride.acceptedAt,
    arrivedAt: ride.arrivedAt,
    startedAt: ride.startedAt,
    completedAt: ride.completedAt,
    waitingChargeAmount: ride.waitingChargeAmount || 0,
    distanceChargeAmount: ride.distanceChargeAmount || 0,
    timeChargeAmount: ride.timeChargeAmount || 0,
  };

  emitToRideRoom(ride._id, SOCKET_EVENTS.RIDE_STATUS_UPDATED, payload);
  emitToRideRoom(ride._id, SOCKET_EVENTS.RIDE_STATE, serializeRideRealtime(ride));

  res.json({
    success: true,
    data: serializeRideRealtime(ride),
  });
};

export const submitRideReview = async (req, res) => {
  if (req.auth.role !== 'user') {
    throw new ApiError(403, 'Only users can rate completed rides');
  }

  const ride = await submitRideFeedback({
    rideId: req.params.rideId,
    userId: req.auth.sub,
    rating: req.body.rating,
    comment: req.body.comment,
    tipAmount: req.body.tipAmount,
  });

  res.json({
    success: true,
    data: serializeRideRealtime(ride),
  });
};

export const createRazorpayRideCompletionOrder = async (req, res) => {
  const rideId = String(req.params.rideId || '').trim();
  const { tipAmount } = await validateRideCompletionFeedback({
    rating: Number(req.body?.rating || 0),
    tipAmount: req.body?.tipAmount,
  });

  const ride = await loadCompletedRideForUser(rideId, req.auth.sub);

  if (ride.feedback?.submittedAt) {
    throw new ApiError(409, 'Feedback already submitted for this ride');
  }

  const { keyId, keySecret } = await resolveRazorpayCredentials();
  const paymentAmounts = buildCompletionAmounts(ride, tipAmount);

  if (paymentAmounts.totalCharge <= 0) {
    throw new ApiError(400, 'No payable amount remains for this ride');
  }

  const compactRideId = rideId.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'ride';
  const compactUserId = String(req.auth?.sub || '').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'usr';
  const receipt = `uride_${compactUserId}_${compactRideId}_${Date.now().toString(36)}`;

  let order;
  try {
    order = await razorpayRequest({
      method: 'POST',
      path: '/orders',
      body: {
        amount: Math.round(paymentAmounts.totalCharge * 100),
        currency: 'INR',
        receipt,
        notes: {
          rideId,
          userId: String(req.auth.sub),
          driverId: String(ride.driverId),
          fareDue: String(paymentAmounts.fareDue),
          tipAmount: String(tipAmount),
          source: 'ride_completion',
        },
      },
      keyId,
      keySecret,
    });
  } catch (error) {
    throw error;
  }

  res.status(201).json({
    success: true,
    data: {
      keyId: keyId || 'mock_key',
      orderId: order.id,
      amount: order.amount,
      currency: order.currency || 'INR',
      fare: paymentAmounts.fare,
      fareDue: paymentAmounts.fareDue,
      tipAmount: paymentAmounts.tipAmount,
      totalCharge: paymentAmounts.totalCharge,
    },
  });
};

export const verifyRazorpayRideCompletion = async (req, res) => {
  const rideId = String(req.params.rideId || '').trim();
  const rating = Number(req.body?.rating || 0);
  const comment = String(req.body?.comment || '');
  const { tipAmount } = await validateRideCompletionFeedback({
    rating,
    tipAmount: req.body?.tipAmount,
  });
  const orderId = String(req.body?.razorpay_order_id || '');
  const paymentId = String(req.body?.razorpay_payment_id || '');
  const signature = String(req.body?.razorpay_signature || '');

  if (!orderId || !paymentId || !signature) {
    throw new ApiError(400, 'Payment verification fields are required');
  }

  const ride = await loadCompletedRideForUser(rideId, req.auth.sub);

  if (
    ride.feedback?.submittedAt &&
    (String(ride.driverPaymentCollection?.providerPaymentId || '') === paymentId || String(ride.feedback?.tipPaymentId || '') === paymentId)
  ) {
    return res.json({
      success: true,
      data: await getRideDetails(rideId),
    });
  }

  const isMock = isMockPaymentAllowed() && orderId.startsWith('mock_order_') && signature === 'mock_signature_bypass';

  let verifiedTotalCharge;
  let order;
  if (isMock) {
    const parts = orderId.split("_");
    const amountPaise = Number(parts[2]);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      throw new ApiError(400, 'Invalid mock order amount');
    }
    verifiedTotalCharge = roundMoney(amountPaise / 100);
    order = { currency: 'INR', amount: amountPaise };
  } else {
    const { keyId, keySecret } = await resolveRazorpayCredentials();
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    if (!safeSignatureEqual(expectedSignature, signature)) {
      throw new ApiError(400, 'Invalid payment signature');
    }

    order = await razorpayRequest({
      method: 'GET',
      path: `/orders/${encodeURIComponent(orderId)}`,
      keyId,
      keySecret,
    });
    
    ensureOrderIsForRide(order, { rideId, purpose: 'completion' });
    verifiedTotalCharge = roundMoney(Number(order?.amount || 0) / 100);
  }

  const paymentAmounts = buildCompletionAmounts(ride, tipAmount);
  if (verifiedTotalCharge <= 0) {
    throw new ApiError(400, 'Invalid order amount');
  }

  if (Math.abs(verifiedTotalCharge - paymentAmounts.totalCharge) > 0.001) {
    throw new ApiError(400, 'Verified payment amount does not match the payable ride total');
  }

  await ensurePaymentNotUsed(paymentId);

  // Signature checked, amount read back from the gateway and matched against the ride
  // total -- the payment is real. Mirror it into the shared payments collection.
  // Cannot throw; see paymentMirror.service.js.
  await mirrorTaxiPayment({
    orderId, paymentId, amount: verifiedTotalCharge, userId: req.auth.sub,
    subjectId: ride._id, purpose: 'ride', mock: isMock,
  });

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const liveRide = await loadCompletedRideForUser(rideId, req.auth.sub, session);
    const result = await finalizeRideCompletion({
      ride: liveRide,
      userId: req.auth.sub,
      rating,
      comment,
      tipAmount,
      paymentSource: 'ride_completion_razorpay',
      paymentRecord: {
        provider: 'razorpay',
        providerId: paymentId,
        providerOrderId: orderId,
        providerPaymentId: paymentId,
        providerMode: 'razorpay_order',
        source: 'ride_completion_razorpay',
        currency: order.currency || 'INR',
        paidAt: new Date(),
      },
      session,
    });

    await session.commitTransaction();

    if (result.walletResult?.transaction) {
      emitToDriver(liveRide.driverId, 'driver:wallet:updated', {
        wallet: result.walletResult.wallet,
        transaction: result.walletResult.transaction,
        notification: {
          id: `ride-payment-${paymentId}`,
          title: 'Payment received',
          body: `Rs ${paymentAmounts.totalCharge.toFixed(2)} received from rider for completed ride.`,
          sentAt: new Date().toISOString(),
        },
      });
    }

    res.json({
      success: true,
      data: result.ride,
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const payRideCompletionWithWallet = async (req, res) => {
  const rideId = String(req.params.rideId || '').trim();
  const rating = Number(req.body?.rating || 0);
  const comment = String(req.body?.comment || '');
  const { tipAmount } = await validateRideCompletionFeedback({
    rating,
    tipAmount: req.body?.tipAmount,
  });

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ride = await loadCompletedRideForUser(rideId, req.auth.sub, session);
    const paymentAmounts = buildCompletionAmounts(ride, tipAmount);

    if (paymentAmounts.totalCharge <= 0) {
      throw new ApiError(400, 'No payable amount remains for this ride');
    }

    await ensureUserWallet(req.auth.sub, session);
    const userWallet = await UserWallet.findOne({ userId: req.auth.sub }).session(session);
    if (!userWallet) {
      throw new ApiError(404, 'User wallet not found');
    }

    if (Number(userWallet.balance || 0) < paymentAmounts.totalCharge) {
      throw new ApiError(400, 'Insufficient wallet balance');
    }

    const transferId = crypto.randomUUID();
    userWallet.balance = roundMoney(Number(userWallet.balance || 0) - paymentAmounts.totalCharge);
    userWallet.transactions.push({
      kind: 'debit',
      amount: paymentAmounts.totalCharge,
      title: `Ride payment for ${rideId.slice(-6)}${tipAmount > 0 ? ' with tip' : ''}`,
      provider: 'ride_completion_wallet',
      providerPaymentId: transferId,
    });
    userWallet.transactions = userWallet.transactions.slice(-50);
    await userWallet.save({ session });

    const result = await finalizeRideCompletion({
      ride,
      userId: req.auth.sub,
      rating,
      comment,
      tipAmount,
      paymentSource: 'ride_completion_wallet',
      paymentRecord: {
        provider: 'wallet',
        providerId: transferId,
        providerOrderId: '',
        providerPaymentId: transferId,
        providerMode: 'wallet_internal',
        source: 'ride_completion_wallet',
        currency: 'INR',
        paidAt: new Date(),
      },
      session,
    });

    await session.commitTransaction();

    if (result.walletResult?.transaction) {
      emitToDriver(ride.driverId, 'driver:wallet:updated', {
        wallet: result.walletResult.wallet,
        transaction: result.walletResult.transaction,
        notification: {
          id: `ride-wallet-${transferId}`,
          title: 'Payment received',
          body: `Rs ${paymentAmounts.totalCharge.toFixed(2)} received from rider wallet for completed ride.`,
          sentAt: new Date().toISOString(),
        },
      });
    }

    res.status(201).json({
      success: true,
      data: result.ride,
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const createRazorpayRideTipOrder = async (req, res) => {
  const rideId = String(req.params.rideId || '').trim();
  // `amount` is what the rider app's tip order has always sent.
  const tipAmount = normalizeMoneyAmount(req.body?.tipAmount ?? req.body?.amount, 'tipAmount');
  const tipSettings = await getTipSettings();
  const tipsEnabled = String(tipSettings.enable_tips || '1') === '1';
  const minimumTipAmount = Number(tipSettings.min_tip_amount || 0);

  if (!tipsEnabled) {
    throw new ApiError(403, 'Tips are currently disabled');
  }

  if (minimumTipAmount > 0 && tipAmount < minimumTipAmount) {
    throw new ApiError(400, `tipAmount must be at least ${minimumTipAmount}`);
  }

  const ride = await Ride.findOne({
    _id: rideId,
    userId: req.auth.sub,
    status: 'completed',
  }).select('_id driverId feedback');

  if (!ride) {
    throw new ApiError(404, 'Completed ride not found');
  }

  if (!ride.driverId) {
    throw new ApiError(409, 'Ride has no assigned driver');
  }

  /*
   * Paying an online fare records feedback along with it, so "feedback
   * already submitted" shut the tip out of exactly the rides whose tip has
   * to be paid this way (rideService.submitRideFeedback refuses it as cash).
   * Only a tip already paid rules out another.
   */
  if (Number(ride.feedback?.tipAmount || 0) > 0) {
    throw new ApiError(409, 'A tip has already been paid for this ride');
  }

  const { keyId, keySecret } = await resolveRazorpayCredentials();
  const amountPaise = Math.round(tipAmount * 100);
  const compactRideId = rideId.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'ride';
  const compactUserId = String(req.auth?.sub || '').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'usr';
  const receipt = `utip_${compactUserId}_${compactRideId}_${Date.now().toString(36)}`;

  let order;
  try {
    order = await razorpayRequest({
      method: 'POST',
      path: '/orders',
      body: {
        amount: amountPaise,
        currency: 'INR',
        receipt,
        notes: {
          rideId,
          userId: String(req.auth.sub),
          driverId: String(ride.driverId),
          kind: 'ride_tip',
        },
      },
      keyId,
      keySecret,
    });
  } catch (error) {
    throw error;
  }

  res.status(201).json({
    success: true,
    data: {
      keyId: keyId || 'mock_key',
      orderId: order.id,
      amount: order.amount,
      currency: order.currency || 'INR',
      tipAmount,
    },
  });
};

export const verifyRazorpayRideTip = async (req, res) => {
  const rideId = String(req.params.rideId || '').trim();
  const rating = Number(req.body?.rating || 0);
  const comment = String(req.body?.comment || '');
  const tipAmount = normalizeMoneyAmount(req.body?.tipAmount, 'tipAmount');
  const orderId = String(req.body?.razorpay_order_id || '');
  const paymentId = String(req.body?.razorpay_payment_id || '');
  const signature = String(req.body?.razorpay_signature || '');

  if (!orderId || !paymentId || !signature) {
    throw new ApiError(400, 'Payment verification fields are required');
  }

  if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
    throw new ApiError(400, 'rating must be between 0 and 5');
  }

  const tipSettings = await getTipSettings();
  const tipsEnabled = String(tipSettings.enable_tips || '1') === '1';
  const minimumTipAmount = Number(tipSettings.min_tip_amount || 0);

  if (!tipsEnabled) {
    throw new ApiError(403, 'Tips are currently disabled');
  }

  if (minimumTipAmount > 0 && tipAmount < minimumTipAmount) {
    throw new ApiError(400, `tipAmount must be at least ${minimumTipAmount}`);
  }

  const ride = await Ride.findOne({
    _id: rideId,
    userId: req.auth.sub,
    status: 'completed',
  });

  if (!ride) {
    throw new ApiError(404, 'Completed ride not found');
  }

  if (!ride.driverId) {
    throw new ApiError(409, 'Ride has no assigned driver');
  }

  if (ride.feedback?.submittedAt && String(ride.feedback?.tipPaymentId || '') === paymentId) {
    const existingRide = await getRideDetails(rideId);
    res.json({
      success: true,
      data: existingRide,
    });
    return;
  }

  if (Number(ride.feedback?.tipAmount || 0) > 0) {
    throw new ApiError(409, 'A tip has already been paid for this ride');
  }

  const isMock = isMockPaymentAllowed() && orderId.startsWith('mock_order_') && signature === 'mock_signature_bypass';

  let amountPaise;
  let order;
  if (isMock) {
    const parts = orderId.split("_");
    amountPaise = Number(parts[2]);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      throw new ApiError(400, 'Invalid mock order amount');
    }
    order = { currency: 'INR', amount: amountPaise };
  } else {
    const { keyId, keySecret } = await resolveRazorpayCredentials();
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    if (!safeSignatureEqual(expectedSignature, signature)) {
      throw new ApiError(400, 'Invalid payment signature');
    }

    order = await razorpayRequest({
      method: 'GET',
      path: `/orders/${encodeURIComponent(orderId)}`,
      keyId,
      keySecret,
    });
    
    ensureOrderIsForRide(order, { rideId, purpose: 'tip' });
    amountPaise = Number(order?.amount);
  }
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    throw new ApiError(400, 'Invalid order amount');
  }

  const verifiedTipAmount = Math.round(amountPaise) / 100;
  if (Math.abs(verifiedTipAmount - tipAmount) > 0.001) {
    throw new ApiError(400, 'Verified tip amount does not match selected tip');
  }

  await ensurePaymentNotUsed(paymentId);

  await mirrorTaxiPayment({
    orderId, paymentId, amount: verifiedTipAmount, userId: req.auth.sub,
    subjectId: ride._id, purpose: 'tip', mock: isMock,
  });

  const driver = await Driver.findById(ride.driverId);
  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  /*
   * The tip may follow feedback already given -- paying an online fare records
   * feedback with it -- so a rating already counted is kept, not counted
   * twice. A rating of 0 means "not rated" and is never counted.
   */
  const previousRating = Number(ride.feedback?.rating || 0);
  const previousComment = String(ride.feedback?.comment || '');
  const previousSubmittedAt = ride.feedback?.submittedAt || null;
  const isNewRating = previousRating <= 0 && rating > 0;

  let walletResult;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    walletResult = await applyDriverWalletAdjustment({
      driverId: ride.driverId,
      rideId: ride._id,
      amount: verifiedTipAmount,
      type: 'adjustment',
      description: 'Ride tip credited from rider',
      metadata: {
        source: 'ride_tip',
        provider: 'razorpay',
        providerOrderId: orderId,
        providerPaymentId: paymentId,
        rideId: String(ride._id),
        userId: String(req.auth.sub),
      },
      session,
    });

    ride.feedback = {
      rating: isNewRating ? rating : previousRating,
      comment: comment.trim() || previousComment,
      tipAmount: verifiedTipAmount,
      tipPaymentId: paymentId,
      tipOrderId: orderId,
      tipPaidAt: new Date(),
      submittedAt: previousSubmittedAt || new Date(),
    };

    if (isNewRating) {
      driver.ratingCount = Number(driver.ratingCount || 0) + 1;
      driver.totalRatingScore = Number(driver.totalRatingScore || 0) + rating;
      driver.rating = Number((driver.totalRatingScore / driver.ratingCount).toFixed(1));
    }

    ride.driverEarnings = roundMoney((ride.driverEarnings || 0) + verifiedTipAmount);

    await Promise.all([ride.save({ session }), driver.save({ session })]);
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  if (walletResult.transaction) {
    emitToDriver(ride.driverId, 'driver:wallet:updated', {
      wallet: walletResult.wallet,
      transaction: walletResult.transaction,
      notification: {
        id: `ride-tip-${paymentId}`,
        title: 'Payment received',
        body: `Rs ${verifiedTipAmount.toFixed(2)} tip received from rider.`,
        sentAt: new Date().toISOString(),
      },
    });
  }

  const populatedRide = await getRideDetails(ride._id);

  res.json({
    success: true,
    data: populatedRide,
  });
};

export const getRideAppTipSettings = async (_req, res) => {
  const tipSettings = await getTipSettings();

  res.json({
    success: true,
    data: {
      settings: tipSettings,
    },
  });
};

export const cancelRide = async (req, res) => {
  const result = await cancelRideByUser({
    rideId: req.params.rideId,
    userId: req.auth.sub,
    reason: req.body?.reason || req.query?.reason || 'User cancelled',
  });

  if (!result || !result.ride) {
    throw new ApiError(404, 'Ride not found');
  }

  const { ride, cancellationSettlement } = result;

  res.json({
    success: true,
    data: {
      rideId: String(ride._id),
      status: ride.status,
      liveStatus: ride.liveStatus,
      cancellationBill: cancellationSettlement ? {
        cancellationFee: cancellationSettlement.feeAmount || 0,
        waitingTimeMinutes: cancellationSettlement.waitingTimeMinutes || 0,
        waitingCharge: cancellationSettlement.waitingCharge || 0,
        totalCancellationFee: cancellationSettlement.totalFeeAmount || 0,
      } : null
    },
  });
};

export const listAvailableDrivers = async (req, res) => {
  const { vehicleTypeId, lat, lng, maxDistance, limit = 30, service_location_id, transport_type } = req.query;
  const latitude = Number(lat);
  const longitude = Number(lng);
  const distance = Number(maxDistance);

  if (!vehicleTypeId) {
    throw new ApiError(400, 'vehicleTypeId is required');
  }

  if (!mongoose.Types.ObjectId.isValid(vehicleTypeId)) {
    throw new ApiError(400, 'vehicleTypeId is invalid');
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new ApiError(400, 'lat and lng are required');
  }

  const near = {
    $geometry: {
      type: 'Point',
      coordinates: [longitude, latitude],
    },
  };

  if (Number.isFinite(distance) && distance > 0) {
    near.$maxDistance = Math.min(distance, 25000);
  }

  const driverMatchFilters = buildDriverMatchFilters({
    vehicleTypeId,
    transportType: transport_type,
  });

  const drivers = await Driver.find({
    ...driverMatchFilters,
    location: {
      $near: near,
    },
  })
    .limit(Math.min(Number(limit) || 30, 50))
    // Public, unauthenticated, polled by the booking map. Identity is NOT selected:
    // it returned each nearby driver's name and number plate with their live
    // position, so anyone could sweep a city and follow named drivers. The map needs
    // positions and vehicle type only.
    .select('vehicleTypeId vehicleType vehicleIconType rating location')
    .lean();

  const enrichedDrivers = drivers.map((driver) => {
    const distanceMeters = calculateDistanceMeters([longitude, latitude], driver.location?.coordinates || []);
    const etaMinutes = estimateEtaMinutes(distanceMeters);

    return {
      id: driver._id,
      vehicleTypeId: driver.vehicleTypeId,
      vehicleType: driver.vehicleType,
      vehicleIconType: driver.vehicleIconType,
      rating: driver.rating,
      location: driver.location,
      distanceMeters,
      etaMinutes,
    };
  });

  const closestDriver = enrichedDrivers[0] || null;
  const { allowedPaymentMethods } = await getAllowedRidePaymentMethodsForPricing({
    serviceLocationId: service_location_id && mongoose.Types.ObjectId.isValid(service_location_id)
      ? new mongoose.Types.ObjectId(service_location_id)
      : null,
    transportType: transport_type || 'taxi',
    vehicleTypeId,
  });

  res.json({
    success: true,
    data: {
      totalDrivers: enrichedDrivers.length,
      closestDriverDistanceMeters: closestDriver?.distanceMeters ?? null,
      closestDriverEtaMinutes: closestDriver?.etaMinutes ?? null,
      allowedPaymentMethods,
      drivers: enrichedDrivers,
    },
  });
};

export const getRideBids = async (req, res) => {
  const result = await listRideBidsForUser({
    rideId: req.params.rideId,
    userId: req.auth.sub,
  });

  res.json({
    success: true,
    data: result,
  });
};

export const acceptRideBid = async (req, res) => {
  const ride = await acceptRideBidAssignment({
    rideId: req.params.rideId,
    bidId: req.params.bidId,
    userId: req.auth.sub,
  });

  await notifyRideAccepted(ride);

  res.json({
    success: true,
    data: {
      rideId: String(ride._id),
      status: ride.status,
      liveStatus: ride.liveStatus,
      acceptedAt: ride.acceptedAt,
    },
  });
};

export const updateRideBidCeiling = async (req, res) => {
  const ride = await increaseRideBidCeiling({
    rideId: req.params.rideId,
    userId: req.auth.sub,
    incrementSteps: req.body.incrementSteps,
  });

  await notifyRideBiddingUpdated(ride.rideId || req.params.rideId);
  if (ride.pricingNegotiationMode === 'user_increment_only') {
    await restartRideDispatchWithLatestFare(ride.rideId || req.params.rideId);
  }

  res.json({
    success: true,
    data: ride,
  });
};

export const validateLocation = async (req, res, next) => {
  try {
    let { pickupCoords, dropCoords } = req.body;
    if (!pickupCoords || !Array.isArray(pickupCoords) || pickupCoords.length < 2) {
      const { ApiError } = await import('../../../../utils/ApiError.js');
      throw new ApiError(400, 'Pickup coordinates are required');
    }

    pickupCoords = [Number(pickupCoords[0]), Number(pickupCoords[1])];
    if (dropCoords && Array.isArray(dropCoords) && dropCoords.length >= 2) {
      dropCoords = [Number(dropCoords[0]), Number(dropCoords[1])];
    }

    const { Zone } = await import('../../driver/models/Zone.js');
    const { ApiError } = await import('../../../../utils/ApiError.js');




    const matchedPickupZone = await Zone.findOne({
      active: { $ne: false },
      status: { $ne: 'inactive' },
      geometry: {
        $geoIntersects: {
          $geometry: {
            type: 'Point',
            coordinates: pickupCoords,
          },
        },
      },
    }).lean();

    if (!matchedPickupZone) {
      throw new ApiError(400, 'Service is not available in the selected pickup location.');
    }

    if (dropCoords) {
      const isOutstation = req.body.rideType === 'outstation' || req.body.transport_type === 'intercity';
      
      if (!isOutstation) {
        const matchedDropZone = await Zone.findOne({
          active: { $ne: false },
          status: { $ne: 'inactive' },
          geometry: {
            $geoIntersects: {
              $geometry: {
                type: 'Point',
                coordinates: dropCoords,
              },
            },
          },
        }).lean();

        if (!matchedDropZone) {
          throw new ApiError(400, 'Service is not available in the selected drop location.');
        }
      }
    }

    res.json({ success: true, message: 'Location is valid' });
  } catch (error) {
    next(error);
  }
};

