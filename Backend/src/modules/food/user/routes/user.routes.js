import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import {
    listAddressesController,
    addAddressController,
    updateAddressController,
    deleteAddressController,
    setDefaultAddressController
} from '../controllers/userAddress.controller.js';
import {
    getCurrentUserProfileController,
    updateCurrentUserProfileController,
    uploadCurrentUserProfileImageController,
    deleteCurrentUserAccountController
} from '../controllers/userProfile.controller.js';
import {
    getUserWalletController,
    createWalletTopupOrderController,
    verifyWalletTopupPaymentController
} from '../controllers/userWallet.controller.js';
import {
    getUserReferralDetailsController,
    getUserReferralStatsController
} from '../controllers/userReferral.controller.js';
import {
    createSafetyEmergencyReportController,
    listMySafetyEmergencyReportsController
} from '../controllers/userSafetyEmergency.controller.js';
import {
    createSupportTicketController,
    listMySupportTicketsController
} from '../controllers/supportTicket.controller.js';
import { getPublicFeeSettingsController, getDeliveryInstructionsController } from '../controllers/userSettings.controller.js';
import { syncUserCartController } from '../controllers/userCart.controller.js';
import {
    getFavoritesController,
    addFavoriteRestaurantController,
    removeFavoriteRestaurantController,
    addFavoriteFoodController,
    removeFavoriteFoodController
} from '../controllers/userFavorite.controller.js';
import {
    getCashbackHistoryController,
    getRefundHistoryController
} from '../controllers/cashback.controller.js';

const router = express.Router();

router.get('/fee-settings', getPublicFeeSettingsController);
router.get('/delivery-instructions', getDeliveryInstructionsController);

router.get('/profile', getCurrentUserProfileController);
router.patch('/profile', updateCurrentUserProfileController);
router.post('/profile/profile-image', upload.single('file'), uploadCurrentUserProfileImageController);
router.delete('/profile', deleteCurrentUserAccountController);

// Wallet (Bearer USER)
router.get('/wallet', getUserWalletController);
router.post('/wallet/topup/order', createWalletTopupOrderController);
router.post('/wallet/topup/verify', verifyWalletTopupPaymentController);

// Wallet sub-ledgers. Neither has its own store: cashback is the wallet rows
// tagged metadata.source = 'cashback', refunds are read off the orders' own
// payment records. Nothing to keep in sync, nothing to backfill.
router.get('/cashback', getCashbackHistoryController);
router.get('/refunds', getRefundHistoryController);

// Referral stats (Bearer USER)
router.get('/referrals/stats', getUserReferralStatsController);
router.get('/referrals/details', getUserReferralDetailsController);

// Safety / Emergency reports (Bearer USER)
router.post('/safety-emergency-reports', createSafetyEmergencyReportController);
router.get('/safety-emergency-reports', listMySafetyEmergencyReportsController);

// Support tickets (Bearer USER)
router.post('/support/ticket', createSupportTicketController);
router.get('/support/my-tickets', listMySupportTicketsController);

router.get('/addresses', listAddressesController);
router.post('/addresses', addAddressController);
router.patch('/addresses/:addressId', updateAddressController);
router.delete('/addresses/:addressId', deleteAddressController);
router.patch('/addresses/:addressId/default', setDefaultAddressController);

// Favourites. Auth + USER role are applied where this router is mounted.
// Add and remove are both idempotent, so a double-tapped heart is safe without
// any client-side debounce.
router.get('/favorites', getFavoritesController);
router.post('/favorites/restaurants/:restaurantId', addFavoriteRestaurantController);
router.delete('/favorites/restaurants/:restaurantId', removeFavoriteRestaurantController);
router.post('/favorites/foods/:foodId', addFavoriteFoodController);
router.delete('/favorites/foods/:foodId', removeFavoriteFoodController);

// Cross-device cart continuity only. Checkout prices the cart it is sent, never
// this snapshot, so a stale or failed sync cannot affect what a customer pays.
router.put('/cart', syncUserCartController);

export default router;
