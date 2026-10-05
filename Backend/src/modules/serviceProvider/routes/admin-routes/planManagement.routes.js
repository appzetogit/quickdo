const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isAdmin } = require('../../middleware/roleMiddleware');
const {
  getAllPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan
} = require('../../controllers/planController');

// Routes
// GET /api/admin/plans - Get all plans (Publicly accessible for authenticated users)
router.get('/plans', authenticate, getAllPlans);

// GET /api/admin/plans/:id - Get single plan
router.get('/plans/:id', authenticate, getPlanById);

// POST /api/admin/plans - Create new plan
router.post('/plans', authenticate, isAdmin, createPlan);

// PUT /api/admin/plans/:id - Update plan
router.put('/plans/:id', authenticate, isAdmin, updatePlan);

// DELETE /api/admin/plans/:id - Delete plan
router.delete('/plans/:id', authenticate, isAdmin, deletePlan);

module.exports = router;
