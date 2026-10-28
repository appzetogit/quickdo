const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
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
    min: [1, 'Withdrawal amount must be at least 1']
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  requestDate: {
    type: Date,
    default: Date.now
  },
  processedDate: {
    type: Date
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPAdmin' // Admin ID
  },
  transactionReference: {
    type: String // Bank reference number or UPI ID used
  },
  adminNotes: {
    type: String
  },
  rejectionReason: {
    type: String
  },
  bankDetails: {
    accountNumber: String,
    ifscCode: String,
    accountHolderName: String,
    bankName: String,
    upiId: String
  },
  // TDS Details (calculated at approval)
  tdsRate: {
    type: Number,
    default: 2 // Default 2% TDS
  },
  tdsAmount: {
    type: Number,
    default: 0
  },
  platformFeeRate: {
    type: Number,
    default: 0
  },
  platformFeeAmount: {
    type: Number,
    default: 0
  },
  netAmount: {
    type: Number, // Amount actually transferred to vendor (amount - tdsAmount - platformFeeAmount)
    default: 0
  }
}, {
  timestamps: true
});

module.exports = mongoose.models.SPWithdrawal || mongoose.model('SPWithdrawal', withdrawalSchema, 'sp_withdrawals');
