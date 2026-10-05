const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/authMiddleware');
const { isAdmin } = require('../../middleware/roleMiddleware');
const {
  getAllBookings,
  getBookingById,
  cancelBooking,
  getBookingAnalytics
} = require('../../controllers/bookingControllers/adminBookingController');

// Validation rules
const cancelBookingValidation = [
  body('cancellationReason').optional().trim()
];

// Routes
router.get('/bookings', authenticate, isAdmin, getAllBookings);
router.get('/bookings/analytics', authenticate, isAdmin, getBookingAnalytics);
router.get('/bookings/:id', authenticate, isAdmin, getBookingById);
router.post('/bookings/:id/cancel', authenticate, isAdmin, cancelBookingValidation, cancelBooking);

module.exports = router;

