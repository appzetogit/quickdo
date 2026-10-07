const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/authMiddleware');
const { isAdmin } = require('../../middleware/roleMiddleware');
// Money moves on approve / reject / limits: the platform finance permission check
// and its audit row (tolerant until FINANCE_PERMISSIONS_ENFORCED is on).
const { requireFinancePermission } = require('../../middleware/financePermission');
const {
  getVendorBalances,
  getVendorLedger,
  getPendingSettlements,
  approveSettlement,
  rejectSettlement,
  getSettlementHistory,
  getSettlementDashboard,
  blockVendor,
  unblockVendor,
  updateCashLimit,
  // Withdrawals
  getWithdrawalRequests,
  approveWithdrawal,
  rejectWithdrawal
} = require('../../controllers/adminControllers/settlementController');

// Dashboard summary
router.get('/dashboard', authenticate, isAdmin, getSettlementDashboard);

// Get all vendors with balances
router.get('/vendors', authenticate, isAdmin, getVendorBalances);

// Get specific vendor's ledger
router.get('/vendors/:vendorId/ledger', authenticate, isAdmin, getVendorLedger);

// Vendor management (blocking and limits)
router.post('/vendors/:vendorId/block', authenticate, isAdmin, blockVendor);
router.post('/vendors/:vendorId/unblock', authenticate, isAdmin, unblockVendor);
router.post('/vendors/:vendorId/cash-limit', authenticate, isAdmin, requireFinancePermission('CASH_LIMIT_SET'), updateCashLimit);

// Get all pending settlements
router.get('/pending', authenticate, isAdmin, getPendingSettlements);

// Get settlement history
router.get('/history', authenticate, isAdmin, getSettlementHistory);

// Approve settlement
router.post(
  '/:settlementId/approve',
  authenticate,
  isAdmin,
  requireFinancePermission('WITHDRAWAL_DECIDE'),
  [body('adminNotes').optional().isString()],
  approveSettlement
);

// Reject settlement
router.post(
  '/:settlementId/reject',
  authenticate,
  isAdmin,
  requireFinancePermission('WITHDRAWAL_DECIDE'),
  [body('rejectionReason').notEmpty().withMessage('Rejection reason is required')],
  rejectSettlement
);

// Withdrawals
router.get('/withdrawals', authenticate, isAdmin, getWithdrawalRequests);
router.post('/withdrawals/:withdrawalId/approve', authenticate, isAdmin, requireFinancePermission('WITHDRAWAL_DECIDE'), approveWithdrawal);
router.post('/withdrawals/:withdrawalId/reject', authenticate, isAdmin, requireFinancePermission('WITHDRAWAL_DECIDE'), rejectWithdrawal);

module.exports = router;
