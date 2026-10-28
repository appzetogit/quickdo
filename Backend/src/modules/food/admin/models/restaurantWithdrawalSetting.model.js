import mongoose from 'mongoose';

const restaurantWithdrawalSettingSchema = new mongoose.Schema(
    {
        minimumWithdrawalAmount: { type: Number, default: 0, min: 0 },
        isActive: { type: Boolean, default: true, index: true }
    },
    { collection: 'food_restaurant_withdrawal_settings', timestamps: true }
);

restaurantWithdrawalSettingSchema.index({ isActive: 1, createdAt: -1 });

export const FoodRestaurantWithdrawalSetting = mongoose.model(
    'FoodRestaurantWithdrawalSetting',
    restaurantWithdrawalSettingSchema
);
