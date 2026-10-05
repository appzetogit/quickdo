import mongoose from 'mongoose';

const foodOfferUsageSchema = new mongoose.Schema(
    {
        offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCOffer', index: true, required: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCUser', index: true, required: true },
        count: { type: Number, default: 0, min: 0 },
        lastUsedAt: { type: Date, default: null }
    },
    { collection: 'food_offer_usages', timestamps: true }
);

foodOfferUsageSchema.index({ offerId: 1, userId: 1 }, { unique: true });

export const FoodOfferUsage = mongoose.models.FoodOfferUsage || mongoose.models.QCOfferUsage || mongoose.model('QCOfferUsage', foodOfferUsageSchema, 'qc_offer_usages');
