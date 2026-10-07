import jwt from 'jsonwebtoken';
import { env } from '../../../config/env.js';

export const signAccessToken = ({ sub, role }) =>
  jwt.sign({ role }, env.jwtSecret, {
    subject: sub,
    expiresIn: env.jwtExpiresIn,
  });

export const verifyAccessToken = (token) => {
  const payload = jwt.verify(token, env.jwtSecret);
  // A taxi refresh token is never an access token, even where JWT_REFRESH_SECRET
  // happens to equal the access secret. See refreshTokenService.js.
  if (payload && payload.typ === 'taxi_refresh') {
    const error = new Error('Refresh token used as access token');
    error.name = 'JsonWebTokenError';
    throw error;
  }
  return payload;
};
