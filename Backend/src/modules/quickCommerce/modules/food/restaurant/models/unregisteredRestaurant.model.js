import mongoose from 'mongoose';

const unregisteredRestaurantSchema = new mongoose.Schema(
    {
        ownerName: { type: String, required: true, trim: true },
        restaurantName: { type: String, required: true, trim: true },
        mobileNumber: { type: String, required: true, trim: true },
        emailId: { type: String, required: true, trim: true },
        location: { type: String, required: true, trim: true }
    },
    { collection: 'food_unregistered_restaurants', timestamps: true }
);

unregisteredRestaurantSchema.index({ createdAt: -1 });

export const FoodUnregisteredRestaurant = mongoose.models.QCUnregisteredRestaurant || mongoose.model('QCUnregisteredRestaurant', unregisteredRestaurantSchema, 'qc_unregistered_restaurants');
