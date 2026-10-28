const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isVendor } = require('../../middleware/roleMiddleware');

// Placeholder routes - to be implemented
router.get('/', authenticate, isVendor, (req, res) => {
  res.json({ success: true, message: 'Vendor booking route' });
});

module.exports = router;

