import { sendError } from '../../utils/response.js';

export const requireRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return sendError(res, 401, 'Not authenticated');
        }

        const userRole = String(req.user.role).toUpperCase();
        const allowedSet = new Set(allowedRoles.map((r) => String(r).toUpperCase()));

        // A super admin IS an admin. Tokens mint role from the admin document
        // (auth.service: `role: admin.role`), so promoting an account to super_admin
        // changed its token role and locked it out of every requireRoles('ADMIN')
        // mount -- the panel rendered, every API call 403'd, and screens showed zeros.
        const satisfies = allowedSet.has(userRole)
            || (userRole === 'SUPER_ADMIN' && allowedSet.has('ADMIN'));
        if (!satisfies) {
            return sendError(res, 403, 'Forbidden: insufficient permissions');
        }

        next();
    };
};

