import { OtpRateLimit } from './otpRateLimit.model.js';
import { config } from '../../config/env.js';
import { normalizePhoneToTenDigits } from '../../utils/phone.util.js';
import { logger } from '../../utils/logger.js';

/**
 * Platform-wide OTP request budget.
 *
 * Before this, each service counted separately: food throttled per-scope in Mongo,
 * Service-Provider throttled in Redis (and therefore not at all, since REDIS_ENABLED
 * is unset and that path fails open), and taxi did not throttle at all. One phone
 * number could pull OTP_RATE_LIMIT codes from each service, times three taxi entry
 * points -- so the effective limit on SMS spend per number was roughly "no limit".
 *
 * Every OTP send path now consumes from this one budget.
 *
 * Config: OTP_RATE_LIMIT requests per OTP_RATE_WINDOW seconds (default 3 / 600).
 */

const SERVICES = Object.freeze({
    FOOD: 'food',
    QUICK_COMMERCE: 'quickCommerce',
    TAXI_USER: 'taxi:user',
    TAXI_DRIVER: 'taxi:driver',
    TAXI_ONBOARDING: 'taxi:onboarding',
    SERVICE_PROVIDER: 'serviceProvider'
});

/**
 * Consume one OTP request from a phone number's shared budget.
 *
 * @param {string} rawPhone   any format; normalised to the last 10 digits
 * @param {{service?: string}} [opts]
 * @returns {Promise<{allowed: boolean, count: number, limit: number, retryAfterSeconds: number, windowSeconds: number}>}
 */
export const consumeOtpQuota = async (rawPhone, { service = 'unknown' } = {}) => {
    const limit = config.otpRateLimit || 3;
    const windowSeconds = config.otpRateWindow || 600;

    const phone = normalizePhoneToTenDigits(rawPhone, '');
    // Nothing usable to key on. Let it through rather than lock out a legitimate
    // caller over a formatting quirk -- the callers validate the number themselves.
    if (!phone || phone.length !== 10) {
        return { allowed: true, count: 0, limit, retryAfterSeconds: 0, windowSeconds };
    }

    const now = new Date();
    const windowFloor = new Date(now.getTime() - windowSeconds * 1000);

    try {
        // Inside a live window -> increment it.
        let doc = await OtpRateLimit.findOneAndUpdate(
            { _id: phone, windowStartedAt: { $gt: windowFloor } },
            { $inc: { count: 1 }, $set: { lastService: service } },
            { new: true }
        ).lean();

        if (!doc) {
            // First request, or the previous window has aged out -> open a fresh one.
            // ponytail: two concurrent first-requests can both land here and both set
            // count=1, letting one extra SMS through at a window boundary. Bounded at
            // +1 per window. Fix with a findAndModify-based token bucket only if SMS
            // spend at the boundary ever actually shows up.
            doc = await OtpRateLimit.findOneAndUpdate(
                { _id: phone },
                { $set: { count: 1, windowStartedAt: now, lastService: service } },
                { upsert: true, new: true }
            ).lean();
        }

        const allowed = doc.count <= limit;
        const retryAfterSeconds = allowed
            ? 0
            : Math.max(1, Math.ceil((doc.windowStartedAt.getTime() + windowSeconds * 1000 - now.getTime()) / 1000));

        if (!allowed) {
            logger.warn(`OTP rate limit hit: phone=${phone} service=${service} count=${doc.count}/${limit}`);
        }

        return { allowed, count: doc.count, limit, retryAfterSeconds, windowSeconds };
    } catch (err) {
        // Fail open. If Mongo is unreachable the platform is already down; refusing
        // logins on top of that helps nobody. Logged so it is visible.
        logger.error(`OTP rate limit check failed (allowing request): ${err.message}`);
        return { allowed: true, count: 0, limit, retryAfterSeconds: 0, windowSeconds };
    }
};

/** Human-readable refusal, so every service says the same thing. */
export const otpRateLimitMessage = ({ retryAfterSeconds }) => {
    const mins = Math.ceil((retryAfterSeconds || 0) / 60);
    return mins > 1
        ? `Too many OTP requests. Please try again in ${mins} minutes.`
        : 'Too many OTP requests. Please try again in a minute.';
};

export { SERVICES as OTP_SERVICES };
