const mongoose = require('mongoose');
const { SERVICE_STATUS } = require('../utils/constants');

/**
 * Brand Model (Previously Service)
 * Represents Brands (e.g., specific service providers or types under a category)
 */
const brandSchema = new mongoose.Schema({
  // Frontend matching fields
  title: {
    type: String,
    required: [true, 'Please provide a brand title'],
    trim: true,
    index: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true
  },
  categoryIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPCategory',
    required: [true, 'Please provide at least one category'],
    index: true
  }],
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPCategory',
    index: true
  },
  // Cities where this brand is available
  cityIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPCity',
    index: true
  }],
  iconUrl: {
    type: String,
    default: null
  },
  badge: {
    type: String,
    default: null,
    trim: true
  },
  routePath: {
    type: String,
    default: null
  },
  // Status
  status: {
    type: String,
    enum: Object.values(SERVICE_STATUS),
    default: SERVICE_STATUS.ACTIVE,
    index: true
  },
  // Additional Info
  isPopular: {
    type: Boolean,
    default: false,
    index: true
  },
  isFeatured: {
    type: Boolean,
    default: false,
    index: true
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalBookings: {
    type: Number,
    default: 0
  },

  // Admin tracking
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPAdmin',
    default: null
  }
}, {
  timestamps: true
});

// Generate slug from title before saving
brandSchema.pre('save', async function (next) {
  if (this.isModified('title') && !this.slug) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  // Auto-generate routePath from slug
  if (this.isModified('slug') && !this.routePath) {
    this.routePath = `/user/brand/${this.slug}`;
  }
  // Sync categoryId and categoryIds
  if (this.isModified('categoryId') && this.categoryId && !this.categoryIds.includes(this.categoryId)) {
    if (!this.categoryIds.includes(this.categoryId)) {
      this.categoryIds.push(this.categoryId);
    }
  }

  if (this.isModified('categoryIds') && this.categoryIds.length > 0) {
    this.categoryId = this.categoryIds[0];
  }

  next();
});

// Indexes for faster queries
brandSchema.index({ categoryIds: 1, status: 1 });
brandSchema.index({ status: 1, isPopular: 1, isFeatured: 1 });

module.exports = mongoose.models.SPBrand || mongoose.model('SPBrand', brandSchema, 'sp_brands');
