import mongoose from 'mongoose';

const diningRestaurantSchema = new mongoose.Schema(
    {
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCRestaurant',
            required: true,
            unique: true
        },
        categoryIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'QCDiningCategory'
            }
        ],
        primaryCategoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCDiningCategory',
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

diningRestaurantSchema.index({ restaurantId: 1 }, { unique: true });
diningRestaurantSchema.index({ isEnabled: 1, primaryCategoryId: 1 });

export const FoodDiningRestaurant = mongoose.models.QCDiningRestaurant || mongoose.model('QCDiningRestaurant', diningRestaurantSchema, 'qc_dining_restaurants');
