const mongoose = require('mongoose');

/**
 * Onboarding / profile fields shared by Vendor and Worker (plan §3.3).
 * Spread into each schema definition.
 */

const VERIFICATION_ITEMS = ['aadhaar', 'pan', 'gst', 'address', 'background'];
const VERIFICATION_STATUS = ['pending', 'verified', 'rejected'];

const verificationItem = () => ({
  status: { type: String, enum: VERIFICATION_STATUS, default: 'pending' },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SPAdmin', default: null },
  verifiedAt: { type: Date, default: null },
  note: { type: String, default: null, trim: true },
  // Room for an automated KYC source (DigiLocker or similar) later.
  source: { type: String, default: 'manual' }
});

const providerProfileFields = () => ({
  gst: {
    number: { type: String, trim: true, uppercase: true, default: null },
    document: { type: String, default: null },
    verified: { type: Boolean, default: false }
  },
  // Same shape as Withdrawal.bankDetails, so a saved account copies straight across.
  bankDetails: {
    accountNumber: String,
    ifscCode: String,
    accountHolderName: String,
    bankName: String,
    upiId: String
  },
  experienceYears: { type: Number, min: 0, max: 80, default: null },
  certifications: [{
    name: { type: String, required: true, trim: true },
    issuer: { type: String, trim: true, default: null },
    document: { type: String, default: null },
    expiresAt: { type: Date, default: null }
  }],
  // Category ObjectIds alongside the legacy name arrays (categories/service on
  // Vendor, serviceCategories on Worker). Writes keep both in step
  // (utils/categoryRefs.js); assignment matches either.
  categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SPCategory' }],
  verification: Object.fromEntries(VERIFICATION_ITEMS.map((k) => [k, verificationItem()]))
});

module.exports = { providerProfileFields, VERIFICATION_ITEMS, VERIFICATION_STATUS };
