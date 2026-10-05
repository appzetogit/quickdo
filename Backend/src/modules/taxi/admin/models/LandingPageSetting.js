import mongoose from 'mongoose';

const landingPageSettingSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      required: true,
      unique: true,
      default: 'default',
    },
    // Media & Video
    video_url: { type: String, default: '' },
    logo_url: { type: String, default: '' },

    // Hero Section Content
    hero_title: { type: String, default: '' },
    hero_description: { type: String, default: '' },
    hero_image_url: { type: String, default: '' },

    // why_us graphic
    why_us_image_url: { type: String, default: '' },

    // Social Links
    social_links: {
      facebook: { type: String, default: '' },
      twitter: { type: String, default: '' },
      instagram: { type: String, default: '' },
      linkedin: { type: String, default: '' },
      youtube: { type: String, default: '' },
    },

    // Contact Details
    contact_email: { type: String, default: '' },
    contact_phone: { type: String, default: '' },
    contact_address: { type: String, default: '' },
    contact_location: {
      lat: { type: Number, default: 26.7271 },
      lng: { type: Number, default: 88.3953 },
    },

    // Badges / Download Links
    play_store_url: { type: String, default: '' },
    app_store_url: { type: String, default: '' },

    // FAQs list
    faqs: [
      {
        question: { type: String, required: true },
        answer: { type: String, required: true },
        order: { type: Number, default: 0 }
      }
    ],

    // CMS Policy content pages (HTML strings)
    pages: {
      about_us: { type: String, default: '' },
      careers: { type: String, default: '' },
      newsroom: { type: String, default: '' },
      terms_conditions: { type: String, default: '' },
      privacy_policy: { type: String, default: '' },
      refund_policy: { type: String, default: '' },
      cancellation_policy: { type: String, default: '' },
    }
  },
  {
    timestamps: true,
    minimize: false,
  }
);

export const LandingPageSetting =
  mongoose.models.TaxiLandingPageSetting || mongoose.model('TaxiLandingPageSetting', landingPageSettingSchema);
