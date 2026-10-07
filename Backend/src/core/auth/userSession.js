import ms from 'ms';
import { signAccessToken, signRefreshToken } from './token.util.js';
import { FoodRefreshToken } from '../refreshTokens/refreshToken.model.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * A signed-in customer session: the same access + refresh token pair the phone OTP
 * login issues (auth.service.js verifyUserOtpAndLogin), so every customer API
 * accepts it unchanged, whichever way the customer signed in.
 */

/** Fields that never leave the server, however the user document was loaded. */
const PRIVATE_FIELDS = ['passwordHash', 'password', 'loginFailures', 'lockedUntil', 'fcmTokens', 'fcmTokenMobile'];

export const publicUser = (doc) => {
    if (!doc) return null;
    const user = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
    // Only stated when the hash was loaded; GET /auth/user/account always says.
    const hasPassword = user.passwordHash !== undefined ? Boolean(user.passwordHash) : undefined;
    for (const f of PRIVATE_FIELDS) delete user[f];
    if (hasPassword !== undefined) user.hasPassword = hasPassword;
    if (Array.isArray(user.authProviders)) {
        // Which providers are linked is the user's business; the provider's internal
        // subject id is not needed by any client.
        user.authProviders = user.authProviders.map(({ provider, email, linkedAt }) => ({ provider, email, linkedAt }));
    }
    user.needsPhone = !user.phone;
    return user;
};

export const issueUserSession = async (userDoc) => {
    const payload = { userId: String(userDoc._id), role: userDoc.role || 'USER' };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    const expiresAt = new Date(Date.now() + ms(config.jwtRefreshExpiresIn || '7d'));
    try {
        await FoodRefreshToken.create({ userId: userDoc._id, token: refreshToken, expiresAt });
    } catch (err) {
        // Same policy as the OTP login: a slow write must not fail the sign-in.
        logger.warn(`[Auth] refresh token not persisted for user ${userDoc._id}: ${err.message}`);
    }
    return { accessToken, refreshToken };
};

/** Sign every device out: used after a password reset. */
export const revokeUserSessions = async (userId) => {
    try {
        await FoodRefreshToken.deleteMany({ userId });
    } catch (err) {
        logger.warn(`[Auth] could not revoke sessions for user ${userId}: ${err.message}`);
    }
};
