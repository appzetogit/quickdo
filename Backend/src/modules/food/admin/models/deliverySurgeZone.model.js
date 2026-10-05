import mongoose from 'mongoose';

const deliverySurgeZoneSchema = new mongoose.Schema(
    {
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            required: true,
            unique: true,
            index: true
        },
        isEnabled: { type: Boolean, default: false, index: true },
        surgeAmount: { type: Number, default: 0, min: 0 },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodUser',
            default: null
        }
    },
    { collection: 'food_delivery_surge_zones', timestamps: true }
);

deliverySurgeZoneSchema.index({ createdAt: -1 });

export const FoodDeliverySurgeZone = mongoose.model('FoodDeliverySurgeZone', deliverySurgeZoneSchema);
