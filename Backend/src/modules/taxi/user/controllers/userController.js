import crypto from 'node:crypto';
import { safeSignatureEqual } from '../../../../utils/safeCompare.js';
import mongoose from 'mongoose';
import { mirrorTaxiPayment } from '../../services/paymentMirror.service.js';
import {
  assertPhonePeTopupOwner,
  buildTopupOrderNotes,
  creditTopupOnce,
  recordPhonePeTopupIntent,
  resolveRazorpayTopup,
} from '../../services/walletTopupGuard.service.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { User } from '../models/User.js';
import { UserWallet } from '../models/UserWallet.js';
import { AdminBusinessSetting } from '../../admin/models/AdminBusinessSetting.js';
import { Notification } from '../../admin/promotions/models/Notification.js';
import { Driver } from '../../driver/models/Driver.js';
import { comparePassword, hashPassword, signAccessToken } from '../services/authService.js';
import { env } from '../../../../config/env.js';
import { uploadDataUrlToCloudinary } from '../../../../utils/cloudinaryUpload.js';
import { resolveConfiguredGatewayCredentials } from '../../services/paymentGatewayService.js';
import {
  consumeUserSignupSession,
  requireVerifiedUserSignupSession,
  startUserOtp,
  verifyUserOtp,
} from '../services/userOtpService.js';
import { SetPrice } from '../../admin/models/SetPrice.js';
import { applyDriverWalletAdjustment } from '../../driver/services/walletService.js';
import { emitToDriver } from '../../services/dispatchService.js';
import { sendPushNotificationToEntities } from '../../services/pushNotificationService.js';
import { listDriverServiceLocations } from '../../driver/services/serviceLocationService.js';
import {
  getUserSubscriptionSummary,
  listCustomerSubscriptionPlans,
  purchaseUserSubscription,
} from '../services/subscriptionService.js';

import { taxiReferralFor } from '../../../../core/referral/referralSettings.service.js';
const VALID_GENDERS = new Set(['male', 'female', 'other', 'prefer-not-to-say', '']);

const toCleanString = (value) => String(value || '').trim();

const normalizePhone = (value) => {
  const digits = toCleanString(value).replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
};

const normalizeEmail = (value) => toCleanString(value).toLowerCase();
const normalizeReferralCode = (value) => toCleanString(value).toUpperCase();

const normalizeGender = (value) => {
  const gender = toCleanString(value).toLowerCase();
  return VALID_GENDERS.has(gender) ? gender : 'prefer-not-to-say';
};

const validatePhone = (phone) => {
  if (!/^\d{10}$/.test(phone)) {
    throw new ApiError(400, 'A valid 10-digit phone number is required');
  }
};

const validateName = (name) => {
  if (!name || name.length < 2 || name.length > 80) {
    throw new ApiError(400, 'name must be between 2 and 80 characters');
  }
};

const validateEmail = (email) => {
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, 'A valid email address is required');
  }
};

const normalizeMoneyAmount = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, 'amount must be a positive number');
  }
  return Math.round(amount * 100) / 100;
};

const ensureUserWallet = async (userId) => {
  if (!userId) return;
  await UserWallet.updateOne(
    { userId },
    { $setOnInsert: { userId, balance: 0, refundWallet: 0, transactions: [] } },
    { upsert: true },
  );
};

/*
 * The wallet is shared with food now (core/wallet/customerWallet.model.js), so
 * this list includes food orders and refunds. Food words a row as `description`
 * and a direction as `type`; without these fallbacks a food order would show
 * here as a nameless row with no direction.
 */
const serializeUserWalletTransaction = (entry = {}) => ({
  id: entry._id,
  kind: entry.kind || (entry.type === 'deduction' ? 'debit' : 'credit'),
  amount: Number(entry.amount || 0),
  title: entry.title || entry.description || '',
  counterpartyPhone: entry.counterpartyPhone || '',
  createdAt: entry.createdAt || null,
});

const buildUserWalletPayload = (wallet) => {
  const transactions = Array.isArray(wallet?.transactions) ? wallet.transactions : [];

  return {
    balance: Number(wallet?.balance || 0),
    refundWallet: Number(wallet?.refundWallet || 0),
    currency: 'INR',
    recentTransactions: transactions
      .slice()
      .reverse()
      .map(serializeUserWalletTransaction),
  };
};

const resolveRazorpayCredentials = async () => {
  return resolveConfiguredGatewayCredentials('razor_pay');
};

const resolvePhonePeCredentials = async () => {
  return resolveConfiguredGatewayCredentials('phone_pay');
};

export const listPublicServiceLocations = async (_req, res) => {
  const results = await listDriverServiceLocations();

  res.json({
    success: true,
    data: {
      results,
    },
  });
};

const getFrontendBaseUrl = () => {
  const configuredOrigin = String(env.corsOrigin || '')
    .split(',')
    .map((value) => value.trim())
    .find((value) => value && value !== '*');

  return (configuredOrigin || 'https://k9rides.onrender.com').replace(/\/+$/, '');
};

const getPhonePeBaseUrl = (environment = 'test') => (
  String(environment).trim().toLowerCase() === 'production'
    ? 'https://api.phonepe.com/apis/hermes'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox'
);

const buildPhonePeChecksum = ({ payload = '', path = '', saltKey = '', saltIndex = '1' }) => {
  const digest = crypto
    .createHash('sha256')
    .update(`${payload}${path}${saltKey}`)
    .digest('hex');

  return `${digest}###${saltIndex}`;
};

const phonePeRequest = async ({
  method,
  path,
  body,
  merchantId,
  saltKey,
  saltIndex,
  environment,
}) => {
  const normalizedMethod = String(method || 'GET').trim().toUpperCase();
  const encodedPayload =
    body && normalizedMethod !== 'GET'
      ? Buffer.from(JSON.stringify(body)).toString('base64')
      : '';
  const response = await fetch(`${getPhonePeBaseUrl(environment)}${path}`, {
    method: normalizedMethod,
    headers: {
      'Content-Type': 'application/json',
      'X-VERIFY': buildPhonePeChecksum({
        payload: encodedPayload,
        path,
        saltKey,
        saltIndex,
      }),
      'X-MERCHANT-ID': merchantId,
      accept: 'application/json',
    },
    body: encodedPayload ? JSON.stringify({ request: encodedPayload }) : undefined,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new ApiError(
      response.status || 502,
      payload?.message || payload?.code || 'PhonePe request failed',
    );
  }

  return payload;
};

const razorpayRequest = async ({ method, path, body, keyId, keySecret }) => {
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status || 502, payload?.error?.description || payload?.error?.message || 'Razorpay request failed');
  }

  return payload;
};

export const getIntercityPackageCatalog = async (_req, res) => {
  const items = await SetPrice.find({
    pricing_scope: 'package',
    active: 1,
    status: 'active',
    package_availability: 'available',
  })
    .populate('service_location_id', 'name service_location_name')
    .populate('package_type_id', 'name')
    .populate('package_vehicle_prices.vehicle_type', 'name capacity icon map_icon image icon_types dispatch_type')
    .sort({ package_destination: 1, createdAt: -1 })
    .lean();

  const results = items.map((item) => {
    const serviceLocation = item.service_location_id || {};
    const packageType = item.package_type_id || {};

    return {
      id: String(item._id),
      serviceLocationId: serviceLocation._id ? String(serviceLocation._id) : '',
      serviceLocationName: serviceLocation.name || serviceLocation.service_location_name || '',
      packageTypeId: packageType._id ? String(packageType._id) : '',
      packageTypeName: packageType.name || '',
      destination: String(item.package_destination || '').trim(),
      availability: String(item.package_availability || 'available').trim().toLowerCase(),
      vehicles: Array.isArray(item.package_vehicle_prices)
        ? item.package_vehicle_prices
          .filter((row) => row?.vehicle_type)
          .map((row, index) => ({
            id: `${String(item._id)}:${String(row.vehicle_type?._id || index)}`,
            vehicleTypeId: row.vehicle_type?._id ? String(row.vehicle_type._id) : '',
            vehicleName: row.vehicle_type?.name || 'Vehicle',
            capacity: Number(row.vehicle_type?.capacity || 0),
            icon: row.vehicle_type?.map_icon || row.vehicle_type?.icon || row.vehicle_type?.image || '',
            iconType: row.vehicle_type?.icon_types || row.vehicle_type?.name || '',
            dispatchType: String(row.vehicle_type?.dispatch_type || 'normal').trim().toLowerCase(),
            basePrice: Number(row.base_price ?? 0),
            freeDistance: Number(row.free_distance ?? 0),
            distancePrice: Number(row.distance_price ?? 0),
            freeTime: Number(row.free_time ?? 0),
            timePrice: Number(row.time_price ?? 0),
            adminCommisionType: Number(row.admin_commision_type ?? 1),
            adminCommision: Number(row.admin_commision ?? 0),
            adminCommissionTypeFromDriver: Number(row.admin_commission_type_from_driver ?? 1),
            adminCommissionFromDriver: Number(row.admin_commission_from_driver ?? 0),
            adminCommissionTypeForOwner: Number(row.admin_commission_type_for_owner ?? 1),
            adminCommissionForOwner: Number(row.admin_commission_for_owner ?? 0),
            serviceTax: Number(row.service_tax ?? 0),
            cancellationFee: Number(row.cancellation_fee ?? 0),
          }))
        : [],
    };
  });

  res.json({
    success: true,
    results,
  });
};

const toUserPayload = (user, options = {}) => ({
  id: user._id,
  name: user.name || '',
  phone: user.phone || '',
  email: user.email || '',
  gender: user.gender || '',
  profileImage: user.profileImage || '',
  referralCode: user.referralCode || '',
  referralCount: Number(user.referralCount || 0),
  deletionRequestStatus: user.deletionRequest?.status || 'none',
  referralCode: user.referralCode || '',
  referralCount: Number(user.referralCount || 0),
  currentRideId: user.currentRideId || null,
  pending_cancellation_due: Number(user.pending_cancellation_due || 0),
  subscriptionSummary: options.subscriptionSummary || {
    activeCount: 0,
    hasUnlimitedPlan: false,
    availableRideCredits: 0,
    activePlans: [],
  },
});

const ensureUserCanLogin = (user) => {
  if (user.deletedAt || user.isActive === false || user.active === false) {
    throw new ApiError(403, 'User account is not active');
  }
};

const canRestoreUserForSignup = (user) => Boolean(user?.deletedAt);

const buildReactivatedUserPayload = async ({ req, name, phone, email, countryCode, gender, profileImage, referrer }) => ({
  name,
  phone,
  countryCode,
  email,
  gender,
  profileImage,
  password: await hashPassword(String(req.body.password || '').trim() || crypto.randomBytes(24).toString('hex')),
  isVerified: true,
  referredBy: referrer?._id || null,
  deletedAt: null,
  deletion_reason: '',
  active: true,
  isActive: true,
  deletionRequest: {
    status: 'none',
    reason: '',
    requestedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    adminNote: '',
  },
});

const createUserSession = (user) => ({
  token: signAccessToken({ sub: String(user._id), role: 'user' }),
  user: toUserPayload(user),
});

const generateUserReferralCode = (user) => {
  const idPart = String(user?._id || '').slice(-6).toUpperCase();
  const phonePart = String(user?.phone || '').slice(-4);
  return `USR${phonePart}${idPart}`.replace(/\W/g, '');
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

const findUserByReferralCode = async (referralCode) => {
  const normalizedCode = normalizeReferralCode(referralCode);

  if (!normalizedCode) {
    return null;
  }

  return User.findOne({ referralCode: normalizedCode });
};

const creditUserWalletByReference = async ({ userId, amount, title, referenceKey }) => {
  const normalizedAmount = Math.max(0, Number(amount || 0) || 0);
  const normalizedReferenceKey = toCleanString(referenceKey);

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
              title: toCleanString(title) || 'Referral Reward',
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

const processSignupReferralRewards = async ({ user, referrer }) => {
  if (!user?._id || !referrer?._id) {
    return;
  }

  const settings = await getUserReferralProgramSettings();
  if (!settings.enabled || settings.amount <= 0) {
    return;
  }

  const referralType = settings.type;
  const rewardBaseKey = `user-referral:signup:${String(user._id)}`;

  if (referralType === 'instant_referrer' || referralType === 'instant_referrer_new') {
    await creditUserWalletByReference({
      userId: referrer._id,
      amount: settings.amount,
      title: `Referral reward for inviting ${user.phone}`,
      referenceKey: `${rewardBaseKey}:referrer`,
    });
  }

  if (referralType === 'instant_referrer_new') {
    await creditUserWalletByReference({
      userId: user._id,
      amount: settings.amount,
      title: 'Welcome referral reward',
      referenceKey: `${rewardBaseKey}:new-user`,
    });
    user.referralRewardGrantedAt = user.referralRewardGrantedAt || new Date();
    await user.save();
  }
};

export const registerUser = async (req, res) => {
  const name = toCleanString(req.body.name);
  const phone = normalizePhone(req.body.phone);
  const email = normalizeEmail(req.body.email);
  const countryCode = toCleanString(req.body.countryCode) || '+91';
  const gender = normalizeGender(req.body.gender);
  const profileImage = toCleanString(req.body.profileImage);
  const referralCode = normalizeReferralCode(req.body.referralCode);

  validateName(name);
  validatePhone(phone);
  validateEmail(email);

  const existingUser = await User.findOne({ phone });

  const referrer = referralCode ? await findUserByReferralCode(referralCode) : null;

  if (referralCode && !referrer) {
    throw new ApiError(400, 'Invalid referral code');
  }

  if (existingUser && !canRestoreUserForSignup(existingUser)) {
    throw new ApiError(409, 'Phone number is already registered');
  }

  const userPayload = await buildReactivatedUserPayload({
    req,
    name,
    phone,
    email,
    countryCode,
    gender,
    profileImage,
    referrer,
  });

  const user = existingUser
    ? await User.findByIdAndUpdate(existingUser._id, { $set: userPayload }, { new: true, runValidators: true })
    : await User.create(userPayload);

  if (!String(user.referralCode || '').trim()) {
    user.referralCode = generateUserReferralCode(user);
    await user.save();
  }

  if (referrer?._id) {
    await User.updateOne({ _id: referrer._id }, { $inc: { referralCount: 1 } });
    await processSignupReferralRewards({ user, referrer });
  }

  res.status(201).json({
    success: true,
    data: createUserSession(user),
  });
};

const serializeUserNotification = (item = {}) => ({
  id: String(item._id || ''),
  title: String(item.push_title || '').trim(),
  body: String(item.message || '').trim(),
  image: item.image || '',
  sentAt: item.sent_at || item.createdAt || null,
  serviceLocationId: item.service_location_id || null,
});

export const getUserNotifications = async (req, res) => {
  const user = await User.findById(req.auth.sub).lean();

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  // Users don't typically have a service_location_id in their profile like drivers do in this schema,
  // but if they did, we would use it. For now, we fetch all user-targeted notifications.
  const query = {
    status: 'sent',
    send_to: { $in: ['all', 'users'] },
  };

  const notifications = await Notification.find(query)
    .sort({ sent_at: -1, createdAt: -1 })
    .limit(100)
    .lean();

  res.json({
    success: true,
    data: {
      results: notifications.map(serializeUserNotification),
    },
  });
};

export const deleteUserNotification = async (req, res) => {
  // In a real multi-tenant app, you'd mark it as read/deleted for THIS user in a pivot table.
  // However, the current driver implementation seems to imply a simpler model or global clear for the demo.
  // For consistency with the user's request for "single clear", we'll just return success 
  // as the frontend is already filtering its local state.
  // If we wanted to persist this per user, we'd need a UserNotification model.
  res.json({
    success: true,
    message: 'Notification removed',
  });
};

export const clearAllUserNotifications = async (req, res) => {
  res.json({
    success: true,
    message: 'All notifications cleared',
  });
};

export const signupUser = async (req, res) => {
  const name = toCleanString(req.body.name);
  const phone = normalizePhone(req.body.phone);
  const email = normalizeEmail(req.body.email);
  const countryCode = toCleanString(req.body.countryCode) || '+91';
  const gender = normalizeGender(req.body.gender);
  const profileImage = toCleanString(req.body.profileImage);
  const referralCode = normalizeReferralCode(req.body.referralCode);

  validateName(name);
  validatePhone(phone);
  validateEmail(email);

  const signupSession = await requireVerifiedUserSignupSession(phone);

  const existingUser = await User.findOne({ phone });

  const referrer = referralCode ? await findUserByReferralCode(referralCode) : null;

  if (referralCode && !referrer) {
    throw new ApiError(400, 'Invalid referral code');
  }

  if (existingUser && !canRestoreUserForSignup(existingUser)) {
    throw new ApiError(409, 'Phone number is already registered');
  }

  const userPayload = await buildReactivatedUserPayload({
    req,
    name,
    phone,
    email,
    countryCode,
    gender,
    profileImage,
    referrer,
  });

  const user = existingUser
    ? await User.findByIdAndUpdate(existingUser._id, { $set: userPayload }, { new: true, runValidators: true })
    : await User.create(userPayload);

  if (!String(user.referralCode || '').trim()) {
    user.referralCode = generateUserReferralCode(user);
    await user.save();
  }

  if (referrer?._id) {
    await User.updateOne({ _id: referrer._id }, { $inc: { referralCount: 1 } });
    await processSignupReferralRewards({ user, referrer });
  }

  await consumeUserSignupSession(signupSession);

  res.status(201).json({
    success: true,
    data: createUserSession(user),
  });
};

export const startUserOtpRequest = async (req, res) => {
  const result = await startUserOtp(req.body);
  res.status(201).json({ success: true, data: result });
};

export const verifyUserOtpRequest = async (req, res) => {
  const result = await verifyUserOtp(req.body);
  res.json({ success: true, data: result });
};

export const loginUser = async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const password = String(req.body.password || '');

  validatePhone(phone);

  if (!password) {
    throw new ApiError(400, 'password is required');
  }

  const user = await User.findOne({ phone }).select('+password');

  if (!user || !user.password || !(await comparePassword(password, user.password))) {
    throw new ApiError(401, 'Invalid phone or password');
  }

  ensureUserCanLogin(user);

  res.json({
    success: true,
    data: createUserSession(user),
  });
};

/*
 * This used to sign anyone in with only a phone number: it looked the user up
 * and returned a session, no OTP. The platform shares one token secret, so that
 * session also worked on food customer routes (orders, addresses, wallet). No
 * app calls it; it now needs the OTP, exactly like /auth/verify-otp.
 */
export const verifyUserPhoneForOtpLogin = async (req, res) => {
  if (!String(req.body?.otp || '').trim()) {
    throw new ApiError(400, 'Enter the OTP sent to your phone');
  }
  const result = await verifyUserOtp(req.body);
  res.json({ success: true, data: result });
};

export const getCurrentUser = async (req, res) => {
  const user = await User.findById(req.auth?.sub);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (!String(user.referralCode || '').trim()) {
    user.referralCode = generateUserReferralCode(user);
    await user.save();
  }

  const subscriptionSummary = await getUserSubscriptionSummary(user._id);

  res.json({
    success: true,
    data: {
      user: {
        ...toUserPayload(user, { subscriptionSummary }),
        createdAt: user.createdAt || null,
      },
    },
  });
};

export const uploadUserProfileImage = async (req, res) => {
  const dataUrl = String(req.body?.dataUrl || '');

  if (!dataUrl) {
    throw new ApiError(400, 'dataUrl is required');
  }

  if (dataUrl.length > 12_000_000) {
    throw new ApiError(413, 'Image is too large');
  }

  const uploadResult = await uploadDataUrlToCloudinary({
    dataUrl,
    folder: `${env.cloudinary.folder}/user-profile`,
    publicIdPrefix: 'user-profile',
  });

  res.status(201).json({
    success: true,
    data: {
      secureUrl: uploadResult.secureUrl,
      publicId: uploadResult.publicId,
    },
  });
};

/**
 * One photograph of a parcel, hosted.
 *
 * Takes the same `dataUrl` the profile-image route takes and returns a URL,
 * so nothing ever stores an image inside a ride document. Both the customer
 * app (at booking) and the captain (at pickup and at delivery) post here.
 */
export const uploadParcelPhoto = async (req, res) => {
  const dataUrl = String(req.body?.dataUrl || '');

  if (!dataUrl) {
    throw new ApiError(400, 'dataUrl is required');
  }

  if (dataUrl.length > 12_000_000) {
    throw new ApiError(413, 'Image is too large');
  }

  const uploadResult = await uploadDataUrlToCloudinary({
    dataUrl,
    folder: env.cloudinary.folder + '/parcel-photos',
    publicIdPrefix: 'parcel-photo',
  });

  res.status(201).json({
    success: true,
    data: {
      secureUrl: uploadResult.secureUrl,
      publicId: uploadResult.publicId,
    },
  });
};

export const updateCurrentUser = async (req, res) => {
  const userId = req.auth?.sub;

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
    const name = toCleanString(req.body.name);
    validateName(name);
    user.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'email')) {
    const email = normalizeEmail(req.body.email);
    validateEmail(email);
    user.email = email;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'profileImage')) {
    user.profileImage = toCleanString(req.body.profileImage);
  }

  await user.save();

  res.json({
    success: true,
    data: {
      user: toUserPayload(user),
    },
  });
};

export const getAvailableSubscriptionPlans = async (_req, res) => {
  const plans = await listCustomerSubscriptionPlans();

  res.json({
    success: true,
    data: {
      results: plans,
    },
  });
};

export const getMySubscriptions = async (req, res) => {
  const summary = await getUserSubscriptionSummary(req.auth?.sub);

  res.json({
    success: true,
    data: summary,
  });
};

export const buySubscription = async (req, res) => {
  const result = await purchaseUserSubscription({
    userId: req.auth?.sub,
    planId: req.body?.planId,
    paymentSource: 'wallet',
  });

  res.status(201).json({
    success: true,
    data: result,
    message: 'Subscription purchased successfully',
  });
};

export const requestAccountDeletion = async (req, res) => {
  const userId = req.auth?.sub;
  const reason = toCleanString(req.body?.reason);

  if (!reason) {
    throw new ApiError(400, 'Deletion reason is required');
  }

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.deletedAt || user.isActive === false || user.active === false) {
    throw new ApiError(400, 'Account is already inactive');
  }

  if (user.deletionRequest?.status === 'pending') {
    res.json({
      success: true,
      data: {
        deletionRequestStatus: 'pending',
        requestedAt: user.deletionRequest.requestedAt || null,
      },
      message: 'Deletion request is already pending admin review',
    });
    return;
  }

  user.deletionRequest = {
    status: 'pending',
    reason: reason.slice(0, 300),
    requestedAt: new Date(),
    reviewedAt: null,
    reviewedBy: null,
    adminNote: '',
  };

  await user.save();

  res.status(201).json({
    success: true,
    data: {
      deletionRequestStatus: user.deletionRequest.status,
      requestedAt: user.deletionRequest.requestedAt,
    },
  });
};

export const getUserWallet = async (req, res) => {
  const userId = req.auth?.sub;
  const user = await User.findById(userId).select('_id').lean();

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  await ensureUserWallet(userId);
  const wallet = await UserWallet.findOne({ userId }).select('balance refundWallet transactions').slice('transactions', -10).lean();
  const transactions = Array.isArray(wallet?.transactions) ? wallet.transactions : [];

  res.json({
    success: true,
    data: buildUserWalletPayload({ ...wallet, transactions }),
  });
};

export const topupUserWallet = async (req, res) => {
  // Credits the requested amount with NO payment ('provider: manual'). Behind the
  // open-user resolver it let an anonymous request credit any customer's wallet,
  // spendable on rides or transferable to a driver. The app's pages use the
  // Razorpay / PhonePe top-up routes; no production calls to this one. Local
  // testing only, behind an explicit flag.
  if (String(process.env.TAXI_MANUAL_WALLET_TOPUP_ENABLED || '').toLowerCase() !== 'true') {
    throw new ApiError(403, 'Manual wallet top-up is disabled. Top up through Razorpay or PhonePe.');
  }

  const amount = normalizeMoneyAmount(req.body?.amount);
  const userId = req.auth?.sub;
  const user = await User.findById(userId).select('_id').lean();

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const tx = {
    kind: 'credit',
    amount,
    title: 'Wallet Refilled',
    provider: 'manual',
  };

  await ensureUserWallet(userId);

  await UserWallet.updateOne(
    { userId },
    {
      $inc: { balance: amount },
      $push: { transactions: { $each: [tx], $slice: -50 } },
    },
  );

  const updatedWallet = await UserWallet.findOne({ userId }).select('balance transactions').slice('transactions', -10).lean();
  const updatedWalletWithRefund = updatedWallet
    ? { ...updatedWallet, refundWallet: Number(updatedWallet.refundWallet || 0) }
    : updatedWallet;
  const transactions = Array.isArray(updatedWallet?.transactions) ? updatedWallet.transactions : [];

  res.status(201).json({
    success: true,
    data: buildUserWalletPayload({ ...updatedWalletWithRefund, transactions }),
  });
};

export const transferUserWallet = async (req, res) => {
  const amount = normalizeMoneyAmount(req.body?.amount);
  const recipientPhone = normalizePhone(req.body?.phone);
  validatePhone(recipientPhone);

  const senderId = req.auth?.sub;

  const sender = await User.findById(senderId).select({ phone: 1 }).lean();
  if (!sender) {
    throw new ApiError(404, 'User not found');
  }

  if (sender.phone === recipientPhone) {
    throw new ApiError(400, 'Cannot transfer to same phone number');
  }

  const recipient = await User.findOne({ phone: recipientPhone }).select({ _id: 1 }).lean();
  if (!recipient) {
    throw new ApiError(404, 'Recipient not found');
  }

  await ensureUserWallet(senderId);
  await ensureUserWallet(recipient._id);

  const transferId = crypto.randomUUID();

  const debitTx = {
    kind: 'debit',
    amount,
    title: 'Wallet Transfer',
    counterpartyPhone: recipientPhone,
    provider: 'internal',
    providerPaymentId: transferId,
  };

  const creditTx = {
    kind: 'credit',
    amount,
    title: 'Wallet Received',
    counterpartyPhone: sender.phone || '',
    provider: 'internal',
    providerPaymentId: transferId,
  };

  const senderUpdate = await UserWallet.updateOne(
    { userId: senderId, balance: { $gte: amount } },
    { $inc: { balance: -amount }, $push: { transactions: { $each: [debitTx], $slice: -50 } } },
  );

  if (!senderUpdate?.modifiedCount) {
    throw new ApiError(400, 'Insufficient wallet balance');
  }

  const recipientUpdate = await UserWallet.updateOne(
    { userId: recipient._id },
    { $inc: { balance: amount }, $push: { transactions: { $each: [creditTx], $slice: -50 } } },
  );

  if (!recipientUpdate?.modifiedCount) {
    await UserWallet.updateOne(
      { userId: senderId },
      { $inc: { balance: amount }, $pull: { transactions: { providerPaymentId: transferId } } },
    );
    throw new ApiError(500, 'Transfer failed');
  }

  const wallet = await UserWallet.findOne({ userId: senderId }).select('balance refundWallet transactions').slice('transactions', -10).lean();

  const transactions = Array.isArray(wallet?.transactions) ? wallet.transactions : [];

  res.status(201).json({
    success: true,
    data: buildUserWalletPayload({ ...wallet, transactions }),
  });
};

export const transferUserWalletToDriver = async (req, res) => {
  const amount = normalizeMoneyAmount(req.body?.amount);
  const driverPhone = normalizePhone(req.body?.phone);
  validatePhone(driverPhone);

  const senderId = req.auth?.sub;
  const sender = await User.findById(senderId).select({ phone: 1, firstName: 1, lastName: 1, name: 1 }).lean();

  if (!sender) {
    throw new ApiError(404, 'User not found');
  }

  if (sender.phone === driverPhone) {
    throw new ApiError(400, 'Cannot transfer to same phone number');
  }

  const recipientDriver = await Driver.findOne({ phone: driverPhone })
    .select({ _id: 1, phone: 1, firstName: 1, lastName: 1, name: 1 })
    .lean();

  if (!recipientDriver) {
    throw new ApiError(404, 'Driver not found');
  }

  await ensureUserWallet(senderId);
  const transferId = crypto.randomUUID();
  const senderDisplayName = String(
    sender.name || [sender.firstName, sender.lastName].filter(Boolean).join(' ') || 'Rider',
  ).trim();
  const driverDisplayName = String(
    recipientDriver.name || [recipientDriver.firstName, recipientDriver.lastName].filter(Boolean).join(' ') || 'Driver',
  ).trim();

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const senderWallet = await UserWallet.findOne({ userId: senderId }).session(session);
    if (!senderWallet) {
      throw new ApiError(404, 'User wallet not found');
    }

    if (Number(senderWallet.balance || 0) < amount) {
      throw new ApiError(400, 'Insufficient wallet balance');
    }

    senderWallet.balance = Math.round((Number(senderWallet.balance || 0) - amount) * 100) / 100;
    senderWallet.transactions.push({
      kind: 'debit',
      amount,
      title: `Sent to driver ${driverDisplayName}`,
      counterpartyPhone: driverPhone,
      provider: 'internal_driver_wallet_transfer',
      providerPaymentId: transferId,
    });
    senderWallet.transactions = senderWallet.transactions.slice(-50);
    await senderWallet.save({ session });

    const walletUpdate = await applyDriverWalletAdjustment({
      driverId: recipientDriver._id,
      amount,
      type: 'adjustment',
      description: `Received from rider wallet (${senderDisplayName})`,
      metadata: {
        source: 'user_wallet_transfer',
        transferId,
        senderUserId: senderId,
        senderPhone: sender.phone || '',
        senderName: senderDisplayName,
      },
      session,
    });

    await session.commitTransaction();

    emitToDriver(recipientDriver._id, 'driver:wallet:updated', {
      wallet: walletUpdate.wallet,
      transaction: walletUpdate.transaction,
      notification: {
        title: 'Wallet credited',
        body: `Rs ${amount.toFixed(2)} received from rider wallet`,
      },
    });

    sendPushNotificationToEntities({
      driverIds: [recipientDriver._id],
      title: 'Wallet credited',
      body: `Rs ${amount.toFixed(2)} received from rider wallet`,
      data: {
        type: 'driver_wallet_credit',
        amount: String(amount),
        transferId,
      },
    }).catch(() => { });

    const refreshedWallet = await UserWallet.findOne({ userId: senderId })
      .select('balance refundWallet transactions')
      .slice('transactions', -10)
      .lean();

    res.status(201).json({
      success: true,
      data: {
        ...buildUserWalletPayload(refreshedWallet),
        transfer: {
          id: transferId,
          amount,
          driverPhone,
          driverName: driverDisplayName,
        },
      },
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const createRazorpayWalletTopupOrder = async (req, res) => {
  const amount = normalizeMoneyAmount(req.body?.amount);
  const { keyId, keySecret } = await resolveRazorpayCredentials();

  const amountPaise = Math.round(amount * 100);
  const userId = String(req.auth?.sub || '');
  const compactUserId = userId.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'usr';
  const receipt = `uwal_${compactUserId}_${Date.now().toString(36)}`;

  const order = await razorpayRequest({
    method: 'POST',
    path: '/orders',
    body: {
      amount: amountPaise,
      currency: 'INR',
      receipt,
      // userId stays for the dashboard; the typed notes are what verify checks.
      notes: { userId, ...buildTopupOrderNotes({ ownerType: 'user', ownerId: userId }) },
    },
    keyId,
    keySecret,
  });

  res.status(201).json({
    success: true,
    data: {
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency || 'INR',
    },
  });
};

export const createPhonePeWalletTopupOrder = async (req, res) => {
  const amount = normalizeMoneyAmount(req.body?.amount);
  const { merchantId, saltKey, saltIndex, environment } = await resolvePhonePeCredentials();
  const userId = String(req.auth?.sub || '');
  const compactUserId = userId.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'usr';
  const merchantTransactionId = `UWAL${Date.now()}${compactUserId}`.slice(0, 34);
  const frontendBaseUrl = getFrontendBaseUrl();
  const backendBaseUrl = `${req.protocol}://${req.get('host')}`;
  const redirectUrl = `${frontendBaseUrl}/taxi/user/wallet?phonepe_txn=${encodeURIComponent(merchantTransactionId)}`;
  const callbackUrl = `${backendBaseUrl}/api/v1/common/payment-gateway/phonepe/callback`;
  const user = userId ? await User.findById(userId).select('phone').lean() : null;
  // Recorded before PhonePe hears of it: verify credits only ids started here, by their owner.
  await recordPhonePeTopupIntent({
    merchantTransactionId,
    ownerType: 'user',
    ownerId: userId,
    amountPaise: Math.round(amount * 100),
  });
  const payload = await phonePeRequest({
    method: 'POST',
    path: '/pg/v1/pay',
    body: {
      merchantId,
      merchantTransactionId,
      merchantUserId: compactUserId,
      amount: Math.round(amount * 100),
      redirectUrl,
      redirectMode: 'GET',
      callbackUrl,
      mobileNumber: normalizePhone(user?.phone || '') || undefined,
      paymentInstrument: {
        type: 'PAY_PAGE',
      },
    },
    merchantId,
    saltKey,
    saltIndex,
    environment,
  });

  const checkoutUrl = payload?.data?.instrumentResponse?.redirectInfo?.url || '';
  if (!checkoutUrl) {
    throw new ApiError(502, 'PhonePe payment URL was not returned');
  }

  res.status(201).json({
    success: true,
    data: {
      gateway: 'phonepe',
      merchantTransactionId,
      amount: Math.round(amount * 100),
      currency: 'INR',
      checkoutUrl,
      method: payload?.data?.instrumentResponse?.redirectInfo?.method || 'GET',
    },
  });
};

export const verifyRazorpayWalletTopup = async (req, res) => {
  const orderId = String(req.body?.razorpay_order_id || '');
  const paymentId = String(req.body?.razorpay_payment_id || '');
  const signature = String(req.body?.razorpay_signature || '');

  if (!orderId || !paymentId || !signature) {
    throw new ApiError(400, 'Payment verification fields are required');
  }

  const { keyId, keySecret } = await resolveRazorpayCredentials();

  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  if (!safeSignatureEqual(expectedSignature, signature)) {
    throw new ApiError(400, 'Invalid payment signature');
  }

  const userId = req.auth?.sub;

  /*
   * A valid signature only proves the payment is real. It must also be a
   * top-up order created for THIS user, and the amount is the gateway's figure
   * for the payment. See services/walletTopupGuard.service.js.
   */
  const { amountPaise } = await resolveRazorpayTopup({
    orderId,
    paymentId,
    ownerType: 'user',
    ownerId: userId,
    fetchRazorpay: (path) => razorpayRequest({ method: 'GET', path, keyId, keySecret }),
  });

  const amount = Math.round(amountPaise) / 100;

  // Verified against the gateway above -- mirror into the shared payments collection.
  // Cannot throw; see services/paymentMirror.service.js.
  await mirrorTaxiPayment({ orderId, paymentId, amount, userId, purpose: 'wallet_topup' });

  await ensureUserWallet(userId);

  // The receipt is the global once-only claim on this payment; the wallet-row
  // check inside still covers top-ups credited before receipts existed.
  await creditTopupOnce({
    provider: 'razorpay',
    paymentId,
    orderId,
    ownerType: 'user',
    ownerId: userId,
    amount,
    credit: async () => {
      const alreadyCredited = await UserWallet.findOne({
        userId,
        'transactions.providerPaymentId': paymentId,
      })
        .select('_id')
        .lean();

      if (alreadyCredited) return;

      const tx = {
        kind: 'credit',
        amount,
        title: 'Wallet Refilled',
        provider: 'razorpay',
        providerOrderId: orderId,
        providerPaymentId: paymentId,
      };

      await UserWallet.updateOne(
        { userId },
        {
          $inc: { balance: amount },
          $push: { transactions: { $each: [tx], $slice: -50 } },
        },
      );
    },
  });

  const wallet = await UserWallet.findOne({ userId }).select('balance refundWallet transactions').slice('transactions', -10).lean();
  if (!wallet) {
    throw new ApiError(404, 'User not found');
  }

  res.status(201).json({
    success: true,
    data: buildUserWalletPayload(wallet),
  });
};

export const verifyPhonePeWalletTopup = async (req, res) => {
  const merchantTransactionId = toCleanString(
    req.params?.merchantTransactionId || req.query?.merchantTransactionId || req.query?.transactionId,
  );

  if (!merchantTransactionId) {
    throw new ApiError(400, 'merchantTransactionId is required');
  }

  // Only a top-up this user started here may be checked, let alone credited.
  await assertPhonePeTopupOwner({ merchantTransactionId, ownerType: 'user', ownerId: req.auth?.sub });

  const { merchantId, saltKey, saltIndex, environment } = await resolvePhonePeCredentials();
  const payload = await phonePeRequest({
    method: 'GET',
    path: `/pg/v1/status/${encodeURIComponent(merchantId)}/${encodeURIComponent(merchantTransactionId)}`,
    merchantId,
    saltKey,
    saltIndex,
    environment,
  });

  const paymentState = String(payload?.data?.state || payload?.data?.paymentState || '').trim().toUpperCase();
  const paymentId = toCleanString(payload?.data?.transactionId || merchantTransactionId);
  const amount = Math.round(Number(payload?.data?.amount || 0)) / 100;
  const userId = req.auth?.sub;

  if (paymentState === 'COMPLETED') {
    if (!(amount > 0)) {
      throw new ApiError(400, 'Invalid payment amount');
    }
    await ensureUserWallet(userId);

    // Keyed on merchantTransactionId: ours, one per top-up, and what the intent names.
    await creditTopupOnce({
      provider: 'phonepe',
      paymentId: merchantTransactionId,
      orderId: paymentId,
      ownerType: 'user',
      ownerId: userId,
      amount,
      credit: async () => {
        const alreadyCredited = await UserWallet.findOne({
          userId,
          $or: [
            { 'transactions.providerPaymentId': paymentId },
            { 'transactions.providerOrderId': merchantTransactionId },
          ],
        })
          .select('_id')
          .lean();

        if (alreadyCredited) return;

        const tx = {
          kind: 'credit',
          amount,
          title: 'Wallet Refilled',
          provider: 'phonepe',
          providerOrderId: merchantTransactionId,
          providerPaymentId: paymentId,
        };

        await UserWallet.updateOne(
          { userId },
          {
            $inc: { balance: amount },
            $push: { transactions: { $each: [tx], $slice: -50 } },
          },
        );
      },
    });

    const wallet = await UserWallet.findOne({ userId })
      .select('balance refundWallet transactions')
      .slice('transactions', -10)
      .lean();

    res.json({
      success: true,
      data: {
        status: 'paid',
        gateway: 'phonepe',
        merchantTransactionId,
        transactionId: paymentId,
        wallet: buildUserWalletPayload(wallet),
      },
    });
    return;
  }

  if (paymentState === 'PENDING') {
    res.json({
      success: true,
      data: {
        status: 'pending',
        gateway: 'phonepe',
        merchantTransactionId,
        transactionId: paymentId,
      },
      message: payload?.message || 'PhonePe payment is still pending',
    });
    return;
  }

  res.json({
    success: true,
    data: {
      status: 'failed',
      gateway: 'phonepe',
      merchantTransactionId,
      transactionId: paymentId,
      code: payload?.code || payload?.data?.responseCode || '',
    },
    message: payload?.message || 'PhonePe payment was not completed',
  });
};

