import { FoodRestaurant } from '../../modules/food/restaurant/models/restaurant.model.js';
import { issueEmailCode, consumeEmailCode, requireEmail } from './emailAuth.service.js';
import { completeRestaurantLogin } from './auth.service.js';
import { AuthError } from './errors.js';

/**
 * Restaurant owner sign-in with an emailed code (SOW plan 6.5).
 *
 *   POST /auth/restaurant/email/request-otp  { email }
 *   POST /auth/restaurant/email/verify-otp   { email, otp, fcmToken?, platform? }
 *
 * Sign-in only. A restaurant is identified by its owner's phone everywhere
 * else (registration, uniqueness, the phone OTP login, order notifications),
 * so a NEW restaurant still starts with the phone flow; the email given during
 * onboarding (ownerEmail) then works as a second way in.
 *
 * The code machinery is the customer email-code one (emailAuth.service.js):
 * stored hashed, expiring, attempt-limited, single use, on the shared email
 * OTP quota. The answer after verifying is exactly the phone login's
 * (auth.service completeRestaurantLogin): pending / rejected outlets get the
 * same status screen, approved ones a session.
 *
 * Enumeration: request-otp answers the same whether or not an outlet uses the
 * address, and only emails a code when one does.
 */

const PURPOSE = 'restaurant_login';
const GENERIC = 'If a restaurant uses this email, a sign-in code is on its way.';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findByOwnerEmail = (email) =>
    FoodRestaurant.find({ ownerEmail: { $regex: new RegExp(`^\\s*${escapeRegExp(email)}\\s*$`, 'i') } })
        .sort({ status: 1, createdAt: -1 })
        .limit(5);

export async function requestRestaurantEmailOtp({ email: rawEmail } = {}) {
    const email = requireEmail(rawEmail);
    const matches = await findByOwnerEmail(email);
    if (matches.length) await issueEmailCode(email, PURPOSE);
    return { message: GENERIC, codeLength: 6 };
}

export async function verifyRestaurantEmailOtp({ email: rawEmail, otp, code, fcmToken, platform } = {}) {
    const email = requireEmail(rawEmail);
    await consumeEmailCode(email, PURPOSE, otp ?? code);
    const matches = await findByOwnerEmail(email);
    if (!matches.length) throw new AuthError('No restaurant uses this email. Sign in with your phone number.');
    /*
     * One owner can run several outlets under one email. Which one to open is
     * not something to guess, and the phone number is unique per outlet, so
     * that is where the owner is sent.
     */
    if (matches.length > 1) {
        const err = new AuthError('This email is linked to more than one outlet. Sign in with the outlet\'s phone number.');
        err.statusCode = 409;
        err.code = 'EMAIL_MULTIPLE_OUTLETS';
        throw err;
    }
    return completeRestaurantLogin(matches[0], { fcmToken, platform, email });
}
