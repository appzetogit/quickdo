import { sendError } from '../../utils/response.js';

/**
 * Server-side enforcement of per-vertical admin access.
 *
 * Until now servicesAccess gated only the sidebar tabs: any admin token reached every
 * vertical's admin API directly, because requireRoles knows roles, not verticals, and
 * hasModuleAccess existed without a single caller. Service-provider was the only
 * vertical that enforced it. This middleware closes that for the rest.
 *
 * The rule matches SP's serviceAccess.js exactly, so one mental model covers the
 * platform: a non-empty servicesAccess must name the vertical; an absent or empty
 * list means unrestricted (legacy admins created before scoping existed).
 *
 * Mounted AFTER authMiddleware + requireRoles('ADMIN'), so req.user is a verified
 * admin token by the time this runs. One indexed lookup per request; results are not
 * cached so a revoked vertical takes effect on the admin's next request, not their
 * next login.
 */
export const requireServiceAccess = (vertical) => async (req, res, next) => {
    try {
        // The three verticals' auth middlewares attach the subject differently:
        // core sets req.user.userId, taxi sets req.auth.sub. Same fallbacks as the
        // activity controller.
        const userId = req.user?.userId || req.user?.id || req.auth?.sub;
        if (!userId) return sendError(res, 401, 'Not authenticated');

        const { FoodAdmin } = await import('../admin/admin.model.js');
        const admin = await FoodAdmin.findById(userId).select('servicesAccess isActive isDeleted').lean();

        // Not in the platform admins collection: a vertical-native admin (e.g. one
        // that lives in qc_admins). Those are scoped to their own vertical by
        // construction -- their credentials only exist inside it.
        // Not in the platform admins collection. Quick commerce still has its own
        // qc_admins, so an id found there passes; anything else is refused. This
        // used to pass every unknown id, so a deleted admin's token (or another
        // module's admin) kept working until it expired.
        if (!admin) {
            if (vertical === 'quickCommerce') {
                const { FoodAdmin: QCAdmin } = await import('../../modules/quickCommerce/core/admin/admin.model.js');
                const qcAdmin = await QCAdmin.findById(userId).select('isActive isDeleted').lean();
                if (qcAdmin && !qcAdmin.isDeleted && qcAdmin.isActive !== false) return next();
            }
            return sendError(res, 403, 'Admin account not found');
        }

        if (admin.isDeleted || admin.isActive === false) {
            return sendError(res, 403, 'Admin account is inactive');
        }

        const access = Array.isArray(admin.servicesAccess) ? admin.servicesAccess : [];
        // The quick-commerce API also serves the Medical panel (a pharmacy is a
        // quick-commerce seller), so Medical access admits an admin to it; what
        // they may see there is narrowed by enforceAdminAccess.
        const admits = vertical === 'quickCommerce' ? ['quickCommerce', 'medical'] : [vertical];
        if (access.length > 0 && !admits.some((v) => access.includes(v))) {
            return sendError(res, 403, `Forbidden: no access to the ${vertical} vertical`);
        }

        return next();
    } catch (error) {
        return next(error);
    }
};
