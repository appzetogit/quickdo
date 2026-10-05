import express from 'express';
import authRoutes from '../core/auth/auth.routes.js';
import deliveryRoutes from '../modules/food/delivery/routes/delivery.routes.js';
import restaurantRoutes from '../modules/food/restaurant/routes/restaurant.routes.js';
import landingRoutes from '../modules/food/landing/routes/landing.routes.js';
import { getPublicDiningRestaurants } from '../modules/food/dining/controllers/diningPublic.controller.js';
import uploadRoutes from '../modules/uploads/routes/upload.routes.js';
import restaurantAdminRoutes from '../modules/food/admin/routes/admin.routes.js';
import userRoutes from '../modules/food/user/routes/user.routes.js';
import chatRoutes from '../modules/food/chat/routes/chat.routes.js';
import orderUserRoutes from '../modules/food/orders/routes/order.routes.user.js';
import paymentRoutes from '../core/payments/payment.routes.js';
import fcmRoutes from '../core/notifications/fcm.routes.js';
import notificationRoutes from '../core/notifications/notification.routes.js';
import { authMiddleware } from '../core/auth/auth.middleware.js';
import * as businessSettingsController from '../modules/food/admin/controllers/businessSettings.controller.js';
import { getPublicFeeSettingsController } from '../modules/food/user/controllers/userSettings.controller.js';
import { getCashbackSettingsPublicController } from '../modules/food/user/controllers/cashback.controller.js';
import { requireRoles } from '../core/roles/role.middleware.js';
import { requireServiceAccess } from '../core/roles/serviceAccess.middleware.js';
import { getQueuesController } from '../controllers/admin.controller.js';
import { getPublicEnvController } from '../modules/food/landing/controllers/publicEnv.controller.js';
import { getMyActivityController, getMySpendController } from '../core/activity/activity.controller.js';
import webhookRoutes from '../core/payments/routes/webhook.routes.js'; // ✅ NEW
import petpoojaWebhookRoutes from '../modules/food/orders/routes/petpooja.routes.js';
import searchRoutes from '../modules/food/search/routes/search.routes.js';
import { taxiRouter } from '../modules/taxi/routes/index.js';
import { promotionsRouter as taxiPromotionsRouter } from '../modules/taxi/admin/promotions/routes/index.js';
// Service-Provider module is CommonJS (see modules/serviceProvider/package.json).
// ESM importing CJS yields module.exports as the default export.
import spRouter from '../modules/serviceProvider/routes/index.js';
// Quick-commerce is a fork of this repo's own food module -- 55 of its 61 model names
// were identical. Its models are renamed QC* on qc_* collections so nothing shares a
// collection with food, and its routes are mounted here rather than on /v1/food.
import qcRouter from '../modules/quickCommerce/routes/index.js';
// Platform module kill-switch: lets one vertical be taken out of service without
// restarting the process the other three share.
import platformModuleRoutes from '../core/modules/module.routes.js';
import platformSettingRoutes from '../core/config/config.routes.js';
import { zoneSettingsWriteGuard } from '../core/admin/zoneAdminSettings.js';
import appServicesRoutes from '../core/appServices/appServices.routes.js';
import platformAdminRoutes from '../core/admin/platformAdmins.routes.js';
import supportInboxRoutes from '../core/support/supportInbox.routes.js';
import couponListRoutes from '../core/promotions/couponList.routes.js';
import platformPnlRoutes from '../core/finance/platformPnl.routes.js';
import homeContentRoutes from '../core/cms/homeContent.routes.js';
import commissionOverviewRoutes from '../core/finance/commissionOverview.routes.js';
import myOrdersRoutes from '../core/orders/myOrders.routes.js';
import { getPublicAppLegal } from '../core/settings/appLegal.js';
import { adminZoneScope } from '../core/admin/adminZoneScope.js';
import { requireModuleEnabled } from '../middleware/moduleEnabled.js';
import { MODULES } from '../core/modules/moduleRegistry.js';

const router = express.Router();

/**
 * Ad-blocker-safe path aliases.
 *
 * uBlock Origin, AdBlock and friends match substrings like "banner", "addon" and
 * "promo" in a request URL and abort the XHR with ERR_BLOCKED_BY_CLIENT. The
 * server never sees the request, so the affected admin screens (hero banners,
 * dining/gourmet/landing banners, add-ons) just render empty with no error --
 * which is exactly how they were being reported as "broken".
 *
 * Clients call the neutral alias; this rewrites it back to the real path before
 * routing, so every existing route keeps working unchanged and old bundles that
 * still use the original paths are unaffected.
 */
const PATH_ALIASES = [
    ['/showcase-items', '/hero-banners'],
    ['/item-extras', '/addons'],
    ['/earning-extras', '/earning-addons'],
    ['/earning-extra-history', '/earning-addon-history'],
    ['/earning-extra-completions', '/earning-addon-completions'],
    // "my-deals" before "deals" so the longer form is not rewritten twice.
    ['/my-deals', '/my-offers'],
    ['/deals', '/offers'],
    ['/insights', '/analytics'],
];

// Rewrite the path only. Substituting across the whole URL also rewrote the query
// string, so a global search for "deals" was silently answered as a search for
// "offers" -- same for any user-supplied value containing an aliased word.
router.use((req, _res, next) => {
    const q = req.url.indexOf('?');
    let path = q === -1 ? req.url : req.url.slice(0, q);
    const search = q === -1 ? '' : req.url.slice(q);

    for (const [alias, real] of PATH_ALIASES) {
        if (path.includes(alias)) {
            path = path.split(alias).join(real);
        }
    }
    req.url = path + search;
    next();
});

// The kill-switch lives at the platform root, NOT under a vertical's /admin: it
// exists to act on a misbehaving vertical, so it must not depend on one.
router.use('/v1/platform/modules', platformModuleRoutes);

/*
 * Master / Global settings, at the platform root for the same reason as the
 * kill-switch above: these are the rules that apply to every vertical, and
 * mounting them beneath /food/admin would reproduce the problem they exist to
 * solve -- a platform-wide rule that lives inside one vertical's panel.
 *
 * Authenticated admins only. Writes additionally require `settings.write`,
 * enforced inside the router.
 */
// Sub-admins may change only zone-level values for their own zones (core/admin/zoneAdminSettings.js).
router.use('/v1/platform/settings', authMiddleware, requireRoles('ADMIN'), zoneSettingsWriteGuard, platformSettingRoutes);

/*
 * Which services the customer app shows, platform-wide and per zone. The read
 * is public (the app asks before sign-in); the admin half authenticates inside
 * the router. See core/appServices.
 */
router.use('/v1/platform/app-services', appServicesRoutes);
// Admin accounts for every panel (food, quick commerce, medical, taxi).
router.use('/v1/platform/admins', platformAdminRoutes);
// One support inbox over every service's tickets (Master > Help & Support).
router.use('/v1/platform/support', supportInboxRoutes);
// Every service's coupons in one list (Master > Coupons).
router.use('/v1/platform/coupons', couponListRoutes);
// What the platform kept, across every service (Master > Platform Earnings).
router.use('/v1/platform/pnl', platformPnlRoutes);
// Every home-screen banner in one list (Master > Home Screen Banners).
router.use('/v1/platform/home-content', homeContentRoutes);
// What the platform takes from every partner (Master > Commission Overview).
router.use('/v1/platform/commission', commissionOverviewRoutes);
// The customer's orders from every service, in one list (the app's My Orders).
router.use('/v1/platform/me', authMiddleware, requireRoles('USER'), myOrdersRoutes);
// Terms and privacy for one app, public (shown before sign-in).
router.get('/v1/platform/legal/:app/:kind', getPublicAppLegal);

router.get('/v1/health', (req, res) => {
    res.status(200).json({ status: 'UP', message: 'Server is healthy' });
});

// Food-prefixed auth routes (preferred)
router.use('/v1/food/auth', authRoutes);

// Backward-compatible auth routes (legacy)
router.use('/v1/auth', authRoutes);
router.use('/v1/food/delivery', deliveryRoutes);
router.use('/v1/food/restaurant', restaurantRoutes);
// Landing & hero-banners for Food user app (paths start with /food/hero-banners/...)
router.use('/v1/food', landingRoutes);
router.use('/v1/food/search', searchRoutes);
router.get('/v1/food/dining/restaurants/public', getPublicDiningRestaurants);
router.use('/v1/uploads', uploadRoutes);

// Admin-managed configuration the customer app has to read before it can sign in.
// These sit under /admin only because that is where an admin edits them; reading
// them is not an admin action, so they are declared here, ahead of the guarded
// block below. Each returns a whitelisted, client-safe projection -- never the
// whole settings document. Same three the quick-commerce fork already exposes.
router.get('/v1/food/admin/business-settings/public', businessSettingsController.getBusinessSettings);
router.get('/v1/food/admin/fee-settings/public', getPublicFeeSettingsController);
router.get('/v1/food/admin/cashback-settings/public', getCashbackSettingsPublicController);

router.use('/v1/food/admin', authMiddleware, requireRoles('ADMIN'), requireServiceAccess('food'), adminZoneScope('food'), restaurantAdminRoutes);
router.use('/v1/food/user', authMiddleware, requireRoles('USER'), userRoutes);
// router.use('/v1/food/user', userRoutes);

router.use('/v1/food/notifications', authMiddleware, requireRoles('USER', 'RESTAURANT', 'DELIVERY_PARTNER'), notificationRoutes);
// Order chat: customer <-> rider, and support threads with ADMIN. Every role that
// can appear on an order is admitted; the service itself refuses any pair that
// does not share one, so the role list here is a floor, not the authorisation.
router.use('/v1/food/chat', authMiddleware, requireRoles('USER', 'RESTAURANT', 'DELIVERY_PARTNER', 'ADMIN'), chatRoutes);
router.use('/v1/food/orders', requireModuleEnabled(MODULES.FOOD), authMiddleware, requireRoles('USER'), orderUserRoutes);
router.use('/v1/food/payments', authMiddleware, paymentRoutes);
router.use('/v1/payments/webhook', webhookRoutes); // ✅ NEW: Public Webhook
router.use('/v1/petpooja/webhook', petpoojaWebhookRoutes);
router.use('/v1/fcm-tokens', fcmRoutes);
router.use('/fcm-tokens', fcmRoutes);

// Runtime config for the frontend. Enabled so the client can read Firebase settings
// at load time instead of having them baked in by Vite at build time -- that is what
// makes the admin panel's Firebase settings take effect without a redeploy.
// Returns only client-safe values; the service account never leaves the server.
router.get('/v1/env/public', getPublicEnvController);
router.get('/env/public', getPublicEnvController);

router.get('/v1/admin/queues', authMiddleware, requireRoles('ADMIN'), getQueuesController);
router.use('/v1', taxiPromotionsRouter);

router.use('/v1/taxi', requireModuleEnabled(MODULES.TAXI), taxiRouter);

// ─── Cross-vertical customer feed ──────────────────────────────────────────
// One customer's history and spend across food, taxi, quick-commerce and
// service-provider. Mounted at the platform root rather than under any vertical,
// because it belongs to none of them.
router.get('/v1/me/activity', authMiddleware, getMyActivityController);
router.get('/v1/me/spend', authMiddleware, getMySpendController);

// ─── Quick-Commerce ────────────────────────────────────────────────────────
// No legacy alias block: unlike service-provider, this module's original paths were
// /v1/food/*, which master's own food module already owns. Aliasing them would hand
// food traffic to quick-commerce.
router.use('/v1/qc', requireModuleEnabled(MODULES.QUICK_COMMERCE), qcRouter);

// ─── Service-Provider (Homster) ────────────────────────────────────────────
// Canonical prefix.
router.use('/v1/sp', requireModuleEnabled(MODULES.SERVICE_PROVIDER), spRouter);

// Legacy prefixes the shipped Flutter / seller-APK builds still call. These were
// top-level in the old standalone server.js and none of them collide with the
// /v1/* namespace above. Do NOT remove until those clients are retired.
//
// Delegating instead of router.use('/users', spRouter): a prefixed mount strips
// the prefix, and spRouter's own table is written with it (`/users/auth/...`),
// so the stripped path would never match. This hands spRouter the full path.
// Registered last, so every master route above still wins on any overlap.
const SP_LEGACY_PREFIXES = ['/users', '/user', '/vendors', '/workers', '/admin', '/bookings', '/payments', '/notifications', '/public', '/scrap', '/image'];
router.use((req, res, next) => {
    const matched = SP_LEGACY_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`));
    return matched ? spRouter(req, res, next) : next();
});

export default router;
