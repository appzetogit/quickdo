const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isAdmin } = require('../../middleware/roleMiddleware');
const {
  getDashboardStats,
  getRevenueAnalytics,
  getBookingTrends,
  getUserGrowthMetrics
} = require('../../controllers/adminControllers/adminDashboardController');

// Routes
router.get('/dashboard/stats', authenticate, isAdmin, getDashboardStats);
router.get('/dashboard/revenue', authenticate, isAdmin, getRevenueAnalytics);
router.get('/dashboard/bookings/trends', authenticate, isAdmin, getBookingTrends);
router.get('/dashboard/users/growth', authenticate, isAdmin, getUserGrowthMetrics);

module.exports = router;

