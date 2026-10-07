import crypto from 'node:crypto';
import { ApiError } from '../../../../utils/ApiError.js';
import { env } from '../../../../config/env.js';
import { Driver } from '../models/Driver.js';
import { DriverLoginSession } from '../models/DriverLoginSession.js';
import { signAccessToken } from './authService.js';
import { rejectWrongOtp, resetOtpAttempts } from '../../services/otpAttempts.js';
import { sendOtpSms } from '../../services/smsService.js';
import { consumeOtpQuota, otpRateLimitMessage, OTP_SERVICES } from '../../../../core/otp/otpRateLimit.service.js';

const LOGIN_OTP_TTL_MS = 10 * 60 * 1000;

const normalizePhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '').trim();
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
};

const buildPhoneCandidates = (phone) => {
  const normalizedPhone = normalizePhone(phone);
  const candidates = new Set();

  if (normalizedPhone) {
    candidates.add(normalizedPhone);
    candidates.add(`91${normalizedPhone}`);
    candidates.add(`+91${normalizedPhone}`);
  }

  return [...candidates];
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildPhoneMatcher = (field, phone) => {
  const normalizedPhone = normalizePhone(phone);
  const candidates = buildPhoneCandidates(phone);
  const clauses = [];

  if (candidates.length > 0) {
    clauses.push({ [field]: { $in: candidates } });
  }

  if (normalizedPhone) {
    // Accept formatted storage like "+91 79741 61582" or "91-7974161582".
    clauses.push({ [field]: { $regex: new RegExp(`${escapeRegex(normalizedPhone)}$`) } });
  }

  return clauses;
};

const generateOtp = () => String(Math.floor(1000 + Math.random() * 9000));

const hashOtp = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex');
const getVisibleOtp = (otp) => (process.env.NODE_ENV !== 'production' ? String(otp) : null);
const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const TEST_LOGIN_OTP_PHONE = '6268423925';
const TEST_LOGIN_OTP_CODE = '0000';
const getStaticDriverOtpConfig = () => ({
  phone: normalizePhone(env.sms?.staticOtpPhone || TEST_LOGIN_OTP_PHONE),
  otp: String(env.sms?.staticOtpCode || TEST_LOGIN_OTP_CODE).trim(),
});
const resolveDriverLoginOtpForPhone = (phone) => {
  const normalizedPhone = normalizePhone(phone);
  const staticOtpConfig = getStaticDriverOtpConfig();
  const defaultOtpEnabled = isTruthy(env.sms?.useDefaultOtp);

  // Both shortcuts hand out a KNOWN code, so each is a sign-in bypass for
  // whoever knows it. The fallback test phone ('6268423925' / '0000') applied
  // on the live system whenever STATIC_OTP_PHONE was unset, which is the
  // default, and USE_DEFAULT_OTP gave every driver the static code. Production
  // always gets a random OTP now -- the same rule the customer flow follows.
  if (process.env.NODE_ENV !== 'production') {
    if (defaultOtpEnabled && staticOtpConfig.otp) {
      return {
        otp: staticOtpConfig.otp,
        isStatic: true,
      };
    }

    if (staticOtpConfig.phone && staticOtpConfig.otp && normalizedPhone === staticOtpConfig.phone) {
      return {
        otp: staticOtpConfig.otp,
        isStatic: true,
      };
    }
  }

  return {
    otp: generateOtp(),
    isStatic: false,
  };
};

const getSession = async (phone) => {
  const session = await DriverLoginSession.findOne({ phone: normalizePhone(phone) }).select('+otpHash');

  if (!session) {
    throw new ApiError(404, 'Login session not found');
  }

  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
    await DriverLoginSession.deleteOne({ _id: session._id });
    throw new ApiError(410, 'Login session expired');
  }

  return session;
};

const publicSessionPayload = (session, debugOtp = null) => ({
  phone: session.phone,
  status: 'otp_sent',
  debugOtp,
});

const publicDriverPayload = (driver) => ({
  id: driver._id,
  name: driver.name,
  phone: driver.phone,
  email: driver.email,
  gender: driver.gender,
  vehicleType: driver.vehicleType,
  registerFor: driver.registerFor,
  vehicleNumber: driver.vehicleNumber,
  vehicleColor: driver.vehicleColor,
  city: driver.city,
  approve: driver.approve,
  status: driver.status,
  rating: driver.rating,
  isOnline: driver.isOnline,
  isOnRide: driver.isOnRide,
});

const isApprovedDriver = (driver) =>
  Boolean(driver) &&
  driver.approve !== false &&
  String(driver.status || '').toLowerCase() !== 'pending';

export const startDriverLoginOtp = async ({ phone }) => {
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone || normalizedPhone.length !== 10) {
    throw new ApiError(400, 'A valid 10-digit mobile number is required');
  }

  // Shared platform-wide budget. This path previously had no throttle at all.
  const quota = await consumeOtpQuota(normalizedPhone, { service: OTP_SERVICES.TAXI_DRIVER });
  if (!quota.allowed) {
    throw new ApiError(429, otpRateLimitMessage(quota));
  }

  const account = await Driver.findOne({ $or: buildPhoneMatcher('phone', phone) });

  if (!account) {
    throw new ApiError(404, 'Driver account not found');
  }

  // Allow login even if account is pending approval to show registration status.

  const { otp, isStatic } = resolveDriverLoginOtpForPhone(normalizedPhone);
  const now = Date.now();

  const session = await DriverLoginSession.findOneAndUpdate(
    { phone: normalizedPhone },
    {
      phone: normalizedPhone,
      driverId: account._id,
      accountRole: 'driver',
      otpHash: hashOtp(otp),
      otpExpiresAt: new Date(now + LOGIN_OTP_TTL_MS),
      verifiedAt: null,
      expiresAt: new Date(now + LOGIN_OTP_TTL_MS),
    },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  );
  await resetOtpAttempts(session);

  const smsDispatch = isStatic
    ? {
        mode: 'static',
        message: 'Static OTP enabled',
      }
    : await sendOtpSms({
        phone: normalizedPhone,
        otp,
        purpose: 'driver login OTP',
      });
  const debugOtp = getVisibleOtp(otp);

  if (debugOtp) {
    console.log(`[loginOtpService] OTP for ${normalizedPhone} = ${debugOtp} (${smsDispatch.mode})`);
  }

  return {
    message: smsDispatch.mode === 'live' ? 'OTP sent successfully' : 'OTP generated successfully',
    session: publicSessionPayload(session, debugOtp),
  };
};

export const verifyDriverLoginOtp = async ({ phone, otp }) => {
  const session = await getSession(phone);

  if (!otp || String(otp).trim().length !== 4) {
    throw new ApiError(400, 'A valid 4-digit OTP is required');
  }

  if (!session.otpExpiresAt || new Date(session.otpExpiresAt).getTime() < Date.now()) {
    throw new ApiError(410, 'OTP has expired');
  }

  if (session.otpHash !== hashOtp(otp)) {
    await rejectWrongOtp(session);
  }

  const account = await Driver.findById(session.driverId);

  if (!account) {
    throw new ApiError(404, 'Driver account not found');
  }

  // Allow verification even if account is pending approval.

  session.verifiedAt = new Date();
  session.expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await session.save();
  await DriverLoginSession.deleteOne({ _id: session._id });

  return {
    message: 'OTP verified successfully',
    token: signAccessToken({ sub: String(account._id), role: 'driver' }),
    driver: publicDriverPayload(account),
  };
};
