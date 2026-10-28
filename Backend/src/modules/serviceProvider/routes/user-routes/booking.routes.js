const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/authMiddleware');
const { isUser } = require('../../middleware/roleMiddleware');
const {
  createBooking,
  getUserBookings,
  getBookingById,
  cancelBooking,
  rescheduleBooking,
  addReview,
  getUserRatings
} = require('../../controllers/bookingControllers/userBookingController');

// Validation rules
const createBookingValidation = [
  body('serviceId').isMongoId().withMessage('Valid service ID is required'),
  body('vendorId').optional().custom((value) => {
    if (value && !/^[0-9a-fA-F]{24}$/.test(value)) {
      throw new Error('Valid vendor ID is required');
    }
    return true;
  }),
  body('address.addressLine1').trim().notEmpty().withMessage('Address line 1 is required'),
  body('address.city').trim().notEmpty().withMessage('City is required'),
  body('address.state').trim().notEmpty().withMessage('State is required'),
  body('address.pincode').trim().notEmpty().withMessage('Pincode is required'),
  body('scheduledDate').isISO8601().withMessage('Valid scheduled date is required'),
  body('scheduledTime').trim().notEmpty().withMessage('Scheduled time is required'),
  body('timeSlot.start').trim().notEmpty().withMessage('Time slot start is required'),
  body('timeSlot.end').trim().notEmpty().withMessage('Time slot end is required')
];

const cancelBookingValidation = [
  body('cancellationReason').optional().trim()
];

const rescheduleBookingValidation = [
  body('scheduledDate').isISO8601().withMessage('Valid scheduled date is required'),
  body('scheduledTime').trim().notEmpty().withMessage('Scheduled time is required'),
  body('timeSlot.start').trim().notEmpty().withMessage('Time slot start is required'),
  body('timeSlot.end').trim().notEmpty().withMessage('Time slot end is required')
];

const addReviewValidation = [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('review').optional().trim(),
  body('reviewImages').optional().isArray().withMessage('Review images must be an array')
];

// Routes
router.get('/ratings', authenticate, isUser, getUserRatings);
router.post('/', authenticate, isUser, createBookingValidation, createBooking);
router.get('/', authenticate, isUser, getUserBookings);
router.get('/:id', authenticate, isUser, getBookingById);
router.post('/:id/cancel', authenticate, isUser, cancelBookingValidation, cancelBooking);
router.put('/:id/reschedule', authenticate, isUser, rescheduleBookingValidation, rescheduleBooking);
router.post('/:id/review', authenticate, isUser, addReviewValidation, addReview);

module.exports = router;

