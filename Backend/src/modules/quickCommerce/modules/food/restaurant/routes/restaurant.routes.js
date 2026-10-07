import { uploadAttachmentRateLimiter as uploadAttachmentLimiter } from '../../../../../../middleware/rateLimit.js';
import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import {
    registerRestaurantController,
    createOnboardingFeeOrderController,
    listApprovedRestaurantsController,
    getApprovedRestaurantController,
    listPublicOffersController,
    getCurrentRestaurantController,
    updateRestaurantProfileController,
    updateRestaurantAcceptingOrdersController,
    uploadRestaurantProfileImageController,
    uploadRestaurantMenuImageController,
    uploadRestaurantCoverImagesController,
    uploadRestaurantMenuImagesController,
    getRestaurantComplaintsController,
    uploadRestaurantAttachmentController,
    deleteCurrentRestaurantAccountController,
    registerUnregisteredRestaurantController,
    getRestaurantSubscriptionHistoryController
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
    getSubscriptionOverviewController,
    listSubscriptionInvoicesController,
    getSubscriptionInvoiceController,
    listSubscriptionTransactionsController,
    createSubscriptionPaymentLinkController,
    getSubscriptionPaymentLinkStatusController,
} from '../controllers/subscription.controller.js';
import {
    listCategoriesController,
    createCategoryController,
    updateCategoryController,
    deleteCategoryController
} from '../controllers/restaurantCategory.controller.js';
import { getMenuController, updateMenuController, getPublicRestaurantMenuController } from '../controllers/restaurantMenu.controller.js';
import { listPublicFoodsController } from '../controllers/publicFoods.controller.js';
import { getPublicRestaurantAddonsController } from '../controllers/publicAddons.controller.js';
import * as feedbackExperienceController from '../../admin/controllers/feedbackExperience.controller.js';
import {
    getOutletTimingsByRestaurantIdController,
    getCurrentRestaurantOutletTimingsController,
    upsertCurrentRestaurantOutletTimingsController
} from '../controllers/outletTimings.controller.js';
import {
    createRestaurantFoodController,
    deleteRestaurantFoodController,
    updateRestaurantFoodController,
    updateRestaurantFoodStockController,
    listLowStockFoodsController,
    getAnalyticsController
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
import { authMiddleware, optionalAuth } from '../../../../core/auth/auth.middleware.js';
import { stockRouter } from '../../admin/routes/stock.routes.js';
import { sendError } from '../../../../utils/response.js';
import { getRestaurantFinanceController } from '../controllers/restaurantFinance.controller.js';
import {
    listBannersController,
    uploadBannersController,
    deleteBannerController,
    reorderBannersController,
    getMediaController,
    uploadCoverImageController,
    uploadGalleryImagesController,
    deleteGalleryImageController
} from '../controllers/restaurantBanner.controller.js';
import { listBannersForRestaurantAppController } from '../../admin/controllers/restaurantAppBanner.controller.js';

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
    { name: 'businessRegistrationImage', maxCount: 1 },
    // Store photos. The front one is how an admin checks the shop is real.
    { name: 'storeFrontImage', maxCount: 1 },
    { name: 'storeInsideImage', maxCount: 1 },
    { name: 'storeSignboardImage', maxCount: 1 },
    { name: 'menuImages', maxCount: 10 },
    // Onboarding: main cover + premises gallery (gallery is shown to the rider at pickup).
    { name: 'coverImage', maxCount: 1 },
    { name: 'galleryImages', maxCount: 10 }
]);

router.post('/register', uploadFields, registerRestaurantController);
router.post('/onboarding-fee/order', createOnboardingFeeOrderController);
router.post('/unregistered', registerUnregisteredRestaurantController);
// Open to not-yet-registered restaurants (the signup form uploads here), so it
// is rate-limited: anonymous callers could fill storage without a bound.
router.post('/upload-attachment', uploadAttachmentLimiter, upload.single('file'), uploadRestaurantAttachmentController);

// Public: approved restaurants list (for user app)
router.get('/restaurants', cacheResponse(300, 'restaurants'), listApprovedRestaurantsController);
router.get('/restaurants/:id', cacheResponse(600, 'restaurant_detail'), getApprovedRestaurantController);
router.get('/restaurants/:id/menu', cacheResponse(600, 'restaurant_menu'), getPublicRestaurantMenuController);
router.get('/public/foods', cacheResponse(300, 'public_foods'), listPublicFoodsController);
router.get('/restaurants/:id/outlet-timings', cacheResponse(600, 'restaurant_timings'), getOutletTimingsByRestaurantIdController);
router.get('/offers', optionalAuth, listPublicOffersController);
// Public: categories list (zone-aware; returns zone categories + global)
router.get('/categories/public', cacheResponse(600, 'categories'), listCategoriesController);

// Restaurant dashboard/profile (Bearer token + RESTAURANT role)
router.get('/current', authMiddleware, requireRestaurant, getCurrentRestaurantController);
/**
 * Account deletion, initiated by the seller themselves.
 *
 * The controller has existed all along and was imported here, but never given
 * a route -- so the only way to close an account was to ask someone with
 * database access. Google Play and the App Store both require deletion to be
 * reachable from inside the app, which made this a submission blocker rather
 * than a missing convenience.
 */
router.delete('/current', authMiddleware, requireRestaurant, deleteCurrentRestaurantAccountController);
router.patch('/profile', authMiddleware, requireRestaurant, async (req, res, next) => {
    // Invalidate caches when profile is updated
    await invalidateCache('restaurants:*');
    await invalidateCache('restaurant_detail:*');
    next();
}, updateRestaurantProfileController);
router.patch('/availability', authMiddleware, requireRestaurant, async (req, res, next) => {
    await invalidateCache('restaurants:*');
    await invalidateCache('restaurant_detail:*');
    next();
}, updateRestaurantAcceptingOrdersController);

router.get('/outlet-timings', authMiddleware, requireRestaurant, getCurrentRestaurantOutletTimingsController);
router.put('/outlet-timings', authMiddleware, requireRestaurant, upsertCurrentRestaurantOutletTimingsController);
router.get('/finance', authMiddleware, requireRestaurant, getRestaurantFinanceController);
router.post('/withdraw', authMiddleware, requireRestaurant, createWithdrawalRequestController);
router.get('/withdrawals', authMiddleware, requireRestaurant, listMyWithdrawalsController);
router.get('/subscription-history', authMiddleware, requireRestaurant, getRestaurantSubscriptionHistoryController);
// New calendar-month postpaid subscription endpoints
router.get('/subscription/overview', authMiddleware, requireRestaurant, getSubscriptionOverviewController);
router.get('/subscription/invoices', authMiddleware, requireRestaurant, listSubscriptionInvoicesController);
// The seller settles their own due, which releases the payout it locks.
router.post('/subscription/invoices/:invoiceId/pay/link', authMiddleware, requireRestaurant, createSubscriptionPaymentLinkController);
router.get('/subscription/invoices/:invoiceId/pay/link/:linkId', authMiddleware, requireRestaurant, getSubscriptionPaymentLinkStatusController);
router.get('/subscription/invoices/:invoiceId', authMiddleware, requireRestaurant, getSubscriptionInvoiceController);
router.get('/subscription/transactions', authMiddleware, requireRestaurant, listSubscriptionTransactionsController);
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

// Admin-managed promo banners shown INSIDE the restaurant partner app.
router.get('/app-banners', authMiddleware, requireRestaurant, listBannersForRestaurantAppController);

// Main cover image + premises gallery. The gallery is surfaced to the delivery partner
// at pickup so they can visually identify the shop.
router.get('/media', authMiddleware, requireRestaurant, getMediaController);
router.post('/media/cover-image', authMiddleware, requireRestaurant, upload.single('file'), uploadCoverImageController);
router.post('/media/gallery', authMiddleware, requireRestaurant, upload.array('files', 10), uploadGalleryImagesController);
router.delete('/media/gallery', authMiddleware, requireRestaurant, deleteGalleryImageController);

// Banners shown on the public restaurant page (/restaurants/:id -> coverImages).
// Separate from /profile/cover-images, which resets the restaurant to 'pending' and is
// only appropriate during onboarding — routine banner edits must not take a live
// restaurant offline.
router.get('/banners', authMiddleware, requireRestaurant, listBannersController);
router.post(
    '/banners',
    authMiddleware,
    requireRestaurant,
    upload.array('files', 10),
    uploadBannersController
);
router.delete('/banners', authMiddleware, requireRestaurant, deleteBannerController);
router.patch('/banners/order', authMiddleware, requireRestaurant, reorderBannersController);

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
router.get('/restaurants/:id/addons', cacheResponse(600, 'restaurant_addons'), getPublicRestaurantAddonsController);

// Foods (restaurant creates/updates items -> stored in food_items collection)
router.post('/foods', authMiddleware, requireRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    next();
}, createRestaurantFoodController);
// Declared before /foods/:id so "stock" and "low-stock" are not swallowed as ids.
router.patch('/foods/stock', authMiddleware, requireRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    await invalidateCache('search_products:*');
    next();
}, updateRestaurantFoodStockController);
router.get('/foods/low-stock', authMiddleware, requireRestaurant, listLowStockFoodsController);
router.get('/analytics', authMiddleware, requireRestaurant, getAnalyticsController);

router.delete('/foods/:id', authMiddleware, requireRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    await invalidateCache('search_products:*');
    next();
}, deleteRestaurantFoodController);

router.patch('/foods/:id', authMiddleware, requireRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    await invalidateCache('search_products:*');
    next();
}, updateRestaurantFoodController);

// Bulk Menu Upload
router.get('/bulk-upload/template', authMiddleware, requireRestaurant, downloadBulkMenuTemplateController);
router.post('/bulk-upload', authMiddleware, requireRestaurant, upload.single('file'), uploadBulkMenuController);

// Add-ons (restaurant dashboard) - approval handled by admin
router.get('/addons', authMiddleware, requireRestaurant, listAddonsController);
router.post('/addons', authMiddleware, requireRestaurant, createAddonController);
router.patch('/addons/:id', authMiddleware, requireRestaurant, updateAddonController);
router.delete('/addons/:id', authMiddleware, requireRestaurant, deleteAddonController);

// Orders (restaurant dashboard)
router.get('/orders', authMiddleware, requireRestaurant, orderController.listOrdersRestaurantController);
router.get('/orders/:orderId', authMiddleware, requireRestaurant, orderController.getOrderByIdRestaurantController);
router.patch('/orders/:orderId/status', authMiddleware, requireRestaurant, orderController.updateOrderStatusRestaurantController);
// Self-pickup: the customer's code at the counter completes the order (plan §5.2).
router.post('/orders/:orderId/pickup/verify', authMiddleware, requireRestaurant, orderController.verifyPickupOtpRestaurantController);
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

// The store's own stock page: its products only (admin/services/stock.service.js).
router.use('/stock', authMiddleware, requireRestaurant, stockRouter({ scope: 'restaurant' }));

export default router;
