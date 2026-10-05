import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import { platformPnl } from './platformPnl.service.js';

/**
 * Master > Report Management > Platform Earnings: /v1/platform/pnl.
 *
 * Read-only. Each service's figures are shown under that service's Reports
 * permission (platformPnl.service.js).
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
    req.platformAdmin = admin;
    return next();
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (req, res) => {
  try {
    return sendResponse(res, 200, 'OK', await platformPnl(req.platformAdmin, req.query));
  } catch (err) {
    const status = err?.statusCode || err?.status || 500;
    return sendError(res, status, status >= 500 ? 'Could not build the report. Please try again.' : err.message);
  }
});

export default router;
