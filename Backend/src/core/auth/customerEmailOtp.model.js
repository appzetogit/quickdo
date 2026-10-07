import mongoose from 'mongoose';

/**
 * One-time codes emailed to customers: email verification and password reset.
 *
 * The same pattern as the admin reset code (core/admin/adminResetOtp.model.js) --
 * one live code per address and purpose, an expiry, an attempt counter -- with two
 * differences that matter for a customer-facing endpoint:
 *
 *   - the code is stored as an HMAC, never in plain text (a backup or a support
 *     query of this collection must not be a sign-in credential);
 *   - attempts are counted atomically before the compare, so parallel guesses
 *     cannot run past the limit.
 */
const customerEmailOtpSchema = new mongoose.Schema(
    {
        email: { type: String, required: true, lowercase: true, trim: true },
        // restaurant_login: the restaurant owner's email sign-in code (SOW plan 6.5).
        purpose: { type: String, enum: ['verify_email', 'password_reset', 'restaurant_login'], required: true },
        codeHash: { type: String, required: true },
        expiresAt: { type: Date, required: true },
        attempts: { type: Number, default: 0 },
    },
    { collection: 'customer_email_otps', timestamps: true },
);

customerEmailOtpSchema.index({ email: 1, purpose: 1 }, { unique: true });
customerEmailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const CustomerEmailOtp =
    mongoose.models.CustomerEmailOtp || mongoose.model('CustomerEmailOtp', customerEmailOtpSchema);
