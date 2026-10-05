const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isUser } = require('../../middleware/roleMiddleware');

// Placeholder routes - to be implemented
router.get('/', authenticate, isUser, (req, res) => {
  res.json({ success: true, message: 'User booking route' });
});

module.exports = router;

