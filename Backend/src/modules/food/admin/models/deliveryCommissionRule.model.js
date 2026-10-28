import mongoose from 'mongoose';

const deliveryCommissionRuleSchema = new mongoose.Schema(
    {
        name: { type: String, trim: true, default: '' },
        minDistance: { type: Number, required: true, min: 0 },
        maxDistance: { type: Number, default: null },
        userDeliveryFee: { type: Number, required: true, min: 0, default: 0 },
        commissionPerKm: { type: Number, required: true, min: 0 },
        basePayout: { type: Number, required: true, min: 0 },
        status: { type: Boolean, default: true, index: true }
    },
    { collection: 'food_delivery_commission_rules', timestamps: true }
);

deliveryCommissionRuleSchema.index({ createdAt: -1 });

export const FoodDeliveryCommissionRule = mongoose.model('FoodDeliveryCommissionRule', deliveryCommissionRuleSchema);

