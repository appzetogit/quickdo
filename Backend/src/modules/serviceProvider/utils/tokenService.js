const jwt = require('jsonwebtoken');

// Master's src/config/env.js resolves jwtAccessSecret as JWT_ACCESS_SECRET || JWT_SECRET.
// SP used to read JWT_SECRET alone, so when both vars are set the two halves of the app
// sign with different keys and cross-module tokens (one admin login, three panels) fail
// to verify. Resolve it exactly the way master does.
const ACCESS_SECRET = () => process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
const REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET;

/**
 * Generate access token
 * @param {Object} payload - Token payload
 * @returns {string} - JWT token
 */
const generateAccessToken = (payload) => {
  return jwt.sign(payload, ACCESS_SECRET(), {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

/**
 * Generate refresh token
 * @param {Object} payload - Token payload
 * @returns {string} - JWT refresh token
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, REFRESH_SECRET(), {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d'
  });
};

/**
 * Generate token pair (access + refresh)
 * @param {Object} payload - Token payload
 * @returns {Object} - Token pair
 */
const generateTokenPair = (payload) => {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload)
  };
};

/**
 * Verify access token
 * @param {string} token - JWT token
 * @returns {Object} - Decoded token
 */
const verifyAccessToken = (token) => {
  return jwt.verify(token, ACCESS_SECRET());
};

/**
 * Verify refresh token
 * @param {string} token - JWT refresh token
 * @returns {Object} - Decoded token
 */
const verifyRefreshToken = (token) => {
  return jwt.verify(token, REFRESH_SECRET());
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,

  /**
   * Generate temporary verification token for signup flow
   * @param {string} phone - Verified phone number
   * @returns {string} - JWT verification token
   */
  generateVerificationToken: (phone) => {
    return jwt.sign({ phone, type: 'verification' }, ACCESS_SECRET(), {
      expiresIn: '15m'
    });
  },

  /**
   * Verify verification token
   * @param {string} token - JWT verification token
   * @returns {string|null} - Phone number if valid, null otherwise
   */
  verifyVerificationToken: (token) => {
    try {
      const decoded = jwt.verify(token, ACCESS_SECRET());
      if (decoded.type !== 'verification') return null;
      return decoded.phone;
    } catch (error) {
      return null;
    }
  }
};

