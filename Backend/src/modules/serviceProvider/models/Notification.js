const mongoose = require('mongoose');

/**
 * Notification Model
 * Stores notifications for users, vendors, workers, and admins
 */
const notificationSchema = new mongoose.Schema({
  // Recipient Information
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPUser',
    default: null,
    index: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPVendor',
    default: null,
    index: true
  },
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPWorker',
    default: null,
    index: true
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPAdmin',
    default: null,
    index: true
  },
  // Notification Type
  type: {
    type: String,
    required: true,
    enum: [
      'booking_created',
      'booking_request',      // New booking request to vendor
      'booking_requested',    // New booking created confirmation to user
      'booking_accepted',     // Vendor accepted booking
      'booking_confirmed',
      'booking_cancelled',
      'booking_completed',
      'booking_rejected',
      'booking_rescheduled',
      'job_accepted',
      'job_rejected',
      'job_cancelled',
      'new_job_available',
      'finding_professional',
      'worker_assigned',
      'worker_started',
      'worker_completed',
      'work_done',
      'work_completed',       // Added for vendor self completion
      'vendor_reached',
      'journey_started',
      'visit_verified',
      'payment_received',
      'payment_success',
      'payment_failed',
      'payment_refunded',
      'review_submitted',
      'vendor_approved',
      'vendor_rejected',
      'wallet_topup',
      'payout_requested',
      'payout_processed',
      'scrap_listed',
      'new_scrap_added',
      'scrap_accepted',
      'scrap_completed',
      'vendor_withdrawal_request',

      // Types the controllers actually emit that were missing here. A value
      // absent from this enum does not raise anything to the caller:
      // createNotification catches the validation error and logs it, so the
      // notification is simply dropped. That silently cost the customer the
      // 'professional accepted' and 'work started' alerts, and cost workers
      // and vendors every earnings and withdrawal alert.
      'worker_accepted',
      'worker_approved',
      'work_started',
      'earnings_credited',
      'withdrawal_requested',
      'withdrawal_approved',
      'withdrawal_rejected',
      'vendor_approval_request',
      'vendor_settlement_request',
      'vendor_cash_limit_exceeded',

      'general'
    ],
    index: true
  },
  // Notification Content
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  // Related Entity (optional)
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  relatedType: {
    type: String,
    enum: ['booking', 'payment', 'user', 'vendor', 'worker', 'service', 'scrap', 'withdrawal'],
    default: null
  },
  // Notification Status
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  readAt: {
    type: Date,
    default: null
  },
  // Additional Data
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes for faster queries
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ vendorId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ workerId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ adminId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.models.SPNotification || mongoose.model('SPNotification', notificationSchema, 'sp_notifications');

