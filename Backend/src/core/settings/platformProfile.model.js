import mongoose from 'mongoose';

/**
 * The platform's one set of shared settings: brand, contact, legal pages and
 * the integrations every service uses (Master > Platform settings).
 *
 * A single document. Every field starts empty, and EMPTY MEANS "NOT MANAGED
 * HERE": readers then keep what they used before (each service's own record,
 * or .env for integrations). A value saved here wins everywhere. See
 * platformProfile.service.js.
 *
 * Secrets are select:false and never leave the server whole; the admin API
 * returns only their last four characters.
 */
const secret = { type: String, default: '', select: false };

const schema = new mongoose.Schema(
  {
    _id: { type: String, default: 'platform' },
    brand: {
      name: { type: String, default: '', trim: true },
      logoUrl: { type: String, default: '', trim: true },
      faviconUrl: { type: String, default: '', trim: true },
    },
    contact: {
      email: { type: String, default: '', trim: true },
      phoneCountryCode: { type: String, default: '', trim: true },
      phone: { type: String, default: '', trim: true },
      whatsapp: { type: String, default: '', trim: true },
      address: { type: String, default: '', trim: true },
      city: { type: String, default: '', trim: true },
      state: { type: String, default: '', trim: true },
      pincode: { type: String, default: '', trim: true },
    },
    business: {
      legalName: { type: String, default: '', trim: true },
      gstin: { type: String, default: '', trim: true },
      pan: { type: String, default: '', trim: true },
      currencyCode: { type: String, default: '', trim: true },
      currencySymbol: { type: String, default: '', trim: true },
    },
    legal: {
      terms: { type: String, default: '' },
      privacy: { type: String, default: '' },
      refund: { type: String, default: '' },
      cancellation: { type: String, default: '' },
      shipping: { type: String, default: '' },
    },
    integrations: {
      razorpay: {
        keyId: { type: String, default: '', trim: true },
        keySecret: secret,
        webhookSecret: secret,
      },
      sms: {
        apiKey: secret,
        senderId: { type: String, default: '', trim: true },
        templateId: { type: String, default: '', trim: true },
        templateText: { type: String, default: '' },
      },
      email: {
        host: { type: String, default: '', trim: true },
        port: { type: Number, default: null },
        secure: { type: Boolean, default: null },
        user: { type: String, default: '', trim: true },
        pass: secret,
        from: { type: String, default: '', trim: true },
      },
    },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true, minimize: false },
);

export const PlatformProfile = mongoose.models.PlatformProfile
  || mongoose.model('PlatformProfile', schema, 'platform_profile');
