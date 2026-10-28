import mongoose from 'mongoose';

const restaurantSubscriptionSettingsSchema = new mongoose.Schema(
    {
        starterPrice: { type: Number, required: true, default: 999 },
        growthPrice: { type: Number, required: true, default: 1999 },
        premiumPrice: { type: Number, required: true, default: 2999 },
        starterMinGmv: { type: Number, required: true, default: 0 },
        starterMaxGmv: { type: Number, required: true, default: 30000 },
        growthMinGmv: { type: Number, required: true, default: 30000.01 },
        growthMaxGmv: { type: Number, required: true, default: 60000 },
        premiumMinGmv: { type: Number, required: true, default: 60000.01 },
        onboardingFee: { type: Number, required: true, default: 0, min: 0 },
    },
    { collection: 'food_restaurant_subscription_settings', timestamps: true }
);

export const FoodRestaurantSubscriptionSettings = mongoose.models.QCRestaurantSubscriptionSettings || mongoose.model('QCRestaurantSubscriptionSettings', restaurantSubscriptionSettingsSchema, 'qc_restaurant_subscription_settingses');
