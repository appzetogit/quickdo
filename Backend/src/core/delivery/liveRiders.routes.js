import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import { isSuperAdminLike } from '../admin/adminHierarchy.service.js';
import { listLiveRiders } from './liveRiders.js';

/**
 * Master > Delivery Management > Live Drivers: /v1/platform/live-riders.
 * Read-only. Every rider's name, phone and position, so super admins only.
 */
const router = express.Router();

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
    if (!isSuperAdminLike(admin)) return sendError(res, 403, 'Only a super admin can see live driver locations');
    return next();
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (req, res) => {
  try {
    return sendResponse(res, 200, 'OK', await listLiveRiders());
  } catch (err) {
    return sendError(res, 500, 'Could not load live drivers. Please try again.');
  }
});

export default router;
