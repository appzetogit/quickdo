const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { WORKER_STATUS } = require('../utils/constants');

const workerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true
  },
  email: {
    type: String,
    unique: true,
    sparse: true, // Allow multiple nulls
    trim: true,
    lowercase: true,
    default: null
  },
  phone: {
    type: String,
    required: [true, 'Please provide a phone number'],
    unique: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['worker'],
    default: 'worker'
  },
  password: {
    type: String,
    select: false
  },
  aadhar: {
    number: {
      type: String,
      trim: true
    },
    document: {
      type: String, // Cloudinary URL (Front)
    },
    backDocument: {
      type: String, // Cloudinary URL (Back)
    }
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPVendor',
    default: null
  },
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending'
  },
  serviceCategories: [{
    type: String
  }],
  status: {
    type: String,
    enum: Object.values(WORKER_STATUS),
    default: WORKER_STATUS.OFFLINE
  },
  profilePhoto: {
    type: String,
    default: null
  },
  address: {
    addressLine1: String,
    addressLine2: String,
    city: String,
    state: String,
    pincode: String,
    landmark: String
  },
  rating: {
    type: Number,
    default: 0
  },
  totalJobs: {
    type: Number,
    default: 0
  },
  completedJobs: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isPhoneVerified: {
    type: Boolean,
    default: false
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  // Wallet
  wallet: {
    balance: {
      type: Number,
      default: 0 // Current withdrawable amount
    },
    earnings: {
      type: Number,
      default: 0 // Lifetime earnings
    },
    dues: {
      type: Number,
      default: 0 // Amount worker owes to platform
    },
    cashLimit: {
      type: Number,
      default: 10000 // Limit before worker is blocked
    },
    isBlocked: {
      type: Boolean,
      default: false // Blocked from receiving cash bookings due to high dues
    },
    blockedAt: {
      type: Date,
      default: null
    },
    blockReason: {
      type: String,
      default: null
    },
    totalCashCollected: {
      type: Number,
      default: 0
    },
    totalWithdrawn: {
      type: Number,
      default: 0
    }
  },
  // Settings
  settings: {
    notifications: {
      type: Boolean,
      default: true
    },
    soundAlerts: {
      type: Boolean,
      default: true
    },
    language: {
      type: String,
      default: 'en'
    }
  },
  // Real-time Location
  location: {
    lat: Number,
    lng: Number,
    updatedAt: Date
  },
  // Additional Stats
  cancelledJobs: {
    type: Number,
    default: 0
  },
  totalReviews: {
    type: Number,
    default: 0
  },

  // FCM Push Notification Tokens
  fcmTokens: {
    type: [String],
    default: []
  },
  fcmTokenMobile: {
    type: [String],
    default: []
  },
  // GeoJSON Location for 2dsphere indexing (fast geo queries)
  geoLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] } // [lng, lat]
  },
  // Real-time Online Status
  isOnline: {
    type: Boolean,
    default: false,
    index: true
  },
  lastSeenAt: {
    type: Date,
    default: null
  },
  loginSessionId: {
    type: String,
    default: null
  },
  subscription: {
    isActive: {
      type: Boolean,
      default: false
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPWorkerSubscriptionPlan',
      default: null
    },
    startDate: {
      type: Date,
      default: null
    },
    expiryDate: {
      type: Date,
      default: null
    },
    transactionId: {
      type: String,
      default: null
    }
  }
}, {
  timestamps: true
});

// Indexes for faster queries
workerSchema.index({ status: 1 });
workerSchema.index({ serviceCategories: 1 });
workerSchema.index({ vendorId: 1 });
workerSchema.index({ geoLocation: '2dsphere' }); // Fast geo queries
workerSchema.index({ isOnline: 1, approvalStatus: 1 }); 

// Hash password before saving
workerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
workerSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.models.SPWorker || mongoose.model('SPWorker', workerSchema, 'sp_workers');

