const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  tagline: {
    type: String, // Dynamic tagline from admin
    default: ''
  },
  description: {
    type: String, // Dynamic description from admin
    default: ''
  },
  price: {
    type: Number,
    required: true
  },
  duration: {
    type: String,
    required: true // e.g., '1 month', '1 year'
  },
  freeCategories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPCategory'
  }],
  freeServices: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPUserService'
  }],
  bonusServices: [{
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPCategory'
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPUserService'
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = mongoose.models.SPPlan || mongoose.model('SPPlan', PlanSchema, 'sp_plans');
