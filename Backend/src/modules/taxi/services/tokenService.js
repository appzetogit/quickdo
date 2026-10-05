import jwt from 'jsonwebtoken';
import { env } from '../../../config/env.js';

export const signAccessToken = ({ sub, role }) =>
  jwt.sign({ role }, env.jwtSecret, {
    subject: sub,
    expiresIn: env.jwtExpiresIn,
  });

export const verifyAccessToken = (token) => jwt.verify(token, env.jwtSecret);
