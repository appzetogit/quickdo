/*
 * Refresh tokens for taxi drivers and taxi users.
 *
 * Driver and rider OTP sign-in used to return one access token with the core
 * access lifetime (JWT_ACCESS_EXPIRES, 15 minutes by default) and nothing to
 * renew it with, so drivers were signed out mid-shift. Sign-in now also returns a
 * refresh token, and POST /taxi/{drivers|users}/auth/refresh-token trades it for
 * a new pair.
 *
 * Signing reuses the core helpers (core/auth/token.util.js: JWT_REFRESH_SECRET,
 * JWT_REFRESH_EXPIRES). Storage does NOT reuse core/refreshTokens: that model has
 * no family or used/revoked state, and the core refresh never rotates. Rotation
 * with reuse detection needs both, so taxi keeps its own collection.
 *
 *  - Rotation: every refresh marks the presented token used and issues a new one
 *    in the same family.
 *  - Reuse detection: presenting a token that was already used (or revoked)
 *    revokes the whole family -- whoever holds the newer token is signed out too.
 *  - Logout revokes the family.
 *  - Only a hash of the token is stored.
 *  - The account is re-checked on every refresh (deleted, blocked, inactive).
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { signRefreshToken, verifyRefreshToken } from '../../../core/auth/token.util.js';
import { signAccessToken } from './tokenService.js';
import { Driver } from '../driver/models/Driver.js';
import { User } from '../user/models/User.js';

export const TAXI_REFRESH_TOKEN_TYPE = 'taxi_refresh';

const taxiRefreshTokenSchema = new mongoose.Schema(
  {
    subjectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    role: { type: String, enum: ['driver', 'user'], required: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'taxi_refresh_tokens', timestamps: true },
);

taxiRefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const TaxiRefreshToken =
  mongoose.models.TaxiRefreshToken
  || mongoose.model('TaxiRefreshToken', taxiRefreshTokenSchema);

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const secondsUntilExpiry = (token) => {
  const decoded = jwt.decode(token);
  if (!decoded?.exp) return null;
  return Math.max(0, decoded.exp - (decoded.iat || Math.floor(Date.now() / 1000)));
};

const invalidRefresh = (message = 'Refresh token is invalid') => new ApiError(401, message);

/**
 * Whether this account may hold a session. Mirrors what sign-in allows: a driver
 * still pending approval signs in (to see their status) and may refresh, but the
 * access token stays limited by authenticate()'s approval check -- refreshing
 * never widens it. Deleted, blocked, rejected or inactive accounts are refused.
 */
const assertAccountCanRefresh = async (role, subjectId) => {
  if (role === 'driver') {
    const driver = await Driver.findById(subjectId).select('approve status deletedAt active isActive').lean();
    if (!driver || driver.deletedAt) {
      throw new ApiError(401, 'Authenticated account no longer exists');
    }
    const status = String(driver.status || '').toLowerCase();
    if (
      driver.active === false
      || driver.isActive === false
      || ['inactive', 'blocked', 'rejected', 'suspended', 'disapproved', 'deleted'].includes(status)
      || (driver.approve === false && status !== 'pending')
    ) {
      throw new ApiError(403, 'Driver account is not active');
    }
    return;
  }

  const user = await User.findById(subjectId).select('deletedAt isActive active').lean();
  if (!user) {
    throw new ApiError(401, 'Authenticated account no longer exists');
  }
  if (user.deletedAt || user.isActive === false || user.active === false) {
    throw new ApiError(403, 'User account is not active');
  }
};

const revokeFamily = (familyId, reason) => TaxiRefreshToken.updateMany(
  { familyId, revokedAt: null },
  { $set: { revokedAt: new Date(), revokedReason: reason } },
);

const issueRefreshToken = async ({ sub, role, familyId }) => {
  const refreshToken = signRefreshToken({
    sub: String(sub),
    role,
    typ: TAXI_REFRESH_TOKEN_TYPE,
    fam: familyId,
    jti: crypto.randomUUID(),
  });
  const decoded = jwt.decode(refreshToken);
  await TaxiRefreshToken.create({
    subjectId: sub,
    role,
    familyId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date((decoded?.exp || Math.floor(Date.now() / 1000) + 7 * 86400) * 1000),
  });
  return refreshToken;
};

/**
 * The sign-in payload. `token` stays for existing clients; it is the same value
 * as `accessToken`. `expiresIn` is the access token's lifetime in seconds.
 */
export const createTaxiSessionTokens = async ({ sub, role, familyId = crypto.randomUUID() }) => {
  const accessToken = signAccessToken({ sub: String(sub), role });
  const refreshToken = await issueRefreshToken({ sub, role, familyId });
  return {
    token: accessToken,
    accessToken,
    refreshToken,
    expiresIn: secondsUntilExpiry(accessToken),
  };
};

// Logout must work with an expired refresh token too; the signature still has
// to be ours.
const verifyRefreshTokenIgnoringExpiry = (rawToken) => {
  try {
    return verifyRefreshToken(rawToken);
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      return jwt.decode(rawToken);
    }
    throw error;
  }
};

const decodeTaxiRefresh = (rawToken, { ignoreExpiration = false } = {}) => {
  let payload;
  try {
    payload = ignoreExpiration
      ? verifyRefreshTokenIgnoringExpiry(rawToken)
      : verifyRefreshToken(rawToken);
  } catch {
    return null;
  }
  if (!payload || payload.typ !== TAXI_REFRESH_TOKEN_TYPE || !payload.sub || !payload.fam) {
    return null;
  }
  return payload;
};

/**
 * Trades a refresh token for a new access + refresh pair (rotation).
 * `expectedRole` is 'driver' or 'user', from the route the token was sent to.
 */
export const rotateTaxiRefreshToken = async (rawToken, expectedRole) => {
  const token = String(rawToken || '').trim();
  if (!token) {
    throw new ApiError(400, 'refreshToken is required');
  }

  const payload = decodeTaxiRefresh(token);
  if (!payload || payload.role !== expectedRole) {
    throw invalidRefresh();
  }

  const tokenHash = hashToken(token);
  const now = new Date();
  // Atomic claim: of two requests racing with the same token, one wins and the
  // other is treated as reuse.
  const claimed = await TaxiRefreshToken.findOneAndUpdate(
    { tokenHash, usedAt: null, revokedAt: null },
    { $set: { usedAt: now } },
    { new: true },
  );

  if (!claimed) {
    const known = await TaxiRefreshToken.findOne({ tokenHash }).lean();
    if (known) {
      // Already used or revoked: someone is replaying it. End the whole session.
      await revokeFamily(known.familyId, 'reuse_detected');
      throw invalidRefresh('Refresh token has already been used. Please sign in again.');
    }
    throw invalidRefresh();
  }

  if (String(claimed.subjectId) !== String(payload.sub) || claimed.role !== expectedRole) {
    await revokeFamily(claimed.familyId, 'subject_mismatch');
    throw invalidRefresh();
  }

  try {
    await assertAccountCanRefresh(expectedRole, claimed.subjectId);
  } catch (error) {
    await revokeFamily(claimed.familyId, 'account_inactive');
    throw error;
  }

  return createTaxiSessionTokens({
    sub: claimed.subjectId,
    role: expectedRole,
    familyId: claimed.familyId,
  });
};

/**
 * Revokes the session (refresh-token family) the token belongs to. Idempotent:
 * an unknown or already-revoked token is not an error.
 */
export const revokeTaxiRefreshToken = async (rawToken, expectedRole) => {
  const token = String(rawToken || '').trim();
  if (!token) {
    throw new ApiError(400, 'refreshToken is required');
  }
  const payload = decodeTaxiRefresh(token, { ignoreExpiration: true });
  if (!payload || payload.role !== expectedRole) {
    return { revoked: false };
  }
  const row = await TaxiRefreshToken.findOne({ tokenHash: hashToken(token) }).lean();
  if (!row) {
    return { revoked: false };
  }
  const result = await revokeFamily(row.familyId, 'logout');
  return { revoked: (result.modifiedCount || 0) > 0 };
};
