const mongoose = require('mongoose');

/**
 * One Razorpay Subscription (auto-renewing provider plan) per row.
 *
 * The provider's own `subscription` sub-document stays the source of truth for
 * "may this provider receive jobs" (isActive + expiryDate); this row tracks the
 * gateway side: which Razorpay subscription, its status, and which charges have
 * already been applied. Webhooks (subscription.*) look it up by
 * razorpaySubscriptionId; see services/recurringSubscription.js.
 */
const STATUSES = ['created', 'authenticated', 'active', 'pending', 'halted', 'paused', 'cancelled', 'completed', 'expired'];
const TERMINAL_STATUSES = ['cancelled', 'completed', 'expired'];

const providerSubscriptionSchema = new mongoose.Schema({
  providerType: { type: String, enum: ['worker', 'vendor'], required: true },
  providerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SPWorkerSubscriptionPlan', required: true },
  planTitle: { type: String, default: '' },
  razorpaySubscriptionId: { type: String, required: true, unique: true },
  razorpayPlanId: { type: String, default: null },
  status: { type: String, enum: STATUSES, default: 'created' },
  shortUrl: { type: String, default: null },
  totalCount: { type: Number, default: null },
  paidCount: { type: Number, default: 0 },
  chargedPaymentIds: [{ type: String }],
  currentStart: { type: Date, default: null },
  currentEnd: { type: Date, default: null },
  cancelAtCycleEnd: { type: Boolean, default: false },
  cancelRequestedAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  lastEvent: { type: String, default: null },
  lastEventAt: { type: Date, default: null },
  history: [{
    _id: false,
    event: String,
    at: Date,
    paymentId: { type: String, default: null }
  }]
}, { timestamps: true });

providerSubscriptionSchema.index({ providerType: 1, providerId: 1, createdAt: -1 });

const ProviderSubscription = mongoose.models.SPProviderSubscription ||
  mongoose.model('SPProviderSubscription', providerSubscriptionSchema, 'sp_provider_subscriptions');

module.exports = ProviderSubscription;
module.exports.STATUSES = STATUSES;
module.exports.TERMINAL_STATUSES = TERMINAL_STATUSES;
