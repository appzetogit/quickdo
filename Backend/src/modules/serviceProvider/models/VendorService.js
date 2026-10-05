const mongoose = require('mongoose');

const vendorServiceSchema = new mongoose.Schema({
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPVendor',
    required: true,
    index: true
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPService',
    required: true,
    index: true
  },
  customPrice: {
    type: Number,
    default: null
  },
  customDescription: {
    type: String,
    default: null
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  customImages: [{
    type: String
  }],
  customDuration: {
    type: Number, // In minutes
    default: null
  }
}, {
  timestamps: true
});

// Ensure a vendor can only have one entry per service
vendorServiceSchema.index({ vendorId: 1, serviceId: 1 }, { unique: true });

module.exports = mongoose.models.SPVendorService || mongoose.model('SPVendorService', vendorServiceSchema, 'sp_vendor_services');
