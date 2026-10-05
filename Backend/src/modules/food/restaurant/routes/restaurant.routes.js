import { uploadAttachmentRateLimiter as uploadAttachmentLimiter } from '../../../../middleware/rateLimit.js';
import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import {
    registerRestaurantController,
    listApprovedRestaurantsController,
    getApprovedRestaurantController,
    listPublicOffersController,
    getCurrentRestaurantController,
    getRestaurantCommissionRateController,
    getRestaurantTaxSettingsController,
    updateRestaurantTaxSettingsController,
    getFreebieOfferController,
    updateFreebieOfferController,
    getBogoOfferController,
    updateBogoOfferController,
    listCombosController,
    createComboController,
    updateComboController,
    deleteComboController,
    updateRestaurantProfileController,
    updateRestaurantAcceptingOrdersController,
    updateCurrentRestaurantDiningSettingsController,
    uploadRestaurantProfileImageController,
    uploadRestaurantMenuImageController,
    uploadRestaurantCoverImagesController,
    uploadRestaurantMenuImagesController,
    getRestaurantComplaintsController,
    uploadRestaurantAttachmentController,
    deleteCurrentRestaurantAccountController,
    getRestaurantPublicReviewsController,
} from '../controllers/restaurant.controller.js';
import {
    createRestaurantOfferController,
    listRestaurantOffersController,
    deleteRestaurantOfferController,
    updateRestaurantOfferStatusController
} from '../controllers/restaurantOffer.controller.js';
import {
    createRestaurantSupportTicketController,
    listRestaurantSupportTicketsController
} from '../controllers/supportTicket.controller.js';
import {
    createWithdrawalRequestController,
    listMyWithdrawalsController
} from '../controllers/withdrawal.controller.js';
import {
    listCategoriesController,
    createCategoryController,
    updateCategoryController,
    deleteCategoryController
} from '../controllers/restaurantCategory.controller.js';
import { getMenuController, updateMenuController, getPublicRestaurantMenuController } from '../controllers/restaurantMenu.controller.js';
import { getOwnServiceRadiusController, updateOwnServiceRadiusController } from '../controllers/serviceRadius.controller.js';
import { getPublicRestaurantAddonsController } from '../controllers/publicAddons.controller.js';
import * as feedbackExperienceController from '../../admin/controllers/feedbackExperience.controller.js';
import {
    getOutletTimingsByRestaurantIdController,
    getCurrentRestaurantOutletTimingsController,
    upsertCurrentRestaurantOutletTimingsController
} from '../controllers/outletTimings.controller.js';
import {
    createRestaurantFoodController,
    updateRestaurantFoodController
} from '../controllers/restaurantFood.controller.js';
import {
    listAddonsController,
    createAddonController,
    updateAddonController,
    deleteAddonController
} from '../controllers/restaurantAddon.controller.js';
import {
    downloadBulkMenuTemplateController,
    uploadBulkMenuController
} from '../controllers/bulkUpload.controller.js';
import * as orderController from '../../orders/controllers/order.controller.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { sendError } from '../../../../utils/response.js';
import { getRestaurantFinanceController } from '../controllers/restaurantFinance.controller.js';
import { listPublicFoodsController } from '../controllers/publicFoods.controller.js';
import {
    getMediaController,
    uploadCoverImageController,
    uploadGalleryImagesController,
    deleteGalleryImageController
} from '../controllers/restaurantMedia.controller.js';

import { cacheResponse, invalidateCache } from '../../../../middleware/cache.js';

const router = express.Router();

const requireRestaurant = (req, res, next) => {
    if (req.user?.role !== 'RESTAURANT') {
        return sendError(res, 403, 'Restaurant access required');
    }
    next();
};

const uploadFields = upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'panImage', maxCount: 1 },
    { name: 'gstImage', maxCount: 1 },
    { name: 'fssaiImage', maxCount: 1 },
    { name: 'menuImages', maxCount: 10 }
]);

router.post('/register', uploadFields, registerRestaurantController);
// Open to not-yet-registered restaurants (the signup form uploads here), so it
// is rate-limited: anonymous callers could fill storage without a bound.
router.post('/upload-attachment', uploadAttachmentLimiter, upload.single('file'), uploadRestaurantAttachmentController);

// Public: approved restaurants list (for user app)
/*
 * Cache lifetimes for the public endpoints.
 *
 * These are a BACKSTOP, not the mechanism: every write that changes a price,
 * an availability toggle or an approval clears the relevant keys immediately
 * (see middleware/cache.js). The TTL only covers changes made outside those
 * paths -- a direct database edit, a one-off script -- and it used to be five
 * to ten minutes, so such a change took that long to reach a customer with
 * nothing explaining the delay.
 *
 * A minute is short enough that nobody waits and long enough to absorb the
 * burst of identical requests a home screen fires on open, which is what the
 * cache is actually for.
 */
const PRICE_TTL = 60;
const SLOW_TTL = 600;

router.get('/restaurants', cacheResponse(PRICE_TTL, 'restaurants'), listApprovedRestaurantsController);
router.get('/restaurants/:id', cacheResponse(PRICE_TTL, 'restaurant_detail'), getApprovedRestaurantController);
router.get('/restaurants/:id/menu', cacheResponse(PRICE_TTL, 'restaurant_menu'), getPublicRestaurantMenuController);
router.get('/restaurants/:id/reviews', getRestaurantPublicReviewsController);
router.get('/restaurants/:id/outlet-timings', cacheResponse(SLOW_TTL, 'restaurant_timings'), getOutletTimingsByRestaurantIdController);
router.get('/offers', cacheResponse(PRICE_TTL, 'offers'), listPublicOffersController);
// Public: cross-restaurant dish feed, used by the home screen's category rails and
// the under-250 promo. Declared before the ':id' routes above cannot swallow it --
// '/public/foods' has two segments, so there is no collision either way.
router.get('/public/foods', cacheResponse(PRICE_TTL, 'public_foods'), listPublicFoodsController);
// Public: categories list (zone-aware; returns zone categories + global)
router.get('/categories/public', cacheResponse(SLOW_TTL, 'categories'), listCategoriesController);

// Restaurant dashboard/profile (Bearer token + RESTAURANT role)
router.get('/current', authMiddleware, requireRestaurant, getCurrentRestaurantController);
router.patch('/profile', authMiddleware, requireRestaurant, async (req, res, next) => {
    // Invalidate caches when profile is updated
    await invalidateCache('restaurants:*');
    await invalidateCache('restaurant_detail:*');
    next();
}, updateRestaurantProfileController);
router.patch('/availability', authMiddleware, requireRestaurant, async (req, res, next) => {
    await invalidateCache('restaurants:*');
    next();
}, updateRestaurantAcceptingOrdersController);
router.get('/commission', authMiddleware, requireRestaurant, getRestaurantCommissionRateController);
router.get('/tax-settings', authMiddleware, requireRestaurant, getRestaurantTaxSettingsController);
// The flag changes what every dish costs the customer, so the menu and
// restaurant caches have to go with it.
router.put('/tax-settings', authMiddleware, requireRestaurant, async (req, res, next) => {
    await invalidateCache('restaurants:*');
    await invalidateCache('restaurant_detail:*');
    await invalidateCache('public_foods:*');
    next();
}, updateRestaurantTaxSettingsController);
// How far the outlet delivers. The admin panel edits the same field through
// the same service; see restaurant/services/serviceRadius.service.js.
router.get('/service-radius', authMiddleware, requireRestaurant, getOwnServiceRadiusController);
router.put('/service-radius', authMiddleware, requireRestaurant, updateOwnServiceRadiusController);
router.get('/freebie-offer', authMiddleware, requireRestaurant, getFreebieOfferController);
router.put('/freebie-offer', authMiddleware, requireRestaurant, updateFreebieOfferController);
router.get('/bogo-offer', authMiddleware, requireRestaurant, getBogoOfferController);
router.put('/bogo-offer', authMiddleware, requireRestaurant, updateBogoOfferController);
// Combos are dishes, so they are managed here rather than under an offers path.
router.get('/combos', authMiddleware, requireRestaurant, listCombosController);
router.post('/combos', authMiddleware, requireRestaurant, createComboController);
router.put('/combos/:comboId', authMiddleware, requireRestaurant, updateComboController);
router.delete('/combos/:comboId', authMiddleware, requireRestaurant, deleteComboController);
router.patch('/profile', authMiddleware, requireRestaurant, updateRestaurantProfileController);
router.delete('/profile/account', authMiddleware, requireRestaurant, deleteCurrentRestaurantAccountController);
// Same handler under the name quick-commerce uses. The restaurant app serves both
// verticals off one set of paths, rewriting only the `/food` prefix to `/qc` — an
// invariant that holds for every other seller route, and broke here because the
// two forks named account deletion differently. Aliasing is cheaper and safer
// than teaching the client that one path is special.
router.delete('/current', authMiddleware, requireRestaurant, deleteCurrentRestaurantAccountController);
router.patch('/availability', authMiddleware, requireRestaurant, updateRestaurantAcceptingOrdersController);
router.patch('/dining-settings', authMiddleware, requireRestaurant, updateCurrentRestaurantDiningSettingsController);
router.get('/outlet-timings', authMiddleware, requireRestaurant, getCurrentRestaurantOutletTimingsController);
router.put('/outlet-timings', authMiddleware, requireRestaurant, upsertCurrentRestaurantOutletTimingsController);
router.get('/finance', authMiddleware, requireRestaurant, getRestaurantFinanceController);
router.post('/withdraw', authMiddleware, requireRestaurant, createWithdrawalRequestController);
router.get('/withdrawals', authMiddleware, requireRestaurant, listMyWithdrawalsController);
router.post(
    '/profile/profile-image',
    authMiddleware,
    requireRestaurant,
    upload.single('file'),
    async (req, res, next) => {
        await invalidateCache('restaurants:*');
        await invalidateCache('restaurant_detail:*');
        next();
    },
    uploadRestaurantProfileImageController
);
router.post(
    '/profile/menu-image',
    authMiddleware,
    requireRestaurant,
    upload.single('file'),
    async (req, res, next) => {
        await invalidateCache('restaurant_menu:*');
        next();
    },
    uploadRestaurantMenuImageController
);
router.post(
    '/profile/cover-images',
    authMiddleware,
    requireRestaurant,
    upload.array('files', 20),
    async (req, res, next) => {
        await invalidateCache('restaurant_detail:*');
        next();
    },
    uploadRestaurantCoverImagesController
);
router.post(
    '/profile/menu-images',
    authMiddleware,
    requireRestaurant,
    upload.array('files', 20),
    async (req, res, next) => {
        await invalidateCache('restaurant_menu:*');
        next();
    },
    uploadRestaurantMenuImagesController
);

// ----- Media: main cover image + premises gallery -----
//
// Separate from the /profile/* image routes above, which reset the restaurant's
// status to 'pending'. That is correct for a document that changes what was
// approved and wrong for swapping a photo -- it takes a live restaurant offline
// and forces re-approval. Nothing in this block touches status.
router.get('/media', authMiddleware, requireRestaurant, getMediaController);
router.post('/media/cover-image', authMiddleware, requireRestaurant, upload.single('file'), uploadCoverImageController);
router.post('/media/gallery', authMiddleware, requireRestaurant, upload.array('files', 10), uploadGalleryImagesController);
// DELETE carries the url in the body: image urls contain slashes, which no
// single path segment can hold.
router.delete('/media/gallery', authMiddleware, requireRestaurant, deleteGalleryImageController);

// Categories (restaurant dashboard). Read-only for item creation, CRUD for Menu Categories page.
router.get('/categories', authMiddleware, requireRestaurant, listCategoriesController);
router.post('/categories', authMiddleware, requireRestaurant, createCategoryController);
router.patch('/categories/:id', authMiddleware, requireRestaurant, updateCategoryController);
router.delete('/categories/:id', authMiddleware, requireRestaurant, deleteCategoryController);

// Menu (restaurant dashboard) - only fields needed by UI
router.get('/menu', authMiddleware, requireRestaurant, getMenuController);
router.patch('/menu', authMiddleware, requireRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    next();
}, updateMenuController);

// Feedback (restaurant dashboard)
router.post('/feedback-experience', authMiddleware, requireRestaurant, feedbackExperienceController.createFeedbackExperience);

// Public: restaurant add-ons (user app)
router.get('/restaurants/:id/addons', cacheResponse(SLOW_TTL, 'restaurant_addons'), getPublicRestaurantAddonsController);

// Foods (restaurant creates/updates items -> stored in food_items collection)
router.post('/foods', authMiddleware, requireRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    await invalidateCache('restaurants:*');
    next();
}, createRestaurantFoodController);
router.patch('/foods/:id', authMiddleware, requireRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    await invalidateCache('restaurants:*');
    next();
}, updateRestaurantFoodController);

// Bulk Menu Upload
router.get('/bulk-upload/template', authMiddleware, requireRestaurant, downloadBulkMenuTemplateController);
router.post('/bulk-upload', authMiddleware, requireRestaurant, upload.single('file'), uploadBulkMenuController);

// Add-ons (restaurant dashboard) - approval handled by admin.
//
// Also served under /item-extras, for the same reason the admin router is: ad
// blockers kill any XHR whose path contains "addons" (ERR_BLOCKED_BY_CLIENT).
// The admin router got that alias and this one did not, while the web app was
// switched to call /item-extras everywhere -- so the restaurant panel's add-on
// list came back empty and the item form had nothing to suggest when a dish was
// being created.
// The customer picker's list is cached for ten minutes; a restaurant switching
// an add-on off or deleting it has to drop that copy, or the picker keeps
// offering something the kitchen no longer makes.
const clearAddonCache = async (req, res, next) => {
    await invalidateCache('restaurant_addons:*');
    next();
};
['/addons', '/item-extras'].forEach((base) => {
    router.get(base, authMiddleware, requireRestaurant, listAddonsController);
    router.post(base, authMiddleware, requireRestaurant, clearAddonCache, createAddonController);
    router.patch(`${base}/:id`, authMiddleware, requireRestaurant, clearAddonCache, updateAddonController);
    router.delete(`${base}/:id`, authMiddleware, requireRestaurant, clearAddonCache, deleteAddonController);
});

// Orders (restaurant dashboard)
router.get('/orders', authMiddleware, requireRestaurant, orderController.listOrdersRestaurantController);
router.get('/orders/:orderId', authMiddleware, requireRestaurant, orderController.getOrderByIdRestaurantController);
router.patch('/orders/:orderId/status', authMiddleware, requireRestaurant, orderController.updateOrderStatusRestaurantController);
router.post('/orders/:orderId/resend-notification', authMiddleware, requireRestaurant, orderController.resendDeliveryNotificationRestaurantController);

// Complaints (restaurant dashboard)
router.get('/complaints', authMiddleware, requireRestaurant, getRestaurantComplaintsController);
router.post('/support/tickets', authMiddleware, requireRestaurant, createRestaurantSupportTicketController);
router.get('/support/tickets', authMiddleware, requireRestaurant, listRestaurantSupportTicketsController);

// Offers (restaurant dashboard)
router.get('/my-offers', authMiddleware, requireRestaurant, listRestaurantOffersController);
router.post('/my-offers', authMiddleware, requireRestaurant, createRestaurantOfferController);
router.patch('/my-offers/:id/status', authMiddleware, requireRestaurant, updateRestaurantOfferStatusController);
router.delete('/my-offers/:id', authMiddleware, requireRestaurant, deleteRestaurantOfferController);

export default router;

