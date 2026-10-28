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
        content: { type: String, default: '' }, // stored as HTML string
        email: { type: String, default: '' },
        mobile: { type: String, default: '' }
    },
    { _id: false }
);

const aboutPageSchema = new mongoose.Schema(
    {
        appName: { type: String, default: 'Switcheats' },
        version: { type: String, default: '1.0.0' },
        description: { type: String, default: '' },
        logo: { type: String, default: '' },
        features: { type: [featureSchema], default: [] },
        stats: { type: Array, default: [] }
    },
    { _id: false }
);

const pageContentSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            index: true,
            enum: ['terms', 'privacy', 'refund', 'shipping', 'cancellation', 'about', 'support']
        },
        module: {
            type: String,
            required: true,
            enum: ['USER', 'DELIVERY', 'RESTAURANT', 'ALL'],
            default: 'ALL'
        },
        legal: { type: legalPageSchema, default: undefined },
        about: { type: aboutPageSchema, default: undefined },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
        updatedByRole: { type: String, default: 'ADMIN' }
    },
    { collection: 'food_page_contents', timestamps: true }
);

pageContentSchema.index({ key: 1, module: 1 }, { unique: true });

export const FoodPageContent = mongoose.models.QCPageContent || mongoose.model('QCPageContent', pageContentSchema, 'qc_page_contents');

