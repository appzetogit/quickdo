const express = require('express');
const router = express.Router();
const { 
  getAllPlans, 
  getPlan, 
  createPlan, 
  updatePlan, 
  deletePlan 
} = require('../../controllers/adminControllers/workerPlanController');
const { authenticate } = require('../../middleware/authMiddleware');
const { isAdmin } = require('../../middleware/roleMiddleware');

// All routes here are protected and admin only
router.use(authenticate);
router.use(isAdmin);

router.route('/')
  .get(getAllPlans)
  .post(createPlan);

// Auto-renewing subscriptions (plan §3.2)
const recurringCtl = require('../../controllers/paymentControllers/recurringSubscriptionController');
router.get('/provider-subscriptions', recurringCtl.listProviderSubscriptions);
router.post('/:id/sync-razorpay', recurringCtl.syncPlanToRazorpay);

router.route('/:id')
  .get(getPlan)
  .put(updatePlan)
  .delete(deletePlan);

module.exports = router;
