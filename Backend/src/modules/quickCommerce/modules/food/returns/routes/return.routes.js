import express from 'express';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../../../../core/roles/role.middleware.js';
// Master's platform-wide ledger, shared by every vertical.
import { idempotency } from '../../../../../../middleware/idempotency.js';
import * as ctrl from '../controllers/return.controller.js';
import { requireServiceAccess } from '../../../../../../core/roles/serviceAccess.middleware.js';
import { enforceAdminAccess } from '../../../../../../core/admin/enforceAdminAccess.middleware.js';

/**
 * Quick-commerce returns.
 *
 * Three audiences on one router, each gated by role at the route rather than in a
 * controller: a customer files and tracks, an admin decides and pays, a rider
 * collects. Mounted at /v1/qc/returns.
 */
const router = express.Router();

// ── Admin ──────────────────────────────────────────────────────────────────────
// Registered before the customer's `/:returnId` routes so `/admin` is never
// swallowed as a return id.
// Admins of THIS vertical, with the right section: returns are Orders, the refund
// is Wallets & payouts. Any admin token from any module used to pass here.
const qcAdmin = [authMiddleware, requireRoles('ADMIN'), requireServiceAccess('quickCommerce'), enforceAdminAccess('quickCommerce', (path) => (/\/refund$/.test(path) ? 'wallet' : 'orders'))];
router.get('/admin', ...qcAdmin, ctrl.listReturnsAdminController);
router.patch('/admin/:returnId/decision', ...qcAdmin, ctrl.decideReturnAdminController);
router.patch('/admin/:returnId/pickup', ...qcAdmin, ctrl.schedulePickupAdminController);
router.patch('/admin/:returnId/inspect', ...qcAdmin, ctrl.inspectReturnAdminController);
// The only route here that moves money. refundReturn() already short-circuits when
// refundId is set, so a replay is a no-op — the ledger adds protection against two
// concurrent clicks racing past that check before either has written it.
router.patch(
    '/admin/:returnId/refund',
    ...qcAdmin,
    idempotency(),
    ctrl.refundReturnAdminController,
);

// ── Delivery partner ───────────────────────────────────────────────────────────
router.patch(
    '/partner/:returnId/collected',
    authMiddleware,
    requireRoles('DELIVERY_PARTNER'),
    ctrl.markPickedUpController,
);

// ── Customer ───────────────────────────────────────────────────────────────────
router.get('/orders/:orderId/returnable', authMiddleware, requireRoles('USER'), ctrl.getReturnableItemsController);
router.post('/orders/:orderId', authMiddleware, requireRoles('USER'), ctrl.requestReturnController);
router.get('/', authMiddleware, requireRoles('USER'), ctrl.listMyReturnsController);
router.get('/:returnId', authMiddleware, requireRoles('USER'), ctrl.getMyReturnController);
router.patch('/:returnId/cancel', authMiddleware, requireRoles('USER'), ctrl.cancelMyReturnController);

export default router;
