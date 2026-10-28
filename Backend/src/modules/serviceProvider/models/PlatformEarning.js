const mongoose = require('mongoose');

const platformEarningSchema = new mongoose.Schema({
  date: {
    type: String,
    required: true,
    unique: true,
    index: true
  }, // Format: 'YYYY-MM-DD'
  totalRevenue: { type: Number, default: 0 },
  totalBookings: { type: Number, default: 0 },
  totalGST: { type: Number, default: 0 },
  totalTDS: { type: Number, default: 0 },
  platformCommission: { type: Number, default: 0 },
  totalWorkerSubscriptionRevenue: { type: Number, default: 0 },
  vendorEarnings: { type: Number, default: 0 },

  // Vendor-to-Platform Payments (Clearing negative balance)
  totalSettlementReceived: { type: Number, default: 0 }, // 'total settlement done'
  totalPendingSettlement: { type: Number, default: 0 }, // snapshot: total negative vendor balances or pending requests

  // Platform-to-Vendor Payments (Payouts)
  totalAmountPaidToVendors: { type: Number, default: 0 }, // 'total amt paid to vendors'
  totalPendingAmountToVendors: { type: Number, default: 0 } // snapshot: total positive vendor balances or pending payouts
}, { timestamps: true });

module.exports = mongoose.models.SPPlatformEarning || mongoose.model('SPPlatformEarning', platformEarningSchema, 'sp_platform_earnings');
