import express from 'express';
import { authMiddleware } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../roles/role.middleware.js';
import { sendResponse, sendError } from '../../../utils/response.js';
import { loadAdminCached } from '../../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import { isRestrictedAdmin } from '../../admin/adminAccessPolicy.js';
import { requireFinancePermission } from '../../admin/requireFinancePermission.middleware.js';
import { listRefunds, processGatewayRefund } from '../refund.service.js';
import { Refund } from '../models/refund.model.js';

/**
 * Master > Refunds: /v1/platform/refunds -- every refund on the platform (food,
 * quick commerce, services), with Razorpay's own status for gateway refunds.
 *
 *   GET  /                ?status= &vertical= &gatewayStatus= &refundTo= &q= &page= &limit=
 *   POST /:id/retry       retry a FAILED gateway refund (same idempotency key, so it
 *                         can never refund twice)
 *
 * Superadmins only.
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
    if (isRestrictedAdmin(admin)) return sendError(res, 403, 'Only a superadmin can manage refunds here');
    req.platformAdmin = admin;
    return next();
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (req, res) => {
  try {
    return sendResponse(res, 200, 'OK', await listRefunds(req.query || {}));
  } catch (err) {
    return sendError(res, 500, 'Could not load refunds. Please try again.');
  }
});

router.post('/:id/retry', requireFinancePermission('REFUND_ISSUE'), async (req, res) => {
  try {
    const refund = await Refund.findById(req.params.id).lean();
    if (!refund) return sendError(res, 404, 'Refund not found');
    if (refund.refundTo !== 'gateway' || refund.status !== 'failed') {
      return sendError(res, 409, 'Only a failed refund to the original payment method can be retried');
    }
    const result = await processGatewayRefund(refund._id);
    return sendResponse(res, 200, 'Refund sent to the payment gateway', result);
  } catch (err) {
    return sendError(res, 502, err?.message || 'The gateway refused the refund');
  }
});

export default router;
