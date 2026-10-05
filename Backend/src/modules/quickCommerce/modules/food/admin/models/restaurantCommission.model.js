import mongoose from 'mongoose';

const restaurantCommissionSchema = new mongoose.Schema(
    {
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCRestaurant',
            required: true,
            unique: true,
            index: true
        },
        defaultCommission: {
            type: {
                type: String,
                enum: ['percentage', 'amount'],
                default: 'percentage'
            },
            value: { type: Number, default: 0 }
        },
        notes: { type: String, trim: true, default: '' },
        status: { type: Boolean, default: true, index: true }
    },
    { collection: 'food_restaurant_commissions', timestamps: true }
);


export const FoodRestaurantCommission = mongoose.models.QCRestaurantCommission || mongoose.model('QCRestaurantCommission', restaurantCommissionSchema, 'qc_restaurant_commissions');

