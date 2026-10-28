const mongoose = require('mongoose');
const { TOKEN_TYPES } = require('../utils/constants');

const tokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false, // Optional - not available during signup
    index: true,
    default: null
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    index: true
  },
  phone: {
    type: String,
    trim: true,
    index: true
  },
  type: {
    type: String,
    enum: Object.values(TOKEN_TYPES),
    required: true
  },
  token: {
    type: String,
    required: true
  },
  otp: {
    type: String
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 } // Auto-delete expired tokens
  },
  isUsed: {
    type: Boolean,
    default: false
  },
  attempts: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for faster lookups
tokenSchema.index({ userId: 1, type: 1, isUsed: 1 });
tokenSchema.index({ email: 1, type: 1, isUsed: 1 });
tokenSchema.index({ phone: 1, type: 1, isUsed: 1 });

module.exports = mongoose.models.SPToken || mongoose.model('SPToken', tokenSchema, 'sp_tokens');

