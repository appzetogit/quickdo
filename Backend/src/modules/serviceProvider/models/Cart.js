const mongoose = require('mongoose');

/**
 * Cart Model
 * Stores user's cart items per user
 */
const cartItemSchema = new mongoose.Schema({
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPUserService',
    required: false
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPCategory',
    required: false
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  icon: {
    type: String,
    default: ''
  },
  category: {
    type: String,
    required: true
  },
  categoryTitle: {
    type: String,
    default: ''
  },
  categoryIcon: {
    type: String,
    default: null
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  originalPrice: {
    type: Number,
    default: null
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  serviceCount: {
    type: Number,
    default: 1,
    min: 1
  },
  rating: {
    type: String,
    default: '4.8'
  },
  reviews: {
    type: String,
    default: '10k+'
  },
  // Section / Brand info (from service catalog)
  sectionTitle: {
    type: String,
    default: ''
  },
  sectionIcon: {
    type: String,
    default: null
  },
  sectionId: {
    type: String,
    default: null
  },
  // Card details (matching service catalog structure)
  card: {
    title: String,
    subtitle: String,
    price: Number,
    originalPrice: Number,
    duration: String,
    description: String,
    imageUrl: String,
    features: [String]
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPVendor',
    default: null
  }
}, { _id: true });

const cartSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPUser',
    required: true,
    unique: true,
    index: true
  },
  items: [cartItemSchema],
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Update updatedAt on save
cartSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.models.SPCart || mongoose.model('SPCart', cartSchema, 'sp_carts');

