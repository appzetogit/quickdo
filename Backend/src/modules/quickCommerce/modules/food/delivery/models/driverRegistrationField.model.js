import mongoose from 'mongoose';

/**
 * Admin-defined field shown on the driver registration form.
 * A "document" (photo/file upload) is just a field with type 'document'.
 * `page` groups fields into registration steps; `order` sorts within a page.
 */
const driverRegistrationFieldSchema = new mongoose.Schema(
    {
        // Machine key sent back by the app, e.g. "bloodGroup". Immutable once created.
        key: { type: String, required: true, unique: true, trim: true },
        label: { type: String, required: true, trim: true },
        type: {
            type: String,
            enum: ['text', 'number', 'email', 'phone', 'date', 'select', 'document'],
            default: 'text'
        },
        required: { type: Boolean, default: false },
        page: { type: Number, default: 1, min: 1 },
        order: { type: Number, default: 0 },
        options: { type: [String], default: [] },        // for type 'select'
        placeholder: { type: String, default: '', trim: true },
        helpText: { type: String, default: '', trim: true },
        // Optional light validation (all optional). regex is a JS pattern string.
        regex: { type: String, default: '' },
        minLength: { type: Number, default: null },
        maxLength: { type: Number, default: null },
        // 'document' fields are never editable/removable as core built-ins if isSystem is true.
        isSystem: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true }
    },
    { collection: 'food_driver_registration_fields', timestamps: true }
);

driverRegistrationFieldSchema.index({ isActive: 1, page: 1, order: 1 });

export const FoodDriverRegistrationField = mongoose.models.QCDriverRegistrationField || mongoose.model('QCDriverRegistrationField', driverRegistrationFieldSchema, 'qc_driver_registration_fields');
