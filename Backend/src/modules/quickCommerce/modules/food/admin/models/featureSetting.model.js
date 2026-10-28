import mongoose from 'mongoose';

const featureSettingSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, trim: true },
        name: { type: String, required: true, trim: true },
        description: { type: String, default: '', trim: true },
        isEnabled: { type: Boolean, default: true }
    },
    { collection: 'food_feature_settings', timestamps: true }
);

featureSettingSchema.index({ key: 1 }, { unique: true });

export const FoodFeatureSetting = mongoose.models.QCFeatureSetting || mongoose.model('QCFeatureSetting', featureSettingSchema, 'qc_feature_settings');
