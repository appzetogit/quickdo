import mongoose from 'mongoose';

const featureSchema = new mongoose.Schema(
    {
        icon: { type: String, default: 'Heart' },
        title: { type: String, default: '' },
        description: { type: String, default: '' },
        color: { type: String, default: '' },
        bgColor: { type: String, default: '' },
        order: { type: Number, default: 0 }
    },
    { _id: false }
);

const legalPageSchema = new mongoose.Schema(
    {
        title: { type: String, default: '' },
        content: { type: String, default: '' } // stored as HTML string
    },
    { _id: false }
);

const aboutPageSchema = new mongoose.Schema(
    {
        appName: { type: String, default: 'Quick Drop' },
        version: { type: String, default: '1.0.0' },
        description: { type: String, default: '' },
        logo: { type: String, default: '' },
        features: { type: [featureSchema], default: [] },
        stats: { type: Array, default: [] }
    },
    { _id: false }
);

const faqSchema = new mongoose.Schema(
    {
        question: { type: String, default: '' },
        answer: { type: String, default: '' }
    },
    { _id: false }
);

const helpSupportCategorySchema = new mongoose.Schema(
    {
        title: { type: String, default: '' },
        icon: { type: String, default: 'HelpCircle' },
        faqs: { type: [faqSchema], default: [] }
    },
    { _id: false }
);

const helpSupportSchema = new mongoose.Schema(
    {
        title: { type: String, default: 'Help & Support' },
        description: { type: String, default: 'We are here to help you.' },
        contactEmail: { type: String, default: '' },
        contactPhone: { type: String, default: '' },
        categories: { type: [helpSupportCategorySchema], default: [] }
    },
    { _id: false }
);

const pageContentSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            index: true,
            enum: [
                'terms', 'privacy', 'refund', 'shipping', 'cancellation', 'about', 'help_support',
                'terms_restaurant', 'privacy_restaurant', 'terms_delivery', 'privacy_delivery'
            ]
        },
        legal: { type: legalPageSchema, default: undefined },
        about: { type: aboutPageSchema, default: undefined },
        help_support: { type: helpSupportSchema, default: undefined },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
        updatedByRole: { type: String, default: 'ADMIN' }
    },
    { collection: 'food_page_contents', timestamps: true }
);

export const FoodPageContent = mongoose.model('FoodPageContent', pageContentSchema);


