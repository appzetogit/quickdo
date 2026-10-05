const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  sendOTP,
  register,
  login,
  logout,
  verifyLogin
} = require('../../controllers/userControllers/userAuthController');
// ...

const { authenticate } = require('../../middleware/authMiddleware');
const { isUser } = require('../../middleware/roleMiddleware');

const sendOTPValidation = [
  body('phone').trim().notEmpty().withMessage('Phone number is required')
    .isLength({ min: 10, max: 10 }).withMessage('Phone number must be 10 digits')
];

const verifyLoginValidation = [
  body('phone').trim().notEmpty().withMessage('Phone number is required').isLength({ min: 10, max: 10 }).withMessage('Phone number must be 10 digits'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
];

const loginValidation = [
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('otp').trim().notEmpty().withMessage('OTP is required'),
  body('token').trim().notEmpty().withMessage('Verification Session ID is required')
];

// Relaxed register validation to support either OTP or verificationToken
const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('Please provide a valid email')
  // Phone/OTP/VerificationToken validation handled in controller logic for flexibility
];

// Routes
router.post('/send-otp', sendOTPValidation, sendOTP);
router.post('/verify-login', verifyLoginValidation, verifyLogin); // New Unified Entry
router.post('/register', registerValidation, register);
router.post('/login', loginValidation, login);
router.post('/refresh-token', require('../../controllers/userControllers/userAuthController').refreshToken);
router.post('/logout', authenticate, isUser, logout);

module.exports = router;

