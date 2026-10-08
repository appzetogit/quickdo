const mongoose = require('mongoose');

const workerSubscriptionPlanSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please provide a plan title'],
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  price: {
    type: Number,
    required: [true, 'Please provide a price'],
    min: 0
  },
  durationDays: {
    type: Number,
    required: [true, 'Please provide duration in days'],
    min: 1
  },
  features: [{
    type: String
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  // Who can buy this plan. Plans were worker-only; vendors subscribe too now.
  providerType: {
    type: String,
    enum: ['all', 'worker', 'vendor'],
    default: 'all'
  },
  // How the plan is paid (plan §3.2):
  //   one_time   a single Razorpay order per term (create-order / verify-payment)
  //   recurring  a Razorpay Subscription that renews itself (POST /subscription/recurring)
  //   both       the provider chooses
  billingMode: {
    type: String,
    enum: ['one_time', 'recurring', 'both'],
    default: 'one_time'
  },
  // Number of billing cycles a recurring subscription runs for (Razorpay's
  // total_count). null = services/recurringSubscription.js picks ~10 years.
  recurringTotalCount: {
    type: Number,
    default: null,
    min: 1
  },
  // The Razorpay plan this plan was last synced to. Razorpay plans cannot be
  // edited, so a change of price or duration creates a new one on next sync.
  razorpayPlan: {
    id: { type: String, default: null },
    amount: { type: Number, default: null }, // paise
    period: { type: String, default: null },
    interval: { type: Number, default: null },
    syncedAt: { type: Date, default: null }
  }
}, {
  timestamps: true
});

module.exports = mongoose.models.SPWorkerSubscriptionPlan || mongoose.model('SPWorkerSubscriptionPlan', workerSubscriptionPlanSchema, 'sp_worker_subscription_plans');

