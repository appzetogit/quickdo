import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const phoneSchema = z
    .string()
    .min(8, 'Phone must be at least 8 digits')
    .max(15, 'Phone must be at most 15 digits');

const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const aadharRegex = /^[0-9]{12}$/;
// India-wide DL support (normalized, no spaces/hyphens):
// 2 letters (state) + 1-2 digits (RTO) + 2 or 4 digits (year) + 4-7 digits (serial)
const drivingLicenseRegex = /^[A-Z]{2}[0-9]{1,2}(?:[0-9]{2}|[0-9]{4})[0-9]{4,7}$/;

const deliveryRegisterSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    phone: phoneSchema,
    email: z.string().email().optional().or(z.literal('')),
    countryCode: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    // What the partner answered to "what do you have?". zod strips unnamed
    // keys, so without these the answer would arrive and vanish.
    driverClass: z
        .enum(['two_wheeler', 'passenger_taxi', 'parcel_vehicle'])
        .optional()
        .or(z.literal('')),
    // Sent as an array, or comma-separated when it comes through multipart.
    serviceIntents: z
        .union([z.array(z.string()), z.string()])
        .optional(),
    vehicleType: z.string().optional(),
    vehicleName: z.string().optional(),
    vehicleNumber: z.string().optional(),
    drivingLicenseNumber: z
        .string()
        .regex(drivingLicenseRegex, 'Invalid driving license format')
        .optional()
        .or(z.literal('')),
    ref: z.string().trim().max(64).optional().or(z.literal('')),
    panNumber: z
        .string()
        .regex(panRegex, 'Invalid PAN format')
        .optional()
        .or(z.literal('')),
    aadharNumber: z
        .string()
        .regex(aadharRegex, 'Invalid Aadhar format')
        .optional()
        .or(z.literal('')),
    fcmToken: z.string().optional().nullable(),
    platform: z.enum(['web', 'mobile']).optional().default('web')
});

/**
 * The text that belongs to an admin-defined document.
 *
 * `docnum_<key>` is the number on it, `docname_<key>` the label the app
 * showed. Both are keyed by a catalogue entry that did not exist when this
 * schema was written, which is exactly why they are matched by prefix.
 */
const carriedDocumentFields = (body = {}) => {
    const out = {};
    for (const [key, value] of Object.entries(body || {})) {
        if (/^(docnum_|docname_)/.test(key)) {
            out[key] = String(value ?? '').trim().slice(0, 120);
        }
    }
    return out;
};

export const validateDeliveryRegisterDto = (body) => {
    const result = deliveryRegisterSchema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return { ...result.data, ...carriedDocumentFields(body) };
};

const deliveryProfileUpdateSchema = z.object({
    name: z.string().min(1).optional(),
    countryCode: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    vehicleType: z.string().optional(),
    vehicleName: z.string().optional(),
    vehicleNumber: z.string().optional(),
    drivingLicenseNumber: z
        .string()
        .regex(drivingLicenseRegex, 'Invalid driving license format')
        .optional()
        .or(z.literal('')),
    fcmToken: z.string().optional().nullable(),
    platform: z.enum(['web', 'mobile']).optional().default('web')
});

export const validateDeliveryProfileUpdateDto = (body) => {
    const result = deliveryProfileUpdateSchema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};

const bankDetailsSchema = z.object({
    accountHolderName: z.string().min(1, 'Account holder name is required').optional().or(z.literal('')),
    accountNumber: z.string().min(1, 'Account number is required').optional().or(z.literal('')),
    ifscCode: z.string().min(1, 'IFSC code is required').optional().or(z.literal('')),
    bankName: z.string().min(1, 'Bank name is required').optional().or(z.literal('')),
    upiId: z.string().optional().or(z.literal('')),
    upiQrCode: z.string().optional().or(z.literal(''))
});

const bankDetailsUpdateSchema = z.object({
    documents: z.object({
        bankDetails: bankDetailsSchema.optional(),
        pan: z.object({ number: z.string().optional() }).optional()
    }).optional()
}).optional();

export const validateDeliveryBankDetailsDto = (body) => {
    // If we have flat keys from FormData (multer), reconstruct the nested object for Zod
    const processed = { ...body };
    if (!processed.documents) processed.documents = {};
    if (!processed.documents.bankDetails) {
        processed.documents.bankDetails = {
            accountHolderName: body['documents[bankDetails][accountHolderName]'],
            accountNumber: body['documents[bankDetails][accountNumber]'],
            ifscCode: body['documents[bankDetails][ifscCode]'],
            bankName: body['documents[bankDetails][bankName]'],
            upiId: body['documents[bankDetails][upiId]']
        };
    }
    if (!processed.documents.pan && body['documents[pan][number]']) {
        processed.documents.pan = { number: body['documents[pan][number]'] };
    }

    const result = bankDetailsUpdateSchema.safeParse(processed);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};

