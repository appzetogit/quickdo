import express from 'express';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../../core/roles/role.middleware.js';
import { upload } from '../../../../middleware/upload.js';
import {
    listHeroBannersController,
    uploadHeroBannersController,
    deleteHeroBannerController,
    updateHeroBannerOrderController,
    toggleHeroBannerStatusController,
    linkHeroBannerRestaurantsController
} from '../controllers/heroBanner.controller.js';
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
    getPublicLandingSettingsController
} from '../controllers/publicLanding.controller.js';
import { detectZonePublicController, listZonesPublicController, listZonesNearbyPublicController } from '../controllers/zonePublic.controller.js';
import { getPublicEnvController } from '../controllers/publicEnv.controller.js';
import {
    listGourmetAdmin,
    createGourmetAdmin,
    deleteGourmetAdmin,
    updateGourmetOrderAdmin,
    toggleGourmetStatusAdmin
} from '../controllers/top10GourmetAdmin.controller.js';
import { getPublicPageController } from '../../admin/controllers/pageContent.controller.js';
import { getPublicReferralSettingsController } from '../controllers/publicReferralSettings.controller.js';
import { enforceAdminAccess } from '../../../../core/admin/enforceAdminAccess.middleware.js';


/*
 * Banner and landing management, guarded.
 *
 * Every write here was reachable with no authentication at all: creating,
 * deleting and reordering the banners on the customer app's home screen, and
 * changing the landing settings -- including the Rs 99 store cap, which now
 * triggers a write across every dish on the platform.
 *
 * The frontend already assumed this guard existed and has been attaching an
 * admin token to these calls all along (see the comment in services/api/axios.js).
 * Only the backend half was missing.
 *
 * Applied per route rather than with router.use, because the public reads the
 * customer app depends on are registered in the same router and must stay open.
 */
// Banners are the "Banners & pages" permission for sub-admins, like the rest of
// the admin API (core/admin/adminAccessPolicy.js).
const adminOnly = [authMiddleware, requireRoles('ADMIN'), enforceAdminAccess('food', () => 'cms')];
const router = express.Router();

// Public CMS pages (About + legal). No auth required.
router.get('/pages/:key', getPublicPageController);
// Public referral settings (no auth required).
router.get('/referral-settings', getPublicReferralSettingsController);

// Admin hero banner management
router.get('/hero-banners', adminOnly, listHeroBannersController);
router.post(
    '/hero-banners/multiple',
    adminOnly,
    upload.array('files'),
    uploadHeroBannersController
);
router.delete('/hero-banners/:id', adminOnly, deleteHeroBannerController);
router.patch('/hero-banners/:id/order', adminOnly, updateHeroBannerOrderController);
router.patch('/hero-banners/:id/status', adminOnly, toggleHeroBannerStatusController);
router.patch('/hero-banners/:id/link-restaurants', adminOnly, linkHeroBannerRestaurantsController);

// Admin under 250 banners
router.get('/hero-banners/under-250', adminOnly, listUnder250BannersController);
router.post(
    '/hero-banners/under-250/multiple',
    adminOnly,
    upload.array('files'),
    uploadUnder250BannersController
);
router.delete('/hero-banners/under-250/:id', adminOnly, deleteUnder250BannerController);
router.patch('/hero-banners/under-250/:id/order', adminOnly, updateUnder250BannerOrderController);
router.patch('/hero-banners/under-250/:id/status', adminOnly, toggleUnder250BannerStatusController);

// Admin dining banners
router.get('/hero-banners/dining', adminOnly, listDiningBannersController);
router.post(
    '/hero-banners/dining/multiple',
    adminOnly,
    upload.array('files'),
    uploadDiningBannersController
);
router.delete('/hero-banners/dining/:id', adminOnly, deleteDiningBannerController);
router.patch('/hero-banners/dining/:id/order', adminOnly, updateDiningBannerOrderController);
router.patch('/hero-banners/dining/:id/status', adminOnly, toggleDiningBannerStatusController);

// Admin Home Promotion banners
router.get('/hero-banners/home-promotion', adminOnly, listHomePromotionBannersController);
router.post(
    '/hero-banners/home-promotion',
    adminOnly,
    upload.single('file'),
    createHomePromotionBannerController
);
// A new image may come with the edit (multipart 'file'); without one only the details change.
router.patch('/hero-banners/home-promotion/:id', adminOnly, upload.single('file'), updateHomePromotionBannerController);
router.delete('/hero-banners/home-promotion/:id', adminOnly, deleteHomePromotionBannerController);
router.patch('/hero-banners/home-promotion/:id/status', adminOnly, toggleHomePromotionBannerStatusController);
router.patch('/hero-banners/home-promotion/:id/order', adminOnly, updateHomePromotionBannerOrderController);

// Admin Explore More (icons)
router.get('/hero-banners/landing/explore-more', adminOnly, listExploreMoreController);
router.post(
    '/hero-banners/landing/explore-more',
    adminOnly,
    upload.single('image'),
    createExploreMoreController
);
router.delete('/hero-banners/landing/explore-more/:id', adminOnly, deleteExploreMoreController);
router.patch('/hero-banners/landing/explore-more/:id/status', adminOnly, toggleExploreMoreStatusController);
router.patch('/hero-banners/landing/explore-more/:id/order', adminOnly, updateExploreMoreOrderController);
router.patch(
    '/hero-banners/landing/explore-more/:id',
    adminOnly,
    upload.single('image'),
    updateExploreMoreController
);

// Admin Gourmet (hero-banners)
router.get('/hero-banners/gourmet', adminOnly, listGourmetAdmin);
router.post('/hero-banners/gourmet', adminOnly, createGourmetAdmin);
router.delete('/hero-banners/gourmet/:id', adminOnly, deleteGourmetAdmin);
router.patch('/hero-banners/gourmet/:id/order', adminOnly, updateGourmetOrderAdmin);
router.patch('/hero-banners/gourmet/:id/status', adminOnly, toggleGourmetStatusAdmin);

// Public landing endpoints (Food user app)
router.get('/hero-banners/public', getPublicHeroBannersController);
/*
 * The video behind the Food home header. The app has always asked for this and
 * got 404, so the header could only ever show still/GIF artwork. There is no
 * separate setting: it is Food's header banners that are videos -- uploaded
 * through the same Banners screen, which records resourceType -- in their order.
 * None uploaded means an empty list, and the app shows the header images.
 */
router.get('/hero-banners/home-header-video/public', async (_req, res, next) => {
    try {
        const { FoodHeroBanner } = await import('../models/heroBanner.model.js');
        const rows = await FoodHeroBanner.find({
            isActive: true,
            $and: [
                { $or: [{ module: 'food' }, { module: { $exists: false } }, { module: null }] },
                { $or: [{ resourceType: 'video' }, { imageUrl: { $regex: /\.(mp4|webm|mov|m3u8)(\?|$)/i } }] },
            ],
        }).sort({ sortOrder: 1, createdAt: -1 }).lean();
        const videos = rows.map((b) => ({ _id: b._id, gifUrl: b.imageUrl, sourceUrl: b.imageUrl }));
        res.status(200).json({ success: true, message: 'Home header videos', data: { videos, video: videos[0] || null } });
    } catch (err) {
        next(err);
    }
});
router.get('/hero-banners/under-250/public', getPublicUnder250BannersController);
router.get('/hero-banners/dining/public', getPublicDiningBannersController);
router.get('/explore-icons/public', getPublicExploreIconsController);
router.get('/hero-banners/home-promotion/public', getPublicHomePromotionBannersController);
router.get('/hero-banners/gourmet/public', getPublicGourmetController);
router.get('/landing/settings/public', getPublicLandingSettingsController);
router.get('/zones/detect', detectZonePublicController);
router.get('/zones/nearby', listZonesNearbyPublicController);
router.get('/zones/public', listZonesPublicController);
router.get('/public/env', getPublicEnvController);
// Admin landing settings
router.get('/hero-banners/landing/settings', adminOnly, getAdminLandingSettingsController);
router.patch('/hero-banners/landing/settings', adminOnly, updateAdminLandingSettingsController);

export default router;
