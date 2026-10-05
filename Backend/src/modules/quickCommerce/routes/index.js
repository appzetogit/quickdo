// Quick-commerce module router.
//
// Mounted by master at /api/v1/qc, so every path below is relative to that. As a
// standalone app this file mounted on /v1/food/* -- the SAME paths master's own food
// module uses -- so those prefixes were stripped rather than left to collide.
//
// Mount ORDER IS LOAD-BEARING: the public /admin/... GETs must stay ahead of the
// authenticated /admin block, or they stop being public.

import express from 'express';
import authRoutes from '../core/auth/auth.routes.js';
import deliveryRoutes from '../modules/food/delivery/routes/delivery.routes.js';
import restaurantRoutes from '../modules/food/restaurant/routes/restaurant.routes.js';
import partnerRoutes from '../modules/food/partner/partner.routes.js';
import landingRoutes from '../modules/food/landing/routes/landing.routes.js';
import { getPublicDiningCategories, getPublicDiningRestaurants } from '../modules/food/dining/controllers/diningPublic.controller.js';
import uploadRoutes from '../modules/uploads/routes/upload.routes.js';
import restaurantAdminRoutes from '../modules/food/admin/routes/admin.routes.js';
import { adminZoneScope } from '../../../core/admin/adminZoneScope.js';
import userRoutes from '../modules/food/user/routes/user.routes.js';
import orderUserRoutes from '../modules/food/orders/routes/order.routes.user.js';
import medicalUserRoutes from '../modules/food/orders/routes/medical.routes.user.js';
import { listNearbyPharmaciesController } from '../modules/food/orders/controllers/prescriptionRequest.controller.js';
import paymentRoutes from '../core/payments/payment.routes.js';
import fcmRoutes from '../core/notifications/fcm.routes.js';
import notificationRoutes from '../../../core/notifications/notification.routes.js';
import { authMiddleware } from '../core/auth/auth.middleware.js';
import * as businessSettingsController from '../modules/food/admin/controllers/businessSettings.controller.js';
import * as adminController from '../modules/food/admin/controllers/admin.controller.js';
import { requireRoles } from '../../../core/roles/role.middleware.js';
import { getQueuesController } from '../controllers/admin.controller.js';
import webhookRoutes from '../core/payments/routes/webhook.routes.js'; // ✅ NEW
import searchRoutes from '../modules/food/search/routes/search.routes.js';
import chatRoutes from '../modules/food/chat/routes/chat.routes.js';
import returnRoutes from '../modules/food/returns/routes/return.routes.js';
import { getCashbackSettingsPublicController } from '../modules/food/user/controllers/cashback.controller.js';
import { config } from '../config/env.js';
import { getRateLimitSummary } from '../middleware/rateLimit.js';
// Platform-level vertical gate (lives in master's core, not this fork).
import { requireServiceAccess } from '../../../core/roles/serviceAccess.middleware.js';

const router = express.Router();

router.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', message: 'Server is healthy' });
});

if (config.nodeEnv !== 'production') {
    router.get('/health/rate-limit', (_req, res) => {
        res.status(200).json({ success: true, data: getRateLimitSummary() });
    });
}

// Food-prefixed auth routes (preferred)
router.use('/auth', authRoutes);

// Backward-compatible auth routes (legacy)
router.use('/auth', authRoutes);
router.use('/delivery', deliveryRoutes);
router.use('/restaurant', restaurantRoutes);
// Store and medical-store sign-up: phone check, application, resubmission.
router.use('/partner', partnerRoutes);
// Landing & hero-banners for Food user app (paths start with /food/hero-banners/...)
router.use('/', landingRoutes);
router.use('/search', searchRoutes);
router.get('/dining/categories/public', getPublicDiningCategories);
router.get('/dining/restaurants/public', getPublicDiningRestaurants);
router.use('/uploads', uploadRoutes);

// Mark business-settings/public as truly public (must be before protected admin block)
router.get('/admin/business-settings/public', businessSettingsController.getBusinessSettings);
router.get('/admin/power-scanning/public', businessSettingsController.getPowerScanningSettings);
router.get('/admin/restaurant-subscription-settings/public', adminController.getRestaurantSubscriptionSettings);
router.get('/admin/feature-settings/public', adminController.getFeatureSettings);
router.get('/admin/fee-settings/public', adminController.getFeeSettings);
router.get('/admin/cashback-settings/public', getCashbackSettingsPublicController);

router.use('/admin', authMiddleware, requireRoles('ADMIN'), requireServiceAccess('quickCommerce'), adminZoneScope('quickCommerce'), restaurantAdminRoutes);
router.use('/user', authMiddleware, requireRoles('USER'), userRoutes);
router.use('/notifications', authMiddleware, requireRoles('USER', 'RESTAURANT', 'DELIVERY_PARTNER'), notificationRoutes);
router.use('/chat', authMiddleware, requireRoles('USER', 'RESTAURANT', 'DELIVERY_PARTNER', 'ADMIN'), chatRoutes);
router.use('/orders', authMiddleware, requireRoles('USER'), orderUserRoutes);
/*
 * The pharmacy list is browsable without signing in, like food's restaurant
 * list and taxi's vehicle list.
 *
 * It sat behind the login check with everything else in /medical, so a customer
 * whose session had lapsed opened the Medical tab to "Could not load pharmacies
 * -- check your connection" while Food and Rides beside it rendered normally:
 * their browse screens are public, this one was not. Production logged these
 * 401s daily. The list is shop names, distances, hours and ratings -- nothing
 * personal -- and the handler never reads who is asking.
 *
 * Declared before the authenticated mount below so it answers first. Sending a
 * prescription and reading your own requests still require a signed-in customer.
 */
router.get('/medical/pharmacies', listNearbyPharmaciesController);
// The customer's medical section: nearby pharmacies, and prescriptions
// broadcast to all of them. Not under /orders -- a broadcast is not an order
// until a pharmacy accepts it.
router.use('/medical', authMiddleware, requireRoles('USER'), medicalUserRoutes);
// Returns carries its own per-route role gates (customer / admin / rider on one
// router), so it is mounted bare rather than behind a single requireRoles.
router.use('/returns', returnRoutes);
// The webhook MUST be mounted before '/payments'. router.use('/payments', ...) is a
// prefix match, so mounting it first ran authMiddleware on /payments/webhook/razorpay
// and 401'd every Razorpay callback — the provider retried, and QC payments never
// reconciled. HMAC signature verification is the webhook's gate, not the JWT.
router.use('/payments/webhook', webhookRoutes); // Public: signature-verified
router.use('/payments', authMiddleware, paymentRoutes);
router.use('/fcm-tokens', fcmRoutes);
router.use('/fcm-tokens', fcmRoutes);

router.get('/admin/queues', authMiddleware, requireRoles('ADMIN'), getQueuesController);

export default router;
