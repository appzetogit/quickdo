const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/authMiddleware');
const { isWorker } = require('../../middleware/roleMiddleware');
const { getProfile, updateProfile, updateLocation, toggleOnline, deleteProfile } = require('../../controllers/workerControllers/workerProfileController');

// Validation rules
const updateProfileValidation = [
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  body('serviceCategory').optional().trim().isLength({ max: 50 }).withMessage('Service category must be less than 50 characters'),
  body('skills').optional().isArray().withMessage('Skills must be an array')
];

// Routes
router.get('/profile', authenticate, isWorker, getProfile);
router.put('/profile', authenticate, isWorker, updateProfileValidation, updateProfile);
router.delete('/profile', authenticate, isWorker, deleteProfile);
router.put('/profile/location', authenticate, isWorker, updateLocation);
router.post('/toggle-online', authenticate, isWorker, toggleOnline);

module.exports = router;

