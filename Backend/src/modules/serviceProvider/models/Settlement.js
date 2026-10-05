const mongoose = require('mongoose');

/**
 * Settlement Model
 * Tracks vendor settlements (payments to admin to clear negative balance)
 */
const settlementSchema = new mongoose.Schema({
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPVendor',
    required: false
  },
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPWorker',
    required: false
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  // Before settlement
  balanceBefore: {
    type: Number,
    required: true
  },
  // After settlement (should be closer to 0 or 0)
  balanceAfter: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['upi', 'bank_transfer', 'cash', 'other'],
    default: 'upi'
  },
  // Reference/Transaction ID from vendor's payment
  paymentReference: {
    type: String,
    default: null
  },
  // Screenshot or proof of payment (Cloudinary URL)
  paymentProof: {
    type: String,
    default: null
  },
  // Admin notes
  adminNotes: {
    type: String,
    default: null
  },
  // Vendor notes
  vendorNotes: {
    type: String,
    default: null
  },
  // Processed by admin
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPAdmin',
    default: null
  },
  processedAt: {
    type: Date,
    default: null
  },
  // Rejection reason
  rejectionReason: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Indexes
settlementSchema.index({ vendorId: 1, createdAt: -1 });
settlementSchema.index({ workerId: 1, createdAt: -1 });
settlementSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.models.SPSettlement || mongoose.model('SPSettlement', settlementSchema, 'sp_settlements');
