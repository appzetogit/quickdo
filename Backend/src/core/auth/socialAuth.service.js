import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { FoodUser } from '../users/user.model.js';
import { findUserByVerifiedEmail } from '../identity/identityLink.service.js';
import { socialSignInConfig } from '../settings/platformProfile.service.js';
import { issueUserSession, publicUser } from './userSession.js';
import { ValidationError, AuthError, ForbiddenError } from './errors.js';
import { logger } from '../../utils/logger.js';

/**
 * Google and Apple sign-in (SOW plan 2.4).
 *
 * The app (Flutter, or the web) runs the provider's own sign-in and sends us the
 * ID token it got back. We never trust what the token SAYS until we have checked
 * who SIGNED it and who it was issued TO:
 *
 *   Google  google-auth-library verifies the signature against Google's keys, the
 *           issuer, the expiry, and that `aud` is one of OUR client ids.
 *   Apple   the token is verified against Apple's published keys (JWKS, via
 *           jwks-rsa), issuer https://appleid.apple.com, expiry, and `aud` is one of
 *           our bundle ids / Services IDs. If the app used a nonce, it must match.
 *
 * Then: find the user by the provider's stable id (`sub`); failing that, link to
 * the account that already signs in with the same VERIFIED email
 * (core/identity); failing that, create one. Phone sign-in is untouched -- a social
 * account adds a phone later through /auth/user/phone/*.
 *
 * Audiences come from Master settings > Integrations, else GOOGLE_CLIENT_IDS /
 * APPLE_CLIENT_IDS. With none configured the provider is refused outright: an
 * unchecked audience would accept a token minted for ANY app.
 */

const PROVIDERS = new Set(['google', 'apple']);
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URI = 'https://appleid.apple.com/auth/keys';

class ConflictError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConflictError';
        this.statusCode = 409;
    }
}

class NotConfiguredError extends Error {
    constructor(provider) {
        super(`${provider === 'apple' ? 'Apple' : 'Google'} sign-in is not configured on this server`);
        this.name = 'NotConfiguredError';
        this.statusCode = 503;
        this.expose = true;
    }
}

/* ------------------------------------------------------------------------ */
/* Token verification                                                       */
/* ------------------------------------------------------------------------ */

let googleClient = null;
let googleClientOverride = null;
const getGoogleClient = async () => {
    if (googleClientOverride) return googleClientOverride;
    if (!googleClient) {
        const { OAuth2Client } = await import('google-auth-library');
        googleClient = new OAuth2Client();
    }
    return googleClient;
};

let appleJwks = null;
let appleKeyOverride = null;
const getAppleSigningKey = async (kid) => {
    if (appleKeyOverride) return appleKeyOverride(kid);
    if (!appleJwks) {
        const jwksClient = (await import('jwks-rsa')).default;
        appleJwks = jwksClient({ jwksUri: APPLE_JWKS_URI, cache: true, cacheMaxAge: 6 * 60 * 60 * 1000, rateLimit: true, jwksRequestsPerMinute: 10, timeout: 8000 });
    }
    const key = await appleJwks.getSigningKey(kid);
    return key.getPublicKey();
};

/**
 * Tests only. `google`: an object with verifyIdToken({ idToken, audience }) like
 * OAuth2Client. `appleKey`: (kid) => PEM public key. Pass nothing to restore.
 */
export const __setSocialVerifiersForTests = ({ google, appleKey } = {}) => {
    googleClientOverride = google || null;
    appleKeyOverride = appleKey || null;
};

const asBool = (v) => v === true || v === 'true';

/** @returns {{ subject, email, emailVerified, name, picture }} */
export const verifyGoogleIdToken = async (idToken) => {
    const audiences = socialSignInConfig().googleClientIds;
    if (!audiences.length) throw new NotConfiguredError('google');
    let payload;
    try {
        const client = await getGoogleClient();
        const ticket = await client.verifyIdToken({ idToken, audience: audiences });
        payload = ticket.getPayload();
    } catch (err) {
        logger.warn(`[Social] Google token rejected: ${err.message}`);
        throw new AuthError('Google sign-in could not be verified. Please try again.');
    }
    if (!payload?.sub) throw new AuthError('Google sign-in could not be verified. Please try again.');
    // google-auth-library checks these; checked again so a stubbed or future client cannot skip them.
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) {
        throw new AuthError('Google sign-in could not be verified. Please try again.');
    }
    if (!audiences.includes(payload.aud)) throw new AuthError('Google sign-in could not be verified. Please try again.');
    return {
        subject: String(payload.sub),
        email: String(payload.email || '').toLowerCase(),
        emailVerified: asBool(payload.email_verified),
        name: String(payload.name || '').trim(),
        picture: String(payload.picture || ''),
    };
};

/** @returns {{ subject, email, emailVerified, name, picture }} */
export const verifyAppleIdToken = async (idToken, { nonce } = {}) => {
    const audiences = socialSignInConfig().appleClientIds;
    if (!audiences.length) throw new NotConfiguredError('apple');
    let payload;
    try {
        const decoded = jwt.decode(idToken, { complete: true });
        if (!decoded?.header?.kid) throw new Error('no key id');
        if (decoded.header.alg !== 'RS256') throw new Error(`unexpected alg ${decoded.header.alg}`);
        const publicKey = await getAppleSigningKey(decoded.header.kid);
        payload = jwt.verify(idToken, publicKey, {
            algorithms: ['RS256'],
            issuer: APPLE_ISSUER,
            audience: audiences,
            clockTolerance: 60,
        });
    } catch (err) {
        logger.warn(`[Social] Apple token rejected: ${err.message}`);
        throw new AuthError('Apple sign-in could not be verified. Please try again.');
    }
    if (!payload?.sub) throw new AuthError('Apple sign-in could not be verified. Please try again.');
    if (nonce) {
        // iOS sends the SHA-256 of the nonce to Apple; the web sends it as is.
        const hashed = crypto.createHash('sha256').update(String(nonce)).digest('hex');
        if (payload.nonce !== hashed && payload.nonce !== String(nonce)) {
            throw new AuthError('Apple sign-in could not be verified. Please try again.');
        }
    }
    return {
        subject: String(payload.sub),
        email: String(payload.email || '').toLowerCase(),
        emailVerified: asBool(payload.email_verified),
        name: '',
        picture: '',
    };
};

const verifyToken = (provider, idToken, opts) =>
    provider === 'google' ? verifyGoogleIdToken(idToken) : verifyAppleIdToken(idToken, opts);

/* ------------------------------------------------------------------------ */
/* Find, link or create                                                     */
/* ------------------------------------------------------------------------ */

const providerEntry = (provider, identity) => ({
    provider,
    subject: identity.subject,
    email: identity.email || '',
    emailVerified: identity.emailVerified,
    linkedAt: new Date(),
});

const findByProvider = (provider, subject) =>
    FoodUser.findOne({ authProviders: { $elemMatch: { provider, subject } } });

const assertActive = (user) => {
    if (user.isActive === false) throw new ForbiddenError('Your account has been deactivated. Please contact support.');
};

/**
 * Sign in with a provider ID token.
 *
 * @param {'google'|'apple'} provider
 * @param {{ idToken: string, nonce?: string, name?: string, fcmToken?: string, platform?: string }} body
 *        `name` is for Apple, which sends the user's name to the app only on the
 *        first sign-in and never in the token.
 */
export const signInWithProvider = async (provider, { idToken, nonce, name, fcmToken, platform } = {}) => {
    if (!PROVIDERS.has(provider)) throw new ValidationError('Unknown sign-in provider');
    if (!idToken || typeof idToken !== 'string') throw new ValidationError('idToken is required');
    const identity = await verifyToken(provider, idToken, { nonce });
    const displayName = String(name || identity.name || '').trim().slice(0, 80);

    let user = await findByProvider(provider, identity.subject);
    let isNewUser = false;
    let linked = false;

    if (!user && identity.email && identity.emailVerified) {
        // An account that already signs in with this (verified) address: link to it.
        const existing = await findUserByVerifiedEmail(identity.email, { includeUnverified: true });
        if (existing) {
            const update = {
                $push: { authProviders: providerEntry(provider, identity) },
                $set: { emailVerified: true },
            };
            if (!existing.emailVerified) {
                /*
                 * The address was registered but never verified -- possibly by someone
                 * else squatting it. The provider has just proven who owns it, so the
                 * unproven password set by whoever registered is discarded rather than
                 * handed a linked account.
                 */
                update.$unset = { passwordHash: 1 };
            }
            user = await FoodUser.findOneAndUpdate(
                { _id: existing._id, 'authProviders.subject': { $ne: identity.subject } },
                update,
                { new: true },
            ) || await findByProvider(provider, identity.subject);
            linked = true;
        }
    }

    if (!user) {
        try {
            const emailFree = identity.email && identity.emailVerified
                && !(await FoodUser.exists({ loginEmail: identity.email }));
            user = await FoodUser.create({
                ...(emailFree ? { loginEmail: identity.email, emailVerified: true } : {}),
                ...(identity.email ? { email: identity.email } : {}),
                ...(displayName ? { name: displayName } : {}),
                ...(identity.picture ? { profileImage: identity.picture } : {}),
                authProviders: [providerEntry(provider, identity)],
                isVerified: true,
                role: 'USER',
            });
            isNewUser = true;
        } catch (err) {
            if (err?.code === 11000) {
                // Two first sign-ins racing: the winner's account is the account.
                user = await findByProvider(provider, identity.subject);
                if (!user && err?.keyPattern?.phone) {
                    logger.error('Social sign-up blocked by the legacy users.phone_1 index; run scripts/migrate-users-phone-index.mjs');
                    const e = new Error(`${provider === 'apple' ? 'Apple' : 'Google'} sign-up is not available yet. Please sign in with your phone number.`);
                    e.statusCode = 503;
                    e.expose = true;
                    throw e;
                }
            }
            if (!user) throw err;
        }
    }

    assertActive(user);
    if (displayName && !user.name) {
        await FoodUser.updateOne({ _id: user._id }, { $set: { name: displayName } });
        user.name = displayName;
    }
    if (fcmToken) {
        await FoodUser.updateOne(
            { _id: user._id },
            { $addToSet: { [platform === 'mobile' ? 'fcmTokenMobile' : 'fcmTokens']: String(fcmToken).trim() } },
        ).catch(() => {});
    }

    const tokens = await issueUserSession(user);
    return { ...tokens, user: publicUser(user), isNewUser, linked, provider };
};

/** A signed-in customer links Google / Apple to their account. */
export const linkProvider = async (userId, provider, { idToken, nonce } = {}) => {
    if (!PROVIDERS.has(provider)) throw new ValidationError('Unknown sign-in provider');
    if (!idToken) throw new ValidationError('idToken is required');
    const identity = await verifyToken(provider, idToken, { nonce });
    const owner = await findByProvider(provider, identity.subject);
    if (owner && String(owner._id) !== String(userId)) {
        throw new ConflictError(`This ${provider === 'apple' ? 'Apple' : 'Google'} account already signs in to another account.`);
    }
    if (owner) return { user: publicUser(owner), linked: false };
    const user = await FoodUser.findOneAndUpdate(
        { _id: userId, authProviders: { $not: { $elemMatch: { provider } } } },
        { $push: { authProviders: providerEntry(provider, identity) } },
        { new: true },
    );
    if (!user) throw new ConflictError(`A different ${provider === 'apple' ? 'Apple' : 'Google'} account is already linked. Unlink it first.`);
    return { user: publicUser(user), linked: true };
};

/** Remove a linked provider, as long as the customer keeps another way to sign in. */
export const unlinkProvider = async (userId, provider) => {
    if (!PROVIDERS.has(provider)) throw new ValidationError('Unknown sign-in provider');
    const user = await FoodUser.findById(userId).select('+passwordHash');
    if (!user) throw new AuthError('Account not found');
    const others = (user.authProviders || []).filter((p) => p.provider !== provider);
    const hasOtherWay = Boolean(user.phone) || Boolean(user.passwordHash && user.emailVerified) || others.length > 0;
    if (!hasOtherWay) throw new ValidationError('Add a phone number or a password first, or you could not sign in again.');
    user.authProviders = others;
    await user.save();
    return { user: publicUser(user) };
};
