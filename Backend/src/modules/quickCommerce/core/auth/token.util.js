import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../../config/env.js';

export const signAccessToken = (payload) => {
    return jwt.sign(payload, config.jwtAccessSecret, {
        expiresIn: config.jwtAccessExpiresIn
    });
};

export const signRefreshToken = (payload) => {
    // jwtid makes two tokens minted in the same second differ. Without it the payload +
    // iat are identical and the unique index on food_refresh_tokens.token throws E11000
    // when a user double-taps "Verify".
    return jwt.sign(payload, config.jwtRefreshSecret, {
        expiresIn: config.jwtRefreshExpiresIn,
        jwtid: crypto.randomUUID()
    });
};

export const verifyAccessToken = (token) => {
    return jwt.verify(token, config.jwtAccessSecret);
};

export const verifyRefreshToken = (token) => {
    return jwt.verify(token, config.jwtRefreshSecret);
};

