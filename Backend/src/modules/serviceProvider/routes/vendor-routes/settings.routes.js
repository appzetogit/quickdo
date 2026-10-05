const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isVendor } = require('../../middleware/roleMiddleware');
const { getSettings, updateSettings, updateBusinessHours } = require('../../controllers/vendorControllers/vendorSettingsController');

// Routes
router.get('/settings', authenticate, isVendor, getSettings);
router.put('/settings', authenticate, isVendor, updateSettings);
router.put('/business-hours', authenticate, isVendor, updateBusinessHours);

module.exports = router;
