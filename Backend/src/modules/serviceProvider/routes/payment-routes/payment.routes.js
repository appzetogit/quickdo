const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/authMiddleware');
const { isUser, isAdmin } = require('../../middleware/roleMiddleware');
const {
  createPaymentOrder,
  verifyPaymentWebhook,
  processWalletPayment,
  processRefund,
  getPaymentHistory,
  confirmPayAtHome,
  createPlanOrder,
  verifyPlanPayment,
  getUpgradeDetails
} = require('../../controllers/paymentControllers/paymentController');

// Validation rules
const createOrderValidation = [
  body('bookingId').isMongoId().withMessage('Valid booking ID is required')
];

const verifyPaymentValidation = [
  body('razorpay_order_id').trim().notEmpty().withMessage('Order ID is required'),
  body('razorpay_payment_id').trim().notEmpty().withMessage('Payment ID is required'),
  body('razorpay_signature').trim().notEmpty().withMessage('Signature is required')
];

const walletPaymentValidation = [
  body('bookingId').isMongoId().withMessage('Valid booking ID is required')
];

const refundValidation = [
  body('bookingId').isMongoId().withMessage('Valid booking ID is required'),
  body('amount').optional().isFloat({ min: 0 }).withMessage('Amount must be a positive number')
];

// Routes
router.post('/create-order', authenticate, isUser, createOrderValidation, createPaymentOrder);
router.post('/verify', authenticate, isUser, verifyPaymentValidation, verifyPaymentWebhook);
router.post('/wallet', authenticate, isUser, walletPaymentValidation, processWalletPayment);
// Refunds move money out of the platform — admin only, never the customer
router.post('/refund', authenticate, isAdmin, refundValidation, processRefund);
router.post('/pay-at-home', authenticate, isUser, walletPaymentValidation, confirmPayAtHome);
router.get('/history', authenticate, isUser, getPaymentHistory);
router.post('/plan/create-order', authenticate, isUser, createPlanOrder);
router.post('/plan/verify', authenticate, isUser, verifyPlanPayment);
router.get('/plan/upgrade-details', authenticate, isUser, getUpgradeDetails);

module.exports = router;

