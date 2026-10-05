import mongoose from 'mongoose';

const deliveryFeeRangeSchema = new mongoose.Schema(
    {
        min: { type: Number, required: true, min: 0 },
        max: { type: Number, required: true, min: 0 },
        fee: { type: Number, required: true, min: 0 },
        deliveryBoyPerKm: { type: Number, min: 0, default: 0 },
        deliveryBoyBasePay: { type: Number, min: 0, default: 0 }
    },
    { _id: false }
);

const feeSettingsSchema = new mongoose.Schema(
    {
        // No defaults here; admin must explicitly configure values.
        deliveryFee: { type: Number, min: 0 },
        deliveryFeeRanges: { type: [deliveryFeeRangeSchema], default: [] },
        platformFee: { type: Number, min: 0 },
        quickDeliveryFee: { type: Number, min: 0 },
        gstRate: { type: Number, min: 0, max: 100 },
        isActive: { type: Boolean, default: true, index: true }
    },
    { collection: 'food_fee_settings', timestamps: true }
);

feeSettingsSchema.index({ isActive: 1, createdAt: -1 });

export const FoodFeeSettings = mongoose.models.QCFeeSettings || mongoose.model('QCFeeSettings', feeSettingsSchema, 'qc_fee_settingses');

