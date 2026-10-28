const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    select: false
  },
  role: {
    type: String,
    enum: ['super_admin', 'admin'],
    default: 'admin'
  },
  cityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPCity',
    default: null // null implies Super Admin or access to all cities (if logic allows)
  },
  cityName: {
    type: String,
    default: ''
  },
  profilePhoto: {
    type: String,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // This model reads the SHARED `admins` collection alongside FoodAdmin and
  // TaxiAdmin. servicesAccess must be declared here or mongoose's strict mode
  // silently drops it on non-lean reads and the access gate sees undefined.
  // `default: undefined` so we never write an empty array onto a food/taxi doc.
  servicesAccess: {
    type: [String],
    default: undefined
  },
  lastLogin: {
    type: Date
  }
}, {
  timestamps: true
});

// Hash password before saving
adminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
adminSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.models.SPAdmin || mongoose.model('SPAdmin', adminSchema, 'admins');

