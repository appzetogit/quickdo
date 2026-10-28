const mongoose = require('mongoose');

/**
 * City Model
 * Manages cities for multi-city content management.
 * Each city can have its own services, categories, and home content.
 */
const citySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a city name'],
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
  state: {
    type: String,
    trim: true,
    default: ''
  },
  country: {
    type: String,
    trim: true,
    default: 'India'
  },

  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  // Default city flag - only one city should have this as true
  isDefault: {
    type: Boolean,
    default: false,
    index: true
  },
  // City-specific settings
  currency: {
    type: String,
    default: 'INR'
  },
  timezone: {
    type: String,
    default: 'Asia/Kolkata'
  },
  // Display order for city lists
  displayOrder: {
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

// Generate slug from name before saving
// Generate slug from name before validation
citySchema.pre('validate', function (next) {
  if (this.isModified('name') && !this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  next();
});

// Handle side-effects before saving
citySchema.pre('save', async function (next) {
  // Ensure only one default city
  if (this.isModified('isDefault') && this.isDefault) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id }, isDefault: true },
      { isDefault: false }
    );
  }

  next();
});



// Compound indexes for common queries
citySchema.index({ isActive: 1, displayOrder: 1 });
citySchema.index({ isActive: 1, isDefault: 1 });

/**
 * Static method to get the default city
 */
citySchema.statics.getDefaultCity = async function () {
  let defaultCity = await this.findOne({ isDefault: true, isActive: true });

  // If no default city exists, get the first active city
  if (!defaultCity) {
    defaultCity = await this.findOne({ isActive: true }).sort({ displayOrder: 1, createdAt: 1 });
  }

  return defaultCity;
};

/**
 * Static method to find city by coordinates
 * Deprecated: Location field removed. Returns default city.
 */
citySchema.statics.findByCoordinates = async function (longitude, latitude) {
  // Fallback to default city as location search is disabled
  return this.getDefaultCity();
};

/**
 * Static method to ensure a default city exists (for migrations)
 */
citySchema.statics.ensureDefaultCity = async function () {
  let defaultCity = await this.findOne({ isDefault: true });

  if (!defaultCity) {
    defaultCity = await this.create({
      name: 'Default City',
      slug: 'default',
      state: '',
      country: 'India',
      isDefault: true,
      isActive: true,
      displayOrder: 0
    });
  }

  return defaultCity;
};

module.exports = mongoose.models.SPCity || mongoose.model('SPCity', citySchema, 'sp_cities');
