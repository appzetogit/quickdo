const mongoose = require('mongoose');

/**
 * Provider availability (plan §3.3): weekly working hours plus date overrides
 * (leave, blocked days, or different hours on one date).
 *
 * One document per provider. A provider WITHOUT a document is treated as always
 * available, so existing vendors and workers keep receiving jobs until they set
 * their calendar. Times are 'HH:mm' (24h) in the provider's timezone
 * (Asia/Kolkata by default); dates are 'YYYY-MM-DD' in that timezone.
 *
 * Rules (services/providerEligibility.js isAvailableAt):
 *  - an override for the date wins: type 'leave' = unavailable all day,
 *    type 'custom' = only the override's slots that day;
 *  - otherwise, if `weekly` is empty the provider is available all day;
 *  - otherwise the weekday's entry decides: missing, off, or no slot covering
 *    the time = unavailable.
 */
const slotSchema = new mongoose.Schema({
  start: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  end: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/ }
}, { _id: false });

const availabilitySchema = new mongoose.Schema({
  providerType: { type: String, enum: ['vendor', 'worker'], required: true },
  providerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  timezone: { type: String, default: 'Asia/Kolkata' },
  weekly: [{
    _id: false,
    day: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
    off: { type: Boolean, default: false },
    slots: { type: [slotSchema], default: [] }
  }],
  overrides: [{
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    type: { type: String, enum: ['leave', 'custom'], default: 'leave' },
    slots: { type: [slotSchema], default: [] },
    note: { type: String, default: null, trim: true }
  }]
}, { timestamps: true });

availabilitySchema.index({ providerType: 1, providerId: 1 }, { unique: true });

module.exports = mongoose.models.SPAvailability || mongoose.model('SPAvailability', availabilitySchema, 'sp_availability');
