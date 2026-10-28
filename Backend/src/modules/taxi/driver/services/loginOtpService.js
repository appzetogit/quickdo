import crypto from 'node:crypto';
import { ApiError } from '../../../../utils/ApiError.js';
import { env } from '../../../../config/env.js';
import { Owner } from '../../admin/models/Owner.js';
import { ServiceStore } from '../../admin/models/ServiceStore.js';
import { ServiceCenterStaff } from '../../admin/models/ServiceCenterStaff.js';
import { Driver } from '../models/Driver.js';
import { BusDriver } from '../models/BusDriver.js';
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
const normalizeRole = (role) => {
  const normalized = String(role || 'driver').toLowerCase();
  if (normalized === 'owner') return 'owner';
  if (
    normalized === 'service_center' ||
    normalized === 'service-center' ||
    normalized === 'servicecenter'
  ) {
    return 'service_center';
  }
  if (
    normalized === 'service_center_staff' ||
    normalized === 'service-center-staff' ||
    normalized === 'servicecenterstaff' ||
    normalized === 'center_staff'
  ) {
    return 'service_center_staff';
  }
  if (normalized === 'bus_driver' || normalized === 'bus-driver' || normalized === 'busdriver') {
    return 'bus_driver';
  }
  return 'driver';
};

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

const publicOwnerPayload = (owner) => ({
  id: owner._id,
  name: owner.name || owner.company_name || '',
  company_name: owner.company_name || '',
  phone: owner.mobile || owner.phone || '',
  email: owner.email || '',
  city: owner.city || '',
  approve: owner.approve,
  status: owner.status,
});

const publicServiceCenterPayload = (center) => ({
  id: center._id,
  name: center.name || '',
  owner_name: center.owner_name || '',
  phone: center.owner_phone || '',
  address: center.address || '',
  status: center.status || 'active',
});

const publicServiceCenterStaffPayload = (staff) => ({
  id: staff._id,
  name: staff.name || '',
  phone: staff.phone || '',
  status: staff.status || 'active',
  serviceCenterId: staff.serviceCenterId ? String(staff.serviceCenterId) : '',
});

const publicBusDriverPayload = (driver) => ({
  id: driver._id,
  name: driver.name || '',
  phone: driver.phone || '',
  email: driver.email || '',
  approve: driver.approve,
  active: driver.active,
  status: driver.status || 'approved',
  assignedBusServiceId: driver.assignedBusServiceId ? String(driver.assignedBusServiceId) : '',
  operatorName: driver.operatorName || '',
  busName: driver.busName || '',
  serviceNumber: driver.serviceNumber || '',
  routeName: driver.routeName || '',
  originCity: driver.originCity || '',
  destinationCity: driver.destinationCity || '',
});

const isApprovedDriver = (driver) =>
  Boolean(driver) &&
  driver.approve !== false &&
  String(driver.status || '').toLowerCase() !== 'pending';

const isApprovedOwner = (owner) =>
  Boolean(owner) &&
  owner.active !== false &&
  (owner.approve === true || String(owner.status || '').toLowerCase() === 'approved');

const isApprovedBusDriver = (driver) =>
  Boolean(driver) &&
  driver.active !== false &&
  driver.approve !== false &&
  !['pending', 'blocked'].includes(String(driver.status || '').toLowerCase());

const isApprovedServiceCenter = (center) =>
  Boolean(center) &&
  center.active !== false &&
  String(center.status || '').toLowerCase() !== 'inactive';

const isApprovedServiceCenterStaff = (staff) =>
  Boolean(staff) &&
  staff.active !== false &&
  String(staff.status || '').toLowerCase() !== 'inactive';

export const startDriverLoginOtp = async ({ phone, role = 'driver' }) => {
  const normalizedPhone = normalizePhone(phone);
  const normalizedRole = normalizeRole(role);
  const ownerPhoneOr = [
    ...buildPhoneMatcher('mobile', phone),
    ...buildPhoneMatcher('phone', phone),
  ];

  if (!normalizedPhone || normalizedPhone.length !== 10) {
    throw new ApiError(400, 'A valid 10-digit mobile number is required');
  }

  // Shared platform-wide budget. This path previously had no throttle at all.
  const quota = await consumeOtpQuota(normalizedPhone, { service: OTP_SERVICES.TAXI_DRIVER });
  if (!quota.allowed) {
    throw new ApiError(429, otpRateLimitMessage(quota));
  }

  const account =
    normalizedRole === 'owner'
      ? await Owner.findOne({
          $or: ownerPhoneOr,
        })
      : normalizedRole === 'service_center'
        ? await ServiceStore.findOne({ $or: buildPhoneMatcher('owner_phone', phone) })
      : normalizedRole === 'service_center_staff'
        ? await ServiceCenterStaff.findOne({ $or: buildPhoneMatcher('phone', phone) })
      : normalizedRole === 'bus_driver'
        ? await BusDriver.findOne({ $or: buildPhoneMatcher('phone', phone) })
        : await Driver.findOne({ $or: buildPhoneMatcher('phone', phone) });

  if (!account) {
    throw new ApiError(
      404,
      `${
        normalizedRole === 'owner'
          ? 'Owner'
          : normalizedRole === 'service_center'
            ? 'Service center'
          : normalizedRole === 'service_center_staff'
            ? 'Service center staff'
          : normalizedRole === 'bus_driver'
            ? 'Bus driver'
            : 'Driver'
      } account not found`,
    );
  }

  // Allow login even if account is pending approval to show registration status
  // if (
  //   (normalizedRole === 'owner' && !isApprovedOwner(account)) ||
  //   (normalizedRole === 'service_center' && !isApprovedServiceCenter(account)) ||
  //   (normalizedRole === 'service_center_staff' && !isApprovedServiceCenterStaff(account)) ||
  //   (normalizedRole === 'driver' && !isApprovedDriver(account)) ||
  //   (normalizedRole === 'bus_driver' && !isApprovedBusDriver(account))
  // ) {
  //   throw new ApiError(
  //     403,
  //     `${
  //       normalizedRole === 'owner'
  //         ? 'Owner'
  //         : normalizedRole === 'service_center'
  //           ? 'Service center'
  //         : normalizedRole === 'service_center_staff'
  //           ? 'Service center staff'
  //         : normalizedRole === 'bus_driver'
  //           ? 'Bus driver'
  //           : 'Driver'
  //     } account is pending approval`,
  //   );
  // }

  const { otp, isStatic } = resolveDriverLoginOtpForPhone(normalizedPhone);
  const now = Date.now();

  const session = await DriverLoginSession.findOneAndUpdate(
    { phone: normalizedPhone },
    {
      phone: normalizedPhone,
      driverId: account._id,
      accountRole: normalizedRole,
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
  const normalizedRole = normalizeRole(session.accountRole);

  if (!otp || String(otp).trim().length !== 4) {
    throw new ApiError(400, 'A valid 4-digit OTP is required');
  }

  if (!session.otpExpiresAt || new Date(session.otpExpiresAt).getTime() < Date.now()) {
    throw new ApiError(410, 'OTP has expired');
  }

  if (session.otpHash !== hashOtp(otp)) {
    await rejectWrongOtp(session);
  }

  const account =
    normalizedRole === 'owner'
      ? await Owner.findById(session.driverId)
      : normalizedRole === 'service_center'
        ? await ServiceStore.findById(session.driverId)
      : normalizedRole === 'service_center_staff'
        ? await ServiceCenterStaff.findById(session.driverId)
      : normalizedRole === 'bus_driver'
        ? await BusDriver.findById(session.driverId)
        : await Driver.findById(session.driverId);

  if (!account) {
    throw new ApiError(
      404,
      `${
        normalizedRole === 'owner'
          ? 'Owner'
          : normalizedRole === 'service_center'
            ? 'Service center'
          : normalizedRole === 'service_center_staff'
            ? 'Service center staff'
          : normalizedRole === 'bus_driver'
            ? 'Bus driver'
            : 'Driver'
      } account not found`,
    );
  }

  // Allow verification even if account is pending approval
  // if (
  //   (normalizedRole === 'owner' && !isApprovedOwner(account)) ||
  //   (normalizedRole === 'service_center' && !isApprovedServiceCenter(account)) ||
  //   (normalizedRole === 'service_center_staff' && !isApprovedServiceCenterStaff(account)) ||
  //   (normalizedRole === 'driver' && !isApprovedDriver(account)) ||
  //   (normalizedRole === 'bus_driver' && !isApprovedBusDriver(account))
  // ) {
  //   throw new ApiError(
  //     403,
  //     `${
  //       normalizedRole === 'owner'
  //         ? 'Owner'
  //         : normalizedRole === 'service_center'
  //           ? 'Service center'
  //         : normalizedRole === 'service_center_staff'
  //           ? 'Service center staff'
  //         : normalizedRole === 'bus_driver'
  //           ? 'Bus driver'
  //           : 'Driver'
  //       } account is pending approval`,
  //     );
  //   }

  if (normalizedRole === 'bus_driver') {
    account.lastLoginAt = new Date();
    await account.save();
  }

  session.verifiedAt = new Date();
  session.expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await session.save();
  await DriverLoginSession.deleteOne({ _id: session._id });

  return {
    message: 'OTP verified successfully',
    token: signAccessToken({ sub: String(account._id), role: normalizedRole }),
    driver:
      normalizedRole === 'owner'
        ? publicOwnerPayload(account)
        : normalizedRole === 'service_center'
          ? publicServiceCenterPayload(account)
          : normalizedRole === 'service_center_staff'
            ? publicServiceCenterStaffPayload(account)
        : normalizedRole === 'bus_driver'
          ? publicBusDriverPayload(account)
          : publicDriverPayload(account),
  };
};
