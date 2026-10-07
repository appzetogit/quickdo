const mongoose = require('mongoose');

/**
 * Quote (plan §3.4). A customer's quote request is a Booking with
 * isConsultancyRequest = true and status 'quote_requested'. Providers in range
 * answer it with Quotes; the customer accepts one and the booking becomes a
 * normal booking at the quoted price, assigned to that provider.
 */
const quoteSchema = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'SPBooking', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'SPUser', required: true, index: true },
  providerType: { type: String, enum: ['vendor', 'worker'], required: true },
  providerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  lineItems: [{
    _id: false,
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 1, min: 1 },
    price: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 }
  }],
  subtotal: { type: Number, required: true, min: 0 },   // before GST
  gstPercentage: { type: Number, default: 18, min: 0, max: 100 },
  tax: { type: Number, default: 0, min: 0 },
  visitingCharges: { type: Number, default: 0, min: 0 },
  amount: { type: Number, required: true, min: 0 },     // what the customer pays
  note: { type: String, default: null, trim: true },
  validUntil: { type: Date, required: true },
  status: {
    type: String,
    enum: ['submitted', 'accepted', 'rejected', 'expired', 'withdrawn'],
    default: 'submitted',
    index: true
  },
  respondedAt: { type: Date, default: null }
}, { timestamps: true });

// One live quote per provider per request (a provider revises by resubmitting).
quoteSchema.index({ bookingId: 1, providerType: 1, providerId: 1 }, { unique: true });

module.exports = mongoose.models.SPQuote || mongoose.model('SPQuote', quoteSchema, 'sp_quotes');
