const express = require('express');
const router = express.Router();
const WorkerSubscriptionPlan = require('../../models/WorkerSubscriptionPlan');
const Vendor = require('../../models/Vendor');
const { authenticate } = require('../../middleware/authMiddleware');
const { isVendor } = require('../../middleware/roleMiddleware');
const { createSubscriptionOrder, verifySubscriptionPayment } = require('../../controllers/paymentControllers/subscriptionPaymentController');
const { isSubscriptionActive } = require('../../utils/commission');

// Vendor side of the provider subscription (SOW §8). Same controller as the
// worker routes; it picks the Vendor model from the caller's role. When
// Settings.bookingModel is 'vendor', an active subscription gates job
// assignment (services/locationService.js).

// POST /api/vendors/subscription/create-order → Create Razorpay order
router.post('/create-order', authenticate, isVendor, createSubscriptionOrder);

// POST /api/vendors/subscription/verify-payment → Verify & activate
router.post('/verify-payment', authenticate, isVendor, verifySubscriptionPayment);

/**
 * GET /api/vendors/subscription/plans
 * Active plans a vendor can buy
 */
router.get('/plans', authenticate, isVendor, async (req, res) => {
  try {
    const plans = await WorkerSubscriptionPlan.find({ isActive: true, providerType: { $in: ['all', 'vendor', null] } }).sort({ price: 1 });
    res.status(200).json({ success: true, data: plans });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

/**
 * GET /api/vendors/subscription/status
 */
router.get('/status', authenticate, isVendor, async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.user.id).select('subscription').lean();
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    res.status(200).json({
      success: true,
      data: {
        isActive: isSubscriptionActive(vendor.subscription),
        expiryDate: vendor.subscription?.expiryDate || null,
        planName: vendor.subscription?.planName || null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

module.exports = router;
