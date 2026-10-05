import mongoose from 'mongoose';

const foodGourmetRestaurantSchema = new mongoose.Schema(
    {
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCRestaurant',
            required: true
        },
        tags: {
            type: [String],
            default: []
        },
        priority: {
            type: Number,
            default: 0,
            index: true
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true
        }
    },
    {
        collection: 'food_gourmet_restaurants',
        timestamps: true
    }
);

foodGourmetRestaurantSchema.index({ restaurantId: 1 });
foodGourmetRestaurantSchema.index({ isActive: 1, priority: 1 });

export const FoodGourmetRestaurant = mongoose.models.QCGourmetRestaurant || mongoose.model('QCGourmetRestaurant', foodGourmetRestaurantSchema, 'qc_gourmet_restaurants');

