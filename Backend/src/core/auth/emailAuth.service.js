import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { FoodUser } from '../users/user.model.js';
import { CustomerEmailOtp } from './customerEmailOtp.model.js';
import { consumeEmailOtpQuota, otpRateLimitMessage } from '../otp/otpRateLimit.service.js';
import { createOrUpdateOtp, verifyOtp } from '../otp/otp.service.js';
import { sendCustomerCodeEmail } from '../../utils/email.js';
import { issueUserSession, publicUser, revokeUserSessions } from './userSession.js';
import { ValidationError, AuthError, ForbiddenError } from './errors.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Customer email + password sign-in and password recovery (SOW plan 2.3).
 *
 * Lives beside the phone OTP login, which is unchanged. The same `users` document
 * can have a phone, a sign-in email, linked Google / Apple accounts, or any mix;
 * every way in issues the same session (userSession.js).
 *
 *   register        email + password + name -> account (unverified) + emailed code
 *   verifyEmail     email + code            -> verified, signed in
 *   login           email + password        -> signed in; locked after repeated failures
 *   forgotPassword  email                   -> emailed reset code (same answer whether or not the account exists)
 *   resetPassword   email + code + password -> new password, every session signed out
 *   addEmail        (signed in) email + password -> adds email sign-in to a phone account
 *   changePassword  (signed in) current + new
 *   requestPhoneLink / verifyPhoneLink (signed in) -> adds a phone to an email/social account
 *
 * Brute force: the route's authRateLimiter buckets by IP + email; on top of that a
 * per-account counter locks password sign-in after AUTH_MAX_LOGIN_FAILURES wrong
 * passwords for AUTH_LOCKOUT_MINUTES. Emailed codes share the platform OTP request
 * budget (otpRateLimit.service.js) and allow OTP_MAX_ATTEMPTS guesses each.
 */

const BCRYPT_ROUNDS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export class LockedError extends Error {
    constructor(message, retryAfterSeconds) {
        super(message);
        this.name = 'LockedError';
        this.statusCode = 423;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

class ConflictError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConflictError';
        this.statusCode = 409;
    }
}

export const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const requireEmail = (value) => {
    const email = normalizeEmail(value);
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) throw new ValidationError('Enter a valid email address');
    return email;
};

/** 8 to 128 characters with at least one letter and one digit. */
export const validatePassword = (value) => {
    const password = String(value ?? '');
    if (password.length < 8) throw new ValidationError('Password must be at least 8 characters');
    if (password.length > 128) throw new ValidationError('Password must be at most 128 characters');
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        throw new ValidationError('Password must contain at least one letter and one number');
    }
    return password;
};

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

/* ------------------------------------------------------------------------ */
/* Emailed codes                                                            */
/* ------------------------------------------------------------------------ */

const CODE_TTL_MINUTES = () => Math.max(1, Number(config.otpExpiryMinutes) || 10);
const maxAttempts = () => Math.max(1, Number(config.otpMaxAttempts) || 5);

const codePepper = () => String(process.env.OTP_HASH_SECRET || config.jwtAccessSecret || 'otp');
const hashCode = (email, purpose, code) =>
    crypto.createHmac('sha256', codePepper()).update(`email|${email}|${purpose}|${String(code)}`).digest('hex');

const generateCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * Issue a code and email it. In development with USE_DEFAULT_OTP the code is
 * 123456 and is logged (never in production: a logged code is a credential).
 */
const issueCode = async (email, purpose) => {
    const quota = await consumeEmailOtpQuota(email, { service: `email:${purpose}` });
    if (!quota.allowed) {
        const err = new ValidationError(otpRateLimitMessage(quota));
        err.statusCode = 429;
        throw err;
    }
    const devCode = config.useDefaultOtp && config.nodeEnv !== 'production';
    const code = devCode ? '123456' : generateCode();
    const minutes = CODE_TTL_MINUTES();
    await CustomerEmailOtp.findOneAndUpdate(
        { email, purpose },
        { $set: { codeHash: hashCode(email, purpose, code), expiresAt: new Date(Date.now() + minutes * 60_000), attempts: 0 } },
        { upsert: true, new: true },
    );
    if (devCode) logger.info(`[EMAIL OTP DEBUG] ${purpose} code for ${email}: ${code}`);
    const sent = await sendCustomerCodeEmail(email, code, purpose, minutes);
    if (!sent && !devCode) logger.warn(`Customer ${purpose} code for ${email} was not emailed; check SMTP settings.`);
    return { sent };
};

/**
 * Check a code. The attempt is counted atomically BEFORE the compare, so parallel
 * guesses each use one up; a correct code is consumed so it cannot be replayed.
 */
const consumeCode = async (email, purpose, code) => {
    const candidate = String(code ?? '').replace(/\D/g, '');
    if (!candidate) throw new ValidationError('Enter the code from the email');
    const record = await CustomerEmailOtp.findOneAndUpdate(
        { email, purpose, expiresAt: { $gt: new Date() }, attempts: { $lt: maxAttempts() } },
        { $inc: { attempts: 1 } },
        { new: true },
    );
    if (!record) {
        const any = await CustomerEmailOtp.findOne({ email, purpose }).select('expiresAt attempts').lean();
        if (!any || any.expiresAt <= new Date()) throw new AuthError('The code has expired. Request a new one.');
        throw new AuthError('Too many attempts. Request a new code.');
    }
    const expected = Buffer.from(record.codeHash);
    const given = Buffer.from(hashCode(email, purpose, candidate));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
        throw new AuthError('Invalid code');
    }
    const consumed = await CustomerEmailOtp.findOneAndDelete({ _id: record._id, codeHash: record.codeHash });
    if (!consumed) throw new AuthError('This code was already used. Request a new one.');
};

/**
 * The same emailed-code machinery for other sign-ins (the restaurant owner's
 * email OTP, restaurantEmailAuth.service.js): hashed storage, expiry, attempt
 * limit, single use, and the shared email OTP quota.
 */
export const issueEmailCode = (email, purpose) => issueCode(requireEmail(email), purpose);
export const consumeEmailCode = (email, purpose, code) => consumeCode(requireEmail(email), purpose, code);
export { requireEmail };

/* ------------------------------------------------------------------------ */
/* Register / verify / login                                                */
/* ------------------------------------------------------------------------ */

const findByLoginEmail = (email, select = '') =>
    FoodUser.findOne({ loginEmail: email }).select(select);

const assertActive = (user) => {
    if (user.isActive === false) throw new ForbiddenError('Your account has been deactivated. Please contact support.');
};

/**
 * @returns {{ email, verificationRequired: true, codeSent: boolean }}
 */
export const registerWithEmail = async ({ email: rawEmail, password: rawPassword, name } = {}) => {
    const email = requireEmail(rawEmail);
    const password = validatePassword(rawPassword);
    const trimmedName = String(name || '').trim().slice(0, 80);
    if (!trimmedName) throw new ValidationError('Name is required');

    const existing = await findByLoginEmail(email, '+passwordHash');
    if (existing) {
        /*
         * A verified address belongs to somebody: refuse. An UNVERIFIED pure email
         * sign-up (no phone, no Google/Apple) may be re-registered -- otherwise anyone
         * could squat an address by registering it first. Only the owner of the inbox
         * can finish verification, so overwriting the pending password is safe.
         */
        const pendingOnly = !existing.emailVerified && !existing.phone && !(existing.authProviders || []).length;
        if (!pendingOnly) throw new ConflictError('An account with this email already exists. Sign in or reset your password.');
        existing.passwordHash = await hashPassword(password);
        existing.passwordUpdatedAt = new Date();
        existing.name = trimmedName;
        await existing.save();
    } else {
        try {
            await FoodUser.create({
                loginEmail: email,
                email,
                emailVerified: false,
                passwordHash: await hashPassword(password),
                passwordUpdatedAt: new Date(),
                name: trimmedName,
                isVerified: false,
                role: 'USER',
            });
        } catch (err) {
            if (err?.code === 11000) {
                if (err?.keyPattern?.phone) {
                    // The old plain unique index on users.phone is still in place
                    // (scripts/migrate-users-phone-index.mjs has not run), so only one
                    // phone-less account can exist. Say so instead of a misleading 409.
                    logger.error('Email sign-up blocked by the legacy users.phone_1 index; run scripts/migrate-users-phone-index.mjs');
                    const e = new Error('Email sign-up is not available yet. Please sign in with your phone number.');
                    e.statusCode = 503;
                    e.expose = true;
                    throw e;
                }
                throw new ConflictError('An account with this email already exists. Sign in or reset your password.');
            }
            throw err;
        }
    }

    const { sent } = await issueCode(email, 'verify_email');
    return { email, verificationRequired: true, codeSent: sent };
};

export const resendVerification = async ({ email: rawEmail } = {}) => {
    const email = requireEmail(rawEmail);
    const user = await findByLoginEmail(email, 'emailVerified');
    // Same answer either way: this endpoint must not reveal which emails have accounts.
    if (user && !user.emailVerified) await issueCode(email, 'verify_email');
    return { email, message: 'If this email needs verifying, a new code is on its way.' };
};

export const verifyEmail = async ({ email: rawEmail, otp, code } = {}) => {
    const email = requireEmail(rawEmail);
    await consumeCode(email, 'verify_email', otp ?? code);
    const user = await FoodUser.findOneAndUpdate(
        { loginEmail: email },
        { $set: { emailVerified: true, isVerified: true, loginFailures: 0 }, $unset: { lockedUntil: 1 } },
        { new: true },
    );
    if (!user) throw new AuthError('Account not found');
    if (!user.email) await FoodUser.updateOne({ _id: user._id }, { $set: { email } });
    assertActive(user);
    const tokens = await issueUserSession(user);
    return { ...tokens, user: publicUser(user), isNewUser: !user.name };
};

/**
 * One wrong password: count it, and lock the account when the count reaches the
 * limit. Done atomically so parallel guesses all count.
 */
const recordLoginFailure = async (userId) => {
    const limit = Math.max(1, Number(config.authMaxLoginFailures) || 5);
    const lockMs = Math.max(1, Number(config.authLockoutMinutes) || 15) * 60_000;
    const after = await FoodUser.findOneAndUpdate(
        { _id: userId },
        { $inc: { loginFailures: 1 } },
        { new: true, projection: { loginFailures: 1 } },
    ).lean();
    if (after && after.loginFailures >= limit) {
        await FoodUser.updateOne(
            { _id: userId },
            { $set: { lockedUntil: new Date(Date.now() + lockMs), loginFailures: 0 } },
        );
        logger.warn(`[Auth] customer ${userId} locked for ${lockMs / 60_000} min after ${limit} wrong passwords`);
        return true;
    }
    return false;
};

const lockedError = (until) => {
    const seconds = Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 1000));
    const minutes = Math.ceil(seconds / 60);
    return new LockedError(
        `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your password.`,
        seconds,
    );
};

// Compared against when the email is unknown, so a miss costs the same time as a
// wrong password and response timing does not reveal which emails exist.
let dummyHash = null;
const getDummyHash = async () => {
    if (!dummyHash) dummyHash = await bcrypt.hash('not-a-real-password-0', BCRYPT_ROUNDS);
    return dummyHash;
};

export const loginWithEmail = async ({ email: rawEmail, password, fcmToken, platform } = {}) => {
    const email = requireEmail(rawEmail);
    if (!password) throw new ValidationError('Password is required');

    const user = await findByLoginEmail(email, '+passwordHash +loginFailures +lockedUntil');
    if (!user || !user.passwordHash) {
        await bcrypt.compare(String(password), await getDummyHash());
        throw new AuthError('Invalid email or password');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw lockedError(user.lockedUntil);

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) {
        const locked = await recordLoginFailure(user._id);
        if (locked) throw lockedError(new Date(Date.now() + (Number(config.authLockoutMinutes) || 15) * 60_000));
        throw new AuthError('Invalid email or password');
    }

    if (!user.emailVerified) {
        const err = new ForbiddenError('Verify your email to sign in. We can send you a new code.');
        err.code = 'EMAIL_NOT_VERIFIED';
        throw err;
    }
    assertActive(user);

    const $set = { loginFailures: 0 };
    const update = { $set, $unset: { lockedUntil: 1 } };
    if (fcmToken) update.$addToSet = { [platform === 'mobile' ? 'fcmTokenMobile' : 'fcmTokens']: String(fcmToken).trim() };
    await FoodUser.updateOne({ _id: user._id }, update);

    const tokens = await issueUserSession(user);
    return { ...tokens, user: publicUser(user), isNewUser: false };
};

/* ------------------------------------------------------------------------ */
/* Password recovery                                                        */
/* ------------------------------------------------------------------------ */

const GENERIC_RESET_MESSAGE = 'If an account uses this email, a reset code is on its way.';

export const forgotPassword = async ({ email: rawEmail } = {}) => {
    const email = requireEmail(rawEmail);
    const user = await findByLoginEmail(email, '_id isActive');
    if (user && user.isActive !== false) {
        try {
            await issueCode(email, 'password_reset');
        } catch (err) {
            // A rate-limit refusal is reported (it is about the caller, not the
            // account); anything else is logged and hidden behind the generic answer.
            if (err.statusCode === 429) throw err;
            logger.error(`[Auth] reset code for ${email} failed: ${err.message}`);
        }
    } else {
        // Spend the same budget for unknown addresses, so the 429 cannot be used to
        // tell which emails exist.
        const quota = await consumeEmailOtpQuota(email, { service: 'email:password_reset' });
        if (!quota.allowed) {
            const err = new ValidationError(otpRateLimitMessage(quota));
            err.statusCode = 429;
            throw err;
        }
    }
    return { email, message: GENERIC_RESET_MESSAGE };
};

export const resetPassword = async ({ email: rawEmail, otp, code, newPassword, password } = {}) => {
    const email = requireEmail(rawEmail);
    const next = validatePassword(newPassword ?? password);
    await consumeCode(email, 'password_reset', otp ?? code);
    const user = await findByLoginEmail(email, '_id isActive');
    if (!user) throw new AuthError('Account not found');
    await FoodUser.updateOne(
        { _id: user._id },
        {
            $set: {
                passwordHash: await hashPassword(next),
                passwordUpdatedAt: new Date(),
                loginFailures: 0,
                // The code arrived in this inbox, so the address is proven.
                emailVerified: true,
            },
            $unset: { lockedUntil: 1 },
        },
    );
    // A reset is often a response to a compromised password: sign every device out.
    await revokeUserSessions(user._id);
    return { email, message: 'Password updated. Sign in with your new password.' };
};

/* ------------------------------------------------------------------------ */
/* Signed-in account changes                                                */
/* ------------------------------------------------------------------------ */

const loadSelf = async (userId, select = '') => {
    if (!mongoose.Types.ObjectId.isValid(String(userId || ''))) throw new AuthError('Invalid session');
    const user = await FoodUser.findById(userId).select(select);
    if (!user) throw new AuthError('Account not found');
    assertActive(user);
    return user;
};

/** A phone (or social) account adds email + password sign-in. The email is verified by code. */
export const addEmailLogin = async (userId, { email: rawEmail, password: rawPassword } = {}) => {
    const email = requireEmail(rawEmail);
    const password = validatePassword(rawPassword);
    const user = await loadSelf(userId, '+passwordHash');
    if (user.loginEmail && user.loginEmail !== email && user.emailVerified) {
        throw new ConflictError('This account already signs in with another email.');
    }
    const other = await FoodUser.findOne({ loginEmail: email, _id: { $ne: user._id } }).select('_id').lean();
    if (other) throw new ConflictError('This email is already used by another account.');

    // Re-adding the same, already verified address keeps it verified; anything else is proven by code.
    const alreadyVerified = Boolean(user.emailVerified && user.loginEmail === email);
    user.loginEmail = email;
    if (!user.email) user.email = email;
    user.emailVerified = alreadyVerified;
    user.passwordHash = await hashPassword(password);
    user.passwordUpdatedAt = new Date();
    try {
        await user.save();
    } catch (err) {
        if (err?.code === 11000) throw new ConflictError('This email is already used by another account.');
        throw err;
    }
    if (!user.emailVerified) await issueCode(email, 'verify_email');
    return { email, verificationRequired: !user.emailVerified, user: publicUser(user) };
};

export const changePassword = async (userId, { currentPassword, newPassword } = {}) => {
    const next = validatePassword(newPassword);
    const user = await loadSelf(userId, '+passwordHash');
    if (!user.passwordHash) throw new ValidationError('This account has no password yet. Add email sign-in first.');
    if (!currentPassword || !(await bcrypt.compare(String(currentPassword), user.passwordHash))) {
        throw new AuthError('Current password is incorrect');
    }
    await FoodUser.updateOne(
        { _id: user._id },
        { $set: { passwordHash: await hashPassword(next), passwordUpdatedAt: new Date(), loginFailures: 0 }, $unset: { lockedUntil: 1 } },
    );
    return { message: 'Password changed.' };
};

const PHONE_LINK_SCOPE = 'user_link_phone';

/** An email/social account adds a phone: send an SMS code to it. */
export const requestPhoneLink = async (userId, { phone } = {}) => {
    const digits = String(phone || '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) throw new ValidationError('Enter a valid 10-digit phone number');
    const user = await loadSelf(userId);
    if (user.phone) throw new ConflictError('This account already has a phone number.');
    const taken = await FoodUser.findOne({ phone: new RegExp(`${digits}$`) }).select('_id').lean();
    if (taken) throw new ConflictError('This phone number is already used by another account. Sign in with it instead.');
    await createOrUpdateOtp(digits, PHONE_LINK_SCOPE);
    return { phone: digits, message: 'OTP sent' };
};

export const verifyPhoneLink = async (userId, { phone, otp } = {}) => {
    const digits = String(phone || '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) throw new ValidationError('Enter a valid 10-digit phone number');
    const result = await verifyOtp(digits, otp, PHONE_LINK_SCOPE);
    if (!result.valid) throw new AuthError(result.reason || 'OTP verification failed');
    const user = await loadSelf(userId);
    if (user.phone) throw new ConflictError('This account already has a phone number.');
    try {
        user.phone = digits;
        user.isVerified = true;
        await user.save();
    } catch (err) {
        if (err?.code === 11000) throw new ConflictError('This phone number is already used by another account.');
        throw err;
    }
    return { user: publicUser(user) };
};

/** How this customer can sign in, for the app's account / security screen. */
export const getAccountSecurity = async (userId) => {
    const user = await loadSelf(userId, '+passwordHash +lockedUntil');
    return {
        phone: user.phone || null,
        loginEmail: user.loginEmail || null,
        emailVerified: Boolean(user.emailVerified),
        hasPassword: Boolean(user.passwordHash),
        providers: (user.authProviders || []).map(({ provider, email, linkedAt }) => ({ provider, email, linkedAt })),
        lockedUntil: user.lockedUntil && user.lockedUntil > new Date() ? user.lockedUntil : null,
        needsPhone: !user.phone,
    };
};
