const mongoose = require('mongoose');

/**
 * BookingRequest Model
 * Tracks individual vendor alerts for bookings
 * Enables retry logic, delivery confirmation, and analytics
 */
const bookingRequestSchema = new mongoose.Schema({
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPBooking',
    required: true,
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
  status: {
    type: String,
    enum: ['PENDING', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
    default: 'PENDING',
    index: true
  },
  wave: {
    type: Number,
    default: 1
  },
  distance: {
    type: Number, // in km
    default: null
  },
  // Timestamps
  sentAt: {
    type: Date,
    default: Date.now
  },
  viewedAt: {
    type: Date,
    default: null
  },
  respondedAt: {
    type: Date,
    default: null
  },
  expiresAt: {
    type: Date,
    default: null
  },
  // Delivery tracking
  socketDelivered: {
    type: Boolean,
    default: false
  },
  pushDelivered: {
    type: Boolean,
    default: false
  },
  // Response reason (for rejections)
  rejectReason: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Compound indexes for common queries
bookingRequestSchema.index({ bookingId: 1, vendorId: 1, workerId: 1 });
bookingRequestSchema.index({ vendorId: 1, status: 1 });
bookingRequestSchema.index({ workerId: 1, status: 1 });
bookingRequestSchema.index({ bookingId: 1, status: 1 });
bookingRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index for auto-expiry

module.exports = mongoose.models.SPBookingRequest || mongoose.model('SPBookingRequest', bookingRequestSchema, 'sp_booking_requests');
