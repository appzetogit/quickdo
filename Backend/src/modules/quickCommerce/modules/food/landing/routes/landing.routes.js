import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../../../../core/roles/role.middleware.js';
import { enforceAdminAccess } from '../../../../../../core/admin/enforceAdminAccess.middleware.js';
import {
    listHeroBannersController,
    uploadHeroBannersController,
    deleteHeroBannerController,
    updateHeroBannerOrderController,
    toggleHeroBannerStatusController
} from '../controllers/heroBanner.controller.js';
import {
    listTopBannersController,
    uploadTopBannersController,
    deleteTopBannerController,
    updateTopBannerOrderController,
    toggleTopBannerStatusController
} from '../controllers/topBanner.controller.js';
import {
    listUnder250BannersController,
    uploadUnder250BannersController,
    deleteUnder250BannerController,
    updateUnder250BannerOrderController,
    toggleUnder250BannerStatusController
} from '../controllers/under250Banner.controller.js';
import {
    listDiningBannersController,
    uploadDiningBannersController,
    deleteDiningBannerController,
    updateDiningBannerOrderController,
    toggleDiningBannerStatusController
} from '../controllers/diningBanner.controller.js';
import {
    listHomePromotionBannersController,
    createHomePromotionBannerController,
    updateHomePromotionBannerController,
    deleteHomePromotionBannerController,
    toggleHomePromotionBannerStatusController,
    updateHomePromotionBannerOrderController
} from '../controllers/homePromotionBanner.controller.js';
import {
    getAdminLandingSettingsController,
    updateAdminLandingSettingsController
} from '../controllers/landingSettings.controller.js';
import {
    listExploreMoreController,
    createExploreMoreController,
    updateExploreMoreController,
    deleteExploreMoreController,
    toggleExploreMoreStatusController,
    updateExploreMoreOrderController
} from '../controllers/exploreIcon.controller.js';
import {
    getPublicHeroBannersController,
    getPublicUnder250BannersController,
    getPublicDiningBannersController,
    getPublicExploreIconsController,
    getPublicHomePromotionBannersController,
    getPublicGourmetController,
    getPublicLandingSettingsController,
    getPublicTopBannersController
} from '../controllers/publicLanding.controller.js';
import { detectZonePublicController, listZonesPublicController, listZonesNearbyPublicController } from '../controllers/zonePublic.controller.js';
import {
    listGourmetAdmin,
    createGourmetAdmin,
    deleteGourmetAdmin,
    updateGourmetOrderAdmin,
    toggleGourmetStatusAdmin
} from '../controllers/top10GourmetAdmin.controller.js';
import { getPublicPageController } from '../../admin/controllers/pageContent.controller.js';
import { getPublicReferralSettingsController } from '../controllers/publicReferralSettings.controller.js';

const router = express.Router();

/**
 * This router is mounted at /v1/food WITHOUT the admin guard, yet it also contains the
 * banner/landing MANAGEMENT endpoints (upload, delete, reorder, toggle). They were
 * therefore reachable unauthenticated by anyone.
 *
 * Allowlist the genuinely public reads and require an admin token for everything else, so
 * any route added to this file in future is protected by default rather than exposed.
 */
/**
 * CRITICAL: this router is mounted at /v1/food, which is a PREFIX of /v1/food/user,
 * /v1/food/orders, /v1/food/chat, /v1/food/notifications, /v1/food/payments and
 * /v1/food/search — all of which mount AFTER it. So every one of those requests passes
 * through this middleware first. It must therefore only act on the paths this router
 * actually owns, and fall straight through for everything else, or it locks the whole
 * customer app out with 403.
 */
const LANDING_MANAGED_PREFIXES = [/^\/hero-banners/, /^\/top-banners/];

const bannerAccess = enforceAdminAccess('quickCommerce', () => 'cms');

const requireAdminForLandingWrites = (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    const path = req.path || '';

    // Not a landing-management path → not ours to guard.
    if (!LANDING_MANAGED_PREFIXES.some((re) => re.test(path))) return next();
    // Public reads stay open.
    if (/\/public$/.test(path)) return next();

    return authMiddleware(req, res, (err) => {
        if (err) return next(err);
        return requireRoles('ADMIN')(req, res, (roleErr) => {
            if (roleErr) return next(roleErr);
            // Sub-admins need "Banners & pages" (core/admin/adminAccessPolicy.js).
            return bannerAccess(req, res, next);
        });
    });
};

router.use(requireAdminForLandingWrites);

// Public CMS pages (About + legal). No auth required.
router.get('/pages/:key', getPublicPageController);
// Public referral settings (no auth required).
router.get('/referral-settings', getPublicReferralSettingsController);

// Admin hero banner management
router.get('/hero-banners', listHeroBannersController);
router.post(
    '/hero-banners/multiple',
    upload.array('files'),
    uploadHeroBannersController
);
router.delete('/hero-banners/:id', deleteHeroBannerController);
router.patch('/hero-banners/:id/order', updateHeroBannerOrderController);
router.patch('/hero-banners/:id/status', toggleHeroBannerStatusController);

// Admin top banners
router.get('/top-banners', listTopBannersController);
router.post(
    '/top-banners/multiple',
    upload.array('files'),
    uploadTopBannersController
);
router.delete('/top-banners/:id', deleteTopBannerController);
router.patch('/top-banners/:id/order', updateTopBannerOrderController);
router.patch('/top-banners/:id/status', toggleTopBannerStatusController);

// Admin under 250 banners
router.get('/hero-banners/under-250', listUnder250BannersController);
router.post(
    '/hero-banners/under-250/multiple',
    upload.array('files'),
    uploadUnder250BannersController
);
router.delete('/hero-banners/under-250/:id', deleteUnder250BannerController);
router.patch('/hero-banners/under-250/:id/order', updateUnder250BannerOrderController);
router.patch('/hero-banners/under-250/:id/status', toggleUnder250BannerStatusController);

// Admin dining banners
router.get('/hero-banners/dining', listDiningBannersController);
router.post(
    '/hero-banners/dining/multiple',
    upload.array('files'),
    uploadDiningBannersController
);
router.delete('/hero-banners/dining/:id', deleteDiningBannerController);
router.patch('/hero-banners/dining/:id/order', updateDiningBannerOrderController);
router.patch('/hero-banners/dining/:id/status', toggleDiningBannerStatusController);

// Admin Home Promotion banners
router.get('/hero-banners/home-promotion', listHomePromotionBannersController);
router.post(
    '/hero-banners/home-promotion',
    upload.single('file'),
    createHomePromotionBannerController
);
router.patch('/hero-banners/home-promotion/:id', updateHomePromotionBannerController);
router.delete('/hero-banners/home-promotion/:id', deleteHomePromotionBannerController);
router.patch('/hero-banners/home-promotion/:id/status', toggleHomePromotionBannerStatusController);
router.patch('/hero-banners/home-promotion/:id/order', updateHomePromotionBannerOrderController);

// Admin Explore More (icons)
router.get('/hero-banners/landing/explore-more', listExploreMoreController);
router.post(
    '/hero-banners/landing/explore-more',
    upload.single('image'),
    createExploreMoreController
);
router.delete('/hero-banners/landing/explore-more/:id', deleteExploreMoreController);
router.patch('/hero-banners/landing/explore-more/:id/status', toggleExploreMoreStatusController);
router.patch('/hero-banners/landing/explore-more/:id/order', updateExploreMoreOrderController);
router.patch(
    '/hero-banners/landing/explore-more/:id',
    upload.single('image'),
    updateExploreMoreController
);

// Admin Gourmet (hero-banners)
router.get('/hero-banners/gourmet', listGourmetAdmin);
router.post('/hero-banners/gourmet', createGourmetAdmin);
router.delete('/hero-banners/gourmet/:id', deleteGourmetAdmin);
router.patch('/hero-banners/gourmet/:id/order', updateGourmetOrderAdmin);
router.patch('/hero-banners/gourmet/:id/status', toggleGourmetStatusAdmin);

// Public landing endpoints (Food user app)
router.get('/hero-banners/public', getPublicHeroBannersController);
router.get('/top-banners/public', getPublicTopBannersController);
router.get('/hero-banners/under-250/public', getPublicUnder250BannersController);
router.get('/hero-banners/dining/public', getPublicDiningBannersController);
router.get('/explore-icons/public', getPublicExploreIconsController);
router.get('/hero-banners/home-promotion/public', getPublicHomePromotionBannersController);
router.get('/hero-banners/gourmet/public', getPublicGourmetController);
router.get('/landing/settings/public', getPublicLandingSettingsController);
router.get('/zones/detect', detectZonePublicController);
router.get('/zones/nearby', listZonesNearbyPublicController);
router.get('/zones/public', listZonesPublicController);
// Admin landing settings
router.get('/hero-banners/landing/settings', getAdminLandingSettingsController);
router.patch('/hero-banners/landing/settings', updateAdminLandingSettingsController);

export default router;
