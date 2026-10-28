import { sendError } from '../../utils/response.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import { isSuperAdminLike } from './adminHierarchy.service.js';

/**
 * For Master pages that list across every zone: a zone-limited sub-admin would
 * see restaurants outside their zones, so only a super admin may. Runs after
 * authMiddleware + requireRoles('ADMIN').
 */
export async function requireSuperAdmin(req, res, next) {
    try {
        const admin = await loadAdminCached(req.user?.userId || req.user?.id);
        if (!admin) return sendError(res, 403, 'Admin account not found');
        if (admin.isActive === false) return sendError(res, 403, 'Your admin account has been deactivated');
        if (!isSuperAdminLike(admin)) return sendError(res, 403, 'Only a super admin can open this page');
        return next();
    } catch (err) {
        return next(err);
    }
}
