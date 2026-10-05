import mongoose from 'mongoose';

const diningRestaurantSchema = new mongoose.Schema(
    {
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodRestaurant',
            required: true,
            unique: true
        },
        categoryIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'FoodDiningCategory'
            }
        ],
        primaryCategoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodDiningCategory',
            default: null
        },
        isEnabled: {
            type: Boolean,
            default: false
        },
        maxGuests: {
            type: Number,
            default: 6,
            min: 1
        },
        pureVegRestaurant: {
            type: Boolean,
            required: true,
            default: false
        }
    },
    {
        collection: 'food_dining_restaurants',
        timestamps: true
    }
);

diningRestaurantSchema.index({ isEnabled: 1, primaryCategoryId: 1 });

export const FoodDiningRestaurant = mongoose.model('FoodDiningRestaurant', diningRestaurantSchema);
