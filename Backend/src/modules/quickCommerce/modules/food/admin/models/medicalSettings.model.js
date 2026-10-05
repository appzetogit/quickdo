import mongoose from 'mongoose';
import {
    DEFAULT_REQUEST_EXPIRY_MINUTES,
    DEFAULT_REQUEST_RADIUS_KM,
} from '../../shared/medicalRequest.js';

/**
 * The platform's rules for medical orders. One document, the admin's to set.
 *
 * `requestRadiusKm` is how far a prescription broadcast travels, and it is also
 * what the customer's "pharmacies near me" list is cut off at, so the shops a
 * customer is shown are exactly the shops a broadcast would reach. Two
 * different radii would mean a customer looking at a pharmacy that never gets
 * their request.
 *
 * Kept apart from fee settings deliberately: this decides who sees a health
 * record, and it should not be one field among thirty in a screen about money,
 * where it can be changed by someone editing a delivery charge.
 */
const medicalSettingsSchema = new mongoose.Schema(
    {
        requestRadiusKm: { type: Number, default: DEFAULT_REQUEST_RADIUS_KM, min: 0 },
        requestExpiryMinutes: { type: Number, default: DEFAULT_REQUEST_EXPIRY_MINUTES, min: 1 },
        /**
         * Whether customers may broadcast at all.
         *
         * Off leaves the direct path working: a customer can still choose a
         * pharmacy and send it a prescription. This switch exists so the
         * platform can stop showing one prescription to several shops without
         * taking medical ordering down with it.
         */
        broadcastEnabled: { type: Boolean, default: true },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { collection: 'qc_medical_settings', timestamps: true },
);

export const QCMedicalSettings = mongoose.models.QCMedicalSettings
    || mongoose.model('QCMedicalSettings', medicalSettingsSchema, 'qc_medical_settings');
