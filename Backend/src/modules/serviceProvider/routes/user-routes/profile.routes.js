const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/authMiddleware');
const { isUser } = require('../../middleware/roleMiddleware');
const { getProfile, updateProfile, getCheckoutData, deleteProfile } = require('../../controllers/userControllers/userProfileController');

// Validation rules
const updateProfileValidation = [
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  body('email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('Please provide a valid email')
];

// Routes
router.get('/profile', authenticate, isUser, getProfile);
router.get('/checkout-data', authenticate, isUser, getCheckoutData);
router.put('/profile', authenticate, isUser, updateProfileValidation, updateProfile);
router.delete('/profile', authenticate, isUser, deleteProfile);

module.exports = router;

