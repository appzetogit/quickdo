const WorkerSubscriptionPlan = require('../../models/WorkerSubscriptionPlan');
const Settings = require('../../models/Settings');

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
    // Price defaults to the configured monthly subscription (Settings.subscriptionPrice,
    // seeded at ₹1,000 per D7) instead of a literal.
    const body = { ...req.body };
    delete body.razorpayPlan; // written only by the Razorpay sync
    if (body.price === undefined || body.price === null || body.price === '') {
      const settings = await Settings.findOne({ type: 'global' }).select('subscriptionPrice').lean();
      body.price = settings?.subscriptionPrice ?? 1000;
    }
    const plan = await WorkerSubscriptionPlan.create(body);
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
    // razorpayPlan is written only by the sync; a changed price or duration is
    // picked up on the next sync (a new Razorpay plan; running subscriptions
    // stay on the old one, as Razorpay plans cannot be edited).
    const { razorpayPlan, ...changes } = req.body || {};
    const plan = await WorkerSubscriptionPlan.findByIdAndUpdate(req.params.id, changes, {
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
