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
  }
}, {
  timestamps: true
});

module.exports = mongoose.models.SPWorkerSubscriptionPlan || mongoose.model('SPWorkerSubscriptionPlan', workerSubscriptionPlanSchema, 'sp_worker_subscription_plans');

