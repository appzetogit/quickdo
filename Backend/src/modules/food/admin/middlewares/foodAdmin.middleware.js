import mongoose from 'mongoose';
import { ForbiddenError, AuthError } from '../../../../core/auth/errors.js';
import { FoodAdmin } from '../../../../core/admin/admin.model.js';
import { serializeAdminContext, hasAdminPermission } from '../../../../core/admin/adminHierarchy.service.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Short-lived cache of admin documents, keyed by admin id.
 *
 * attachFoodAdminContext runs on EVERY request under /v1/food/admin -- roughly 300
 * routes -- and fetched the full admin document each time. An operator working
 * through the panel generates one of these per click, per background poll, per table
 * page. The document changes only when someone edits that admin.
 *
 * Correctness comes from invalidation, not from the TTL: mutating an admin calls
 * invalidateAdminCache(), so a permission change or a deactivation takes effect on
 * the admin's very next request. The TTL is a backstop for changes made outside this
 * process -- a direct database edit, or the other pm2 instance -- and is deliberately
 * short because the worst case it bounds is a deactivated admin retaining access.
 *
 * ponytail: process-local Map, so each pm2 instance keeps its own copy and an
 * invalidation only clears the instance that served the write. The 15s TTL is what
 * bounds that. Move to Redis pub/sub if the admin count or instance count grows
 * enough for the window to matter.
 */
const CACHE_TTL_MS = 15_000;
const adminCache = new Map();

/** Drop a cached admin. Call after any write that changes access. */
export const invalidateAdminCache = (adminId) => {
    if (!adminId) return;
    adminCache.delete(String(adminId));
};

/** Drop everything. For bulk permission changes. */
export const clearAdminCache = () => adminCache.clear();

/*
 * structuredClone does not keep ObjectIds: they come back as plain objects that
 * hydrate() cannot read, so every cache hit produced an admin with NO _id. Any
 * sub-admin created within 15s of the creator's previous request was saved with
 * parentAdminId unset -- and an admin without a parent reads as a legacy owner,
 * so those sub-admins had full access. Clone by hand, keeping ids and dates.
 */
const cloneDoc = (value) => {
    if (value instanceof mongoose.Types.ObjectId) return new mongoose.Types.ObjectId(String(value));
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(cloneDoc);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneDoc(v)]));
    }
    return value;
};

const loadAdmin = async (userId) => {
    const key = String(userId);
    const hit = adminCache.get(key);

    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        // hydrate() rebuilds a mongoose document from the stored plain object with no
        // database round-trip. Two reasons not to cache the document itself: a
        // document is mutable shared state, so one request mutating it would leak
        // into every other request holding the same instance; and consumers here
        // (managementService.*) are written against a document, so handing them a
        // POJO would be a silent behaviour change.
        return FoodAdmin.hydrate(cloneDoc(hit.doc));
    }

    const admin = await FoodAdmin.findById(userId);
    if (admin) {
        adminCache.set(key, { doc: admin.toObject(), at: Date.now() });
    }
    return admin;
};

/** The same cached lookup, for the permission guard every admin panel shares. */
export const loadAdminCached = (userId) => loadAdmin(userId);

/**
 * Middleware to load and attach the serialized admin hierarchy context to the request.
 */
export const attachFoodAdminContext = async (req, res, next) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) {
      return next(new AuthError('Admin session not found'));
    }

    const admin = await loadAdmin(userId);
    if (!admin) {
      return next(new AuthError('Admin account not found'));
    }

    if (admin.isActive === false) {
      // Never serve a deactivated admin from cache on a later request.
      invalidateAdminCache(userId);
      return next(new ForbiddenError('Your account has been deactivated'));
    }

    req.admin = admin;
    req.adminContext = serializeAdminContext(admin);
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Record a refused admin action.
 *
 * A denial is the interesting event: it is either an operator hitting a boundary that
 * is wrong for their job, or someone probing one. Neither was recorded anywhere, so a
 * ForbiddenError left no trace of who tried what. One greppable line, no request body
 * -- these routes carry payment and payout payloads and this is not the place to
 * spill them into logs.
 */
const logDenial = (req, resource, action, reason) => {
    logger.warn(
        `[ADMIN DENIED] adminId=${req.admin?._id} level=${req.adminContext?.adminLevel} `
        + `module=${req.adminContext?.module} resource=${resource} action=${action} `
        + `reason=${reason} ${req.method} ${req.originalUrl || req.url}`,
    );
};

/**
 * Middleware to restrict access based on resource permission.
 * Checks for resource.read (GET/HEAD) or resource.write (POST/PUT/PATCH/DELETE).
 */
export const requireFoodResourceAccess = (resource, label = '') => {
  return (req, res, next) => {
    if (!req.admin) {
      return next(new AuthError('Admin context required'));
    }

    const method = req.method;
    const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(method);
    const requiredAction = isRead ? 'read' : 'write';

    // Platform and Food Superadmins have full access
    const isSuper = req.adminContext.adminLevel === 'platform_superadmin' ||
                    (req.adminContext.adminLevel === 'food_superadmin' && req.adminContext.module === 'food');

    if (isSuper) {
      return next();
    }

    // Check specific permission
    const hasWrite = hasAdminPermission(req.admin, resource, 'write');
    if (requiredAction === 'write') {
      if (hasWrite) {
        return next();
      }

      const hasRead = hasAdminPermission(req.admin, resource, 'read');
      if (hasRead) {
        logDenial(req, resource, 'write', 'read_only');
        return next(new ForbiddenError(`You have read-only permission for ${label || resource}`));
      }
      logDenial(req, resource, 'write', 'no_permission');
      return next(new ForbiddenError(`Access denied: requires write permission for ${label || resource}`));
    }

    // Read action check: write implies read
    const hasRead = hasWrite || hasAdminPermission(req.admin, resource, 'read');
    if (hasRead) {
      return next();
    }

    logDenial(req, resource, 'read', 'no_permission');
    return next(new ForbiddenError(`Access denied: requires read permission for ${label || resource}`));
  };
};
