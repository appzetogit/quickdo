import { sendError } from '../../utils/response.js';
import { logger } from '../../utils/logger.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import {
  decideAdminAccess,
  denialMessage,
  isDeleteRequest,
  isRestrictedAdmin,
  isWriteMethod,
} from './adminAccessPolicy.js';

/**
 * Enforce the shared admin permissions on one panel's API.
 *
 *   service   'food' | 'quickCommerce' | 'taxi' -- the API being guarded
 *   resolve   (path, method) => resource        -- see adminAccessPolicy.js
 *   prefix    prepended to req.path when mounted under a sub-path
 *
 * An id that is not in the platform `admins` collection (a quick-commerce-native
 * admin in qc_admins) passes through: that panel's own checks still apply to it.
 */
export const enforceAdminAccess = (service, resolve, { prefix = '' } = {}) => async (req, res, next) => {
  try {
    if (req.method === 'OPTIONS') return next();
    const id = req.user?.userId || req.user?.id || req.auth?.sub;
    if (!id) return next();

    const admin = await loadAdminCached(id);
    if (!admin) return next();

    const path = `${prefix}${req.path}`;
    const resource = resolve(path, req.method);
    const decision = decideAdminAccess(admin, {
      service,
      resource,
      write: isWriteMethod(req.method),
      remove: isDeleteRequest(req.method, path),
    });

    if (!decision.allowed) {
      logger.warn(
        `[ADMIN DENIED] adminId=${admin._id} service=${service} resource=${resource || '-'} `
        + `reason=${decision.reason} ${req.method} ${req.originalUrl || req.url}`,
      );
      return sendError(res, 403, denialMessage({ ...decision, resource }));
    }

    return next();
  } catch (error) {
    return next(error);
  }
};

/** Platform-wide settings (the MASTER section) are not a sub-admin's to change. */
export const refuseRestrictedAdminWrites = async (req, res, next) => {
  try {
    if (!isWriteMethod(req.method)) return next();
    const id = req.user?.userId || req.user?.id;
    if (!id) return next();
    const admin = await loadAdminCached(id);
    if (admin && isRestrictedAdmin(admin)) {
      return sendError(res, 403, 'Only a superadmin can change platform settings');
    }
    return next();
  } catch (error) {
    return next(error);
  }
};
