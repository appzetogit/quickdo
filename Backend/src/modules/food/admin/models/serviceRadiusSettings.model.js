import mongoose from 'mongoose';

/**
 * The platform ceiling on a restaurant's delivery radius.
 *
 * One document, keyed 'default'. Kept out of the fee settings on purpose: those
 * are versioned by createdAt and replaced wholesale by the fee page, and a
 * ceiling that silently reset whenever someone saved a delivery slab would
 * start refusing saves nobody had touched.
 *
 * See shared/serviceRadius.js for how it is applied.
 */
const serviceRadiusSettingsSchema = new mongoose.Schema(
    {
        key: { type: String, default: 'default', unique: true },
        maxRadiusKm: { type: Number, min: 1, max: 100, default: 20 },
    },
    { collection: 'food_service_radius_settings', timestamps: true }
);

export const FoodServiceRadiusSettings = mongoose.models.FoodServiceRadiusSettings
    || mongoose.model('FoodServiceRadiusSettings', serviceRadiusSettingsSchema, 'food_service_radius_settings');
