const express = require('express');
const router = express.Router();
const { getAllPlans } = require('../../controllers/planController');

// GET /api/public/plans - Get all active plans
// Pass query param activeOnly=true by default or handle in controller
router.get('/plans', (req, res, next) => {
  req.query.activeOnly = 'true';
  next();
}, getAllPlans);

module.exports = router;
