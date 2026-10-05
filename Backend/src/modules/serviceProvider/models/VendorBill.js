const mongoose = require('mongoose');
const { BILL_STATUS } = require('../utils/constants');

/**
 * Vendor Bill Model
 * ─────────────────
 * Single source of truth for the final bill and revenue split.
 * 
 * Revenue Model:
 *   Vendor gets 70% of total service BASE (excl GST)
 *   Vendor gets 10% of total parts BASE (excl GST)
 *   GST is NEVER paid to vendor — 100% retained by company
 *   Company gets remainder (30% service + 90% parts + 100% GST)
 */
const vendorBillSchema = new mongoose.Schema({
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPBooking',
    required: true,
    unique: true,
    index: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPVendor',
    required: false,
    index: true
  },
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPWorker',
    required: false,
    index: true
  },

  // ==========================================
  // 1. BILL LINE ITEMS (Input)
  // ==========================================

  /** Services — original booking service + vendor-added extras */
  services: [{
    catalogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPVendorServiceCatalog'
    },
    name: String,
    price: Number,            // Unit base price (excl GST)
    gstPercentage: Number,
    quantity: { type: Number, default: 1 },
    gstAmount: Number,        // price × qty × gst%
    total: Number,            // price × qty + gstAmount
    isOriginal: { type: Boolean, default: false } // true = from booking, false = vendor-added
  }],

  /** Parts used during the job */
  parts: [{
    catalogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPVendorPartsCatalog'
    },
    name: String,
    price: Number,            // Unit base price (excl GST)
    gstPercentage: Number,
    quantity: { type: Number, default: 1 },
    gstAmount: Number,
    total: Number
  }],

  /** Custom items added by vendor (ad-hoc parts/materials) */
  customItems: [{
    name: String,
    price: Number,            // Unit base price (excl GST)
    gstPercentage: Number,
    quantity: { type: Number, default: 1 },
    gstAmount: Number,
    total: Number
  }],

  // ==========================================
  // 2. CALCULATED BASE TOTALS
  // ==========================================

  // Service bases
  originalServiceBase: { type: Number, default: 0 },  // Σ(original service price×qty)
  vendorServiceBase: { type: Number, default: 0 },  // Σ(added service price×qty)
  totalServiceBase: { type: Number, default: 0 },  // original + vendor

  // Parts base
  totalPartsBase: { type: Number, default: 0 },  // Σ(part price×qty)

  // Visiting Charges
  visitingCharges: { type: Number, default: 0 },

  // Transport Charges
  transportCharges: { type: Number, default: 0 },

  // GST breakdown
  originalGST: { type: Number, default: 0 },
  vendorServiceGST: { type: Number, default: 0 },
  partsGST: { type: Number, default: 0 },
  totalGST: { type: Number, default: 0 },  // sum of all GST

  // ==========================================
  // 3. FINAL BILL (What user pays)
  // ==========================================

  grandTotal: {
    type: Number,
    required: true
    // = totalServiceBase + totalPartsBase + totalGST
  },

  // ==========================================
  // 4. REVENUE SPLIT (Internal — never shown to vendor before payment)
  // ==========================================

  /** Config snapshot — frozen at bill-generation time */
  payoutConfig: {
    serviceSplitPercentage: { type: Number, default: 70 },  // vendor gets 70%
    partsSplitPercentage: { type: Number, default: 10 },  // vendor gets 10%
    serviceGstPercentage: { type: Number, default: 18 },
    partsGstPercentage: { type: Number, default: 18 }
  },

  /** Vendor earnings (calculated on BASE prices, never on GST) */
  vendorServiceEarning: { type: Number, default: 0 },  // totalServiceBase × 70%
  vendorPartsEarning: { type: Number, default: 0 },  // totalPartsBase  × 10%
  vendorTotalEarning: { type: Number, default: 0 },  // service + parts earning

  /** Company revenue */
  companyRevenue: { type: Number, default: 0 },  // grandTotal − vendorTotalEarning

  // ==========================================
  // 5. STATUS & META
  // ==========================================

  status: {
    type: String,
    enum: Object.values(BILL_STATUS),
    default: BILL_STATUS.DRAFT,
    index: true
  },

  generatedAt: {
    type: Date,
    default: Date.now
  },

  paidAt: {
    type: Date,
    default: null
  },

  applyPartsGST: {
    type: Boolean,
    default: true
  },

  note: { type: String, default: null }

}, {
  timestamps: true
});

module.exports = mongoose.models.SPVendorBill || mongoose.model('SPVendorBill', vendorBillSchema, 'sp_vendor_bills');
