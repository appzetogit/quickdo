/**
 * Quick-commerce's OWN admin permission model. Deliberately not collapsed.
 *
 * `role.middleware.js` beside this was byte-identical to master's and is gone.
 * This one is not a fork of anything -- it is a different model, and the two
 * cannot be merged by moving files:
 *
 *              collection      `permissions` shape
 *   master     admins          flat array of 'resource.action' strings
 *   this       qc_admins       nested object of { section: [actions] }
 *
 * So a QC-native admin does not exist in master's collection and their
 * permissions would not parse if they did. Unifying them is an identity merge
 * with a migration, not a refactor, and it belongs with the core/admin work.
 *
 * ONE CONSEQUENCE WORTH KNOWING NOW: requireFinancePermission, mounted on this
 * vertical's money routes, reads master's `admins`. A QC-native admin is absent
 * there, so today it tolerates and audits them (see financeAuthz.decide) -- but
 * when FINANCE_PERMISSIONS_ENFORCED is switched on they would be refused. The
 * admin identities have to merge before that flag flips, or QC's own admins lose
 * the withdrawal queue.
 */
import { sendError } from '../../utils/response.js';
import { FoodAdmin } from '../admin/admin.model.js';

const isSuperAdmin = (admin) =>
    !admin?.adminType || admin?.adminType === 'super_admin' || admin?.isSuperAdmin === true;

const hasAction = (permissions, section, action) => {
    const actions = Array.isArray(permissions?.[section]) ? permissions[section] : [];
    return actions.includes(action);
};

const hydrateAdmin = async (req) => {
    if (req.adminAccess) return req.adminAccess;
    const admin = await FoodAdmin.findById(req.user?.userId)
        .select('adminType permissions isActive isDeleted')
        .lean();
    if (admin) {
        req.adminAccess = admin;
        return admin;
    }

    // Not a quick-commerce-native admin. Platform admins live in the shared `admins`
    // collection, not qc_admins, so without this fallback every one of them read as
    // "inactive" here and the whole QC panel 403'd. Same identity bridge the
    // service-provider module uses: a platform admin is admitted when their
    // servicesAccess names this vertical (an absent/empty list means unrestricted,
    // matching SP's serviceAccess rule).
    const { FoodAdmin: PlatformAdmin } = await import('../../../../core/admin/admin.model.js');
    const platform = await PlatformAdmin.findById(req.user?.userId)
        .select('role servicesAccess adminLevel isActive isDeleted')
        .lean();
    if (!platform) return null;

    const access = Array.isArray(platform.servicesAccess) ? platform.servicesAccess : [];
    // Medical is served by this API too; which sections a platform sub-admin may
    // open here is decided earlier, by enforceAdminAccess.
    if (access.length > 0 && !access.includes('quickCommerce') && !access.includes('medical')) return null;

    const bridged = {
        // Full QC access for admitted platform admins. Per-section QC permissions only
        // exist on qc_admins documents; scoping platform sub-admins inside QC is the
        // server-side servicesAccess work tracked in SUPERAPP_DATA_MODEL.md.
        adminType: 'super_admin',
        permissions: {},
        isActive: platform.isActive !== false,
        isDeleted: platform.isDeleted === true
    };
    req.adminAccess = bridged;
    return bridged;
};

export const requireAdminPermission = (section, action = 'view') => async (req, res, next) => {
    try {
        if (!req.user?.userId || !['ADMIN', 'SUPER_ADMIN'].includes(req.user?.role)) {
            return sendError(res, 401, 'Not authenticated');
        }

        const admin = await hydrateAdmin(req);
        if (!admin || admin.isDeleted || admin.isActive === false) {
            return sendError(res, 403, 'Admin account is inactive');
        }

        if (isSuperAdmin(admin)) {
            return next();
        }

        if (!hasAction(admin.permissions, section, action)) {
            return sendError(res, 403, 'Forbidden: insufficient permissions');
        }

        return next();
    } catch (_error) {
        return sendError(res, 500, 'Permission check failed');
    }
};

export const requireAnyAdminPermission = (rules = []) => async (req, res, next) => {
    try {
        if (!req.user?.userId || !['ADMIN', 'SUPER_ADMIN'].includes(req.user?.role)) {
            return sendError(res, 401, 'Not authenticated');
        }

        const admin = await hydrateAdmin(req);
        if (!admin || admin.isDeleted || admin.isActive === false) {
            return sendError(res, 403, 'Admin account is inactive');
        }

        if (isSuperAdmin(admin)) {
            return next();
        }

        const allowed = Array.isArray(rules) && rules.some((rule) => {
            const section = rule?.section;
            const action = rule?.action || 'view';
            if (!section) return false;
            return hasAction(admin.permissions, section, action);
        });

        if (!allowed) {
            return sendError(res, 403, 'Forbidden: insufficient permissions');
        }

        return next();
    } catch (_error) {
        return sendError(res, 500, 'Permission check failed');
    }
};
