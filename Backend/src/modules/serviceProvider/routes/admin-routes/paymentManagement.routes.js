const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isAdmin } = require('../../middleware/roleMiddleware');
const {
  getFinanceOverview,
  getGSTRReport,
  getTDSReport,
  getCODReport,
  getPaymentTransactions,
  getRevenueBreakdown
} = require('../../controllers/adminControllers/reportController');

// All routes require authentication and admin role
router.use(authenticate, isAdmin);

// Dashboard overview - /api/admin/payments/overview
router.get('/payments/overview', getFinanceOverview);

// Payment Reports - /api/admin/payments/reports
router.get('/payments/reports', getPaymentTransactions);
router.get('/payments/reports/gst', getGSTRReport);
router.get('/payments/reports/tds', getTDSReport);
router.get('/payments/reports/cod', getCODReport);
router.get('/payments/reports/revenue-breakdown', getRevenueBreakdown);

module.exports = router;
