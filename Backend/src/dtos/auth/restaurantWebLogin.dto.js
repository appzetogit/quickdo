import { z } from 'zod';
import { ValidationError } from '../../core/auth/errors.js';

const email = z.string().trim().toLowerCase().email('Enter a valid email address');

const requestSchema = z.object({
    email,
    password: z.string().min(1, 'Password is required').max(128, 'Password is too long'),
});

const ticket = z.string().min(1, 'Your login session expired. Please sign in again.');

const resendSchema = z.object({ ticket, email });

const verifySchema = z.object({
    ticket,
    email,
    otp: z
        .string()
        .min(4, 'OTP must be 4-6 digits')
        .max(6, 'OTP must be 4-6 digits'),
    fcmToken: z.string().optional().nullable(),
});

const parse = (schema, body) => {
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};

export const validateRestaurantWebLoginRequestDto = (body) => parse(requestSchema, body);
export const validateRestaurantWebLoginResendDto = (body) => parse(resendSchema, body);
export const validateRestaurantWebLoginVerifyDto = (body) => parse(verifySchema, body);
