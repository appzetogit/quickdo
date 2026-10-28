import { Admin } from '../admin/models/Admin.js';
import { Owner } from '../admin/models/Owner.js';
import { ServiceStore } from '../admin/models/ServiceStore.js';
import { ServiceCenterStaff } from '../admin/models/ServiceCenterStaff.js';
import { ApiError } from '../../../utils/ApiError.js';
import { Driver } from '../driver/models/Driver.js';
import { BusDriver } from '../driver/models/BusDriver.js';
import { User } from '../user/models/User.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { resolveUnifiedDriverIdentity } from '../services/driverIdentityBridge.js';
import {
  normalizeAdminPermissions,
  normalizeAdminType,
} from '../admin/services/adminAccessService.js';

const roleModelMap = {
  admin: Admin,
  'super-admin': Admin,
  driver: Driver,
  bus_driver: BusDriver,
  owner: Owner,
  service_center: ServiceStore,
  service_center_staff: ServiceCenterStaff,
  user: User,
};

// The three modules each spell the super-admin role differently -- taxi uses
// `super-admin`, service-provider uses `super_admin`, and food/master issues
// `ADMIN`. A single platform admin account can only carry ONE role string, so
// whichever spelling it picks locks it out of the other panels: an account set to
// `super_admin` (which the SP routes require) was rejected here with
// "Insufficient permissions for this resource".
//
// Treat every spelling of the admin role as `admin`. This only widens which
// spellings are RECOGNISED; it grants nothing a plain `admin` token did not already
// have, and the entity/active checks below are unchanged.
const ADMIN_ROLE_ALIASES = new Set(['admin', 'super-admin', 'super_admin', 'superadmin']);

const normalizeRole = (role = '') => {
  const value = String(role || '').toLowerCase();
  if (ADMIN_ROLE_ALIASES.has(value)) {
    return 'admin';
  }
  return value;
};

const attachResolvedAuth = (req, payload) => {
  req.auth = {
    sub: payload.sub,
    role: normalizeRole(payload.role),
    originalRole: payload.role,
  };
};

/*
 * "Open user access": acting as a user WITHOUT a token, for local development.
 *
 * It was on everywhere, production included. With no Authorization header the
 * caller became whichever user id it put in x-user-id, the body or the query --
 * or, sending none, the OLDEST user in the database. That sat in front of 52 taxi
 * customer routes, among them wallet top-up (which credits the requested amount
 * with no payment), wallet transfer to a driver, ride booking and the active-ride
 * poll -- so an anonymous request could credit, spend or read any customer's money
 * and rides, and a logged-out visitor's home screen was served the oldest
 * customer's active ride.
 *
 * Now: off unless TAXI_OPEN_USER_ACCESS=true, never in production, and it names
 * an explicit user rather than picking one.
 */
export const isOpenUserAccessEnabled = () =>
  process.env.NODE_ENV !== 'production'
  && String(process.env.TAXI_OPEN_USER_ACCESS || '').toLowerCase() === 'true';

const resolveOpenUserIdentity = async (req) => {
  const explicitUserId =
    req.headers['x-user-id'] ||
    req.body?.userId ||
    req.query?.userId ||
    req.params?.userId ||
    null;

  if (!explicitUserId) {
    throw new ApiError(401, 'Authorization token is required');
  }
  const user = await User.findOne({ _id: explicitUserId });

  if (!user) {
    throw new ApiError(404, 'No user account is available for open user access');
  }

  attachResolvedAuth(req, {
    sub: String(user._id),
    role: 'user',
  });
};

export const authenticate = (allowedRoles = [], options = {}) => async (req, _res, next) => {
  try {
    const allowPending = options?.allowPending === true;
    const authorization = req.headers.authorization || '';
    const [, token] = authorization.split(' ');

    if (!token) {
      throw new ApiError(401, 'Authorization token is required');
    }

    const payload = await resolveUnifiedDriverIdentity(verifyAccessToken(token));

    const normalizedRole = normalizeRole(payload.role);
    const normalizedAllowedRoles = allowedRoles.map(normalizeRole);

    if (normalizedAllowedRoles.length > 0 && !normalizedAllowedRoles.includes(normalizedRole)) {
      throw new ApiError(403, 'Insufficient permissions for this resource');
    }

    const Model = roleModelMap[payload.role] || roleModelMap[normalizedRole];
    const subjectId = payload.sub || payload.userId || payload.id || null;

    if (!Model) {
      throw new ApiError(401, 'Unsupported auth role');
    }

    if (!subjectId) {
      throw new ApiError(401, 'Authorization token is invalid');
    }

    const entity = await Model.findById(subjectId);

    if (!entity) {
      throw new ApiError(401, 'Authenticated account no longer exists');
    }

    if (
      normalizedRole === 'user' &&
      (entity.deletedAt || entity.isActive === false || entity.active === false)
    ) {
      throw new ApiError(401, 'User account is not active');
    }

    if (
      normalizedRole === 'driver' &&
      !allowPending &&
      (entity.approve === false || String(entity.status || '').toLowerCase() === 'pending')
    ) {
      throw new ApiError(403, 'Driver account is pending approval');
    }

    if (
      normalizedRole === 'owner' &&
      !allowPending &&
      (entity.active === false ||
        entity.approve === false ||
        String(entity.status || '').toLowerCase() === 'pending')
    ) {
      throw new ApiError(403, 'Owner account is pending approval');
    }

    if (
      normalizedRole === 'bus_driver' &&
      (entity.active === false ||
        entity.approve === false ||
        ['pending', 'blocked'].includes(String(entity.status || '').toLowerCase()))
    ) {
      throw new ApiError(403, 'Bus driver account is pending approval');
    }

    if (
      normalizedRole === 'service_center' &&
      (entity.active === false || String(entity.status || '').toLowerCase() === 'inactive')
    ) {
      throw new ApiError(403, 'Service center account is inactive');
    }

    if (
      normalizedRole === 'service_center_staff' &&
      (entity.active === false || String(entity.status || '').toLowerCase() === 'inactive')
    ) {
      throw new ApiError(403, 'Service center staff account is inactive');
    }

    attachResolvedAuth(req, { ...payload, sub: String(subjectId) });
    req.auth.entity = entity;

    if (normalizedRole === 'admin') {
      req.auth.admin = {
        id: String(entity._id),
        email: entity.email || '',
        name: entity.name || '',
        role: entity.role || '',
        admin_type: normalizeAdminType(entity.admin_type || entity.role),
        permissions: normalizeAdminPermissions(entity.permissions || []),
        service_location_ids: Array.isArray(entity.service_location_ids)
          ? entity.service_location_ids.map((item) => String(item))
          : [],
        zone_ids: Array.isArray(entity.zone_ids)
          ? entity.zone_ids.map((item) => String(item))
          : [],
        active: entity.active !== false,
        status: entity.status || 'active',
      };

      if (req.auth.admin.active === false || String(req.auth.admin.status).toLowerCase() === 'inactive') {
        throw new ApiError(403, 'Admin account is inactive');
      }
    }

    next();
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      return next(new ApiError(401, 'Authorization token has expired'));
    }
    if (error?.name === 'JsonWebTokenError' || error?.name === 'NotBeforeError') {
      return next(new ApiError(401, 'Authorization token is invalid'));
    }
    next(error);
  }
};

export const authenticateOrResolveUser = (allowedRoles = ['user']) => async (req, res, next) => {
  const authorization = req.headers.authorization || '';
  const [, token] = authorization.split(' ');

  if (token) {
    return authenticate(allowedRoles)(req, res, next);
  }

  try {
    if (!allowedRoles.includes('user') || !isOpenUserAccessEnabled()) {
      throw new ApiError(401, 'Authorization token is required');
    }

    await resolveOpenUserIdentity(req);
    next();
  } catch (error) {
    next(error);
  }
};
