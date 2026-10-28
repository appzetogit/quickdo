import crypto from "crypto";
import ms from "ms";
import { FoodUser } from "../users/user.model.js";
import { FoodAdmin } from "../admin/admin.model.js";
import { AdminResetOtp } from "../admin/adminResetOtp.model.js";
import { FoodRestaurant } from "../../modules/food/restaurant/models/restaurant.model.js";
import { FoodDeliveryPartner } from "../../modules/food/delivery/models/deliveryPartner.model.js";
import { FoodOrder } from "../../modules/food/orders/models/order.model.js";
import { FoodReferralSettings } from "../../modules/food/admin/models/referralSettings.model.js";
import { FoodReferralLog } from "../../modules/food/admin/models/referralLog.model.js";
/*
 * Master's OTP service, not this fork's copy.
 *
 * The copy was a 160-line snapshot of a file that is now 311 lines, and every one
 * of the differences was a fix quick-commerce never received:
 *
 *   - the rate limiter. The copy carried the per-scope counter master explicitly
 *     replaced, which let one phone pull a full quota from EACH of user,
 *     restaurant and delivery, and did nothing about the same number also hitting
 *     taxi. Quick-commerce auth has been the weakest OTP surface on the platform.
 *   - phone normalisation, so '+919876543210' and '9876543210' are one person
 *     rather than two OTP rows that cannot verify each other.
 *   - the DLT-registered SMS template. SMS India Hub rejects anything that is not
 *     character-for-character the registered text, so the copy's hard-coded
 *     wording could fail to send at all.
 *
 * The `qc:` scopes matter. Master scopes by role -- 'user', 'restaurant',
 * 'delivery' -- and OTPs now share one collection, so reusing those names would
 * let a customer who exists in both apps overwrite their own food OTP by
 * requesting a grocery one.
 */
import { createOrUpdateOtp, verifyOtp } from "../../../../core/otp/otp.service.js";
import { OTP_SERVICES } from "../../../../core/otp/otpRateLimit.service.js";
import { signAccessToken, signRefreshToken } from "./token.util.js";
// Master's model bound to this vertical's own collection. Same schema, same
// qc_refresh_tokens rows -- so no session is invalidated by this change.
import { QCRefreshToken as FoodRefreshToken } from "../../../../core/refreshTokens/refreshToken.model.js";
import { ValidationError, AuthError } from "./errors.js";
import { config } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { sendAdminResetOtpEmail } from "../../utils/email.js";
import mongoose from "mongoose";
import { creditReferralReward } from "../../modules/food/user/services/userWallet.service.js";
import { ADMIN_FULL_PERMISSIONS, sanitizeAdminPermissions } from '../../constants/permissions.js';
import { isMobilePlatform } from "../../utils/platform.js";
import {
  detachFirebaseDeviceTokenEverywhere,
  replaceFirebaseDeviceToken,
  upsertFirebaseDeviceToken,
} from "../notifications/firebase.service.js";

import { referralSettingsFor } from '../../../../core/referral/referralSettings.service.js';
const ROLES = {
  USER: "USER",
  RESTAURANT: "RESTAURANT",
  DELIVERY_PARTNER: "DELIVERY_PARTNER",
  ADMIN: "ADMIN",
};

/**
 * Roles whose sessions are single-device, and whose push tokens must therefore be
 * single-device too. Mirrors SESSION_SCOPED_MODELS in auth.middleware — admins are
 * excluded there because the panel is used across several tabs and machines, and
 * evicting those would be a regression rather than a safeguard.
 */
const SINGLE_DEVICE_ROLES = new Set([
  ROLES.USER,
  ROLES.RESTAURANT,
  ROLES.DELIVERY_PARTNER,
]);

const saveLoginFcmToken = async ({ ownerType, ownerId, fcmToken, platform, ownerDoc }) => {
  if (!fcmToken || !ownerId) return;
  try {
    // Logging in already invalidated every earlier session for this account. Its
    // push tokens have to go with it, or the signed-out device keeps receiving
    // pushes it can no longer act on.
    const save = SINGLE_DEVICE_ROLES.has(ownerType)
      ? replaceFirebaseDeviceToken
      : upsertFirebaseDeviceToken;

    await save({
      ownerType,
      ownerId: String(ownerId),
      token: fcmToken,
      platform,
    });
    // Keep in-memory doc in sync so a later ownerDoc.save() cannot clobber tokens.
    if (ownerDoc) {
      const field = isMobilePlatform(platform) ? "fcmTokenMobile" : "fcmTokens";
      const otherField = field === "fcmTokenMobile" ? "fcmTokens" : "fcmTokenMobile";
      const model =
        ownerType === ROLES.USER
          ? FoodUser
          : ownerType === ROLES.RESTAURANT
            ? FoodRestaurant
            : ownerType === ROLES.DELIVERY_PARTNER
              ? FoodDeliveryPartner
              : null;
      if (model) {
        const fresh = await model.findById(ownerId).select("fcmTokens fcmTokenMobile").lean();
        if (fresh) {
          ownerDoc.fcmTokens = fresh.fcmTokens || [];
          ownerDoc.fcmTokenMobile = fresh.fcmTokenMobile || [];
          if (typeof ownerDoc.unmarkModified === "function") {
            ownerDoc.unmarkModified(field);
            ownerDoc.unmarkModified(otherField);
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err, ownerType, ownerId: String(ownerId) }, "Failed to save FCM token during login");
  }
};

/**
 * Invalidates every existing session for an account and returns the new version.
 *
 * Called on each successful login. The value goes into the JWT, and authMiddleware
 * rejects any token carrying an older one — so signing in on a new phone logs the
 * old one out on its very next request, instead of leaving one account live on two
 * devices.
 *
 * $inc is atomic, so two simultaneous logins get distinct versions and the later
 * one wins rather than both sharing a value.
 *
 * Deliberately NOT applied to admins: the panel is routinely used across several
 * browser tabs and machines, and evicting those would be a regression, not a
 * safeguard.
 */
const bumpTokenVersion = async (model, id) => {
  const updated = await model
    .findByIdAndUpdate(id, { $inc: { tokenVersion: 1 } }, { new: true })
    .select('tokenVersion')
    .lean();
  return Number(updated?.tokenVersion) || 0;
};

export const requestUserOtp = async (phone) => {
  if (!phone) {
    throw new ValidationError("Phone is required");
  }

  const otp = await createOrUpdateOtp(phone, "qc:user", { service: OTP_SERVICES.QUICK_COMMERCE });
  // TODO: integrate SMS provider here
  const shouldExposeOtp =
    config.nodeEnv !== "production";
  return shouldExposeOtp ? { otp } : {};
};

export const verifyUserOtpAndLogin = async (
  phone,
  otp,
  ref,
  fcmToken,
  platform,
  name,
) => {
  console.log(
    `[FCM-LOGIN] User login platform received: rawPlatform=${String(platform ?? "") || "<empty>"}, hasToken=${Boolean(fcmToken)}`,
  );
  const result = await verifyOtp(phone, otp, "qc:user");

  if (!result.valid) {
    throw new AuthError(result.reason || "OTP verification failed");
  }

  let userDoc = await FoodUser.findOne({ phone });
  
  // Ensure user exists and mark as verified on successful OTP.
  // Check if user is new or hasn't provided a name yet
  const needsNamePrompt = !userDoc || !userDoc.name || String(userDoc.name).trim() === "" || String(userDoc.name).toLowerCase() === "null";
  const isNewUser = needsNamePrompt;
  const trimmedName = typeof name === "string" ? name.trim() : "";

  if (!userDoc) {
    userDoc = await FoodUser.create({
      phone,
      isVerified: true,
      ...(trimmedName ? { name: trimmedName } : {}),
    });

    // Link to the customer's one platform identity (identity merge, phase 1).
    // Never blocks the login; an unlinked document is repaired by the backfill.
    import('../../../../core/identity/identityLink.service.js')
      .then(({ linkSatellite }) => linkSatellite(FoodUser, userDoc._id, { phone, name: trimmedName }))
      .catch(() => {});
  } else {
    let needsSave = false;
    if (!userDoc.isVerified) {
      userDoc.isVerified = true;
      needsSave = true;
    }
    if (trimmedName && !userDoc.name) {
      userDoc.name = trimmedName;
      needsSave = true;
    }
    if (needsSave) await userDoc.save();
  }

  // Block login for deactivated users
  if (userDoc.isActive === false) {
    throw new AuthError(
      "Your account has been deactivated. Please contact support.",
    );
  }

  // Update FCM token if provided
  if (fcmToken) {
    await saveLoginFcmToken({
      ownerType: ROLES.USER,
      ownerId: userDoc._id,
      fcmToken,
      platform,
      ownerDoc: userDoc,
    });
  }

  // Ensure referralCode exists (used for share links on older accounts).
  if (!userDoc.referralCode) {
    userDoc.referralCode = String(userDoc._id);
    await userDoc.save();
  }

  // Referral crediting: only for brand new accounts.
  const refRaw = typeof ref === "string" ? String(ref).trim() : "";
  if (isNewUser && refRaw) {
    try {
      if (mongoose.Types.ObjectId.isValid(refRaw)) {
        const referrerId = new mongoose.Types.ObjectId(refRaw);
        if (String(referrerId) !== String(userDoc._id)) {
          const [referrer, settingsDoc] = await Promise.all([
            FoodUser.findById(referrerId).select("_id referralCount").lean(),
            referralSettingsFor('quickCommerce', FoodReferralSettings),
          ]);

          if (referrer && settingsDoc) {
            const reward = Math.max(
              0,
              Number(settingsDoc.referralRewardUser) || 0,
            );
            const limit = Math.max(
              0,
              Number(settingsDoc.referralLimitUser) || 0,
            );

            if (
              reward > 0 &&
              limit > 0 &&
              Number(referrer.referralCount || 0) < limit
            ) {
              userDoc.referredBy = referrerId;
              await userDoc.save();

              const log = await FoodReferralLog.create({
                referrerId,
                refereeId: userDoc._id,
                role: "USER",
                rewardAmount: reward,
                status: "credited",
              });

              await Promise.all([
                FoodUser.updateOne(
                  { _id: referrerId },
                  { $inc: { referralCount: 1 } },
                ),
                creditReferralReward(referrerId, reward, {
                  role: "USER",
                  refereeId: String(userDoc._id),
                  referralLogId: String(log._id),
                }),
              ]);
            } else {
              await FoodReferralLog.create({
                referrerId,
                refereeId: userDoc._id,
                role: "USER",
                rewardAmount: reward,
                status: "rejected",
                reason:
                  reward <= 0
                    ? "reward_disabled"
                    : limit <= 0
                      ? "limit_disabled"
                      : "limit_reached",
              });
            }
          }
        }
      }
    } catch (e) {
      // Never fail login due to referral errors.
      logger?.warn?.({ err: e }, "Referral crediting failed (user)");
    }
  }

  const user = userDoc.toObject();
  const payload = {
    userId: user._id.toString(),
    role: user.role || "USER",
    tokenVersion: await bumpTokenVersion(FoodUser, user._id),
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  await FoodRefreshToken.create({
    userId: user._id,
    token: refreshToken,
    expiresAt,
  });

  return { accessToken, refreshToken, user, isNewUser };
};

export const adminLogin = async (email, password) => {
  if (!email || !password) {
    throw new ValidationError("Email and password are required");
  }

  const admin = await FoodAdmin.findOne({ email });
  if (!admin) {
    throw new AuthError("Invalid credentials");
  }

  if (admin.isDeleted || admin.isActive === false) {
    throw new AuthError("Admin account is inactive");
  }

  const isMatch = await admin.comparePassword(password);
  if (!isMatch) {
    throw new AuthError("Invalid credentials");
  }

  const effectivePermissions = admin.adminType === "super_admin"
    ? ADMIN_FULL_PERMISSIONS
    : sanitizeAdminPermissions(admin.permissions || {});

  const payload = {
    userId: admin._id.toString(),
    role: admin.role,
    adminType: admin.adminType || "super_admin",
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  await FoodRefreshToken.create({
    userId: admin._id,
    token: refreshToken,
    expiresAt,
  });

  const userObj = admin.toObject();
  delete userObj.password;
  userObj.effectivePermissions = effectivePermissions;
  return { accessToken, refreshToken, user: userObj };
};

export const requestRestaurantOtp = async (phone) => {
  if (!phone) {
    throw new ValidationError("Phone is required");
  }
  const otp = await createOrUpdateOtp(phone, "qc:restaurant", { service: OTP_SERVICES.QUICK_COMMERCE });
  // Only expose OTP in response when in default/dev mode — never in production with real SMS
  const shouldExposeOtp =
    config.nodeEnv !== "production";
  return shouldExposeOtp ? { otp } : {};
};


/**
 * The seller holding this phone number, or null.
 *
 * Sellers store their number with or without a country code or formatting, so
 * this matches the exact value, its digits, the last 10 digits, or a number
 * ending in them -- otherwise a seller who exists reads as needing to register.
 */
export const findRestaurantByPhone = async (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  const last10 = digits.slice(-10);
  const phoneCandidates = [phone, digits, last10].filter(Boolean);
  const phoneOrFields = (field) => [
    { [field]: { $in: phoneCandidates } },
    ...(last10 ? [{ [field]: { $regex: new RegExp(last10 + "$") } }] : []),
  ];
  return FoodRestaurant.findOne({
    $or: [
      ...phoneOrFields("ownerPhone"),
      ...phoneOrFields("primaryContactNumber"),
    ],
  });
};

/**
 * Sign a seller in: access and refresh tokens, and the refresh token recorded.
 * The caller decides whether the seller may sign in; this only issues.
 */
export const issueRestaurantSession = async (restaurant) => {
  const payload = {
    userId: restaurant._id.toString(),
    role: ROLES.RESTAURANT,
    tokenVersion: await bumpTokenVersion(FoodRestaurant, restaurant._id),
  };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  await FoodRefreshToken.create({
    userId: restaurant._id,
    token: refreshToken,
    expiresAt,
  });

  return {
    accessToken,
    refreshToken,
    user: restaurant,
    needsRegistration: false,
  };
};

export const verifyRestaurantOtpAndLogin = async (phone, otp, fcmToken, platform) => {
  console.log(
    `[FCM-LOGIN] Restaurant login platform received: rawPlatform=${String(platform ?? "") || "<empty>"}, hasToken=${Boolean(fcmToken)}`,
  );
  const result = await verifyOtp(phone, otp, "qc:restaurant");
  if (!result.valid) {
    throw new AuthError(result.reason || "OTP verification failed");
  }

  console.log(`[AUTH] Verifying OTP for restaurant phone: ${phone}`);
  const restaurant = await findRestaurantByPhone(phone);

  console.log(`[AUTH] Restaurant lookup result:`, restaurant ? { id: restaurant._id, status: restaurant.status, name: restaurant.restaurantName } : "NOT FOUND");

  if (!restaurant) {
    console.log(`[AUTH] No restaurant found. Returning needsRegistration: true`);
    // Phone has been successfully verified, but no restaurant exists yet.
    // Frontend will use this to redirect into registration/onboarding.
    return {
      needsRegistration: true,
      phone,
    };
  }

  // Update FCM token if provided
  if (fcmToken) {
    await saveLoginFcmToken({
      ownerType: ROLES.RESTAURANT,
      ownerId: restaurant._id,
      fcmToken,
      platform,
      ownerDoc: restaurant,
    });
  }

  // Allow login for previously-operational restaurants even if they are temporarily
  // moved to "pending" due to profile-change review requests.
  if (restaurant.status && restaurant.status !== "approved") {
    if (restaurant.status === "pending") {
      const hasHistoricalApproval = Boolean(restaurant.approvedAt);
      const hasOperationalHistory = await FoodOrder.exists({
        restaurantId: restaurant._id,
      });

      // New onboarding requests (no approval + no orders) must stay blocked.
      if (!hasHistoricalApproval && !hasOperationalHistory) {
        throw new AuthError("Your restaurant registration is pending approval.");
      }
    } else {
      throw new AuthError(
        "Your restaurant registration has been rejected. Please contact support.",
      );
    }
  }

  // Postpaid subscription model: no onboarding payment or subscription purchase
  // is required to use the platform — dues are billed at each month end.

  return issueRestaurantSession(restaurant);
};

export const requestDeliveryOtp = async (phone) => {
  if (!phone) {
    throw new ValidationError("Phone is required");
  }
  const otp = await createOrUpdateOtp(phone, "qc:delivery", { service: OTP_SERVICES.QUICK_COMMERCE });
  // Only expose OTP in response when in default/dev mode — never in production with real SMS
  const shouldExposeOtp =
    config.nodeEnv !== "production";
  return shouldExposeOtp ? { otp } : {};
};

const normalizePhoneForDelivery = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.slice(-10) || null;
};

export const verifyDeliveryOtpAndLogin = async (phone, otp, fcmToken, platform) => {
  console.log(
    `[FCM-LOGIN] Delivery login platform received: rawPlatform=${String(platform ?? "") || "<empty>"}, hasToken=${Boolean(fcmToken)}`,
  );
  const result = await verifyOtp(phone, otp, "qc:delivery");
  if (!result.valid) {
    throw new AuthError(result.reason || "OTP verification failed");
  }

  const normalized = normalizePhoneForDelivery(phone);
  if (!normalized) {
    return { needsRegistration: true, phone };
  }

  const deliveryPartner = await FoodDeliveryPartner.findOne({
    $or: [
      { phone: normalized },
      { phone: { $regex: new RegExp(normalized + "$") } },
    ],
  });

  if (!deliveryPartner) {
    return { needsRegistration: true, phone };
  }

  // Update FCM token if provided - CRITICAL: do this BEFORE returning pendingApproval
  // so we can notify them when approved.
  if (fcmToken) {
    await saveLoginFcmToken({
      ownerType: ROLES.DELIVERY_PARTNER,
      ownerId: deliveryPartner._id,
      fcmToken,
      platform,
      ownerDoc: deliveryPartner,
    });
  }

  if (deliveryPartner.status && deliveryPartner.status !== "approved") {
    const isRejected = deliveryPartner.status === "rejected";
    return {
      pendingApproval: true,
      isRejected,
      rejectionReason: isRejected ? deliveryPartner.rejectionReason : null,
      message:
        isRejected
          ? (deliveryPartner.rejectionReason 
              ? `Your account was rejected: ${deliveryPartner.rejectionReason}`
              : "Your delivery account was not approved. Please contact support.")
          : "Your account is pending admin verification. You will be notified once approved.",
    };
  }

  const payload = {
    userId: deliveryPartner._id.toString(),
    role: ROLES.DELIVERY_PARTNER,
    tokenVersion: await bumpTokenVersion(FoodDeliveryPartner, deliveryPartner._id),
  };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  await FoodRefreshToken.create({
    userId: deliveryPartner._id,
    token: refreshToken,
    expiresAt,
  });

  return {
    accessToken,
    refreshToken,
    user: deliveryPartner,
    needsRegistration: false,
  };
};

export const logout = async (refreshToken, fcmToken, platform) => {
  // No refresh token is a valid way to log out -- see logout.dto.js. Fall
  // through so the FCM token is still detached, then report nothing was
  // invalidated.

  // 1. Remove specific FCM token from ALL collections if provided
  if (fcmToken) {
    console.log(`[FCM-Logout] Starting logout-driven token removal: platform=${platform}, tokenPreview=${fcmToken?.slice(0, 10)}...`);
    try {
      await detachFirebaseDeviceTokenEverywhere(fcmToken);
      console.log("[FCM-Logout] Token removed from all collections successfully");
    } catch (err) {
      logger.warn({ err }, "Failed to remove FCM token from all collections during logout");
    }
  }

  // 2. Invalidate the refresh token (standard logout procedure)
  // Guarded: deleteOne({ token: undefined }) matches any document with no
  // token field rather than matching nothing, so it could delete an unrelated
  // row. Only query when there is actually a token to invalidate.
  if (!refreshToken) {
    return { invalidated: false };
  }

  const deleted = await FoodRefreshToken.deleteOne({ token: refreshToken });
  return { invalidated: deleted.deletedCount > 0 };
};

export const getProfile = async (userId, role) => {
  if (!userId || !role) {
    throw new AuthError("Invalid token payload");
  }
  let profile = null;
  const id = userId;

  switch (role) {
    case ROLES.USER:
      profile = await FoodUser.findById(id).lean();
      break;
    case ROLES.ADMIN:
      profile = await FoodAdmin.findById(id).select("-password").lean();
      if (profile) {
        profile.effectivePermissions = profile.adminType === "super_admin"
          ? ADMIN_FULL_PERMISSIONS
          : sanitizeAdminPermissions(profile.permissions || {});
      }
      break;
    case ROLES.RESTAURANT:
      {
        const doc = await FoodRestaurant.findById(id).lean();
        if (!doc) break;

        const location =
          doc.addressLine1 ||
          doc.addressLine2 ||
          doc.area ||
          doc.city ||
          doc.state ||
          doc.pincode ||
          doc.landmark
            ? {
                addressLine1: doc.addressLine1 || "",
                addressLine2: doc.addressLine2 || "",
                area: doc.area || "",
                city: doc.city || "",
                state: doc.state || "",
                pincode: doc.pincode || "",
                landmark: doc.landmark || "",
              }
            : null;

        const menuImages = Array.isArray(doc.menuImages)
          ? doc.menuImages
              .map((m) => (m && (typeof m === "string" ? m : m.url)) || null)
              .filter(Boolean)
              .map((url) => ({ url, publicId: null }))
          : [];

        profile = {
          id: doc._id,
          _id: doc._id,
          // Frontend expects "name" and "location" for restaurant screens.
          name: doc.restaurantName || "",
          restaurantName: doc.restaurantName || "",
          cuisines: Array.isArray(doc.cuisines) ? doc.cuisines : [],
          location,
          ownerName: doc.ownerName || "",
          ownerEmail: doc.ownerEmail || "",
          ownerPhone: doc.ownerPhone || "",
          primaryContactNumber: doc.primaryContactNumber || "",
          profileImage: doc.profileImage ? { url: doc.profileImage } : null,
          menuImages,
          coverImages: [],
          openingTime: doc.openingTime || null,
          closingTime: doc.closingTime || null,
          openDays: Array.isArray(doc.openDays) ? doc.openDays : [],
          status: doc.status || null,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          // These fields may not exist yet in DB, keep stable defaults for UI.
          rating: typeof doc.rating === "number" ? doc.rating : 0,
          totalRatings:
            typeof doc.totalRatings === "number" ? doc.totalRatings : 0,
        };
      }
      break;
    case ROLES.DELIVERY_PARTNER: {
      const partner = await FoodDeliveryPartner.findById(id).lean();
      if (!partner) break;
      const deliveryId = partner._id
        ? `DP-${partner._id.toString().slice(-8).toUpperCase()}`
        : null;
      profile = {
        ...partner,
        email: partner.email || null,
        deliveryId,
        status: partner.status === "rejected" ? "blocked" : partner.status,
        profileImage: partner.profilePhoto
          ? { url: partner.profilePhoto }
          : null,
        documents: {
          aadhar:
            partner.aadharPhoto || partner.aadharNumber
              ? {
                  number: partner.aadharNumber || null,
                  document: partner.aadharPhoto || null,
                }
              : null,
          pan:
            partner.panPhoto || partner.panNumber
              ? {
                  number: partner.panNumber || null,
                  document: partner.panPhoto || null,
                }
              : null,
          drivingLicense: partner.drivingLicensePhoto || partner.drivingLicenseNumber
            ? {
                number: partner.drivingLicenseNumber || null,
                document: partner.drivingLicensePhoto || null,
              }
            : null,
          bankDetails:
            partner.bankAccountHolderName ||
            partner.bankAccountNumber ||
            partner.bankIfscCode ||
            partner.bankName ||
            partner.upiId ||
            partner.upiQrCode
              ? {
                  accountHolderName: partner.bankAccountHolderName || null,
                  accountNumber: partner.bankAccountNumber || null,
                  ifscCode: partner.bankIfscCode || null,
                  bankName: partner.bankName || null,
                  upiId: partner.upiId || null,
                  upiQrCode: partner.upiQrCode || null,
                }
              : null,
        },
        location:
          partner.address || partner.city || partner.state
            ? {
                addressLine1: partner.address,
                city: partner.city,
                state: partner.state,
              }
            : null,
        vehicle:
          partner.vehicleType || partner.vehicleName || partner.vehicleNumber
            ? {
                type: partner.vehicleType,
                brand: partner.vehicleName,
                model: partner.vehicleName,
                number: partner.vehicleNumber,
              }
            : null,
      };
      break;
    }
    default:
      throw new AuthError("Unknown role");
  }

  if (!profile) {
    throw new AuthError("Profile not found");
  }
  return { user: profile };
};

const ADMIN_SERVICES_ALLOWED = ["food", "quickCommerce", "taxi"];

/** Update admin profile (name, email, phone, profileImage). Only for ADMIN role. */
export const updateAdminProfile = async (userId, body) => {
  if (!userId) {
    throw new AuthError("Invalid token payload");
  }
  const admin = await FoodAdmin.findById(userId);
  if (!admin) {
    throw new AuthError("Profile not found");
  }
  if (body.name !== undefined) admin.name = String(body.name || "").trim();
  if (body.email !== undefined) {
    const normalizedEmail = String(body.email || "")
      .trim()
      .toLowerCase();
    if (!normalizedEmail) {
      throw new ValidationError("Email is required");
    }

    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(?:\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,10}$/;
    if (!emailRegex.test(normalizedEmail) || normalizedEmail.includes("..")) {
      throw new ValidationError("Invalid email format");
    }

    const domain = normalizedEmail.split("@")[1];
    const segments = domain ? domain.split(".") : [];
    if (segments.length >= 2 && segments[segments.length - 1] === segments[segments.length - 2]) {
      throw new ValidationError("Invalid email domain (repeated segments)");
    }

    if (normalizedEmail !== admin.email) {
      const duplicateAdmin = await FoodAdmin.findOne({
        _id: { $ne: admin._id },
        email: normalizedEmail,
      })
        .select("_id")
        .lean();
      if (duplicateAdmin) {
        throw new ValidationError("Email is already in use");
      }
    }
    admin.email = normalizedEmail;
  }
  if (body.phone !== undefined) admin.phone = String(body.phone || "").trim();
  if (body.profileImage !== undefined)
    admin.profileImage = String(body.profileImage || "").trim();
  // Normalize servicesAccess so legacy values (e.g. 'zomato') don't fail schema validation on save
  if (Array.isArray(admin.servicesAccess)) {
    const valid = admin.servicesAccess.filter((s) =>
      ADMIN_SERVICES_ALLOWED.includes(s),
    );
    admin.servicesAccess = valid.length ? valid : ["food"];
  } else {
    admin.servicesAccess = ["food"];
  }
  await admin.save();
  const profile = admin.toObject();
  delete profile.password;
  return { user: profile };
};

/** Change admin password. Only for ADMIN role. */
export const changeAdminPassword = async (
  userId,
  currentPassword,
  newPassword,
) => {
  if (!userId) {
    throw new AuthError("Invalid token payload");
  }
  const admin = await FoodAdmin.findById(userId);
  if (!admin) {
    throw new AuthError("Profile not found");
  }
  const isMatch = await admin.comparePassword(currentPassword);
  if (!isMatch) {
    throw new AuthError("Current password is incorrect");
  }
  if (!newPassword || String(newPassword).length < 6) {
    throw new ValidationError("New password must be at least 6 characters");
  }
  admin.password = newPassword;
  await admin.save();

  try {
    const { notifyAdminsSafely } = await import("../../core/notifications/firebase.service.js");
    void notifyAdminsSafely({
      title: "Security Alert: Password Changed 🔐",
      body: `The password for admin account ${admin.email} has been changed. If this was not you, please contact support immediately.`,
      data: {
        type: "security_alert",
        subType: "password_change",
        email: admin.email
      }
    });
  } catch (e) {
    console.error("Failed to notify admins of password change:", e);
  }

  return { success: true };
};

/** Admin forgot password: request OTP. Only accepts email that is registered as admin. */
export const requestAdminForgotPasswordOtp = async (email) => {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalizedEmail) {
    throw new ValidationError("Email is required");
  }

  const admin = await FoodAdmin.findOne({ email: normalizedEmail });
  if (!admin) {
    throw new AuthError("This email is not registered as an admin account.");
  }

  /*
   * Never a fixed code in production. This reused USE_DEFAULT_OTP -- the switch for
   * customer SMS delivery -- and with it set in production every admin reset code
   * was "123456": anyone who knew or guessed an admin's email could request a reset,
   * submit 123456 with a new password, and sign in as that admin. This code is sent
   * by EMAIL, so the SMS reason for the static OTP never applied to it.
   */
  const staticAdminOtp = config.useDefaultOtp && config.nodeEnv !== "production";
  const otp = staticAdminOtp
    ? "123456"
    : String(crypto.randomInt(100000, 999999));
  const ttlMs = (config.otpExpiryMinutes || 10) * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  await AdminResetOtp.findOneAndUpdate(
    { email: normalizedEmail },
    { otp, expiresAt, attempts: 0 },
    { upsert: true, new: true },
  );

  // A reset code in the log is a credential; development only.
  if (staticAdminOtp) {
    logger.info(`Admin reset OTP for ${normalizedEmail}: ${otp}`);
  }

  const sent = await sendAdminResetOtpEmail(normalizedEmail, otp);
  if (!sent && !staticAdminOtp) {
    logger.warn(
      `Admin OTP not sent by email to ${normalizedEmail}; check SMTP config.`,
    );
  }

  return {
    success: true,
    message: "If this email is registered, you will receive an OTP shortly.",
  };
};

/** Admin forgot password: verify OTP and set new password in one call. */
export const resetAdminPasswordWithOtp = async (email, otp, newPassword) => {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  const otpStr = String(otp || "").replace(/\D/g, "");
  if (!normalizedEmail || !otpStr) {
    throw new ValidationError("Email and OTP are required");
  }
  if (!newPassword || String(newPassword).length < 6) {
    throw new ValidationError("New password must be at least 6 characters");
  }

  const record = await AdminResetOtp.findOne({ email: normalizedEmail });
  if (!record) {
    throw new AuthError("OTP not found or expired. Please request a new code.");
  }
  if (record.expiresAt < new Date()) {
    await record.deleteOne();
    throw new AuthError("OTP has expired. Please request a new code.");
  }
  if (record.attempts >= (config.otpMaxAttempts || 5)) {
    throw new AuthError("Too many attempts. Please request a new code.");
  }
  record.attempts += 1;
  if (record.otp !== otpStr) {
    await record.save();
    throw new AuthError("Invalid OTP.");
  }

  const admin = await FoodAdmin.findOne({ email: normalizedEmail });
  if (!admin) {
    await record.deleteOne();
    throw new AuthError("Account not found.");
  }

  admin.password = newPassword;
  await admin.save();
  await record.deleteOne();

  try {
    const { notifyAdminsSafely } = await import("../../core/notifications/firebase.service.js");
    void notifyAdminsSafely({
      title: "Security Alert: Password Reset Successful 🔐",
      body: `The password for admin account ${admin.email} has been reset via OTP.`,
      data: {
        type: "security_alert",
        subType: "password_reset",
        email: admin.email
      }
    });
  } catch (e) {
    console.error("Failed to notify admins of password reset:", e);
  }

  return { success: true, message: "Password reset successfully." };
};

export const refreshAccessToken = async (token) => {
  if (!token) {
    throw new ValidationError("Refresh token is required");
  }

  const stored = await FoodRefreshToken.findOne({ token }).lean();
  if (!stored) {
    throw new AuthError("Invalid refresh token");
  }

  const jwt = await import("jsonwebtoken");
  let payload;
  try {
    payload = jwt.default.verify(token, config.jwtRefreshSecret);
  } catch {
    throw new AuthError("Invalid refresh token");
  }

  // If deactivated user, do not issue fresh access tokens (forces logout on client)
  if (payload?.role === "USER") {
    const u = await FoodUser.findById(payload.userId).select("isActive").lean();
    if (!u || u.isActive === false) {
      throw new AuthError("User account is deactivated");
    }
  }

  // Carry the session version forward, and refuse a refresh from a device that has
  // already been replaced. Without this, an evicted device could mint itself a
  // brand-new access token from its still-valid refresh token and stay signed in.
  const sessionModel = {
    USER: FoodUser,
    RESTAURANT: FoodRestaurant,
    DELIVERY_PARTNER: FoodDeliveryPartner,
  }[payload?.role];

  let tokenVersion = payload?.tokenVersion;
  if (sessionModel) {
    const owner = await sessionModel
      .findById(payload.userId)
      .select('tokenVersion')
      .lean();
    const stored = Number(owner?.tokenVersion) || 0;
    if (tokenVersion !== undefined && Number(tokenVersion) !== stored) {
      throw new AuthError(
        'You have been signed out because this account was used on another device',
      );
    }
    tokenVersion = stored;
  }

  const newAccessToken = signAccessToken({
    userId: payload.userId,
    role: payload.role,
    ...(tokenVersion !== undefined ? { tokenVersion } : {}),
    ...(payload.adminType ? { adminType: payload.adminType } : {}),
  });

  return { accessToken: newAccessToken, refreshToken: token };
};
