

const mongoose = require('mongoose');
const { SERVICE_STATUS } = require('../utils/constants');

/**
 * User Service Model
 * Represents individual services strictly under a Brand
 * separate from internal services or global services
 */
const userServiceSchema = new mongoose.Schema({
  brandId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPBrand',
    required: [true, 'Please provide a brand ID'],
    index: true
  },
  // Added based on user request "category -> brand -> service", 
  // ensuring we can link if needed, though brand already links to category.
  // Making it optional for now to avoid breaking existing flows if not sent.
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPCategory',
    index: true
  },
  title: {
    type: String,
    required: [true, 'Please provide a service title'],
    trim: true,
    index: true
  },
  // Removed slug as it is not needed for internal modal-based services
  iconUrl: {
    type: String,
    default: null
  },
  basePrice: {
    type: Number,
    required: [true, 'Base price is required'],
    min: [0, 'Price cannot be negative']
  },
  gstPercentage: {
    type: Number,
    required: [true, 'GST percentage is required'],
    min: 0,
    default: 18
  },
  pricingUnit: {
    type: String,
    trim: true,
    default: ''
  },
  status: {
    type: String,
    enum: Object.values(SERVICE_STATUS),
    default: SERVICE_STATUS.ACTIVE,
    index: true
  },
  description: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Compound index to ensure slug is unique PER BRAND
// Index for faster queries
userServiceSchema.index({ brandId: 1, categoryId: 1 });

module.exports = mongoose.models.SPUserService || mongoose.model('SPUserService', userServiceSchema, 'sp_user_services');
