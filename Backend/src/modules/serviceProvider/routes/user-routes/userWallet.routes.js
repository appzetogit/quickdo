const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/authMiddleware');
const { isUser } = require('../../middleware/roleMiddleware');
const {
  getWalletBalance,
  addMoneyToWallet,
  verifyWalletTopup,
  getWalletTransactions
} = require('../../controllers/userControllers/userWalletController');

// Validation rules
const addMoneyValidation = [
  body('amount').isFloat({ min: 100 }).withMessage('Minimum amount is ₹100')
];

const verifyTopupValidation = [
  body('razorpay_order_id').trim().notEmpty().withMessage('Order ID is required'),
  body('razorpay_payment_id').trim().notEmpty().withMessage('Payment ID is required'),
  body('razorpay_signature').trim().notEmpty().withMessage('Signature is required'),
  // The credited amount is read back from Razorpay, NOT from here — trusting the
  // client's number was exploitable. This stays only as a dev-mock fallback for
  // local runs with no Razorpay credentials, and is ignored in production.
  body('amount').optional().isFloat({ min: 1 }).withMessage('Amount must be a positive number')
];

// Routes
router.get('/balance', authenticate, isUser, getWalletBalance);
router.post('/add-money', authenticate, isUser, addMoneyValidation, addMoneyToWallet);
router.post('/verify-topup', authenticate, isUser, verifyTopupValidation, verifyWalletTopup);
router.get('/transactions', authenticate, isUser, getWalletTransactions);

module.exports = router;

