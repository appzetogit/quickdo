const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isWorker } = require('../../middleware/roleMiddleware');
const { getDashboardStats } = require('../../controllers/workerControllers/workerDashboardController');

// Routes
router.get('/stats', authenticate, isWorker, getDashboardStats);

module.exports = router;
