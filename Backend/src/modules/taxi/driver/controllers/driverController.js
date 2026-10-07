import crypto from "node:crypto";
import { managedBrand } from '../../../../core/settings/platformProfile.service.js';
import { safeSignatureEqual } from '../../../../utils/safeCompare.js';
import mongoose from "mongoose";
import QRCode from "qrcode";
import { env } from "../../../../config/env.js";
import { mirrorTaxiPayment } from '../../services/paymentMirror.service.js';
import {
  assertPhonePeTopupOwner,
  buildTopupOrderNotes,
  creditTopupOnce,
  recordPhonePeTopupIntent,
  resolveRazorpayTopup,
} from '../../services/walletTopupGuard.service.js';
import { ApiError } from "../../../../utils/ApiError.js";
import { normalizePoint, toPoint } from "../../../../utils/geo.js";
import { Driver } from "../models/Driver.js";
import { ensureAllDriverCapabilities } from "../../../../core/identity/driverCapabilities.service.js";
import { DriverLoginSession } from "../models/DriverLoginSession.js";
import { WalletTransaction } from "../models/WalletTransaction.js";
import { WithdrawalRequest } from "../../admin/models/WithdrawalRequest.js";
import { Ride } from "../../user/models/Ride.js";
import { ServiceLocation } from "../../admin/models/ServiceLocation.js";
import { Vehicle } from "../../admin/models/Vehicle.js";
import { AdminBusinessSetting } from "../../admin/models/AdminBusinessSetting.js";
import { Notification } from "../../admin/promotions/models/Notification.js";
import {
  comparePassword,
  hashPassword,
} from "../services/authService.js";
import {
  createTaxiSessionTokens,
  revokeTaxiRefreshToken,
  rotateTaxiRefreshToken,
} from "../../services/refreshTokenService.js";
import { cancelScheduledRideByDriver, cancelActiveRideByDriver, emitToDriver, emitToRideRoom, getDispatchState, markDriverRejectedFromDispatch } from "../../services/dispatchService.js";
import { getRideRoom } from "../../services/rideService.js";
import { reconcileDriverAssignment } from "../services/driverAssignmentService.js";
import { notifyLateAvailableDriver } from "../../services/dispatchService.js";
import { findZoneByPickup } from "../services/locationService.js";
import { listDriverServiceLocations } from "../services/serviceLocationService.js";
import {
  applyDriverWalletAdjustment,
  ensureDriverWalletCanAcceptRide,
  serializeDriverWallet,
  topUpDriverWallet,
  creditOnlineRideEarnings,
} from "../services/walletService.js";
import {
  startDriverLoginOtp,
  verifyDriverLoginOtp,
} from "../services/loginOtpService.js";
import { verifyAccessToken } from "../../services/tokenService.js";
import { clearDriverActiveRideIfStale } from "../../services/rideService.js";
import { getWalletSettings } from "../../services/appSettingsService.js";
import { RIDE_LIVE_STATUS, RIDE_STATUS } from "../../constants/index.js";
import {
  ensureThirdPartySettings,
  listDriverNeededDocuments,
  listDriverVehicleFieldTemplates,
  } from "../../admin/services/adminService.js";
import { resolveConfiguredGatewayCredentials } from "../../services/paymentGatewayService.js";
import {
  completeDriverOnboarding,
  getDriverOnboardingSession,
  saveDriverDocuments,
  saveDriverPersonalDetails,
  saveDriverReferral,
  saveDriverVehicle,
  startDriverOnboarding,
  verifyDriverOtp,
} from "../services/onboardingService.js";
import {
  buildDriverTodaySummaryFromDocument,
  syncDriverTodaySummaryDocument,
} from "../services/driverTodaySummaryService.js";

import { taxiReferralFor } from '../../../../core/referral/referralSettings.service.js';
const generateDriverReferralCode = (driver) => {
  const idPart = String(driver?._id || "")
    .slice(-6)
    .toUpperCase();
  const phonePart = String(driver?.phone || "").slice(-4);
  return `DRV${phonePart}${idPart}`.replace(/\W/g, "");
};

const MAX_EMERGENCY_CONTACTS = 5;
const EMERGENCY_CONTACT_NAME_REGEX = /^[A-Za-z]+(?:[ .'-][A-Za-z]+)*$/;
const DRIVER_NAME_REGEX = /^[A-Za-z]+(?:[ .'-][A-Za-z]+)*$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RAZORPAY_QR_MAX_AMOUNT = 500000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const toIstDayKey = (value = new Date()) =>
  new Date(new Date(value).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

const toCleanString = (value = "") => String(value || "").trim();

const serializeDriverRouteBooking = (routeBooking = {}) => {
  const coordinates = Array.isArray(routeBooking?.anchorLocation?.coordinates)
    ? routeBooking.anchorLocation.coordinates
    : [];

  return {
    enabled: Boolean(routeBooking?.enabled && coordinates.length === 2),
    coordinates: coordinates.length === 2 ? coordinates : null,
    label: String(routeBooking?.label || "").trim(),
    updatedAt: routeBooking?.updatedAt || null,
  };
};

const getIstDayStart = (value = new Date()) => {
  const timestamp = new Date(value).getTime();
  const shifted = timestamp + IST_OFFSET_MS;
  const dayStartShifted = Math.floor(shifted / DAY_MS) * DAY_MS;
  return new Date(dayStartShifted - IST_OFFSET_MS);
};

const getIstWeekKey = (value = new Date()) => {
  const dayStart = getIstDayStart(value);
  const shifted = dayStart.getTime() + IST_OFFSET_MS;
  const shiftedDate = new Date(shifted);
  const day = shiftedDate.getUTCDay();
  const mondayDistance = day === 0 ? 6 : day - 1;
  const weekStart = new Date(dayStart.getTime() - mondayDistance * DAY_MS);
  return toIstDayKey(weekStart);
};

const getIstMonthKey = (value = new Date()) => {
  const shifted = new Date(new Date(value).getTime() + IST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const getConfiguredAppName = async () => {
  try {
    const { name } = await managedBrand();
    if (name) return name;
    const settings = await AdminBusinessSetting.findOne({ scope: "default" })
      .select("general.app_name")
      .lean();

    return String(settings?.general?.app_name || "").trim() || "App";
  } catch {
    return "App";
  }
};

const pruneDailyActivity = (items = []) =>
  (Array.isArray(items) ? items : [])
    .filter((item) => item?.date)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
    .slice(-120);

const pruneClaimedRewards = (items = []) =>
  (Array.isArray(items) ? items : [])
    .filter((item) => item?.rewardType && item?.rewardKey)
    .sort((left, right) => new Date(left.claimedAt || 0) - new Date(right.claimedAt || 0))
    .slice(-200);

const appendDailyActivityMinutes = (dailyActivity = [], dateKey, minutes) => {
  const safeMinutes = Math.max(0, Number(minutes || 0));
  if (!dateKey || safeMinutes <= 0) {
    return pruneDailyActivity(dailyActivity);
  }

  const next = [...(Array.isArray(dailyActivity) ? dailyActivity : [])];
  const index = next.findIndex((item) => item?.date === dateKey);

  if (index >= 0) {
    next[index] = {
      ...next[index],
      activeMinutes: Math.round((Number(next[index]?.activeMinutes || 0) + safeMinutes) * 100) / 100,
    };
  } else {
    next.push({
      date: dateKey,
      activeMinutes: Math.round(safeMinutes * 100) / 100,
    });
  }

  return pruneDailyActivity(next);
};

const mergeOnlineSessionIntoTracking = (tracking = {}, sessionStart, sessionEnd = new Date()) => {
  const start = sessionStart ? new Date(sessionStart) : null;
  const end = sessionEnd ? new Date(sessionEnd) : null;

  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return {
      ...tracking,
      dailyActivity: pruneDailyActivity(tracking?.dailyActivity),
    };
  }

  let cursor = new Date(start);
  let nextDailyActivity = Array.isArray(tracking?.dailyActivity) ? [...tracking.dailyActivity] : [];

  while (cursor < end) {
    const nextDayStart = new Date(getIstDayStart(cursor).getTime() + DAY_MS);
    const segmentEnd = nextDayStart < end ? nextDayStart : end;
    const minutes = (segmentEnd.getTime() - cursor.getTime()) / 60000;
    nextDailyActivity = appendDailyActivityMinutes(nextDailyActivity, toIstDayKey(cursor), minutes);
    cursor = segmentEnd;
  }

  return {
    ...tracking,
    dailyActivity: nextDailyActivity,
  };
};

const collectWeekWindows = (count = 1, fromDate = new Date()) => {
  const total = Math.max(1, Number(count || 1));
  const windows = [];
  const currentDayStart = getIstDayStart(fromDate);
  const shifted = currentDayStart.getTime() + IST_OFFSET_MS;
  const shiftedDate = new Date(shifted);
  const day = shiftedDate.getUTCDay();
  const mondayDistance = day === 0 ? 6 : day - 1;
  const currentWeekStart = new Date(currentDayStart.getTime() - mondayDistance * DAY_MS);

  for (let index = 0; index < total; index += 1) {
    const start = new Date(currentWeekStart.getTime() - index * 7 * DAY_MS);
    const end = new Date(start.getTime() + 7 * DAY_MS);
    windows.unshift({
      key: toIstDayKey(start),
      start,
      end,
    });
  }

  return windows;
};

const countCompletedRidesInRange = (rides = [], start, end) =>
  rides.filter((ride) => {
    const status = String(ride?.status || "").toLowerCase();
    const liveStatus = String(ride?.liveStatus || "").toLowerCase();
    if (!["completed", "delivered"].includes(status) && !["completed", "delivered"].includes(liveStatus)) {
      return false;
    }

    const rideDate = new Date(ride?.completedAt || ride?.updatedAt || ride?.createdAt || 0);
    return rideDate >= start && rideDate < end;
  }).length;

const countPeakHourTripsInRange = (rides = [], start, end) =>
  rides.filter((ride) => {
    const status = String(ride?.status || "").toLowerCase();
    const liveStatus = String(ride?.liveStatus || "").toLowerCase();
    if (!["completed", "delivered"].includes(status) && !["completed", "delivered"].includes(liveStatus)) {
      return false;
    }
    const rideDate = new Date(ride?.completedAt || ride?.updatedAt || ride?.createdAt || 0);
    if (!(rideDate >= start && rideDate < end)) {
      return false;
    }
    const hour = new Date(rideDate.getTime() + IST_OFFSET_MS).getUTCHours();
    return (hour >= 7 && hour < 11) || (hour >= 17 && hour < 21);
  }).length;

const getCurrentActiveStreak = (dailyActivity = [], minimumMinutes = 1) => {
  const activityMap = new Map((Array.isArray(dailyActivity) ? dailyActivity : []).map((item) => [item.date, Number(item.activeMinutes || 0)]));
  let streak = 0;
  let cursor = getIstDayStart(new Date());

  while (true) {
    const key = toIstDayKey(cursor);
    const minutes = Number(activityMap.get(key) || 0);
    if (minutes < minimumMinutes) {
      break;
    }
    streak += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }

  return streak;
};

const hasClaimedReward = (claimedRewards = [], rewardType, rewardKey, periodKey) =>
  (Array.isArray(claimedRewards) ? claimedRewards : []).some((item) =>
    item?.rewardType === rewardType &&
    item?.rewardKey === rewardKey &&
    item?.periodKey === periodKey,
  );

const buildDriverIncentiveSnapshot = ({ driver, settings, rides }) => {
  const tracking = driver?.incentiveTracking || {};
  const dailyActivity = Array.isArray(tracking.dailyActivity) ? tracking.dailyActivity : [];
  const claimedRewards = Array.isArray(tracking.claimedRewards) ? tracking.claimedRewards : [];
  const milestonePrograms = Array.isArray(settings?.milestone_programs) ? settings.milestone_programs : [];
  const rewardFeatures = Array.isArray(settings?.reward_features) ? settings.reward_features : [];
  const dailyActivityMap = new Map(dailyActivity.map((item) => [item.date, Number(item.activeMinutes || 0)]));

  const milestones = milestonePrograms.map((item, index) => {
    const requiredWeeks = Math.max(1, Number(item.required_weeks || 1));
    const requiredHours = Math.max(0, Number(item.active_hours_per_day || 0));
    const minTripsPerWeek = Math.max(0, Number(item.min_trips_per_week || 0));
    const weekWindows = collectWeekWindows(requiredWeeks, new Date());
    const qualifyingWeeks = weekWindows.filter((week) => {
      const tripCount = countCompletedRidesInRange(rides, week.start, week.end);
      return tripCount >= minTripsPerWeek;
    }).length;

    const targetDays = requiredWeeks * 7;
    let qualifyingDays = 0;
    for (let offset = 0; offset < targetDays; offset += 1) {
      const day = new Date(getIstDayStart(new Date()).getTime() - offset * DAY_MS);
      const dayKey = toIstDayKey(day);
      if ((Number(dailyActivityMap.get(dayKey) || 0) / 60) >= requiredHours) {
        qualifyingDays += 1;
      }
    }

    const periodKey = `milestone:${item.id || index}`;
    const eligible = Boolean(item.enabled) && qualifyingWeeks >= requiredWeeks && qualifyingDays >= targetDays;

    return {
      ...item,
      periodKey,
      progress: {
        qualifyingWeeks,
        targetWeeks: requiredWeeks,
        qualifyingDays,
        targetDays,
      },
      isEligible: eligible,
      isClaimed: hasClaimedReward(claimedRewards, "milestone", item.id || String(index), periodKey),
    };
  });

  const currentWeekWindow = collectWeekWindows(1, new Date())[0];
  const currentWeekTrips = currentWeekWindow ? countCompletedRidesInRange(rides, currentWeekWindow.start, currentWeekWindow.end) : 0;
  const currentPeakTrips = currentWeekWindow ? countPeakHourTripsInRange(rides, currentWeekWindow.start, currentWeekWindow.end) : 0;
  const currentStreak = getCurrentActiveStreak(dailyActivity, 1);
  const weekendCount = collectWeekWindows(4, new Date()).reduce((total, week) => {
    const saturday = new Date(week.start.getTime() + 5 * DAY_MS);
    const sunday = new Date(week.start.getTime() + 6 * DAY_MS);
    const weekendTrips = countCompletedRidesInRange(rides, saturday, new Date(sunday.getTime() + DAY_MS));
    return total + (weekendTrips > 0 ? 1 : 0);
  }, 0);
  const currentMonthKey = getIstMonthKey(new Date());
  const monthStart = new Date(`${currentMonthKey}-01T00:00:00.000Z`);
  const monthCompleted = rides.filter((ride) => {
    const status = String(ride?.status || "").toLowerCase();
    const liveStatus = String(ride?.liveStatus || "").toLowerCase();
    if (!["completed", "delivered"].includes(status) && !["completed", "delivered"].includes(liveStatus)) {
      return false;
    }
    const rideDate = new Date(ride?.completedAt || ride?.updatedAt || ride?.createdAt || 0);
    return getIstMonthKey(rideDate) === currentMonthKey;
  }).length;
  const monthCancelled = rides.filter((ride) => {
    const status = String(ride?.status || "").toLowerCase();
    return status === "cancelled" && getIstMonthKey(new Date(ride?.updatedAt || ride?.createdAt || 0)) === currentMonthKey;
  }).length;
  const cancellationRate = monthCompleted + monthCancelled > 0
    ? Number(((monthCancelled / (monthCompleted + monthCancelled)) * 100).toFixed(2))
    : 0;

  const features = rewardFeatures.map((item, index) => {
    const key = item.key || item.id || `feature_${index + 1}`;
    let currentValue = 0;
    let periodKey = key;

    switch (key) {
      case "daily_active_streak":
        currentValue = currentStreak;
        periodKey = `${key}:${getIstWeekKey(new Date())}`;
        break;
      case "weekly_trip_quest":
        currentValue = currentWeekTrips;
        periodKey = `${key}:${getIstWeekKey(new Date())}`;
        break;
      case "peak_hour_booster":
        currentValue = currentPeakTrips;
        periodKey = `${key}:${getIstWeekKey(new Date())}`;
        break;
      case "weekend_warrior":
        currentValue = weekendCount;
        periodKey = `${key}:${currentMonthKey}`;
        break;
      case "rating_guard":
        currentValue = Number(driver?.rating || 0);
        periodKey = `${key}:${currentMonthKey}`;
        break;
      case "cancellation_guard":
        currentValue = cancellationRate;
        periodKey = `${key}:${currentMonthKey}`;
        break;
      default:
        currentValue = Number(item.target_value || 0);
        periodKey = `${key}:${currentMonthKey}`;
        break;
    }

    const target = Number(item.target_value || 0);
    const isEligible = key === "cancellation_guard"
      ? currentValue <= target
      : currentValue >= target;

    return {
      ...item,
      key,
      periodKey,
      currentValue,
      targetValue: target,
      isEligible: Boolean(item.enabled) && isEligible,
      isClaimed: hasClaimedReward(claimedRewards, "feature", key, periodKey),
    };
  });

  return {
    settings: {
      enabled: Boolean(settings?.enabled),
      milestone_program_enabled: Boolean(settings?.milestone_program_enabled),
      type: settings?.type || "instant_referrer",
    },
    summary: {
      streakDays: currentStreak,
      currentWeekTrips,
      currentPeakTrips,
      weekendCount,
      monthCancellationRate: cancellationRate,
      totalClaimedRewards: claimedRewards.length,
    },
    milestones,
    features,
    claimedRewards,
    walletBalance: Number(driver?.wallet?.balance || 0),
  };
};

const buildDriverTodaySummary = async (driver) => buildDriverTodaySummaryFromDocument(driver);

const normalizePaymentAmount = (value) => {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, "amount must be a positive number");
  }

  if (amount > RAZORPAY_QR_MAX_AMOUNT) {
    throw new ApiError(400, "amount is too large for QR collection");
  }

  return Math.round(amount * 100);
};

const razorpayRequest = async ({ method, path, body }) => {
  const { keyId, keySecret } = await resolveConfiguredGatewayCredentials("razor_pay");
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const isRazorpayAuthError = response.status === 401;
    console.error("Razorpay QR Request Failed:", { status: response.status, payload });
    throw new ApiError(
      isRazorpayAuthError ? 500 : (response.status || 502),
      isRazorpayAuthError
        ? "Payment gateway authentication failed. Please verify Razorpay keys in Admin settings."
        : (payload?.error?.description || payload?.error?.message || "Razorpay QR request failed"),
      {
        provider: "razorpay",
        path,
        code: payload?.error?.code || null,
      }
    );
  }

  return payload;
};

const shouldFallbackToPaymentLinkQr = (error) => {
  const message = String(error?.message || "").toLowerCase();

  return (
    error?.statusCode === 404 ||
    message.includes("requested url was not found") ||
    message.includes("qr") && message.includes("not") && message.includes("enabled")
  );
};

const shouldFallbackToStandardPaymentLink = (error) => {
  const message = String(error?.message || "").toLowerCase();

  return (
    message.includes("upi payment links are not supported in test mode") ||
    message.includes("upi payment link") && message.includes("test mode")
  );
};

const buildPaymentLinkBody = ({ amountInPaise, rideId, driverId, serviceType, expireBy, referenceId, upiLink }) => ({
  ...(upiLink ? { upi_link: true } : {}),
  amount: amountInPaise,
  currency: "INR",
  accept_partial: false,
  expire_by: expireBy,
  reference_id: referenceId,
  description: `Taxi fare for ride ${rideId}`,
  reminder_enable: false,
  notes: {
    rideId: String(rideId),
    driverId: String(driverId),
    serviceType: serviceType || "ride",
    source: "driver_collect_amount",
    fallback: upiLink ? "upi_payment_link_qr" : "standard_payment_link_qr",
  },
});

const createPaymentLinkQr = async ({ amountInPaise, rideId, driverId, serviceType }) => {
  const referenceId = `ride_${String(rideId).slice(-18)}_${Date.now().toString(36)}`.slice(0, 40);
  const expireBy = Math.floor(Date.now() / 1000) + 30 * 60;
  let providerMode = "upi_payment_link_qr";
  let paymentLink;

  try {
    paymentLink = await razorpayRequest({
      method: "POST",
      path: "/payment_links",
      body: buildPaymentLinkBody({
        amountInPaise,
        rideId,
        driverId,
        serviceType,
        expireBy,
        referenceId,
        upiLink: true,
      }),
    });
  } catch (error) {
    if (!shouldFallbackToStandardPaymentLink(error)) {
      throw error;
    }

    providerMode = "standard_payment_link_qr";
    paymentLink = await razorpayRequest({
      method: "POST",
      path: "/payment_links",
      body: buildPaymentLinkBody({
        amountInPaise,
        rideId,
        driverId,
        serviceType,
        expireBy,
        referenceId: `${referenceId}_std`.slice(0, 40),
        upiLink: false,
      }),
    });
  }

  const paymentUrl = paymentLink.short_url || paymentLink.shortUrl || paymentLink.url;

  if (!paymentUrl) {
    throw new ApiError(502, "Razorpay payment link was created without a payment URL");
  }

  const imageUrl = await QRCode.toDataURL(paymentUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 8,
  });

  return {
    id: paymentLink.id,
    entity: paymentLink.entity || "payment_link",
    status: paymentLink.status || "created",
    imageUrl,
    linkUrl: paymentUrl,
    amount: amountInPaise / 100,
    currency: "INR",
    description: paymentLink.description,
    closeBy: paymentLink.expire_by || expireBy,
    rawStatus: paymentLink.status || "created",
    providerMode,
  };
};

const PAYMENT_PAID_STATUSES = new Set(["paid", "captured", "completed"]);
const PAYMENT_OPEN_STATUSES = new Set(["created", "active", "issued", "partially_paid"]);

const normalizeCollectionStatus = (status) => {
  const normalized = String(status || "").toLowerCase();

  if (PAYMENT_PAID_STATUSES.has(normalized)) {
    return "paid";
  }

  if (PAYMENT_OPEN_STATUSES.has(normalized)) {
    return normalized === "partially_paid" ? "active" : normalized;
  }

  if (normalized === "closed") {
    return "closed";
  }

  if (["cancelled", "canceled", "expired", "failed"].includes(normalized)) {
    return normalized === "canceled" ? "cancelled" : normalized;
  }

  return normalized || "pending";
};

const getPaymentCollectionPath = ({ providerId, providerMode }) => {
  if (!providerId) {
    throw new ApiError(400, "payment collection id is required");
  }

  if (String(providerMode || "").includes("payment_link")) {
    return `/payment_links/${providerId}`;
  }

  return `/payments/qr_codes/${providerId}`;
};

const serializeDriverPaymentCollection = (collection = {}) => {
  const status = normalizeCollectionStatus(collection.status);

  return {
    provider: collection.provider || "razorpay",
    id: collection.providerId || collection.id || "",
    providerMode: collection.providerMode || "",
    status,
    paid: PAYMENT_PAID_STATUSES.has(status),
    amount: Number(collection.amount || 0),
    currency: collection.currency || "INR",
    linkUrl: collection.linkUrl || "",
    paidAt: collection.paidAt || null,
    updatedAt: collection.updatedAt || null,
  };
};

const refreshDriverPaymentCollection = async (ride) => {
  const collection = ride?.driverPaymentCollection || {};
  const providerId = String(collection.providerId || "").trim();

  if (!providerId) {
    return serializeDriverPaymentCollection(collection);
  }

  const providerMode = collection.providerMode || "";
  const providerPayload = await razorpayRequest({
    method: "GET",
    path: getPaymentCollectionPath({ providerId, providerMode }),
  });
  const receivedAmount = Number(
    providerPayload?.amount_paid ||
    providerPayload?.amount_paid_total ||
    providerPayload?.payments_amount_received ||
    providerPayload?.amount_received ||
    0,
  );
  const expectedAmount = Number(collection.amount || 0) * 100;
  const isProviderAmountPaid = expectedAmount > 0 && receivedAmount >= expectedAmount;
  const providerStatus = normalizeCollectionStatus(providerPayload?.status);
  const isPaid = PAYMENT_PAID_STATUSES.has(providerStatus) || isProviderAmountPaid;
  const nextStatus = isPaid ? "paid" : providerStatus;
  const nextCollection = {
    provider: "razorpay",
    providerId,
    providerMode,
    status: nextStatus,
    amount: Number(collection.amount || 0),
    currency: collection.currency || "INR",
    linkUrl: collection.linkUrl || providerPayload?.short_url || providerPayload?.url || "",
    paidAt: isPaid ? collection.paidAt || new Date() : collection.paidAt || null,
    updatedAt: new Date(),
  };

  ride.driverPaymentCollection = nextCollection;
  await ride.save();

  /*
   * Razorpay has confirmed the rider paid this QR. If the ride is already
   * completed, this is the payment its online earnings were waiting for
   * (walletService.creditOnlineRideEarnings). A QR paid before completion is
   * credited by the completion's own settlement instead; either way, once.
   */
  if (isPaid) {
    await creditOnlineRideEarnings({
      rideId: ride._id,
      requireConfirmedCollection: true,
      source: "driver_payment_qr",
    });
  }

  return serializeDriverPaymentCollection(nextCollection);
};

const sanitizeEmergencyPhone = (value) =>
  String(value || "")
    .replace(/\D/g, "")
    .slice(-10);

const serializeEmergencyContact = (contact = {}) => ({
  id: String(contact._id || contact.id || ""),
  name: String(contact.name || "").trim(),
  phone: sanitizeEmergencyPhone(contact.phone),
  source:
    String(contact.source || "manual").toLowerCase() === "device"
      ? "device"
      : "manual",
});

const resolveVehicleMapIcon = async (vehicleTypeId) => {
  if (!vehicleTypeId) {
    return "";
  }

  const vehicle = await Vehicle.findById(vehicleTypeId).select("icon map_icon image").lean();
  return vehicle?.map_icon || vehicle?.icon || vehicle?.image || "";
};

const serializeDriverNotification = (item = {}) => ({
  id: String(item._id || ""),
  title: String(item.push_title || "").trim(),
  body: String(item.message || "").trim(),
  image: String(item.image || "").trim(),
  sendTo: String(item.send_to || "all").trim(),
  serviceLocationName: String(item.service_location_name || "").trim(),
  sentAt: item.sent_at || item.createdAt || null,
  createdAt: item.createdAt || null,
});

const serializeDriverScheduledRide = (ride = {}, currentDriverId = "") => ({
  rideId: String(ride._id || ""),
  type: ride.serviceType || "ride",
  serviceType: ride.serviceType || "ride",
  status: ride.status || RIDE_STATUS.SEARCHING,
  liveStatus: ride.liveStatus || RIDE_LIVE_STATUS.SEARCHING,
  fare: Number(ride.fare || 0),
  baseFare: Number(ride.baseFare || ride.fare || 0),
  bookingMode: ride.bookingMode || "normal",
  estimatedDistanceMeters: Number(ride.estimatedDistanceMeters || 0),
  estimatedDurationMinutes: Number(ride.estimatedDurationMinutes || 0),
  paymentMethod: ride.paymentMethod || "cash",
  pickupLocation: ride.pickupLocation || null,
  pickupAddress: ride.pickupAddress || "",
  dropLocation: ride.dropLocation || null,
  dropAddress: ride.dropAddress || "",
  scheduledAt: ride.scheduledAt || null,
  intercity: ride.intercity || null,
  driverId: ride.driverId ? String(ride.driverId) : null,
  isAssignedToCurrentDriver:
    Boolean(ride.driverId) && String(ride.driverId) === String(currentDriverId || ""),
  vehicleTypeId: ride.vehicleTypeId ? String(ride.vehicleTypeId) : null,
  vehicleTypeIds: Array.isArray(ride.dispatchVehicleTypeIds)
    ? ride.dispatchVehicleTypeIds.map((item) => String(item))
    : [],
  serviceLocationId: ride.service_location_id ? String(ride.service_location_id) : null,
  transportType: ride.transport_type || "taxi",
  user: ride.userId
    ? {
      id: String(ride.userId._id || ""),
      name: ride.userId.name || "Customer",
      phone: ride.userId.phone || "",
      countryCode: ride.userId.countryCode || "",
    }
    : null,
  createdAt: ride.createdAt || null,
  updatedAt: ride.updatedAt || null,
});

export const registerDriver = async (req, res) => {
  const { name, phone, password, vehicleType, location } = req.body;

  if (!name || !phone || !password || !vehicleType || !location) {
    throw new ApiError(
      400,
      "name, phone, password, vehicleType and location are required",
    );
  }

  const existingDriver = await Driver.findOne({ phone });

  if (existingDriver) {
    throw new ApiError(409, "Phone number is already registered");
  }

  const coordinates = normalizePoint(location, "location");
  const zone = await findZoneByPickup(coordinates);

  const driver = await Driver.create({
    name,
    phone,
    password: await hashPassword(password),
    vehicleType,
    // Pending until an admin reviews the documents. This public route used to
    // create the driver as approved -- no OTP, no documents, no review -- and
    // ensureAllDriverCapabilities then made them an approved food and quick
    // commerce rider too. Onboarding (OTP + documents) is the real signup path.
    approve: false,
    status: "pending",
    zoneId: zone?._id || null,
    location: toPoint(coordinates, "location"),
  });

  // Both job streams from one registration -- see
  // core/identity/driverCapabilities.service.js. Non-fatal.
  await ensureAllDriverCapabilities(driver);

  const session = await createTaxiSessionTokens({ sub: driver._id, role: "driver" });

  res.status(201).json({
    success: true,
    data: {
      ...session,
      driver: {
        id: driver._id,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        rating: driver.rating,
        status: driver.status,
      },
    },
  });
};

export const loginDriver = async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    throw new ApiError(400, "phone and password are required");
  }

  const driver = await Driver.findOne({ phone }).select("+password");

  if (!driver || !(await comparePassword(password, driver.password))) {
    throw new ApiError(401, "Invalid phone or password");
  }

  if (
    driver.approve === false ||
    String(driver.status || "").toLowerCase() === "pending"
  ) {
    throw new ApiError(403, "Driver account is pending approval");
  }

  await clearDriverActiveRideIfStale(driver);

  // token (kept for existing clients) === accessToken; plus refreshToken, expiresIn.
  const session = await createTaxiSessionTokens({ sub: driver._id, role: "driver" });

  res.json({
    success: true,
    data: {
      ...session,
      driver: {
        id: driver._id,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        isOnline: driver.isOnline,
        isOnRide: driver.isOnRide,
        status: driver.status,
      },
    },
  });
};

/**
 * Sets the driver's work mode — which job streams they accept: all | taxi | delivery.
 *
 * 'delivery' covers BOTH delivery verticals, food and quick-commerce. One toggle,
 * because a rider turning deliveries on wants jobs rather than a choice between
 * two apps they cannot tell apart from the street.
 *
 * Only capabilities the driver actually has are honored, and holding either
 * delivery capability is enough to select it. 'all' means every stream the driver
 * is capable of, so it needs at least two capabilities to be a real choice.
 */
const WORK_MODES = ['all', 'taxi', 'delivery'];
const DELIVERY_CAPABILITIES = ['delivery', 'quickCommerce'];

export const setWorkMode = async (req, res) => {
  // Matched case-insensitively but stored in the schema's casing: lowercasing
  // the input outright would turn 'quickCommerce' into 'quickcommerce', which is
  // not in the enum, so the mode would be rejected however the client sent it.
  const raw = String(req.body?.workMode || '').trim();
  const requested = WORK_MODES.find((m) => m.toLowerCase() === raw.toLowerCase());
  if (!requested) {
    throw new ApiError(400, `workMode must be one of: ${WORK_MODES.join(', ')}`);
  }

  const driver = await Driver.findById(req.auth.sub);
  if (!driver) throw new ApiError(404, "Driver not found");

  const caps = Array.isArray(driver.serviceCapabilities) && driver.serviceCapabilities.length
    ? driver.serviceCapabilities
    : ['taxi'];

  // Guard: a driver can only pick a mode they're actually set up for.
  // Delivery is satisfied by EITHER delivery capability, since the one toggle
  // covers both verticals -- a driver set up for grocery but not food can still
  // turn deliveries on and will simply only be offered grocery.
  if (requested === 'taxi' && !caps.includes('taxi')) {
    throw new ApiError(400, 'You are not registered for taxi rides');
  }
  if (requested === 'delivery' && !DELIVERY_CAPABILITIES.some((c) => caps.includes(c))) {
    throw new ApiError(400, 'You are not registered for deliveries');
  }
  if (requested === 'all' && caps.length < 2) {
    throw new ApiError(400, "You need more than one capability for 'all' mode");
  }

  driver.workMode = requested;
  await driver.save();

  res.json({
    success: true,
    message: `Work mode set to ${requested}`,
    data: {
      workMode: driver.workMode,
      serviceCapabilities: caps,
      driverClass: driver.driverClass || '',
      // The app's duty-toggle fallback needs this alongside driverClass: on a
      // record where driverClass was never populated, vehicleType is often
      // the only reliable signal for which vehicle this driver actually
      // has. Omitting it here (unlike /taxi/drivers/me, which already
      // includes it) meant the toggle's label reverted to a generic guess
      // the moment a driver switched modes, even though the initial load
      // had shown it correctly.
      vehicleType: driver.vehicleType || '',
      serviceIntents: Array.isArray(driver.serviceIntents) ? driver.serviceIntents : [],
    },
  });
};

export const goOnline = async (req, res) => {
  const { location } = req.body;

  const coordinates = normalizePoint(location, "location");
  const zone = await findZoneByPickup(coordinates);
  const existingDriver = await Driver.findById(req.auth.sub);

  if (!existingDriver) {
    throw new ApiError(404, "Driver not found");
  }

  /*
   * No selfie step of any kind. Going online is decided by the wallet, vehicle
   * and document checks below and nothing else. The daily-selfie requirement,
   * the stored record and the admin view of it were all removed together, so a
   * `selfieImageUrl` in the body is simply ignored.
   */
  await ensureDriverWalletCanAcceptRide(existingDriver);
  await clearDriverActiveRideIfStale(existingDriver);
  // Self-heal a cross-service busy-lock left behind by an abandoned/force-quit job, otherwise
  // the driver would come back online permanently unassignable.
  await reconcileDriverAssignment(existingDriver._id);
  const trackingBeforeOnline = mergeOnlineSessionIntoTracking(
    existingDriver.incentiveTracking || {},
    existingDriver.incentiveTracking?.currentOnlineStartedAt,
    new Date(),
  );
  const nextTodaySummary = buildDriverTodaySummaryFromDocument(existingDriver);

  const driver = await Driver.findByIdAndUpdate(
    req.auth.sub,
    {
      isOnline: true,
      zoneId: zone?._id || null,
      location: toPoint(coordinates, "location"),
      incentiveTracking: {
        ...trackingBeforeOnline,
        currentOnlineStartedAt: new Date(),
        claimedRewards: pruneClaimedRewards(trackingBeforeOnline?.claimedRewards),
      },
      todaySummary: nextTodaySummary,
    },
    { returnDocument: 'after' },
  );

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const vehicleIconUrl = await resolveVehicleMapIcon(driver.vehicleTypeId);

  res.json({
    success: true,
    data: {
      ...driver.toObject(),
      vehicleIconUrl,
    },
  });

  notifyLateAvailableDriver(driver._id).catch((error) => {
    console.error("Failed to notify late-available driver on goOnline", error);
  });
};

export const getCurrentDriver = async (req, res) => {
  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  let driverNeedsSave = false;
  if (!String(driver.referralCode || "").trim()) {
    driver.referralCode = generateDriverReferralCode(driver);
    driverNeedsSave = true;
  }

  // This used to set approve:true / status:'approved' on any pending driver, and
  // this route accepts pending drivers' tokens -- so a driver approved themselves
  // just by opening the app, bypassing admin review. Approval is the admin's call.

  if (driverNeedsSave) {
    await driver.save();
  }

  await clearDriverActiveRideIfStale(driver);
  const vehicleIconUrl = await resolveVehicleMapIcon(driver.vehicleTypeId);
  const todaySummary = await syncDriverTodaySummaryDocument(driver);

  res.json({
    success: true,
    data: {
      id: driver._id,
      name: driver.name,
      phone: driver.phone,
      email: driver.email,
      salary: Number(driver.salary || 0),
      profileImage: driver.profileImage || "",
      gender: driver.gender,
      vehicleType: driver.vehicleType,
      vehicleTypeId: driver.vehicleTypeId,
      vehicleIconType: driver.vehicleIconType,
      vehicleIconUrl,
      vehicleMake: driver.vehicleMake,
      vehicleModel: driver.vehicleModel,
      registerFor: driver.registerFor,
      vehicleNumber: driver.vehicleNumber,
      vehicleColor: driver.vehicleColor,
      vehicleImage: driver.vehicleImage || "",
      city: driver.city,
      approve: driver.approve,
      status: driver.status,
      rating: driver.rating,
      wallet: await serializeDriverWallet(driver),
      referralCode: driver.referralCode || "",
      deletionRequest: driver.deletionRequest || { status: "none" },
      isOnline: driver.isOnline,
      isOnRide: driver.isOnRide,
      // Driver unification: drives the All/Rides/Food work-mode toggle in the driver app.
      workMode: driver.workMode || 'all',
      serviceCapabilities: Array.isArray(driver.serviceCapabilities) && driver.serviceCapabilities.length
        ? driver.serviceCapabilities
        : ['taxi'],
      // What the rider actually ticked at registration (e.g. 'bike_taxi_parcel',
      // 'four_wheeler') — finer-grained than serviceCapabilities, which
      // collapses bike-taxi and passenger-taxi into one 'taxi' flag. The app's per-duty toggle row
      // (WorkModeSwitcher) needs this finer list; serviceCapabilities alone
      // can't tell "I have a bike" from "I have a car" apart. See
      // driverClasses.js for the full DRIVER_INTENTS catalogue.
      driverClass: driver.driverClass || '',
      serviceIntents: Array.isArray(driver.serviceIntents) ? driver.serviceIntents : [],
      location: driver.location,
      zoneId: driver.zoneId,
      routeBooking: serializeDriverRouteBooking(driver.routeBooking),
      documents: driver.documents || {},
      emergencyContacts: Array.isArray(driver.emergencyContacts)
        ? driver.emergencyContacts.map(serializeEmergencyContact)
        : [],
      onboarding: driver.onboarding || {},
      todaySummary: todaySummary || buildDriverTodaySummaryFromDocument(driver),
      // The daily-selfie requirement was removed from goOnline (see its own
      // comment), but the app's selfieStatus() check still gates on this
      // field being present and dated today -- reporting it as always
      // satisfied here keeps the camera screen from appearing without
      // touching the app itself.
      onlineSelfie: { imageUrl: 'https://quickdrop.appzeto.com/selfie-not-required', forDate: new Date().toISOString().slice(0, 10) },
    },
  });
};

export const getDriverEmergencyContacts = async (req, res) => {
  const driver = await Driver.findById(req.auth.sub).lean();

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  res.json({
    success: true,
    data: {
      results: Array.isArray(driver.emergencyContacts)
        ? driver.emergencyContacts.map(serializeEmergencyContact)
        : [],
      limit: MAX_EMERGENCY_CONTACTS,
    },
  });
};

export const getDriverNotifications = async (req, res) => {
  const driver = await Driver.findById(req.auth.sub).lean();

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const serviceLocationId = driver.service_location_id || null;
  const query = {
    status: "sent",
    send_to: { $in: ["all", "drivers"] },
  };

  if (serviceLocationId) {
    query.$or = [
      { service_location_id: serviceLocationId },
      { send_to: "all" },
      { send_to: "drivers" },
    ];
  }

  const notifications = await Notification.find(query)
    .sort({ sent_at: -1, createdAt: -1 })
    .limit(100)
    .lean();

  res.json({
    success: true,
    data: {
      results: notifications.map(serializeDriverNotification),
    },
  });
};

export const getDriverScheduledRides = async (req, res) => {
  const driver = await Driver.findById(req.auth.sub)
    .select("service_location_id vehicleTypeId")
    .lean();

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const safePage = Math.max(1, Number(req.query?.page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(req.query?.limit) || 20));
  const openScheduledRideQuery = {
    driverId: null,
    status: RIDE_STATUS.SEARCHING,
    liveStatus: RIDE_LIVE_STATUS.SEARCHING,
    ...(driver.service_location_id ? { service_location_id: driver.service_location_id } : {}),
  };

  if (driver.vehicleTypeId) {
    openScheduledRideQuery.$or = [
      { vehicleTypeId: driver.vehicleTypeId },
      { dispatchVehicleTypeIds: driver.vehicleTypeId },
    ];
  }

  const query = {
    scheduledAt: { $ne: null, $gte: new Date() },
    $or: [
      openScheduledRideQuery,
      {
        driverId: req.auth.sub,
        status: { $in: [RIDE_STATUS.SEARCHING, RIDE_STATUS.ACCEPTED] },
        liveStatus: {
          $in: [
            RIDE_LIVE_STATUS.SEARCHING,
            RIDE_LIVE_STATUS.ACCEPTED,
            RIDE_LIVE_STATUS.ARRIVING,
          ],
        },
      },
    ],
  };

  const [rides, totalCount] = await Promise.all([
    Ride.find(query)
      .sort({ scheduledAt: 1, createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .select([
        "serviceType",
        "status",
        "liveStatus",
        "fare",
        "baseFare",
        "bookingMode",
        "estimatedDistanceMeters",
        "estimatedDurationMinutes",
        "paymentMethod",
        "pickupLocation",
        "pickupAddress",
        "dropLocation",
        "dropAddress",
        "scheduledAt",
        "driverId",
        "intercity",
        "vehicleTypeId",
        "dispatchVehicleTypeIds",
        "service_location_id",
        "transport_type",
        "userId",
        "createdAt",
        "updatedAt",
      ].join(" "))
      .populate("userId", "name phone countryCode")
      .lean(),
    Ride.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: {
      results: rides.map((ride) => serializeDriverScheduledRide(ride, req.auth.sub)),
      totalCount,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
        hasNextPage: safePage * safeLimit < totalCount,
        hasPrevPage: safePage > 1,
      },
    },
  });
};

export const cancelDriverScheduledRide = async (req, res) => {
  const rideId = toCleanString(req.params?.rideId);

  if (!rideId) {
    throw new ApiError(400, "Ride id is required");
  }

  const ride = await cancelScheduledRideByDriver({
    rideId,
    driverId: req.auth.sub,
  });

  if (!ride) {
    throw new ApiError(404, "Scheduled ride not found for this driver");
  }

  res.json({
    success: true,
    message: "Scheduled ride cancelled successfully",
    data: {
      rideId: String(ride._id || ""),
      status: ride.status || RIDE_STATUS.CANCELLED,
      liveStatus: ride.liveStatus || RIDE_LIVE_STATUS.CANCELLED,
    },
  });
};

export const cancelDriverActiveRide = async (req, res) => {
  const rideId = toCleanString(req.params?.rideId);
  if (!rideId) {
    throw new ApiError(400, "Ride id is required");
  }

  const { ride, settlement } = await cancelActiveRideByDriver({
    rideId,
    driverId: req.auth.sub,
    reason: toCleanString(req.body?.reason),
  });

  if (!ride) {
    throw new ApiError(404, "Active ride not found for this driver");
  }

  res.json({
    success: true,
    message: "Ride cancelled. A cancellation fee may apply.",
    data: {
      rideId: String(ride._id || ""),
      status: ride.status,
      liveStatus: ride.liveStatus,
      cancellationFee: Number(settlement?.feeAmount || 0),
    },
  });
};

/**
 * Declines a ride offer this driver was dispatched, over plain REST.
 *
 * Mirrors the socket `rejectRide` handler exactly (same ownership check, same
 * `markDriverRejectedFromDispatch` call, same `driverRejectedRide` room
 * broadcast) so a decline answers identically whichever transport sent it.
 * Exists for the native Android incoming-order card, which can show and
 * answer a ride offer even with no Flutter engine running -- it has no
 * socket connection to call `rejectRide` over, only an authenticated REST
 * client.
 */
export const declineDriverRideOffer = async (req, res) => {
  const rideId = toCleanString(req.params?.rideId);
  if (!rideId) {
    throw new ApiError(400, "Ride id is required");
  }

  // Only a driver who was actually offered this ride may decline it -- same
  // guard the socket path uses, so a stray/late REST call can't poke a ride
  // it was never dispatched.
  const state = getDispatchState(rideId);
  const wasOffered = Array.isArray(state?.notifiedDriverIds)
    && state.notifiedDriverIds.map(String).includes(String(req.auth.sub));
  if (!wasOffered) {
    throw new ApiError(404, "This ride was not offered to you");
  }

  markDriverRejectedFromDispatch(rideId, req.auth.sub);
  emitToRideRoom(rideId, "driverRejectedRide", { rideId });

  res.json({ success: true, message: "Offer declined" });
};

export const addDriverEmergencyContact = async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const phone = sanitizeEmergencyPhone(req.body?.phone);
  const source =
    String(req.body?.source || "manual").toLowerCase() === "device"
      ? "device"
      : "manual";

  if (!name) {
    throw new ApiError(400, "Contact name is required");
  }

  if (!EMERGENCY_CONTACT_NAME_REGEX.test(name)) {
    throw new ApiError(400, "Contact name can contain alphabets only");
  }

  if (!/^\d{10}$/.test(phone)) {
    throw new ApiError(400, "A valid 10-digit contact number is required");
  }

  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const existingContacts = Array.isArray(driver.emergencyContacts)
    ? driver.emergencyContacts
    : [];

  if (existingContacts.length >= MAX_EMERGENCY_CONTACTS) {
    throw new ApiError(
      400,
      `You can add up to ${MAX_EMERGENCY_CONTACTS} emergency contacts`,
    );
  }

  if (
    existingContacts.some(
      (contact) => sanitizeEmergencyPhone(contact.phone) === phone,
    )
  ) {
    throw new ApiError(409, "This contact number is already added");
  }

  driver.emergencyContacts = [
    ...existingContacts,
    {
      name: name.slice(0, 80),
      phone,
      source,
    },
  ];

  await driver.save();

  const addedContact =
    driver.emergencyContacts[driver.emergencyContacts.length - 1];

  res.status(201).json({
    success: true,
    data: serializeEmergencyContact(addedContact),
  });
};

export const deleteDriverEmergencyContact = async (req, res) => {
  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const existingContacts = Array.isArray(driver.emergencyContacts)
    ? driver.emergencyContacts
    : [];
  const nextContacts = existingContacts.filter(
    (contact) => String(contact._id) !== String(req.params.contactId),
  );

  if (nextContacts.length === existingContacts.length) {
    throw new ApiError(404, "Emergency contact not found");
  }

  driver.emergencyContacts = nextContacts;
  await driver.save();

  res.json({
    success: true,
    data: {
      deleted: true,
      results: driver.emergencyContacts.map(serializeEmergencyContact),
    },
  });
};

export const updateCurrentDriver = async (req, res) => {
  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "name")) {
    const name = String(req.body.name || "").trim();
    if (!DRIVER_NAME_REGEX.test(name)) {
      throw new ApiError(400, "Full name can contain alphabets only");
    }
    driver.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "email")) {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    if (email && !EMAIL_REGEX.test(email)) {
      throw new ApiError(400, "Enter a valid email address");
    }
    driver.email = email;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "profileImage")) {
    driver.profileImage = String(req.body.profileImage || "").trim();
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "routeBooking")) {
    const routeBookingPayload = req.body?.routeBooking || {};
    const enabled = Boolean(routeBookingPayload?.enabled);

    if (!enabled) {
      driver.routeBooking = {
        enabled: false,
        anchorLocation: null,
        label: "",
        updatedAt: new Date(),
      };
    } else {
      const coordinates = normalizePoint(
        routeBookingPayload?.coordinates || routeBookingPayload?.anchorLocation,
        "routeBooking.coordinates",
      );

      driver.routeBooking = {
        enabled: true,
        anchorLocation: toPoint(coordinates, "routeBooking.coordinates"),
        label: String(routeBookingPayload?.label || "").trim(),
        updatedAt: new Date(),
      };
    }
  }

  await driver.save();

  res.json({
    success: true,
    data: {
      id: driver._id,
      name: driver.name,
      phone: driver.phone,
      email: driver.email,
      profileImage: driver.profileImage || "",
      routeBooking: serializeDriverRouteBooking(driver.routeBooking),
    },
  });
};

export const requestDriverAccountDeletion = async (req, res) => {
  const driverId = req.auth?.sub;
  const reason = String(req.body?.reason || "").trim();

  if (!reason) {
    throw new ApiError(400, "Deletion reason is required");
  }

  const driver = await Driver.findById(driverId);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  if (
    driver.deletedAt ||
    driver.approve === false ||
    String(driver.status || "").toLowerCase() === "inactive"
  ) {
    throw new ApiError(400, "Account is already inactive");
  }

  if (driver.deletionRequest?.status === "pending") {
    res.json({
      success: true,
      data: {
        deletionRequestStatus: "pending",
        requestedAt: driver.deletionRequest.requestedAt || null,
      },
      message: "Deletion request is already pending admin review",
    });
    return;
  }

  driver.deletionRequest = {
    status: "pending",
    reason: reason.slice(0, 300),
    requestedAt: new Date(),
    reviewedAt: null,
    reviewedBy: null,
    adminNote: "",
  };

  await driver.save();

  res.status(201).json({
    success: true,
    data: {
      deletionRequestStatus: driver.deletionRequest.status,
      requestedAt: driver.deletionRequest.requestedAt,
    },
  });
};

export const updateCurrentDriverDocument = async (req, res) => {
  const documentKey = String(req.params.documentKey || "").trim();
  const document = req.body?.document || {};

  if (!documentKey) {
    throw new ApiError(400, "Document key is required");
  }

  const previewUrl = String(
    document.previewUrl || document.secureUrl || document.url || "",
  ).trim();

  if (!previewUrl) {
    throw new ApiError(400, "Uploaded document image URL is required");
  }

  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const existingDocument = driver.documents?.[documentKey] || {};
  const existingStatus = String(
    existingDocument.status ||
    existingDocument.verificationStatus ||
    existingDocument.approvalStatus ||
    existingDocument.reviewStatus ||
    "",
  ).trim().toLowerCase();

  if (["verified", "approved"].includes(existingStatus)) {
    throw new ApiError(409, "Verified documents cannot be re-uploaded");
  }

  const updatedDocument = {
    ...(typeof existingDocument === "object" ? existingDocument : {}),
    ...(typeof document === "object" ? document : {}),
    key: documentKey,
    fileName: String(document.fileName || documentKey).trim(),
    fileNames: [String(document.fileName || documentKey).trim()],
    uploaded: true,
    uploadedAt: new Date().toISOString(),
    previewUrl,
    secureUrl: String(document.secureUrl || previewUrl).trim(),
    imageUrl: previewUrl,
    images: [previewUrl],
    status: "pending",
    verificationStatus: "pending",
    reviewStatus: "pending",
    comment: "",
    remarks: "",
    reason: "",
    admin_comment: "",
    rejection_reason: "",
    reviewedAt: null,
    reverificationRequestedAt: new Date().toISOString(),
  };

  driver.documents = {
    ...(driver.documents || {}),
    [documentKey]: updatedDocument,
  };

  driver.markModified("documents");
  await driver.save();

  res.json({
    success: true,
    data: {
      document: updatedDocument,
      documents: driver.documents || {},
    },
  });
};

export const deleteCurrentDriverAccount = async (req, res) => {
  const driverId = req.auth?.sub;

  const activeRide = await Ride.findOne({
    driverId,
    status: { $in: [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] },
  }).select("_id status");

  if (activeRide) {
    throw new ApiError(409, "Complete or cancel your active ride before deleting your account");
  }

  const deletedDriver = await Driver.findByIdAndDelete(driverId);

  if (!deletedDriver) {
    throw new ApiError(404, "Driver not found");
  }

  await DriverLoginSession.deleteMany({
    $or: [
      { driverId: deletedDriver._id },
      { phone: deletedDriver.phone },
    ],
  });

  res.json({
    success: true,
    data: {
      deleted: true,
      driverId: String(deletedDriver._id),
    },
    message: "Driver account deleted successfully",
  });
};

export const getMyWallet = async (req, res) => {
  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const transactions = await WalletTransaction.find({ driverId: req.auth.sub })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  const withdrawalRequests = await WithdrawalRequest.find({ driver_id: req.auth.sub })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  const walletSettings = await getWalletSettings();

  const [aggregationResult] = await WalletTransaction.aggregate([
    { $match: { driverId: req.auth.sub } },
    {
      $group: {
        _id: null,
        onlineRideEarnings: {
          $sum: {
            $cond: [{ $eq: ["$type", "ride_earning"] }, { $max: ["$amount", 0] }, 0]
          }
        },
        cashRideCommission: {
          $sum: {
            $cond: [{ $eq: ["$type", "commission_deduction"] }, { $abs: "$amount" }, 0]
          }
        },
        /*
         * Tips are read from `metadata.tipAmount` first, falling back to `amount`.
         *
         * A cash tip never passes through the wallet, so its row now records
         * `amount: 0` -- a ledger row whose amount does not equal its own balance
         * delta would make folding the collection overstate every driver's balance
         * by their lifetime tips. The figure moved to `metadata.tipAmount`.
         *
         * The fallback is not defensive coding: rows written before that change
         * carry the tip in `amount` and nothing backfills them, so both shapes are
         * real and will coexist indefinitely. `$ifNull` picks whichever this row has.
         */
        totalTips: {
          $sum: {
            $cond: [
              { $or: [{ $eq: ["$metadata.source", "ride_tip"] }, { $gt: ["$metadata.tipAmount", 0] }] },
              { $max: [{ $ifNull: ["$metadata.tipAmount", "$amount"] }, 0] },
              0
            ]
          }
        },
        totalAppEarnings: {
          $sum: {
            $cond: [
              { $eq: ["$type", "ride_earning"] },
              { $max: ["$amount", 0] },
              {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$type", "adjustment"] },
                      { $in: ["$metadata.source", ["driver_incentive", "ride_tip"]] }
                    ]
                  },
                  // Same reason as totalTips above: a cash tip's figure now lives
                  // in metadata, older rows still carry it in `amount`.
                  { $max: [{ $ifNull: ["$metadata.tipAmount", "$amount"] }, 0] },
                  0
                ]
              }
            ]
          }
        }
      }
    }
  ]);

  const summary = aggregationResult || {
    onlineRideEarnings: 0,
    cashRideCommission: 0,
    totalTips: 0,
    totalAppEarnings: 0
  };

  res.json({
    success: true,
    data: {
      wallet: await serializeDriverWallet(driver),
      transactions,
      withdrawalRequests,
      settings: walletSettings,
      summary,
    },
  });
};

export const createDriverWithdrawalRequest = async (req, res) => {
  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const wallet = await serializeDriverWallet(driver);
  const walletSettings = await getWalletSettings();
  const isTransferEnabled = ['1', 'true', 'yes', 'on'].includes(
    String(walletSettings.enable_wallet_transfer_driver ?? '1').trim().toLowerCase(),
  );
  const minimumTransferAmount = Number(wallet.minimumTransferAmount ?? walletSettings.minimum_wallet_amount_for_transfer ?? 0);
  const amount = Number(req.body?.amount);
  const paymentMethod = String(req.body?.payment_method || req.body?.paymentMethod || 'bank_transfer').trim().toLowerCase() || 'bank_transfer';

  if (!isTransferEnabled) {
    throw new ApiError(403, "Withdrawals are disabled by admin");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, "amount must be greater than zero");
  }

  if (minimumTransferAmount > 0 && amount < minimumTransferAmount) {
    throw new ApiError(400, `amount must be at least ${minimumTransferAmount}`);
  }

  if (amount > Number(wallet.balance || 0)) {
    throw new ApiError(400, "Withdrawal amount cannot exceed current balance");
  }

  const pendingRequest = await WithdrawalRequest.findOne({
    driver_id: req.auth.sub,
    amount,
    status: 'pending',
  })
    .sort({ createdAt: -1 })
    .lean();

  if (pendingRequest && (Date.now() - new Date(pendingRequest.createdAt).getTime()) < 60 * 1000) {
    throw new ApiError(409, "A similar withdrawal request was just submitted");
  }

  const created = await WithdrawalRequest.create({
    transactionId: `wdr_${Date.now().toString(36)}`,
    driver_id: req.auth.sub,
    amount: Math.round(amount * 100) / 100,
    payment_method: paymentMethod,
    status: 'pending',
  });

  res.status(201).json({
    success: true,
    data: {
      request: created,
      wallet,
    },
    message: "Withdrawal request sent to admin",
  });
};

export const topUpMyWallet = async (req, res) => {
  // Credits the requested amount with NO payment behind it, so any driver could mint
  // wallet balance and withdraw it. The app tops up through the Razorpay / PhonePe
  // routes below; nothing calls this one (none in the production API log). Kept for
  // local testing only, behind an explicit flag.
  if (String(process.env.TAXI_MANUAL_WALLET_TOPUP_ENABLED || "").toLowerCase() !== "true") {
    throw new ApiError(403, "Manual wallet top-up is disabled. Top up through Razorpay or PhonePe.");
  }

  const amount = Number(req.body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, "amount must be greater than zero");
  }

  const result = await topUpDriverWallet({
    driverId: req.auth.sub,
    amount,
    metadata: {
      source: req.body.source || "manual",
      referenceId: req.body.referenceId || null,
    },
  });

  const payload = {
    wallet: result.wallet,
    transaction: result.transaction,
  };

  emitToDriver(req.auth.sub, "driver:wallet:updated", payload);

  res.json({
    success: true,
    data: payload,
  });
};

export const createDriverPaymentQr = async (req, res) => {
  const amountInPaise = normalizePaymentAmount(req.body.amount);
  const rideId = String(req.body.rideId || "").trim();

  if (!rideId) {
    throw new ApiError(400, "rideId is required");
  }

  const ride = await Ride.findOne({
    _id: rideId,
    driverId: req.auth.sub,
  })
    .select("_id fare paymentMethod serviceType driverPaymentCollection");

  if (!ride) {
    throw new ApiError(404, "Ride not found for this driver");
  }

  let payload;

  try {
    const appName = await getConfiguredAppName();
    const qr = await razorpayRequest({
      method: "POST",
      path: "/payments/qr_codes",
      body: {
        type: "upi_qr",
        name: `${appName} Taxi Fare`,
        usage: "single_use",
        fixed_amount: true,
        payment_amount: amountInPaise,
        description: `Taxi fare for ride ${rideId}`,
        close_by: Math.floor(Date.now() / 1000) + 30 * 60,
        notes: {
          rideId,
          driverId: String(req.auth.sub),
          serviceType: ride.serviceType || "ride",
          source: "driver_collect_amount",
        },
      },
    });

    payload = {
      id: qr.id,
      entity: qr.entity,
      status: qr.status,
      imageUrl: qr.image_url,
      linkUrl: qr.image_url,
      amount: amountInPaise / 100,
      currency: "INR",
      description: qr.description,
      closeBy: qr.close_by || null,
      rawStatus: qr.status,
      providerMode: "razorpay_qr",
    };
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn("Razorpay QR failed, falling back to dummy QR for development", error.message);
      const dummyUrl = `upi://pay?pa=test@upi&pn=Test&am=${amountInPaise / 100}`;
      const imageUrl = await QRCode.toDataURL(dummyUrl);
      payload = {
        id: 'qr_dummy_' + Date.now(),
        entity: 'qr_code',
        status: 'active',
        imageUrl,
        linkUrl: dummyUrl,
        amount: amountInPaise / 100,
        currency: 'INR',
        description: 'Dummy QR for development',
        closeBy: Math.floor(Date.now() / 1000) + 30 * 60,
        rawStatus: 'active',
        providerMode: 'razorpay_qr',
      };
    } else {
      if (!shouldFallbackToPaymentLinkQr(error)) {
        throw error;
      }

      payload = await createPaymentLinkQr({
        amountInPaise,
        rideId,
        driverId: req.auth.sub,
        serviceType: ride.serviceType,
      });
    }
  }

  ride.driverPaymentCollection = {
    provider: "razorpay",
    providerId: payload.id,
    providerMode: payload.providerMode,
    status: normalizeCollectionStatus(payload.rawStatus || payload.status),
    amount: payload.amount,
    currency: payload.currency || "INR",
    linkUrl: payload.linkUrl || "",
    paidAt: null,
    updatedAt: new Date(),
  };
  await ride.save();

  res.json({
    success: true,
    data: payload,
  });
};

const resolveRazorpayCredentials = async () => {
  return resolveConfiguredGatewayCredentials("razor_pay");
};

const resolvePhonePeCredentials = async () => {
  return resolveConfiguredGatewayCredentials("phone_pay");
};

const getFrontendBaseUrl = () => {
  const configuredOrigin = String(env.corsOrigin || "")
    .split(",")
    .map((value) => value.trim())
    .find((value) => value && value !== "*");

  return (configuredOrigin || "https://k9rides.onrender.com").replace(/\/+$/, "");
};

const getPhonePeBaseUrl = (environment = "test") =>
  String(environment).trim().toLowerCase() === "production"
    ? "https://api.phonepe.com/apis/hermes"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox";

const buildPhonePeChecksum = ({ payload = "", path = "", saltKey = "", saltIndex = "1" }) => {
  const digest = crypto
    .createHash("sha256")
    .update(`${payload}${path}${saltKey}`)
    .digest("hex");

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
  const normalizedMethod = String(method || "GET").trim().toUpperCase();
  const encodedPayload =
    body && normalizedMethod !== "GET"
      ? Buffer.from(JSON.stringify(body)).toString("base64")
      : "";
  const response = await fetch(`${getPhonePeBaseUrl(environment)}${path}`, {
    method: normalizedMethod,
    headers: {
      "Content-Type": "application/json",
      "X-VERIFY": buildPhonePeChecksum({
        payload: encodedPayload,
        path,
        saltKey,
        saltIndex,
      }),
      "X-MERCHANT-ID": merchantId,
      accept: "application/json",
    },
    body: encodedPayload ? JSON.stringify({ request: encodedPayload }) : undefined,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new ApiError(
      response.status || 502,
      payload?.message || payload?.code || "PhonePe request failed",
    );
  }

  return payload;
};

const fetchRazorpay = async ({ method, path, body, keyId, keySecret }) => {
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const isRazorpayAuthError = response.status === 401;
    throw new ApiError(
      isRazorpayAuthError ? 500 : (response.status || 502),
      isRazorpayAuthError
        ? "Payment gateway authentication failed. Please verify Razorpay keys in Admin settings."
        : (payload?.error?.description || payload?.error?.message || "Razorpay request failed")
    );
  }

  return payload;
};

export const createDriverWalletTopupOrder = async (req, res) => {
  const settings = await getWalletSettings();
  const minTopUp = Number(settings.minimum_amount_added_to_wallet || 0);
  const amount = Number(req.body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, "Invalid top-up amount");
  }

  if (amount < minTopUp) {
    throw new ApiError(400, `Minimum top-up amount is Rs ${minTopUp}`);
  }

  const { keyId, keySecret } = await resolveRazorpayCredentials();

  const amountPaise = Math.round(amount * 100);
  const driverId = String(req.auth?.sub || "");
  const compactDriverId = driverId.replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "drv";
  const receipt = `dwal_${compactDriverId}_${Date.now().toString(36)}`;

  let order;
  try {
    order = await fetchRazorpay({
      method: "POST",
      path: "/orders",
      body: {
        amount: amountPaise,
        currency: "INR",
        receipt,
        // driverId stays for the dashboard; the typed notes are what verify checks.
        notes: { driverId, ...buildTopupOrderNotes({ ownerType: "driver", ownerId: driverId }) },
      },
      keyId,
      keySecret,
    });
  } catch (error) {
    const isAuthError =
      error.statusCode === 401 ||
      error.statusCode === 403 ||
      String(error.message || "").toLowerCase().includes("authentication failed") ||
      String(error.message || "").toLowerCase().includes("api key");

    if (isAuthError) {
      console.warn(`[Razorpay] Order creation failed with auth error, falling back to mock order:`, error.message);
      order = {
        id: `mock_order_${amountPaise}_${Date.now().toString(36)}`,
        amount: amountPaise,
        currency: "INR",
      };
    } else {
      throw error;
    }
  }

  res.status(201).json({
    success: true,
    data: {
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency || "INR",
    },
  });
};

export const createDriverPhonePeWalletTopupOrder = async (req, res) => {
  const settings = await getWalletSettings();
  const minTopUp = Number(settings.minimum_amount_added_to_wallet || 0);
  const amount = Number(req.body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, "Invalid top-up amount");
  }

  if (amount < minTopUp) {
    throw new ApiError(400, `Minimum top-up amount is Rs ${minTopUp}`);
  }

  const { merchantId, saltKey, saltIndex, environment } = await resolvePhonePeCredentials();
  const driverId = String(req.auth?.sub || "");
  const compactDriverId = driverId.replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "drv";
  const merchantTransactionId = `DWAL${Date.now()}${compactDriverId}`.slice(0, 34);
  const frontendBaseUrl = getFrontendBaseUrl();
  const backendBaseUrl = `${req.protocol}://${req.get("host")}`;
  const redirectUrl = `${frontendBaseUrl}/taxi/driver/wallet?phonepe_txn=${encodeURIComponent(merchantTransactionId)}`;
  const callbackUrl = `${backendBaseUrl}/api/v1/common/payment-gateway/phonepe/callback`;
  const driver = driverId ? await Driver.findById(driverId).select("phone").lean() : null;
  // Recorded before PhonePe hears of it: verify credits only ids started here, by their owner.
  await recordPhonePeTopupIntent({
    merchantTransactionId,
    ownerType: "driver",
    ownerId: driverId,
    amountPaise: Math.round(amount * 100),
  });
  const payload = await phonePeRequest({
    method: "POST",
    path: "/pg/v1/pay",
    body: {
      merchantId,
      merchantTransactionId,
      merchantUserId: compactDriverId,
      amount: Math.round(amount * 100),
      redirectUrl,
      redirectMode: "GET",
      callbackUrl,
      mobileNumber: String(driver?.phone || "").replace(/\D/g, "").slice(-10) || undefined,
      paymentInstrument: {
        type: "PAY_PAGE",
      },
    },
    merchantId,
    saltKey,
    saltIndex,
    environment,
  });

  const checkoutUrl = payload?.data?.instrumentResponse?.redirectInfo?.url || "";
  if (!checkoutUrl) {
    throw new ApiError(502, "PhonePe payment URL was not returned");
  }

  res.status(201).json({
    success: true,
    data: {
      gateway: "phonepe",
      merchantTransactionId,
      amount: Math.round(amount * 100),
      currency: "INR",
      checkoutUrl,
      method: payload?.data?.instrumentResponse?.redirectInfo?.method || "GET",
    },
  });
};

export const verifyDriverWalletTopup = async (req, res) => {
  const orderId = String(req.body?.razorpay_order_id || "");
  const paymentId = String(req.body?.razorpay_payment_id || "");
  const signature = String(req.body?.razorpay_signature || "");

  if (!orderId || !paymentId || !signature) {
    throw new ApiError(400, "Payment verification fields are required");
  }

  /*
   * The mock pair was honoured in production here too, with the top-up amount
   * read out of the order id: any driver could mint wallet balance. NODE_ENV
   * alone decides.
   */
  const isMock =
    process.env.NODE_ENV !== "production" &&
    orderId.startsWith("mock_order_") &&
    signature === "mock_signature_bypass";

  const driverId = req.auth?.sub;

  let amountPaise;
  if (isMock) {
    const parts = orderId.split("_");
    amountPaise = Number(parts[2]);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      amountPaise = 50000;
    }
  } else {
    const { keyId, keySecret } = await resolveRazorpayCredentials();

    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    if (!safeSignatureEqual(expectedSignature, signature)) {
      throw new ApiError(400, "Invalid payment signature");
    }

    /*
     * A valid signature only proves the payment is real. It must also be a
     * top-up order created for THIS driver, and the amount is the gateway's
     * figure for the payment. See services/walletTopupGuard.service.js.
     */
    ({ amountPaise } = await resolveRazorpayTopup({
      orderId,
      paymentId,
      ownerType: "driver",
      ownerId: driverId,
      fetchRazorpay: (path) => fetchRazorpay({ method: "GET", path, keyId, keySecret }),
    }));
  }

  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    throw new ApiError(400, "Invalid order amount");
  }

  const amount = Math.round(amountPaise) / 100;

  // The payer here is the DRIVER topping up their own wallet, not a rider.
  await mirrorTaxiPayment({
    orderId, paymentId, amount, userId: driverId,
    purpose: 'driver_wallet_topup', mock: isMock,
  });

  // The receipt is the global once-only claim on this payment; the ledger-row
  // check inside still covers top-ups credited before receipts existed.
  const { result } = await creditTopupOnce({
    provider: isMock ? "razorpay_mock" : "razorpay",
    paymentId,
    orderId,
    ownerType: "driver",
    ownerId: driverId,
    amount,
    credit: async () => {
      const alreadyCredited = await WalletTransaction.findOne({
        driverId,
        "metadata.providerPaymentId": paymentId,
      })
        .select("_id")
        .lean();

      if (alreadyCredited) return null;

      return topUpDriverWallet({
        driverId,
        amount,
        metadata: {
          source: "razorpay",
          provider: "razorpay",
          providerOrderId: orderId,
          providerPaymentId: paymentId,
        },
      });
    },
  });

  if (!result) {
    const driver = await Driver.findById(driverId);
    res.json({
      success: true,
      data: {
        wallet: await serializeDriverWallet(driver),
      },
    });
    return;
  }

  const payload = {
    wallet: result.wallet,
    transaction: result.transaction,
  };

  emitToDriver(driverId, "driver:wallet:updated", payload);

  res.json({
    success: true,
    data: payload,
  });
};

export const verifyDriverPhonePeWalletTopup = async (req, res) => {
  const merchantTransactionId = toCleanString(
    req.params?.merchantTransactionId || req.query?.merchantTransactionId || req.query?.transactionId,
  );

  if (!merchantTransactionId) {
    throw new ApiError(400, "merchantTransactionId is required");
  }

  // Only a top-up this driver started here may be checked, let alone credited.
  await assertPhonePeTopupOwner({ merchantTransactionId, ownerType: "driver", ownerId: req.auth?.sub });

  const { merchantId, saltKey, saltIndex, environment } = await resolvePhonePeCredentials();
  const payload = await phonePeRequest({
    method: "GET",
    path: `/pg/v1/status/${encodeURIComponent(merchantId)}/${encodeURIComponent(merchantTransactionId)}`,
    merchantId,
    saltKey,
    saltIndex,
    environment,
  });

  const paymentState = String(payload?.data?.state || payload?.data?.paymentState || "").trim().toUpperCase();
  const paymentId = toCleanString(payload?.data?.transactionId || merchantTransactionId);
  const amount = Math.round(Number(payload?.data?.amount || 0)) / 100;
  const driverId = req.auth?.sub;

  if (paymentState === "COMPLETED") {
    if (!(amount > 0)) {
      throw new ApiError(400, "Invalid payment amount");
    }

    // Keyed on merchantTransactionId: ours, one per top-up, and what the intent names.
    const { result } = await creditTopupOnce({
      provider: "phonepe",
      paymentId: merchantTransactionId,
      orderId: paymentId,
      ownerType: "driver",
      ownerId: driverId,
      amount,
      credit: async () => {
        const alreadyCredited = await WalletTransaction.findOne({
          driverId,
          $or: [
            { "metadata.providerPaymentId": paymentId },
            { "metadata.providerOrderId": merchantTransactionId },
          ],
        })
          .select("_id")
          .lean();

        if (alreadyCredited) return null;

        return topUpDriverWallet({
          driverId,
          amount,
          metadata: {
            source: "phonepe",
            provider: "phonepe",
            providerOrderId: merchantTransactionId,
            providerPaymentId: paymentId,
          },
        });
      },
    });

    const driver = await Driver.findById(driverId);
    res.json({
      success: true,
      data: {
        status: "paid",
        gateway: "phonepe",
        merchantTransactionId,
        transactionId: paymentId,
        wallet: result?.wallet || await serializeDriverWallet(driver),
        transaction: result?.transaction || null,
      },
    });
    return;
  }

  if (paymentState === "PENDING") {
    res.json({
      success: true,
      data: {
        status: "pending",
        gateway: "phonepe",
        merchantTransactionId,
        transactionId: paymentId,
      },
      message: payload?.message || "PhonePe payment is still pending",
    });
    return;
  }

  res.json({
    success: true,
    data: {
      status: "failed",
      gateway: "phonepe",
      merchantTransactionId,
      transactionId: paymentId,
      code: payload?.code || payload?.data?.responseCode || "",
    },
    message: payload?.message || "PhonePe payment was not completed",
  });
};


export const getDriverPaymentQrStatus = async (req, res) => {
  const rideId = String(req.query.rideId || req.params.rideId || "").trim();

  if (!rideId) {
    throw new ApiError(400, "rideId is required");
  }

  const ride = await Ride.findOne({
    _id: rideId,
    driverId: req.auth.sub,
  }).select("_id driverPaymentCollection");

  if (!ride) {
    throw new ApiError(404, "Ride not found for this driver");
  }

  if (!ride.driverPaymentCollection?.providerId) {
    res.json({
      success: true,
      data: serializeDriverPaymentCollection(ride.driverPaymentCollection),
    });
    return;
  }

  const collection = await refreshDriverPaymentCollection(ride);

  res.json({
    success: true,
    data: collection,
  });
};

const getGenericVehicleType = (vehicle = {}) => {
  const value = String(vehicle.icon_types || vehicle.name || "").toLowerCase();

  if (value.includes("bike")) {
    return "bike";
  }

  if (value.includes("auto")) {
    return "auto";
  }

  return "car";
};

export const updateDriverVehicle = async (req, res) => {
  const {
    vehicleTypeId,
    vehicleNumber,
    vehicleColor,
    vehicleMake,
    vehicleModel,
    vehicleImage,
  } = req.body;

  let selectedVehicle = null;

  if (vehicleTypeId) {
    selectedVehicle = await Vehicle.findById(vehicleTypeId);

    if (
      !selectedVehicle ||
      selectedVehicle.active === false ||
      Number(selectedVehicle.status) === 0
    ) {
      throw new ApiError(404, "Active vehicle type not found");
    }
  }

  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const update = {};
  let vehicleChanged = false;

  if (selectedVehicle) {
    const nextVehicleType = getGenericVehicleType(selectedVehicle);
    const nextVehicleIconType = selectedVehicle.icon_types || nextVehicleType;

    update.vehicleTypeId = selectedVehicle._id;
    update.vehicleType = nextVehicleType;
    update.vehicleIconType = nextVehicleIconType;

    if (
      String(driver.vehicleTypeId || "") !== String(selectedVehicle._id || "") ||
      String(driver.vehicleType || "") !== String(nextVehicleType) ||
      String(driver.vehicleIconType || "") !== String(nextVehicleIconType)
    ) {
      vehicleChanged = true;
    }
  }

  if (vehicleNumber !== undefined) {
    const normalizedVehicleNumber = String(vehicleNumber || "")
      .trim()
      .toUpperCase();
    update.vehicleNumber = normalizedVehicleNumber;
    if (String(driver.vehicleNumber || "") !== normalizedVehicleNumber) {
      vehicleChanged = true;
    }
  }
  if (vehicleColor !== undefined) {
    const normalizedVehicleColor = String(vehicleColor || "").trim();
    update.vehicleColor = normalizedVehicleColor;
    if (String(driver.vehicleColor || "") !== normalizedVehicleColor) {
      vehicleChanged = true;
    }
  }
  if (vehicleMake !== undefined) {
    const normalizedVehicleMake = String(vehicleMake || "").trim();
    update.vehicleMake = normalizedVehicleMake;
    if (String(driver.vehicleMake || "") !== normalizedVehicleMake) {
      vehicleChanged = true;
    }
  }
  if (vehicleModel !== undefined) {
    const normalizedVehicleModel = String(vehicleModel || "").trim();
    update.vehicleModel = normalizedVehicleModel;
    if (String(driver.vehicleModel || "") !== normalizedVehicleModel) {
      vehicleChanged = true;
    }
  }
  if (vehicleImage !== undefined) {
    const normalizedVehicleImage = String(vehicleImage || "").trim();
    update.vehicleImage = normalizedVehicleImage;
    if (String(driver.vehicleImage || "") !== normalizedVehicleImage) {
      vehicleChanged = true;
    }
  }

  if (vehicleChanged) {
    update.approve = false;
    update.status = "pending";
    update.isOnline = false;
  }

  const updatedDriver = await Driver.findByIdAndUpdate(req.auth.sub, update, {
    returnDocument: 'after',
  });

  const vehicleIconUrl = await resolveVehicleMapIcon(updatedDriver.vehicleTypeId);

  res.json({
    success: true,
    message: vehicleChanged
      ? "Vehicle updated and sent to admin for approval"
      : "Vehicle updated successfully",
    data: {
      id: updatedDriver._id,
      name: updatedDriver.name,
      phone: updatedDriver.phone,
      vehicleType: updatedDriver.vehicleType,
      vehicleTypeId: updatedDriver.vehicleTypeId,
      vehicleIconType: updatedDriver.vehicleIconType,
      vehicleIconUrl,
      vehicleMake: updatedDriver.vehicleMake,
      vehicleModel: updatedDriver.vehicleModel,
      vehicleNumber: updatedDriver.vehicleNumber,
      vehicleColor: updatedDriver.vehicleColor,
      vehicleImage: updatedDriver.vehicleImage || "",
      registerFor: updatedDriver.registerFor,
      approve: updatedDriver.approve,
      status: updatedDriver.status,
      isOnline: updatedDriver.isOnline,
      isOnRide: updatedDriver.isOnRide,
      vehicleApprovalRequested: vehicleChanged,
    },
  });
};

export const getDriverApprovalStatus = async (req, res) => {
  const authorization = req.headers.authorization || "";
  const [, token] = authorization.split(" ");

  if (!token) {
    throw new ApiError(401, "Authorization token is required");
  }

  const payload = verifyAccessToken(token);

  if (String(payload.role || "").toLowerCase() !== "driver") {
    throw new ApiError(403, "Insufficient permissions for this resource");
  }

  const driver = await Driver.findById(payload.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  res.json({
    success: true,
    data: {
      id: driver._id,
      name: driver.name,
      phone: driver.phone,
      approve: driver.approve,
      status: driver.status,
      documents: driver.documents || {},
      onboarding: driver.onboarding || {},
      isOnline: driver.isOnline,
      isOnRide: driver.isOnRide,
    },
  });
};

export const getServiceLocations = async (_req, res) => {
  const results = await listDriverServiceLocations();

  res.json({
    success: true,
    data: { results },
  });
};

export const getDriverDocumentTemplates = async (_req, res) => {
  const results = await listDriverNeededDocuments({
    activeOnly: true,
    includeFields: true,
  });

  res.json({
    success: true,
    data: {
      results,
    },
  });
};

export const getDriverVehicleFieldTemplates = async (req, res) => {
  const results = await listDriverVehicleFieldTemplates({ activeOnly: true });
  const matchesAccountType = (accountType) => {
    const normalizedAccountType = String(accountType || "individual").trim().toLowerCase();

    if (normalizedAccountType === "both") {
      return true;
    }

    return normalizedAccountType === "individual";
  };

  res.json({
    success: true,
    data: {
      results: results.filter((item) => matchesAccountType(item.account_type)),
    },
  });
};

export const startDriverLoginOtpRequest = async (req, res) => {
  const result = await startDriverLoginOtp(req.body);
  res.status(201).json({ success: true, data: result });
};

export const verifyDriverLoginOtpRequest = async (req, res) => {
  const result = await verifyDriverLoginOtp(req.body);
  res.json({ success: true, data: result });
};

// POST /taxi/drivers/auth/refresh-token { refreshToken } -> a new pair (rotated).
export const refreshDriverTokenRequest = async (req, res) => {
  const result = await rotateTaxiRefreshToken(req.body?.refreshToken, "driver");
  res.json({ success: true, data: result });
};

// POST /taxi/drivers/auth/logout { refreshToken } -> revokes that session.
export const logoutDriverRequest = async (req, res) => {
  const result = await revokeTaxiRefreshToken(req.body?.refreshToken, "driver");
  res.json({ success: true, message: "Logged out", data: result });
};

export const startOnboarding = async (req, res) => {
  const result = await startDriverOnboarding(req.body);
  res.status(201).json({ success: true, data: result });
};

export const verifyOnboardingOtp = async (req, res) => {
  const result = await verifyDriverOtp(req.body);
  res.json({ success: true, data: result });
};

export const saveOnboardingPersonal = async (req, res) => {
  const result = await saveDriverPersonalDetails(req.body);
  res.json({ success: true, data: result });
};

export const saveOnboardingReferral = async (req, res) => {
  const result = await saveDriverReferral(req.body);
  res.json({ success: true, data: result });
};

export const saveOnboardingVehicle = async (req, res) => {
  const result = await saveDriverVehicle(req.body);
  res.json({ success: true, data: result });
};

export const saveOnboardingDocuments = async (req, res) => {
  const result = await saveDriverDocuments(req.body);
  res.json({ success: true, data: result });
};

export const completeOnboarding = async (req, res) => {
  const result = await completeDriverOnboarding(req.body);
  res.status(201).json({ success: true, data: result });
};

export const getOnboardingSession = async (req, res) => {
  const result = await getDriverOnboardingSession({
    registrationId: req.params.registrationId,
    phone: req.query.phone,
  });
  res.json({ success: true, data: result });
};

export const goOffline = async (req, res) => {
  const existingDriver = await Driver.findById(req.auth.sub);

  if (!existingDriver) {
    throw new ApiError(404, "Driver not found");
  }

  const finalizedTracking = mergeOnlineSessionIntoTracking(
    existingDriver.incentiveTracking || {},
    existingDriver.incentiveTracking?.currentOnlineStartedAt,
    new Date(),
  );
  const finalizedTodaySummary = buildDriverTodaySummaryFromDocument(existingDriver);

  const driver = await Driver.findByIdAndUpdate(
    req.auth.sub,
    {
      isOnline: false,
      socketId: null,
      incentiveTracking: {
        ...finalizedTracking,
        currentOnlineStartedAt: null,
        claimedRewards: pruneClaimedRewards(finalizedTracking?.claimedRewards),
      },
      todaySummary: finalizedTodaySummary,
    },
    { returnDocument: 'after' },
  );

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  res.json({
    success: true,
    data: driver,
  });
};

export const getDriverIncentives = async (req, res) => {
  const driver = await Driver.findById(req.auth.sub).lean();

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const liveDriver = {
    ...driver,
    incentiveTracking: {
      ...(driver.incentiveTracking || {}),
      ...mergeOnlineSessionIntoTracking(
        driver.incentiveTracking || {},
        driver.incentiveTracking?.currentOnlineStartedAt,
        new Date(),
      ),
    },
  };

  const settingsDoc = await AdminBusinessSetting.findOne({ scope: "default" }).lean();
  const driverSettings = await taxiReferralFor('driver', settingsDoc?.referral?.driver);
  const rides = await Ride.find({ driverId: driver._id }).select("status liveStatus createdAt updatedAt completedAt").lean();

  const snapshot = buildDriverIncentiveSnapshot({
    driver: liveDriver,
    settings: driverSettings,
    rides,
  });

  res.json({
    success: true,
    data: snapshot,
  });
};

export const claimDriverIncentiveReward = async (req, res) => {
  const { rewardType, rewardKey } = req.body || {};
  const normalizedRewardType = String(rewardType || "").trim().toLowerCase();
  const normalizedRewardKey = String(rewardKey || "").trim();

  if (!["milestone", "feature"].includes(normalizedRewardType) || !normalizedRewardKey) {
    throw new ApiError(400, "Valid reward type and reward key are required");
  }

  const driver = await Driver.findById(req.auth.sub);

  if (!driver) {
    throw new ApiError(404, "Driver not found");
  }

  const settingsDoc = await AdminBusinessSetting.findOne({ scope: "default" }).lean();
  const driverSettings = await taxiReferralFor('driver', settingsDoc?.referral?.driver);
  const rides = await Ride.find({ driverId: driver._id }).select("status liveStatus createdAt updatedAt completedAt").lean();
  const liveDriver = {
    ...driver.toObject(),
    incentiveTracking: {
      ...(driver.incentiveTracking || {}),
      ...mergeOnlineSessionIntoTracking(
        driver.incentiveTracking || {},
        driver.incentiveTracking?.currentOnlineStartedAt,
        new Date(),
      ),
    },
  };
  const snapshot = buildDriverIncentiveSnapshot({
    driver: liveDriver,
    settings: driverSettings,
    rides,
  });

  const targetReward =
    normalizedRewardType === "milestone"
      ? snapshot.milestones.find((item) => String(item.id) === normalizedRewardKey)
      : snapshot.features.find((item) => String(item.key) === normalizedRewardKey);

  if (!targetReward) {
    throw new ApiError(404, "Reward not found");
  }

  if (!targetReward.isEligible) {
    throw new ApiError(400, "Reward is not eligible yet");
  }

  if (targetReward.isClaimed) {
    throw new ApiError(400, "Reward already claimed");
  }

  const claimedRewards = pruneClaimedRewards([
    ...(Array.isArray(driver.incentiveTracking?.claimedRewards) ? driver.incentiveTracking.claimedRewards : []),
    {
      rewardType: normalizedRewardType,
      rewardKey: normalizedRewardType === "milestone" ? String(targetReward.id) : String(targetReward.key),
      periodKey: targetReward.periodKey,
      amount: Number(targetReward.payout_amount ?? targetReward.reward_amount ?? 0),
      claimedAt: new Date(),
      metadata: {
        label: targetReward.name || targetReward.label || "",
        targetValue: targetReward.targetValue ?? targetReward.progress?.targetWeeks ?? 0,
      },
    },
  ]);

  driver.incentiveTracking = {
    ...(liveDriver.incentiveTracking || {}),
    dailyActivity: pruneDailyActivity(liveDriver.incentiveTracking?.dailyActivity),
    claimedRewards,
  };
  await driver.save();

  const rewardAmount = Number(targetReward.payout_amount ?? targetReward.reward_amount ?? 0);

  const walletResult = await applyDriverWalletAdjustment({
    driverId: driver._id,
    amount: rewardAmount,
    type: "adjustment",
    description: `Incentive reward credited for ${targetReward.name || targetReward.label || "milestone"}`,
    metadata: {
      category: "driver_incentive",
      rewardType: normalizedRewardType,
      rewardKey: normalizedRewardType === "milestone" ? String(targetReward.id) : String(targetReward.key),
      periodKey: targetReward.periodKey,
    },
  });

  res.json({
    success: true,
    data: {
      wallet: walletResult.wallet,
      transaction: walletResult.transaction,
      claimedReward: {
        rewardType: normalizedRewardType,
        rewardKey: normalizedRewardKey,
        amount: rewardAmount,
        periodKey: targetReward.periodKey,
      },
    },
  });
};
