const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPUser',
    default: null
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPVendor',
    default: null
  },
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPWorker',
    default: null
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPBooking',
    default: null
  },
  type: {
    type: String,
    enum: ['credit', 'debit', 'refund', 'withdrawal', 'commission', 'cash_collected', 'settlement', 'worker_payment', 'earnings_credit', 'tds_deduction', 'payment', 'platform_fee', 'convenience_fee', 'gst', 'penalty', 'worker_subscription', 'plan_purchase'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['wallet', 'razorpay', 'cash', 'bank_transfer', 'system', 'other', 'hand_to_hand', 'online', 'cash collected', 'Qr online'],
    default: 'wallet'
  },
  description: {
    type: String,
    required: true
  },
  referenceId: {
    type: String,  // Payment gateway reference
    default: null
  },
  balanceBefore: {
    type: Number,
    default: 0
  },
  balanceAfter: {
    type: Number,
    default: 0
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Index for faster queries
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ vendorId: 1, createdAt: -1 });
transactionSchema.index({ workerId: 1, createdAt: -1 });
transactionSchema.index({ bookingId: 1 });
transactionSchema.index({ type: 1, status: 1 });

module.exports = mongoose.models.SPTransaction || mongoose.model('SPTransaction', transactionSchema, 'sp_transactions');
