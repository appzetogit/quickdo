const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { requireBookingParty } = require('../../middleware/bookingPartyMiddleware');
const {
  initiateCashCollection,
  initiateOnlineCollection,
  verifyOnlinePayment,
  confirmManualOnlinePayment,
  confirmCashCollection,
  customerConfirmPayment,
  getCashCollectionStatus
} = require('../../controllers/bookingControllers/cashCollectionController');

// All routes require authentication
router.use(authenticate);

// Vendor/Worker routes
// Each route is limited to the booking's own parties -- see bookingPartyMiddleware.
router.post('/:id/initiate', requireBookingParty('partner'), initiateCashCollection);
router.post('/:id/initiate-online', requireBookingParty('partner'), initiateOnlineCollection);
router.post('/:id/confirm', requireBookingParty('partner'), confirmCashCollection);

// Explicit verification route
router.post('/:id/verify-online', requireBookingParty('partner'), verifyOnlinePayment);
router.post('/:id/confirm-manual-online', requireBookingParty('partner'), confirmManualOnlinePayment);

// Customer route
router.post('/:id/customer-confirm', requireBookingParty('customer'), customerConfirmPayment);

// Status route (read-only check)
router.get('/:id/status', requireBookingParty('any'), getCashCollectionStatus);

module.exports = router;
