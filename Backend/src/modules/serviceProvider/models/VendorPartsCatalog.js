const mongoose = require('mongoose');
const { SERVICE_STATUS } = require('../utils/constants');

/**
 * Vendor Parts Catalog Model
 * Represents parts that vendors can add to their bill
 */
const vendorPartsCatalogSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a part name'],
    trim: true,
    index: true
  },
  hsnCode: {
    type: String,
    trim: true,
    index: true
  },
  price: {
    type: Number,
    required: [true, 'Please provide a price'],
    min: 0
  },
  gstApplicable: {
    type: Boolean,
    default: true
  },
  gstPercentage: {
    type: Number,
    default: 18,
    min: 0
  },
  status: {
    type: String,
    enum: Object.values(SERVICE_STATUS),
    default: SERVICE_STATUS.ACTIVE,
    index: true
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPCategory',
    required: [true, 'Please select a category'],
    index: true
  },
  description: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.models.SPVendorPartsCatalog || mongoose.model('SPVendorPartsCatalog', vendorPartsCatalogSchema, 'sp_vendor_parts_catalogs');
