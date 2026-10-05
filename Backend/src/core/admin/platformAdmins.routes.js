import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import * as service from './platformAdmins.service.js';

/**
 * /v1/platform/admins -- admin accounts for every panel.
 *
 *   GET    /me            the signed-in admin's access (the panel filters its menu by it)
 *   GET    /meta          what the caller may hand out: panels, sections, service locations
 *   GET    /              accounts the caller manages   ?q= &service= &status= &role=
 *   GET    /:id
 *   POST   /
 *   PATCH  /:id
 *   PATCH  /:id/status    { isActive }
 *   DELETE /:id
 */
const router = express.Router();
// Per account: a shared browser must never be handed the previous admin's copy.
router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
router.use(authMiddleware, requireRoles('ADMIN'));

router.use(async (req, res, next) => {
  try {
    const admin = await loadAdminCached(req.user?.userId || req.user?.id);
    if (!admin) return sendError(res, 403, 'Admin account not found');
    if (admin.isActive === false) return sendError(res, 403, 'Your admin account has been deactivated');
    req.platformAdmin = admin;
    return next();
  } catch (err) {
    return next(err);
  }
});

const handle = (fn, message = 'OK') => async (req, res) => {
  try {
    return sendResponse(res, 200, message, await fn(req));
  } catch (err) {
    if (err?.code === 11000) return sendError(res, 409, 'An admin with this email already exists');
    const status = err?.statusCode || err?.status || 500;
    return sendError(res, status, status >= 500 ? 'Could not complete that. Please try again.' : err.message);
  }
};

router.get('/me', handle((req) => service.describeCaller(req.platformAdmin)));
router.get('/meta', handle((req) => service.getMeta(req.platformAdmin)));
router.get('/', handle((req) => service.listAdmins(req.platformAdmin, req.query)));
router.get('/:id', handle((req) => service.getAdmin(req.platformAdmin, req.params.id)));
router.post('/', handle((req) => service.createAdmin(req.platformAdmin, req.body), 'Admin created'));
router.patch('/:id/status', handle((req) => service.setAdminStatus(req.platformAdmin, req.params.id, req.body?.isActive), 'Saved'));
router.patch('/:id', handle((req) => service.updateAdmin(req.platformAdmin, req.params.id, req.body), 'Saved'));
router.delete('/:id', handle((req) => service.deleteAdmin(req.platformAdmin, req.params.id), 'Admin removed'));

export default router;
