import * as emailAuth from './emailAuth.service.js';
import * as socialAuth from './socialAuth.service.js';
import { sendResponse } from '../../utils/response.js';

/**
 * HTTP layer for customer email + password and Google / Apple sign-in. The
 * endpoints are documented for the app team in docs/flutter-auth-payments-api.md.
 *
 * 4xx errors are answered here rather than by the shared error handler so the
 * client also gets the machine-readable `code` (EMAIL_NOT_VERIFIED, ACCOUNT_LOCKED)
 * and, for a lockout, `retryAfterSeconds`. 5xx go to the shared handler.
 */
const fail = (res, next, err) => {
    const status = err?.statusCode || 500;
    if (status >= 500) return next(err);
    const body = { success: false, message: err.message, error: err.message };
    if (err.code && typeof err.code === 'string') body.code = err.code;
    if (status === 423) {
        body.code = 'ACCOUNT_LOCKED';
        body.retryAfterSeconds = err.retryAfterSeconds;
        res.set('Retry-After', String(err.retryAfterSeconds || 60));
    }
    if (status === 429) body.code = 'TOO_MANY_REQUESTS';
    return res.status(status).json(body);
};

const handle = (fn, { status = 200, message = 'OK' } = {}) => async (req, res, next) => {
    try {
        return sendResponse(res, status, message, await fn(req));
    } catch (err) {
        return fail(res, next, err);
    }
};

const selfId = (req) => req.user?.userId || req.user?.id;

const requireUser = (req, res, next) => {
    if (String(req.user?.role || '').toUpperCase() !== 'USER') {
        return res.status(403).json({ success: false, message: 'Customer sign-in required', error: 'Customer sign-in required' });
    }
    return next();
};

export const customerAuthGuards = { requireUser };

/* Email + password */
export const registerEmailController = handle((req) => emailAuth.registerWithEmail(req.body || {}), {
    status: 201, message: 'Account created. Enter the code we emailed you.',
});
export const resendVerificationController = handle((req) => emailAuth.resendVerification(req.body || {}), {
    message: 'If this email needs verifying, a new code is on its way.',
});
export const verifyEmailController = handle((req) => emailAuth.verifyEmail(req.body || {}), { message: 'Email verified' });
export const loginEmailController = handle((req) => emailAuth.loginWithEmail(req.body || {}), { message: 'Login successful' });
export const forgotPasswordController = handle((req) => emailAuth.forgotPassword(req.body || {}), {
    message: 'If an account uses this email, a reset code is on its way.',
});
export const resetPasswordController = handle((req) => emailAuth.resetPassword(req.body || {}), { message: 'Password updated' });

/* Signed in */
export const addEmailController = handle((req) => emailAuth.addEmailLogin(selfId(req), req.body || {}), {
    message: 'Email added. Enter the code we emailed you.',
});
export const changePasswordController = handle((req) => emailAuth.changePassword(selfId(req), req.body || {}), {
    message: 'Password changed',
});
export const requestPhoneLinkController = handle((req) => emailAuth.requestPhoneLink(selfId(req), req.body || {}), {
    message: 'OTP sent',
});
export const verifyPhoneLinkController = handle((req) => emailAuth.verifyPhoneLink(selfId(req), req.body || {}), {
    message: 'Phone number added',
});
export const accountSecurityController = handle((req) => emailAuth.getAccountSecurity(selfId(req)));

/* Google / Apple */
export const socialSignInController = handle((req) => socialAuth.signInWithProvider(req.params.provider, req.body || {}), {
    message: 'Login successful',
});
export const socialLinkController = handle((req) => socialAuth.linkProvider(selfId(req), req.params.provider, req.body || {}), {
    message: 'Account linked',
});
export const socialUnlinkController = handle((req) => socialAuth.unlinkProvider(selfId(req), req.params.provider), {
    message: 'Account unlinked',
});

/* Restaurant owner email sign-in (SOW plan 6.5); see restaurantEmailAuth.service.js. */
export const requestRestaurantEmailOtpController = handle(async (req) => {
    const { requestRestaurantEmailOtp } = await import('./restaurantEmailAuth.service.js');
    return requestRestaurantEmailOtp(req.body || {});
}, { message: 'If a restaurant uses this email, a sign-in code is on its way.' });
export const verifyRestaurantEmailOtpController = handle(async (req) => {
    const { verifyRestaurantEmailOtp } = await import('./restaurantEmailAuth.service.js');
    return verifyRestaurantEmailOtp(req.body || {});
}, { message: 'Code verified' });
