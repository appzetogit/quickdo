const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isAdmin } = require('../../middleware/roleMiddleware');
const { getHomeContent, updateHomeContent } = require('../../controllers/adminControllers/homeContentController');

// Get home content
router.get('/home-content', authenticate, isAdmin, getHomeContent);

// Update home content
router.put('/home-content', authenticate, isAdmin, updateHomeContent);

module.exports = router;

