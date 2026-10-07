const mongoose = require('mongoose');

/**
 * Admin-configured commission for bookings above Settings.commissionThreshold
 * (SOW §8, plan §3.2). See utils/commission.js resolveCommission.
 *
 * Specificity: provider > category > global. When several active rules match
 * at the same scope, the most recently created one wins.
 *
 * Rules are never read back for a booking that already has a commissionSnapshot,
 * so editing or deleting a rule does not rewrite past bookings.
 */
const commissionRuleSchema = new mongoose.Schema({
  scope: {
    type: String,
    enum: ['global', 'category', 'provider'],
    required: true,
    index: true
  },
  // category scope: SPCategory _id. provider scope: SPVendor or SPWorker _id
  // (see providerType). global scope: null.
  refId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    index: true
  },
  providerType: {
    type: String,
    enum: ['vendor', 'worker', null],
    default: null
  },
  type: {
    type: String,
    enum: ['fixed', 'percentage'],
    required: true
  },
  // Rupees for 'fixed', 0-100 for 'percentage'.
  value: {
    type: Number,
    required: true,
    min: 0
  },
  active: {
    type: Boolean,
    default: true,
    index: true
  },
  validFrom: {
    type: Date,
    default: null
  },
  validTo: {
    type: Date,
    default: null
  },
  note: {
    type: String,
    default: '',
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPAdmin',
    default: null
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPAdmin',
    default: null
  }
}, {
  timestamps: true
});

commissionRuleSchema.index({ scope: 1, refId: 1, active: 1, createdAt: -1 });

module.exports = mongoose.models.SPCommissionRule || mongoose.model('SPCommissionRule', commissionRuleSchema, 'sp_commission_rules');
