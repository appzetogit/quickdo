import express from 'express';
import {
    getPaymentHistoryController,
    getOrderTransactionsController,
    getUserWalletBalanceController,
    getUserWalletTransactionsController,
    getRestaurantWalletController,
    getDeliveryWalletController,
    getAdminWalletController,
    getAdminFinanceSummaryController,
    listSettlementsController,
    createSettlementController,
    processSettlementController,
    listRefundsController,
    getRefundsByOrderController
} from './payment.controller.js';
import { requireRoles } from '../roles/role.middleware.js';
import { requireFinancePermission } from '../admin/requireFinancePermission.middleware.js';

const router = express.Router();

/*
 * Mounted as /v1/food/payments and /v1/qc/payments behind authMiddleware ONLY --
 * which proves someone is logged in, not who. Every route below trusted that:
 *
 *   - /admin/settlements (create, process): any customer, restaurant or rider could
 *     create a payout for any entity and amount from the request body, then process
 *     it, debiting that entity's wallet.
 *   - /restaurant/:id/wallet and /delivery/:id/wallet fell back to the URL id,
 *     because req.user never carries restaurantId/deliveryPartnerId: anyone could
 *     read anyone's wallet.
 *   - /orders/:orderId/* returned any order's payments, transactions and refunds.
 *
 * Nothing in the frontends calls this router and the production API log has no
 * requests to it, so tightening it breaks no flow.
 */
const selfOrAdmin = (role, param) => (req, res, next) => {
    if (req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN') return next();
    if (req.user?.role === role && String(req.user.userId) === String(req.params[param])) return next();
    return res.status(403).json({ success: false, message: 'Forbidden: not your wallet' });
};

// ─── Payment history for an order (user sees their payment trail) ───
// Admin only: nothing here checks the order belongs to the caller.
router.get('/orders/:orderId/payments', requireRoles('ADMIN'), getPaymentHistoryController);
router.get('/orders/:orderId/transactions', requireRoles('ADMIN'), getOrderTransactionsController);
router.get('/orders/:orderId/refunds', requireRoles('ADMIN'), getRefundsByOrderController);

// ─── User wallet (new transaction-based endpoints) ───
router.get('/wallet/balance', getUserWalletBalanceController);
router.get('/wallet/transactions', getUserWalletTransactionsController);

// ─── Restaurant wallet ───
router.get('/restaurant/:restaurantId/wallet', selfOrAdmin('RESTAURANT', 'restaurantId'), getRestaurantWalletController);

// ─── Delivery partner wallet ───
router.get('/delivery/:deliveryPartnerId/wallet', selfOrAdmin('DELIVERY_PARTNER', 'deliveryPartnerId'), getDeliveryWalletController);

// ─── Admin / Finance ───
router.use('/admin', requireRoles('ADMIN'));
router.get('/admin/wallet', getAdminWalletController);
router.get('/admin/finance/summary', getAdminFinanceSummaryController);
router.get('/admin/settlements', listSettlementsController);
// Payouts move money: the finance permission check (tolerant until enforced) and its audit trail.
router.post('/admin/settlements', requireFinancePermission('WITHDRAWAL_DECIDE'), createSettlementController);
router.post('/admin/settlements/:id/process', requireFinancePermission('WITHDRAWAL_DECIDE'), processSettlementController);
router.get('/admin/refunds', listRefundsController);

export default router;
