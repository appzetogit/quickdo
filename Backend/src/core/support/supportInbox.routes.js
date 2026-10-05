import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import * as inbox from './supportInbox.service.js';

/**
 * Master > Help & Support: /v1/platform/support.
 *
 * Open to any admin, like Admin Accounts: what each one sees and may answer is
 * decided per ticket by the shared `support` permission for that ticket's
 * service (supportInbox.service.js), so a support sub-admin works here without
 * owning the rest of Master.
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

const handle = (fn, message = 'OK') => async (req, res) => {
  try {
    return sendResponse(res, 200, message, await fn(req));
  } catch (err) {
    const status = err?.statusCode || err?.status || 500;
    return sendError(res, status, status >= 500 ? 'Could not complete that. Please try again.' : err.message);
  }
};

router.get('/tickets', handle((req) => inbox.listInbox(req.platformAdmin, req.query)));
router.get('/stats', handle((req) => inbox.inboxStats(req.platformAdmin)));
router.get('/tickets/:source/:id', handle((req) => inbox.getInboxTicket(req.platformAdmin, req.params.source, req.params.id)));
router.patch('/tickets/:source/:id', handle((req) => inbox.updateInboxTicket(req.platformAdmin, req.params.source, req.params.id, req.body), 'Saved'));

export default router;
