import crypto from "crypto";
import ms from "ms";
import { FoodUser } from "../users/user.model.js";
import { FoodAdmin } from "../admin/admin.model.js";
import { AdminResetOtp } from "../admin/adminResetOtp.model.js";
import { FoodRestaurant } from "../../modules/food/restaurant/models/restaurant.model.js";
import { FoodDeliveryPartner } from "../../modules/food/delivery/models/deliveryPartner.model.js";
import { FoodReferralSettings } from "../../modules/food/admin/models/referralSettings.model.js";
import { FoodReferralLog } from "../../modules/food/admin/models/referralLog.model.js";
import { createOrUpdateOtp, verifyOtp } from "../otp/otp.service.js";
import { signAccessToken, signRefreshToken } from "./token.util.js";
import { FoodRefreshToken } from "../refreshTokens/refreshToken.model.js";
import { ValidationError, AuthError } from "./errors.js";
import { config } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { sendAdminResetOtpEmail } from "../../utils/email.js";
import mongoose from "mongoose";
import { creditReferralReward } from "../../modules/food/user/services/userWallet.service.js";

import { referralSettingsFor } from '../../core/referral/referralSettings.service.js';
const ROLES = {
  USER: "USER",
  RESTAURANT: "RESTAURANT",
  DELIVERY_PARTNER: "DELIVERY_PARTNER",
  ADMIN: "ADMIN",
};

const isDev = config.nodeEnv !== 'production';
const DEFAULT_CREDENTIALS = {
  adminEmail: String(process.env.DEFAULT_ADMIN_EMAIL || (isDev ? "Quick Dropindia@gmail.com" : ""))
    .trim()
    .toLowerCase(),
  adminPassword: String(
    process.env.DEFAULT_ADMIN_PASSWORD || (isDev ? "sahin.Quick Drop@2004#" : ""),
  ),
  userPhone: String(process.env.DEFAULT_USER_PHONE || (isDev ? "7974161582" : "")),
  restaurantPhone: String(process.env.DEFAULT_RESTAURANT_PHONE || (isDev ? "7974161582" : "")),
  deliveryPhone: String(process.env.DEFAULT_DELIVERY_PHONE || (isDev ? "7610416911" : "")),
};

const normalizePhone10 = (value) => String(value || "").replace(/\D/g, "").slice(-10);

const isDefaultPhone = (inputPhone, defaultPhone) =>
  normalizePhone10(inputPhone) === normalizePhone10(defaultPhone);

const withTimeout = async (promise, timeoutMs, label) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};

export const requestUserOtp = async (phone) => {
  if (!phone) {
    throw new ValidationError("Phone is required");
  }

  const existingUser = await FoodUser.findOne({ phone }).select("_id name").lean();
  const otp = await createOrUpdateOtp(phone, "user");
  // TODO: integrate SMS provider here
  const shouldExposeOtp =
    config.nodeEnv !== "production";
  return {
    ...(shouldExposeOtp ? { otp } : {}),
    isExistingUser: Boolean(existingUser?._id),
    needsNamePrompt:
      !existingUser?._id ||
      !existingUser?.name ||
      String(existingUser.name).trim() === "" ||
      String(existingUser.name).toLowerCase() === "null",
  };
};

export const verifyUserOtpAndLogin = async (
  phone,
  otp,
  ref,
  fcmToken,
  platform,
  name,
) => {
  const loginStart = Date.now();
  logger.info(`[Auth Verify] Start verifyUserOtpAndLogin phone=${phone}`);
  const result = await verifyOtp(phone, otp, "user");
  logger.info(
    `[Auth Verify] OTP checked in ${Date.now() - loginStart}ms phone=${phone} valid=${result.valid}`,
  );

  if (!result.valid) {
    throw new AuthError(result.reason || "OTP verification failed");
  }

  let userDoc = await FoodUser.findOne({ phone });
  logger.info(
    `[Auth Verify] User lookup done in ${Date.now() - loginStart}ms phone=${phone}`,
  );
  
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

  // Update FCM token in background so login is not blocked on this write.
  if (fcmToken) {
    const tokenField = platform === "mobile" ? "fcmTokenMobile" : "fcmTokens";
    try {
      await FoodUser.updateOne(
        { _id: userDoc._id },
        { $addToSet: { [tokenField]: String(fcmToken).trim() } },
      );
    } catch (err) {
      logger.warn(
        `[Auth Verify] FCM token update failed for user ${userDoc._id}: ${err.message}`,
      );
    }
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
            referralSettingsFor('food', FoodReferralSettings),
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

            /*
             * One reward per phone number, ever. Deleting a profile removes the
             * user and its wallet, so signing up again with the same phone and
             * the same ref paid the referrer again, up to the limit. And the cap
             * is claimed atomically: it was read, then incremented in a separate
             * write, so parallel signups ran past it.
             */
            const refereePhone = String(userDoc.phone || "").replace(/\D/g, "").slice(-10);
            const phoneAlreadyRewarded = refereePhone
              ? await FoodReferralLog.exists({ refereePhone, role: "USER", status: "credited" })
              : false;
            const claimed = reward > 0 && limit > 0 && !phoneAlreadyRewarded
              ? await FoodUser.updateOne(
                  { _id: referrerId, $or: [{ referralCount: { $lt: limit } }, { referralCount: { $exists: false } }] },
                  { $inc: { referralCount: 1 } },
                )
              : null;

            if (claimed?.modifiedCount === 1) {
              userDoc.referredBy = referrerId;
              await userDoc.save();

              const log = await FoodReferralLog.create({
                referrerId,
                refereeId: userDoc._id,
                role: "USER",
                rewardAmount: reward,
                status: "credited",
                refereePhone,
              });

              await Promise.all([
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
                refereePhone,
                reason:
                  phoneAlreadyRewarded
                    ? "phone_already_rewarded"
                    : reward <= 0
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
  const payload = { userId: user._id.toString(), role: user.role || "USER" };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  try {
    await withTimeout(
      FoodRefreshToken.create({
        userId: user._id,
        token: refreshToken,
        expiresAt,
      }),
      1500,
      "FoodRefreshToken.create",
    );
  } catch (err) {
    logger.warn(
      `[Auth Verify] Refresh token persistence skipped due to slowdown for phone=${phone}: ${err.message}`,
    );
  }
  logger.info(
    `[Auth Verify] Login success phone=${phone} total=${Date.now() - loginStart}ms`,
  );

  return { accessToken, refreshToken, user, isNewUser };
};

export const adminLogin = async (email, password) => {
  if (!email || !password) {
    throw new ValidationError("Email and password are required");
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  let admin = await FoodAdmin.findOne({ email: normalizedEmail });

  // Auto-provision default admin account (no manual seed needed).
  if (
    !admin &&
    normalizedEmail === DEFAULT_CREDENTIALS.adminEmail &&
    password === DEFAULT_CREDENTIALS.adminPassword
  ) {
    admin = await FoodAdmin.create({
      email: DEFAULT_CREDENTIALS.adminEmail,
      password: DEFAULT_CREDENTIALS.adminPassword,
      name: "Quick Drop Admin",
      isActive: true,
      servicesAccess: ["food", "quickCommerce", "taxi", "serviceProvider"],
      adminLevel: "platform_superadmin",
      admin_type: "superadmin",
      permissions: ["*"]
    });
  }

  if (!admin) {
    throw new AuthError("Invalid credentials");
  }

  const isMatch = await admin.comparePassword(password);
  if (!isMatch) {
    throw new AuthError("Invalid credentials");
  }

  const payload = { userId: admin._id.toString(), role: admin.role };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  await FoodRefreshToken.create({
    userId: admin._id,
    token: refreshToken,
    expiresAt,
  });

  const { serializeAdminContext } = await import("../admin/adminHierarchy.service.js");
  const serializedContext = serializeAdminContext(admin);

  const userObj = admin.toObject();
  delete userObj.password;
  
  const mergedUser = {
    ...userObj,
    ...serializedContext
  };

  return { accessToken, refreshToken, user: mergedUser };
};

export const requestRestaurantOtp = async (phone) => {
  if (!phone) {
    throw new ValidationError("Phone is required");
  }
  const otp = await createOrUpdateOtp(phone, "restaurant");
  // Only expose OTP in response when in default/dev mode — never in production with real SMS
  const shouldExposeOtp =
    config.nodeEnv !== "production";
  return shouldExposeOtp ? { otp } : {};
};

export const verifyRestaurantOtpAndLogin = async (phone, otp, fcmToken, platform) => {
  const result = await verifyOtp(phone, otp, "restaurant");
  if (!result.valid) {
    throw new AuthError(result.reason || "OTP verification failed");
  }

  // Restaurants may store ownerPhone with country code or formatting.
  // Match by exact phone, last-10 digits, or suffix match to avoid false "needsRegistration".
  const digits = String(phone || "").replace(/\D/g, "");
  const last10 = digits.slice(-10);
  const phoneCandidates = [phone, digits, last10].filter(Boolean);
  const phoneOrFields = (field) => [
    { [field]: { $in: phoneCandidates } },
    ...(last10 ? [{ [field]: { $regex: new RegExp(last10 + "$") } }] : []),
  ];

  const restaurant = await FoodRestaurant.findOne({
    $or: [
      ...phoneOrFields("ownerPhone"),
      ...phoneOrFields("primaryContactNumber"),
    ],
  });
  let restaurantDoc = restaurant;
  if (!restaurantDoc && isDefaultPhone(phone, DEFAULT_CREDENTIALS.restaurantPhone)) {
    // Auto-provision default restaurant account for configured default phone.
    restaurantDoc = await FoodRestaurant.create({
      restaurantName: "Quick Drop Demo Restaurant",
      ownerName: "Quick Drop Restaurant Owner",
      ownerEmail: "restaurant@Quick Drop.com",
      ownerPhone: normalizePhone10(DEFAULT_CREDENTIALS.restaurantPhone),
      primaryContactNumber: normalizePhone10(DEFAULT_CREDENTIALS.restaurantPhone),
      city: "Bhopal",
      state: "Madhya Pradesh",
      status: "approved",
      approvedAt: new Date(),
    });
  }
  if (!restaurantDoc) {
    // Phone has been successfully verified, but no restaurant exists yet.
    // Frontend will use this to redirect into registration/onboarding.
    return {
      needsRegistration: true,
      phone,
    };
  }

  // Update FCM token if provided
  if (fcmToken) {
    let isModified = false;
    if (platform === "mobile") {
      if (!restaurantDoc.fcmTokenMobile) restaurantDoc.fcmTokenMobile = [];
      if (!restaurantDoc.fcmTokenMobile.includes(fcmToken)) {
        restaurantDoc.fcmTokenMobile.push(fcmToken);
        isModified = true;
      }
    } else {
      if (!restaurantDoc.fcmTokens) restaurantDoc.fcmTokens = [];
      if (!restaurantDoc.fcmTokens.includes(fcmToken)) {
        restaurantDoc.fcmTokens.push(fcmToken);
        isModified = true;
      }
    }
    if (isModified) {
      await restaurantDoc.save();
    }
  }

  // If restaurant approval status is used, only allow login for approved restaurants.
  if (restaurantDoc.status && restaurantDoc.status !== "approved") {
    const isRejected = restaurantDoc.status === "rejected";
    return {
      pendingApproval: true,
      isRejected,
      rejectionReason: isRejected ? restaurantDoc.rejectionReason : null,
      message:
        isRejected
          ? (restaurantDoc.rejectionReason 
              ? `Your restaurant registration was rejected: ${restaurantDoc.rejectionReason}`
              : "Your restaurant registration has been rejected. Please contact support.")
          : "Your restaurant registration is pending approval.",
      phone: phone,
      restaurant: isRejected ? restaurantDoc : null
    };
  }

  const payload = { userId: restaurantDoc._id.toString(), role: ROLES.RESTAURANT };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  await FoodRefreshToken.create({
    userId: restaurantDoc._id,
    token: refreshToken,
    expiresAt,
  });

  return {
    accessToken,
    refreshToken,
    user: restaurantDoc,
    needsRegistration: false,
  };
};

export const requestDeliveryOtp = async (phone) => {
  if (!phone) {
    throw new ValidationError("Phone is required");
  }
  const otp = await createOrUpdateOtp(phone, "delivery");
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
  const result = await verifyOtp(phone, otp, "delivery");
  if (!result.valid) {
    throw new AuthError(result.reason || "OTP verification failed");
  }

  const normalized = normalizePhoneForDelivery(phone);
  if (!normalized) {
    return { needsRegistration: true, phone };
  }

  let deliveryPartner = await FoodDeliveryPartner.findOne({
    $or: [
      { phone: normalized },
      { phone: { $regex: new RegExp(normalized + "$") } },
    ],
  });

  if (!deliveryPartner && isDefaultPhone(phone, DEFAULT_CREDENTIALS.deliveryPhone)) {
    // Auto-provision default delivery account for configured default phone.
    deliveryPartner = await FoodDeliveryPartner.create({
      name: "Quick Drop Delivery Partner",
      phone: normalizePhone10(DEFAULT_CREDENTIALS.deliveryPhone),
      city: "Bhopal",
      state: "Madhya Pradesh",
      vehicleType: "bike",
      status: "approved",
      approvedAt: new Date(),
    });
  }

  if (!deliveryPartner) {
    return { needsRegistration: true, phone };
  }

  // Deleted by an admin: sign up again (the app shows the sign-up form). This
  // used to answer "pending admin verification", and the number was stuck:
  // a deactivated account is not in Join Requests, so nobody could approve it.
  if (deliveryPartner.status === "deactivated") {
    return { needsRegistration: true, phone, returning: true };
  }

  // Update FCM token if provided - CRITICAL: do this BEFORE returning pendingApproval
  // so we can notify them when approved.
  if (fcmToken) {
    let isModified = false;
    if (platform === "mobile") {
      if (!deliveryPartner.fcmTokenMobile) deliveryPartner.fcmTokenMobile = [];
      if (!deliveryPartner.fcmTokenMobile.includes(fcmToken)) {
        deliveryPartner.fcmTokenMobile.push(fcmToken);
        isModified = true;
      }
    } else {
      if (!deliveryPartner.fcmTokens) deliveryPartner.fcmTokens = [];
      if (!deliveryPartner.fcmTokens.includes(fcmToken)) {
        deliveryPartner.fcmTokens.push(fcmToken);
        isModified = true;
      }
    }
    if (isModified) {
      await deliveryPartner.save();
    }
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
      phone: phone,
      deliveryPartner: isRejected ? deliveryPartner : null
    };
  }

  const payload = {
    userId: deliveryPartner._id.toString(),
    role: ROLES.DELIVERY_PARTNER,
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
  // No refresh token is a valid way to log out -- see dtos/auth/logout.dto.js.
  // Fall through so the FCM token below is still detached, then report that
  // nothing was invalidated.

  // 1. Remove specific FCM token from ALL collections if provided
  if (fcmToken) {
    console.log(`[FCM-Logout] Starting logout-driven token removal: platform=${platform}, tokenPreview=${fcmToken?.slice(0, 10)}...`);
    
    // We try to remove the token from all 4 possible models regardless of the user ID, 
    // ensuring no stale connections are left across any role or app the user was logged into.
    const field = platform === "mobile" ? "fcmTokenMobile" : "fcmTokens";
    const models = [FoodUser, FoodRestaurant, FoodDeliveryPartner, FoodAdmin];
    
    try {
      await Promise.all(
        models.map((model) =>
          model.updateMany(
            { [field]: fcmToken },
            { $pull: { [field]: fcmToken } },
          ),
        ),
      );
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

// Every value the model accepts. This list once lacked serviceProvider, so
// saving a profile quietly removed that access from the admin.
const ADMIN_SERVICES_ALLOWED = ["food", "quickCommerce", "medical", "taxi", "serviceProvider"];

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
  // Riders and stores likewise: a rejected rider or store used to keep minting
  // access tokens for the refresh token's whole life.
  if (payload?.role === "DELIVERY_PARTNER") {
    const p = await FoodDeliveryPartner.findById(payload.userId).select("status").lean();
    if (!p || p.status !== "approved") {
      await FoodRefreshToken.deleteOne({ token });
      throw new AuthError("Your delivery account is not active");
    }
  }
  if (payload?.role === "RESTAURANT") {
    const r = await FoodRestaurant.findById(payload.userId).select("status").lean();
    if (!r || r.status === "rejected") {
      await FoodRefreshToken.deleteOne({ token });
      throw new AuthError("This account is not active");
    }
  }

  const newAccessToken = signAccessToken({
    userId: payload.userId,
    role: payload.role,
  });

  return { accessToken: newAccessToken, refreshToken: token };
};
