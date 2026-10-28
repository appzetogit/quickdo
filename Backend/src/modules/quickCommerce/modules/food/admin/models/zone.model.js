import mongoose from 'mongoose';

const coordinateSchema = new mongoose.Schema(
    {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true }
    },
    { _id: false }
);

export const zoneSchema = new mongoose.Schema(
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
        coordinates: {
            type: [coordinateSchema],
            required: true,
            validate: {
                validator(v) {
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

/*
 * Quick commerce's zones, and medical's -- a pharmacy is a quick-commerce
 * seller, so /admin/medical edits these.
 *
 * Its own model name and its own collection, deliberately. Food keeps
 * `FoodZone` in `food_zones` and taxi keeps `TaxiZone` in `taxizones`; nothing
 * is shared between the three, so a zone drawn in one vertical's panel is
 * invisible to the others and an id from one can never resolve in another.
 * tests/zone-separation.smoke.mjs holds them apart.
 *
 * QCZone is the name to import. `FoodZone` is kept because four files already
 * use it and renaming them is churn for its own sake -- but it is a misleading
 * name for a model called QCZone reading qc_zones, and it is how somebody ends
 * up editing the wrong vertical's zones believing they are editing this one.
 */
export const QCZone = mongoose.models.QCZone || mongoose.model('QCZone', zoneSchema, 'qc_zones');

/** @deprecated Import {@link QCZone}. Same model; the name is a hangover. */
export const FoodZone = QCZone;
