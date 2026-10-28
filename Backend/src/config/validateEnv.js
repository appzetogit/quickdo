import { config } from './env.js';
import { logger } from '../utils/logger.js';

/** Secrets shorter than this are brute-forceable and rejected in production. */
const MIN_SECRET_LENGTH = 32;

/**
 * Placeholder values that ship in .env.example. If any of these reach production it
 * means the real value was never set, so we fail rather than boot insecurely.
 */
const PLACEHOLDER_VALUES = new Set([
    'your_jwt_access_secret',
    'your_jwt_refresh_secret',
    'changeme',
    'secret',
    'your_razorpay_key_id',
    'your_razorpay_key_secret',
    'your_razorpay_webhook_secret',
]);

/**
 * True when a value is still a template rather than a real credential.
 *
 * Catches three shapes, because a half-filled .env is the most common way a bad
 * production config reaches boot:
 *  - exact placeholders shipped in .env.example (`your_jwt_access_secret`)
 *  - REPLACE_ME / CHANGEME / TODO markers, including embedded ones such as
 *    `rzp_live_REPLACE_ME`
 *  - unreplaced angle-bracket templates such as `<REAL_DB_NAME>`, which would
 *    otherwise surface much later as an opaque connection error
 */
const isPlaceholder = (value) => {
    if (typeof value !== 'string') return false;
    const v = value.trim().toLowerCase();
    if (!v) return false;
    if (PLACEHOLDER_VALUES.has(v)) return true;
    if (/replace_me|changeme|change_me|\btodo\b|xxxxx/.test(v)) return true;
    if (/<[^>]+>/.test(value)) return true;
    return false;
};

/**
 * Validates required environment configuration on startup.
 *
 * Two severities:
 *  - `missing`  -> fatal, the process exits (the app cannot work correctly at all).
 *  - `warnings` -> logged, boot continues (degraded but functional).
 *
 * Production adds guardrails that are deliberately absent in development, so a
 * dev-tuned .env cannot be promoted to production unnoticed. That promotion is not
 * hypothetical here: USE_DEFAULT_OTP=true is the normal local setting, and until the
 * check below existed nothing stopped it reaching a live server.
 */
export const validateConfig = () => {
    const missing = [];
    const warnings = [];
    const isProd = config.nodeEnv === 'production';

    // ── Always required ────────────────────────────────────────────────────────
    if (!config.mongodbUri) {
        missing.push('MONGO_URI or MONGODB_URI');
    } else if (isPlaceholder(config.mongodbUri)) {
        // e.g. a `<REAL_DB_NAME>` template left in the connection string. Caught here
        // rather than as an opaque driver error 15s into startup.
        missing.push('MONGODB_URI still contains an unreplaced placeholder (e.g. <REAL_DB_NAME>)');
    }
    if (!config.jwtAccessSecret) {
        missing.push('JWT_ACCESS_SECRET or JWT_SECRET');
    }
    if (!config.jwtRefreshSecret) {
        missing.push('JWT_REFRESH_SECRET');
    }
    if (config.redisEnabled && !config.redisUrl) {
        missing.push('REDIS_URL (required when REDIS_ENABLED=true)');
    }
    if (config.bullmqEnabled && !config.redisEnabled) {
        missing.push('REDIS_ENABLED=true (required when BULLMQ_ENABLED=true)');
    }

    // ── Secret hygiene ─────────────────────────────────────────────────────────
    if (config.jwtAccessSecret && config.jwtRefreshSecret
        && config.jwtAccessSecret === config.jwtRefreshSecret) {
        const msg = 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are identical — a leaked access token can then be replayed as a refresh token';
        if (isProd) missing.push(msg); else warnings.push(msg);
    }
    for (const [name, value] of [
        ['JWT_ACCESS_SECRET', config.jwtAccessSecret],
        ['JWT_REFRESH_SECRET', config.jwtRefreshSecret],
    ]) {
        if (!value) continue;
        if (isPlaceholder(value)) {
            missing.push(`${name} is still the .env.example placeholder value`);
        } else if (value.length < MIN_SECRET_LENGTH) {
            const msg = `${name} is only ${value.length} chars (minimum ${MIN_SECRET_LENGTH})`;
            if (isProd) missing.push(msg); else warnings.push(msg);
        }
    }

    // ── Production-only guardrails ─────────────────────────────────────────────
    if (isProd) {
        // The single most dangerous dev flag. It makes every OTP "1234", i.e. anyone
        // can sign in as any phone number.
        //
        // Fatal by default. The escape hatch exists because flipping USE_DEFAULT_OTP
        // to false requires working SMS delivery — if the DLT template does not match
        // exactly, sends fail and NOBODY can log in. That makes "just turn it off" a
        // potentially worse outage than the hole itself, so operators need a way to
        // restore service while they fix SMS, without the fix being a silent revert.
        // The acknowledgement is deliberately verbose and greppable.
        if (config.useDefaultOtp) {
            if (process.env.ALLOW_INSECURE_DEFAULT_OTP === 'true') {
                warnings.push(
                    'SECURITY: USE_DEFAULT_OTP=true in production — every OTP is "1234" and any account can be accessed with any phone number. '
                    + 'Running only because ALLOW_INSECURE_DEFAULT_OTP=true. Fix SMS delivery, then remove BOTH variables.',
                );
            } else {
                missing.push(
                    'USE_DEFAULT_OTP must be false in production (it forces every OTP to 1234). '
                    + 'If you must boot before SMS is fixed, set ALLOW_INSECURE_DEFAULT_OTP=true to acknowledge the risk.',
                );
            }
        }

        // A static phone/code pair is a permanent sign-in backdoor for whoever knows
        // it. The verify path already refuses to honour it outside development, so
        // this is here to tell the operator the variable is doing nothing.
        if (process.env.STATIC_OTP_PHONE || process.env.STATIC_OTP_CODE) {
            warnings.push(
                'STATIC_OTP_PHONE / STATIC_OTP_CODE are set but ignored in production (they are a sign-in bypass). Remove them from the production .env.',
            );
        }

        // Long-lived access tokens cannot be revoked; the refresh token exists for
        // longevity. A 7d access token means a stolen one is valid for a week.
        if (/^(\d+)d$/.test(String(config.jwtAccessExpiresIn || ''))) {
            warnings.push(
                `JWT_ACCESS_EXPIRES is "${config.jwtAccessExpiresIn}" — access tokens should be minutes (e.g. 15m) and lifetime extended via the refresh token instead`,
            );
        }

        // Rate limiting, socket fan-out across instances and BullMQ all degrade or
        // break without Redis.
        if (!config.redisEnabled) {
            warnings.push(
                'REDIS_ENABLED is not true — rate limits fall back to per-process memory and Socket.IO cannot fan out across instances',
            );
        }
        if (!config.bullmqEnabled) {
            warnings.push(
                'BULLMQ_ENABLED is not true — queued order, notification, payment and tracking jobs will not run',
            );
        }

        // Payments: a missing webhook secret means webhook signatures cannot be
        // verified, so payment confirmations could be forged.
        if (config.razorpayKeyId || config.razorpayKeySecret) {
            for (const [name, value] of [
                ['RAZORPAY_KEY_ID', config.razorpayKeyId],
                ['RAZORPAY_KEY_SECRET', config.razorpayKeySecret],
                ['RAZORPAY_WEBHOOK_SECRET', config.razorpayWebhookSecret],
            ]) {
                if (!value) {
                    missing.push(`${name} (Razorpay is configured, so all three live values are required)`);
                } else if (isPlaceholder(value)) {
                    missing.push(`${name} is still a placeholder — set the live value from the Razorpay dashboard`);
                }
            }
            if (String(config.razorpayKeyId || '').startsWith('rzp_test_')) {
                warnings.push('RAZORPAY_KEY_ID is a test key (rzp_test_*) while NODE_ENV=production');
            }
        }

        if (config.socketCorsOrigin === '*') {
            warnings.push('SOCKET_CORS_ORIGIN is "*" — restrict it to your frontend origin(s)');
        }
    }

    // ── Integrations (non-fatal in every environment) ──────────────────────────
    if (config.petpoojaEnabled) {
        const petpoojaMissing = [];
        if (!config.petpoojaApiKey) petpoojaMissing.push('PETPOOJA_API_KEY');
        if (!config.petpoojaClientCode) petpoojaMissing.push('PETPOOJA_CLIENT_CODE');
        if (petpoojaMissing.length > 0) {
            warnings.push(`Petpooja integration is enabled but missing: ${petpoojaMissing.join(', ')}`);
        }
    }

    for (const warning of warnings) {
        logger.warn(`[config] ${warning}`);
    }

    if (missing.length > 0) {
        logger.error(`Invalid environment configuration:\n  - ${missing.join('\n  - ')}`);
        process.exit(1);
    }

    logger.info(
        `[config] validated for ${config.nodeEnv} (redis=${config.redisEnabled} bullmq=${config.bullmqEnabled})`,
    );
};
