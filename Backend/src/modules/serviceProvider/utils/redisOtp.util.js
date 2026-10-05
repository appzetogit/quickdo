const crypto = require('crypto');
const { getRedis, isRedisConnected } = require('../services/redisService');
const Token = require('../models/Token'); // Fallback model
const { TOKEN_TYPES } = require('./constants'); // Need to ensure constants file is reachable or define types here
// Note: imports might need adjustment based on directory structure. 
// constants is in ../utils/constants.js usually, but this file is in utils/ so ./constants

// Constants if not imported
const OTP_EXPIRY = parseInt(process.env.OTP_EXPIRY_SECONDS) || 300;
// Default aligned with master's config.otpMaxAttempts (src/config/env.js), which
// defaults to 5. Both read the same OTP_MAX_ATTEMPTS env var, so in a configured
// environment they already agree -- this only matters when the var is unset, where
// the old 3-vs-5 split gave the platform two different lockout policies.
const MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS) || 5;

// Test-OTP escape hatch. Still fail-closed: off unless ALLOW_TEST_OTP is explicitly
// 'true', and even then it applies to ONE number.
//
// It used to also require NODE_ENV !== 'production', which made it unusable on a
// staging deployment (those run NODE_ENV=production), and the only way to get a
// static OTP was to flip NODE_ENV -- which on a shared-database box also re-enables
// the write-side background jobs, including the watchdog that unassigns riders from
// live in-flight orders. Scoping to a single number is the safer trade.
//
// USE_DEFAULT_OTP is deliberately honoured ONLY outside production. It applies to
// EVERY phone, so on a publicly reachable backend sharing the live database it would
// let anyone log in as any customer.
// TEST_OTP_PHONE is a comma-separated LIST, so a whole QA team can sign in with the
// static code without opening it to every number on a publicly reachable host.
const TEST_PHONES = (process.env.TEST_OTP_PHONE || '')
  .split(',')
  .map((entry) => entry.replace(/\D/g, '').slice(-10))
  .filter(Boolean);
const STATIC_TEST_OTP = process.env.TEST_OTP_CODE || '123456';

const testOtpAllowed = () => process.env.ALLOW_TEST_OTP === 'true';
const defaultOtpForEveryone = () =>
  process.env.USE_DEFAULT_OTP === 'true' && process.env.NODE_ENV !== 'production';

const isStaticOtpPhone = (cleanPhone) =>
  (testOtpAllowed() && TEST_PHONES.includes(cleanPhone)) || defaultOtpForEveryone();

/**
 * True when this number is served the static code AND therefore must not be sent a
 * real SMS.
 *
 * Exported so services/smsService.js suppresses the message on exactly this
 * condition. The two used to be gated separately -- the SMS mock on
 * USE_DEFAULT_OTP alone, the static code on ALLOW_TEST_OTP plus a production veto --
 * and when they disagreed the result was a backend that mocked every message while
 * serving an unguessable random OTP. Nothing could log in, and the config looked
 * intentional, so it read as a broken OTP service rather than a misconfiguration.
 * One predicate for both halves is what stops that recurring.
 */
const usesStaticOtp = (phone) =>
  isStaticOtpPhone((phone || '').toString().replace(/\D/g, '').slice(-10));

// Say so loudly at boot. A static-OTP path left on by accident is invisible
// otherwise -- it looks exactly like a working login.
if (testOtpAllowed() || defaultOtpForEveryone()) {
  const scope = defaultOtpForEveryone()
    ? 'EVERY phone number'
    : `${TEST_PHONES.length} test number(s)`;
  console.warn(
    `[OTP] TEST OTP MODE ACTIVE - static code accepted for ${scope}, and their SMS ` +
    `is suppressed. Unset ALLOW_TEST_OTP / USE_DEFAULT_OTP before real users rely on this.`,
  );
}

/**
 * Generate 6-digit OTP
 */
const generateOTP = (phone = null) => {
  const cleanPhone = (phone || '').toString().replace(/\D/g, '').slice(-10);
  if (isStaticOtpPhone(cleanPhone)) {
    return STATIC_TEST_OTP;
  }
  return crypto.randomInt(100000, 1000000).toString();
};

/**
 * Hash OTP using SHA-256
 */
const hashOTP = (otp) => {
  return crypto.createHash('sha256').update(otp).digest('hex');
};

/**
 * Check the OTP request rate limit for a phone number.
 * Returns true if allowed, false if the limit is exceeded.
 *
 * The budget is PLATFORM-WIDE and lives in core/otp/otpRateLimit.service.js — the same
 * counter food and taxi consume — so a number cannot get a fresh quota per service.
 */
const checkRateLimit = async (phone) => {
  // Delegates to the platform-wide budget in core/otp, shared with food and taxi, so
  // one phone number gets ONE quota across every service rather than one per service.
  //
  // The old implementation counted in Redis and fell open when Redis was unavailable.
  // REDIS_ENABLED is optional and currently unset, which meant this check did nothing
  // at all in practice. The shared limiter is Mongo-backed for exactly that reason.
  //
  // Dynamic import because this module is CommonJS and core/otp is ESM.
  const { consumeOtpQuota, OTP_SERVICES } = await import('../../../core/otp/otpRateLimit.service.js');
  const { allowed } = await consumeOtpQuota(phone, { service: OTP_SERVICES.SERVICE_PROVIDER });
  return allowed;
};

/**
 * Store OTP (Redis Primary -> MongoDB Fallback)
 */
const storeOTP = async (phone, otpHash) => {
  const redis = getRedis();

  // 1. Try Redis
  if (isRedisConnected() && redis) {
    try {
      const key = `otp:${phone}`;
      const data = JSON.stringify({ hash: otpHash, attempts: 0 });
      await redis.set(key, data, 'EX', OTP_EXPIRY);
      console.log(`[OTP] Stored in Redis for ${phone}`);
      return true;
    } catch (err) {
      console.error('[OTP] Redis store failed, falling back to MongoDB:', err);
    }
  }

  // 2. Fallback to MongoDB
  try {
    // Delete existing tokens for this phone & type
    await Token.deleteMany({ phone, type: 'PHONE_VERIFICATION' });

    // Create new token
    await Token.create({
      phone,
      type: 'PHONE_VERIFICATION',
      token: otpHash, // Storing hash in token field for compatibility
      otp: otpHash,   // Also storing in otp field (hashed)
      expiresAt: new Date(Date.now() + OTP_EXPIRY * 1000),
      attempts: 0
    });
    console.log(`[OTP] Stored in MongoDB (Fallback) for ${phone}`);
    return true;
  } catch (err) {
    console.error('[OTP] MongoDB fallback failed:', err);
    throw new Error('Failed to generate OTP');
  }
};

/**
 * Verify OTP (Redis Primary -> MongoDB Fallback)
 * Returns: { success: true/false, message: string }
 */
const verifyOTP = async (phone, plainOtp) => {
  console.log(`[OTP] Verifying OTP for phone: ${phone}`);

  const cleanPhone = (phone || '').toString().replace(/\D/g, '').slice(-10);

  // Static OTP. Uses the same predicate and code as generateOTP so the two halves
  // cannot drift -- a generator that hands out 123456 while the verifier still expects
  // a different constant fails in a way that looks like a broken OTP service.
  if (isStaticOtpPhone(cleanPhone) && plainOtp === STATIC_TEST_OTP) {
    console.log(`[OTP] ✅ Static OTP used for ${phone}`);
    return { success: true };
  }

  const redis = getRedis();
  const inputHash = hashOTP(plainOtp);

  // 1. Try Redis
  if (isRedisConnected() && redis) {
    try {
      const key = `otp:${phone}`;
      const data = await redis.get(key);

      if (data) {
        console.log(`[OTP] Found in Redis for ${phone}`);
        const otpData = JSON.parse(data);

        // Check attempts
        if (otpData.attempts >= MAX_ATTEMPTS) {
          await redis.del(key);
          console.log(`[OTP] Max attempts exceeded for ${phone}`);
          return { success: false, message: 'Too many attempts. Please request new OTP.' };
        }

        // Verify Hash
        if (otpData.hash !== inputHash) {
          otpData.attempts += 1;
          // Update attempts, keep remaining TTL
          const ttl = await redis.ttl(key);
          if (ttl > 0) {
            await redis.set(key, JSON.stringify(otpData), 'EX', ttl);
          }
          console.log(`[OTP] Invalid OTP for ${phone}, attempts: ${otpData.attempts}`);
          return { success: false, message: 'Invalid OTP' };
        }

        // Success
        await redis.del(key);
        console.log(`[OTP] ✅ Verification successful for ${phone}`);
        return { success: true };
      } else {
        console.log(`[OTP] Not found in Redis for ${phone}, checking MongoDB...`);
      }
    } catch (err) {
      console.error('[OTP] Redis verify failed, trying MongoDB:', err);
    }
  }

  // 2. Check MongoDB (Fallback)
  try {
    const tokenDoc = await Token.findOne({
      phone,
      type: 'PHONE_VERIFICATION',
      isUsed: false
    });

    if (!tokenDoc) {
      console.log(`[OTP] ❌ Not found in MongoDB for ${phone}`);
      return { success: false, message: 'Invalid or expired OTP. Please request a new one.' };
    }

    console.log(`[OTP] Found in MongoDB for ${phone}`);

    // Check expiry
    if (tokenDoc.expiresAt < new Date()) {
      await Token.deleteOne({ _id: tokenDoc._id });
      console.log(`[OTP] Expired in MongoDB for ${phone}`);
      return { success: false, message: 'OTP expired. Please request a new one.' };
    }

    // Check attempts
    if (tokenDoc.attempts >= MAX_ATTEMPTS) {
      await Token.deleteOne({ _id: tokenDoc._id });
      console.log(`[OTP] Max attempts exceeded in MongoDB for ${phone}`);
      return { success: false, message: 'Too many attempts. Please request a new one.' };
    }

    // Verify Hash (Token stores hash in this new design)
    // Note: Old implementation stored plain OTP. 
    // This check supports both logic if needed, but we assume new OTPs are hashed.
    // If migration needed: check length of stored OTP. SHA256 hex is 64 chars.
    let isMatch = false;
    if (tokenDoc.otp.length === 64) {
      isMatch = tokenDoc.otp === inputHash;
    } else {
      // Old plain text fallback (for dev/legacy)
      isMatch = tokenDoc.otp === plainOtp;
    }

    if (!isMatch) {
      tokenDoc.attempts += 1;
      await tokenDoc.save();
      console.log(`[OTP] Invalid OTP in MongoDB for ${phone}, attempts: ${tokenDoc.attempts}`);
      return { success: false, message: 'Invalid OTP' };
    }

    // Success
    await Token.deleteOne({ _id: tokenDoc._id }); // Or mark used
    console.log(`[OTP] ✅ Verification successful (MongoDB) for ${phone}`);
    return { success: true };

  } catch (err) {
    console.error('[OTP] MongoDB verify error:', err);
    return { success: false, message: 'Verification failed. Please try again.' };
  }
};

module.exports = {
  generateOTP,
  hashOTP,
  checkRateLimit,
  storeOTP,
  verifyOTP,
  usesStaticOtp
};
