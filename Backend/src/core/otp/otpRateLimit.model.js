import mongoose from 'mongoose';

/**
 * One OTP request budget per phone number, shared by every service on the platform.
 *
 * Keyed by the normalised 10-digit phone as _id, which gives atomicity and uniqueness
 * for free -- concurrent requests for the same number contend on one document.
 *
 * Deliberately in MongoDB rather than Redis: REDIS_ENABLED is optional (and currently
 * unset), and a rate limiter that silently disappears when a cache is off is not a
 * rate limiter. Mongo is always available here because it is the primary store.
 */
const otpRateLimitSchema = new mongoose.Schema(
    {
        // normalised to the last 10 digits so +91XXXXXXXXXX and XXXXXXXXXX are one budget
        _id: { type: String },
        count: { type: Number, default: 0, min: 0 },
        windowStartedAt: { type: Date, required: true },
        // which service last consumed from this budget -- for support/debugging only
        lastService: { type: String, default: '' }
    },
    { collection: 'otp_rate_limits', timestamps: true, _id: false }
);

// Housekeeping only. The window itself is enforced in code against windowStartedAt,
// because expireAfterSeconds is baked in at index-creation time and would not follow a
// change to OTP_RATE_WINDOW. A fixed day is comfortably longer than any sane window.
otpRateLimitSchema.index({ windowStartedAt: 1 }, { expireAfterSeconds: 86400 });

export const OtpRateLimit =
    mongoose.models.OtpRateLimit || mongoose.model('OtpRateLimit', otpRateLimitSchema);
