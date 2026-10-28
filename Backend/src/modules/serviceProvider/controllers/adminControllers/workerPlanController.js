const WorkerSubscriptionPlan = require('../../models/WorkerSubscriptionPlan');

/**
 * Get all worker subscription plans
 */
exports.getAllPlans = async (req, res) => {
  try {
    const plans = await WorkerSubscriptionPlan.find().sort({ price: 1 });
    res.status(200).json({
      success: true,
      count: plans.length,
      data: plans
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

/**
 * Get single plan
 */
exports.getPlan = async (req, res) => {
  try {
    const plan = await WorkerSubscriptionPlan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }
    res.status(200).json({ success: true, data: plan });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Create new plan
 */
exports.createPlan = async (req, res) => {
  try {
    const plan = await WorkerSubscriptionPlan.create(req.body);
    res.status(201).json({
      success: true,
      data: plan
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Update plan
 */
exports.updatePlan = async (req, res) => {
  try {
    const plan = await WorkerSubscriptionPlan.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    res.status(200).json({
      success: true,
      data: plan
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Delete plan
 */
exports.deletePlan = async (req, res) => {
  try {
    const plan = await WorkerSubscriptionPlan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    await plan.deleteOne();
    res.status(200).json({
      success: true,
      message: 'Plan deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};
