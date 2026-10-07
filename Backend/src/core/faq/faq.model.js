import mongoose from 'mongoose';

/**
 * Frequently asked questions (plan §5.8), for every vertical's app and site.
 *
 * `vertical` is the service the question belongs to, or 'general' for the
 * platform as a whole; `category` groups them on the help screen; `sortOrder`
 * is the order the admin chose. Inactive rows stay in the panel but are not
 * served to customers.
 */
export const FAQ_VERTICALS = Object.freeze(['general', 'food', 'quickCommerce', 'taxi', 'serviceProvider', 'delivery', 'store']);

const faqSchema = new mongoose.Schema(
    {
        vertical: { type: String, enum: FAQ_VERTICALS, default: 'general', index: true },
        category: { type: String, trim: true, default: 'General', maxlength: 80 },
        question: { type: String, required: true, trim: true, maxlength: 500 },
        answer: { type: String, required: true, trim: true, maxlength: 5000 },
        sortOrder: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true, index: true },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { collection: 'platform_faqs', timestamps: true },
);

faqSchema.index({ vertical: 1, isActive: 1, category: 1, sortOrder: 1 });

export const Faq = mongoose.models.Faq || mongoose.model('Faq', faqSchema);
