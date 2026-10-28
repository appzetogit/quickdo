import mongoose from 'mongoose';

const coordinateSchema = new mongoose.Schema(
    {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true }
    },
    { _id: false }
);

const zoneSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        zoneName: {
            type: String,
            trim: true
        },
        country: {
            type: String,
            required: true,
            trim: true,
            default: 'India',
            index: true
        },
        /** Display label e.g. city/area; optional, can mirror name */
        serviceLocation: {
            type: String,
            trim: true
        },
        unit: {
            type: String,
            enum: ['kilometer', 'miles'],
            default: 'kilometer'
        },
        boundary_mode: {
            type: String,
            enum: ['polygon', 'circle'],
            default: 'polygon'
        },
        circle_center: {
            lat: { type: Number },
            lng: { type: Number }
        },
        circle_radius_meters: {
            type: Number
        },
        coordinates: {
            type: [coordinateSchema],
            required: function() { return this.boundary_mode === 'polygon'; },
            validate: {
                validator(v) {
                    if (this.boundary_mode === 'circle') return true;
                    return Array.isArray(v) && v.length >= 3;
                },
                message: 'Zone must have at least 3 coordinates (polygon).'
            }
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true
        }
    },
    {
        collection: 'food_zones',
        timestamps: true
    }
);

zoneSchema.index({ isActive: 1, name: 1 });
zoneSchema.index({ country: 1, name: 1 });

export const FoodZone = mongoose.model('FoodZone', zoneSchema);
