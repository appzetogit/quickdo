const mongoose = require('mongoose');

/**
 * Service package: several catalogue services and/or add-ons sold together at
 * one admin-set price (e.g. "AC deep clean + gas top-up + filter").
 *
 * A booking made with packageId is priced from `price` (+ GST) on the server,
 * whatever the app sends, and its items are expanded into booking.bookedItems
 * so the provider sees what to do. The booking's basePrice is the package price,
 * so the bill and the commission engine work on it as on any booking.
 *
 * `items[].name` and `items[].unitPrice` are a snapshot of the catalogue taken
 * when the package is saved: they show the customer what the bundle is worth
 * separately (`catalogValue`), they never price a booking.
 */
const packageItemSchema = new mongoose.Schema({
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'SPUserService', required: true },
  // Set when the item is one of the service's add-ons rather than the service itself.
  addOnId: { type: mongoose.Schema.Types.ObjectId, default: null },
  name: { type: String, default: '' },
  quantity: { type: Number, default: 1, min: 1 },
  unitPrice: { type: Number, default: 0, min: 0 }
}, { _id: false });

const servicePackageSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  imageUrl: { type: String, default: null },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'SPCategory', required: true, index: true },
  items: {
    type: [packageItemSchema],
    validate: [(v) => Array.isArray(v) && v.length > 0, 'A package needs at least one item']
  },
  // Package price before GST.
  price: { type: Number, required: true, min: 0 },
  // null = Settings.serviceGstPercentage (what the bill charges on the service base).
  gstPercentage: { type: Number, default: null, min: 0, max: 100 },
  // Optional sale window. Outside it the package is not listed and cannot be booked.
  validFrom: { type: Date, default: null },
  validTo: { type: Date, default: null },
  active: { type: Boolean, default: true, index: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

servicePackageSchema.virtual('catalogValue').get(function catalogValue() {
  return Math.round((this.items || []).reduce((s, i) => s + (Number(i.unitPrice) || 0) * (Number(i.quantity) || 1), 0) * 100) / 100;
});

/**
 * Is the package on sale at `now`? Works on lean docs too.
 */
servicePackageSchema.statics.isOnSale = (pkg, now = new Date()) => Boolean(
  pkg &&
  pkg.active !== false &&
  (!pkg.validFrom || new Date(pkg.validFrom) <= now) &&
  (!pkg.validTo || new Date(pkg.validTo) >= now)
);

servicePackageSchema.set('toJSON', { virtuals: true });
servicePackageSchema.set('toObject', { virtuals: true });

module.exports = mongoose.models.SPServicePackage || mongoose.model('SPServicePackage', servicePackageSchema, 'sp_service_packages');
