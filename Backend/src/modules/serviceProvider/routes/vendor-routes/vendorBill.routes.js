const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isVendor } = require('../../middleware/roleMiddleware');
const {
  createOrUpdateBill,
  getBillByBookingId
} = require('../../controllers/vendorControllers/vendorBillController');

// Bill Routes
router.post('/bookings/:bookingId/bill', authenticate, isVendor, createOrUpdateBill);
router.get('/bookings/:bookingId/bill', authenticate, isVendor, getBillByBookingId);

module.exports = router;
