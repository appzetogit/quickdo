import express from 'express';
import {
    requestUserOtpController,
    verifyUserOtpController,
    adminLoginController,
    refreshTokenController,
    requestRestaurantOtpController,
    verifyRestaurantOtpController,
    requestDeliveryOtpController,
    verifyDeliveryOtpController,
    logoutController,
    getMeController,
    updateAdminProfileController,
    changeAdminPasswordController,
    requestAdminForgotPasswordOtpController,
    resetAdminPasswordWithOtpController
} from './auth.controller.js';
import {
    requestUnifiedOtpController,
    verifyUnifiedOtpController
} from './unifiedAuth.controller.js';
import { authMiddleware, requireAdmin } from './auth.middleware.js';
import { authRateLimiter } from '../../middleware/rateLimit.js';
import {
    registerEmailController,
    resendVerificationController,
    verifyEmailController,
    loginEmailController,
    forgotPasswordController,
    resetPasswordController,
    addEmailController,
    changePasswordController,
    requestPhoneLinkController,
    verifyPhoneLinkController,
    accountSecurityController,
    socialSignInController,
    socialLinkController,
    socialUnlinkController,
    customerAuthGuards,
    requestRestaurantEmailOtpController,
    verifyRestaurantEmailOtpController
} from './customerAuth.controller.js';

const router = express.Router();

// router.use(authRateLimiter); // Removed global application to avoid rate-limiting /me or /refresh-token too strictly

// Unified OTP login (Food + Taxi sync)
router.post('/unified/request-otp', authRateLimiter, requestUnifiedOtpController);
router.post('/unified/verify-otp', authRateLimiter, verifyUnifiedOtpController);

// User OTP login
router.post('/user/request-otp', authRateLimiter, requestUserOtpController);
router.post('/user/verify-otp', authRateLimiter, verifyUserOtpController);

// Customer email + password (phone OTP above is unchanged). docs/flutter-auth-payments-api.md
router.post('/user/email/register', authRateLimiter, registerEmailController);
router.post('/user/email/resend-otp', authRateLimiter, resendVerificationController);
router.post('/user/email/verify', authRateLimiter, verifyEmailController);
router.post('/user/email/login', authRateLimiter, loginEmailController);
router.post('/user/password/forgot', authRateLimiter, forgotPasswordController);
router.post('/user/password/reset', authRateLimiter, resetPasswordController);

// Customer Google / Apple sign-in: the app sends the provider's ID token.
router.post('/user/social/:provider(google|apple)', authRateLimiter, socialSignInController);

// Signed-in customer: add email sign-in, change password, add a phone, link providers.
const signedInUser = [authMiddleware, customerAuthGuards.requireUser];
router.get('/user/account', ...signedInUser, accountSecurityController);
router.post('/user/email/add', authRateLimiter, ...signedInUser, addEmailController);
router.post('/user/password/change', authRateLimiter, ...signedInUser, changePasswordController);
router.post('/user/phone/request-otp', authRateLimiter, ...signedInUser, requestPhoneLinkController);
router.post('/user/phone/verify', authRateLimiter, ...signedInUser, verifyPhoneLinkController);
router.post('/user/social/:provider(google|apple)/link', authRateLimiter, ...signedInUser, socialLinkController);
router.delete('/user/social/:provider(google|apple)', ...signedInUser, socialUnlinkController);

// Restaurant OTP login
router.post('/restaurant/request-otp', authRateLimiter, requestRestaurantOtpController);
router.post('/restaurant/verify-otp', authRateLimiter, verifyRestaurantOtpController);
// Restaurant owner sign-in with an emailed 6-digit code (existing outlets; SOW plan 6.5).
router.post('/restaurant/email/request-otp', authRateLimiter, requestRestaurantEmailOtpController);
router.post('/restaurant/email/verify-otp', authRateLimiter, verifyRestaurantEmailOtpController);

// Delivery partner OTP login
router.post('/delivery/request-otp', authRateLimiter, requestDeliveryOtpController);
router.post('/delivery/verify-otp', authRateLimiter, verifyDeliveryOtpController);

// Admin login
router.post('/admin/login', authRateLimiter, adminLoginController);

// Admin forgot password (no auth required)
router.post('/admin/forgot-password/request-otp', authRateLimiter, requestAdminForgotPasswordOtpController);
router.post('/admin/forgot-password/reset', authRateLimiter, resetAdminPasswordWithOtpController);

// Refresh token
router.post('/refresh-token', refreshTokenController);

// Logout (invalidates refresh token)
router.post('/logout', logoutController);

// Authenticated user profile (requires Bearer token)
router.get('/me', authMiddleware, getMeController);

// Admin-only: profile update & change password (Bearer + ADMIN role)
router.patch('/admin/profile', authMiddleware, requireAdmin, updateAdminProfileController);
router.post('/admin/change-password', authMiddleware, requireAdmin, changeAdminPasswordController);

export default router;

