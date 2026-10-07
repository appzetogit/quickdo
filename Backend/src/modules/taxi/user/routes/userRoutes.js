import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate, authenticateOrResolveUser } from '../../middlewares/authMiddleware.js';
import {
  createRazorpayWalletTopupOrder,
  createPhonePeWalletTopupOrder,
  getUserWallet,
  getCurrentUser,
  getUserNotifications,
  deleteUserNotification,
  getIntercityPackageCatalog,
  clearAllUserNotifications,
  listPublicServiceLocations,
  loginUser,
  registerUser,
  requestAccountDeletion,
  signupUser,
  startUserOtpRequest,
  topupUserWallet,
  transferUserWalletToDriver,
  transferUserWallet,
  updateCurrentUser,
  uploadUserProfileImage,
  verifyRazorpayWalletTopup,
  verifyPhonePeWalletTopup,
  verifyUserOtpRequest,
  refreshUserTokenRequest,
  logoutUserRequest,
  verifyUserPhoneForOtpLogin,
  getAvailableSubscriptionPlans,
  getMySubscriptions,
  buySubscription,
} from '../controllers/userController.js';
import { getAppModules, getPopularPlaces, getPublicSetPrices, getPublicVehicleTypeCatalog } from '../../admin/controllers/adminController.js';
import { triggerUserSosAlert, updateUserSosLocation } from '../../safety/controllers/safetyController.js';

export const userRouter = Router();

userRouter.get('/app-modules', asyncHandler(getAppModules));
userRouter.get('/intercity-packages', asyncHandler(getIntercityPackageCatalog));
userRouter.get('/vehicle-types', asyncHandler(getPublicVehicleTypeCatalog));
// Landmarks the admin set on the zone the rider is standing in, nearest
// first. Public: the destination screen renders before sign-in.
userRouter.get('/popular-places', asyncHandler(getPopularPlaces));
// Public tariffs. Present pre-merge as userRouter.get('/set-prices'); the
// rider app has always read fares from here and shows blank prices without it.
userRouter.get('/set-prices', asyncHandler(getPublicSetPrices));
userRouter.get('/service-locations', asyncHandler(listPublicServiceLocations));
// The Rides home strip. The app has asked for this since the merge and got 404,
// so it showed its bundled artwork and nothing the admin uploaded under Taxi >
// Promotions > Banner Image ever reached a rider. Public: the home renders before
// sign-in. `link` is what the app opens on tap.
userRouter.get('/banners', asyncHandler(async (_req, res) => {
  const { Banner } = await import('../../admin/promotions/models/Banner.js');
  const rows = await Banner.find({ active: { $ne: false } }).sort({ createdAt: -1 }).limit(20).lean();
  res.json({
    success: true,
    data: {
      results: rows.map((b) => ({
        _id: b._id,
        title: b.title || '',
        image: b.image || '',
        link: b.redirect_url || b.external_link || b.deep_link || '',
      })),
    },
  });
}));
userRouter.post('/register', asyncHandler(registerUser));
userRouter.post('/signup', asyncHandler(signupUser));
userRouter.post('/login', asyncHandler(loginUser));
userRouter.post('/profile-image', asyncHandler(uploadUserProfileImage));
userRouter.post('/auth/send-otp', asyncHandler(startUserOtpRequest));
userRouter.post('/auth/verify-otp', asyncHandler(verifyUserOtpRequest));
userRouter.post('/auth/refresh-token', asyncHandler(refreshUserTokenRequest));
userRouter.post('/auth/logout', asyncHandler(logoutUserRequest));
userRouter.post('/otp-login', asyncHandler(verifyUserPhoneForOtpLogin));
userRouter.get('/me', authenticateOrResolveUser(['user']), asyncHandler(getCurrentUser));
userRouter.patch('/me', authenticateOrResolveUser(['user']), asyncHandler(updateCurrentUser));
userRouter.get('/subscriptions/plans', authenticateOrResolveUser(['user']), asyncHandler(getAvailableSubscriptionPlans));
userRouter.get('/subscriptions/me', authenticateOrResolveUser(['user']), asyncHandler(getMySubscriptions));
userRouter.post('/subscriptions/purchase', authenticateOrResolveUser(['user']), asyncHandler(buySubscription));
userRouter.post('/me/delete-request', authenticateOrResolveUser(['user']), asyncHandler(requestAccountDeletion));
userRouter.get('/notifications', authenticateOrResolveUser(['user']), asyncHandler(getUserNotifications));
userRouter.delete('/notifications/:id', authenticateOrResolveUser(['user']), asyncHandler(deleteUserNotification));
userRouter.delete('/notifications', authenticateOrResolveUser(['user']), asyncHandler(clearAllUserNotifications));
userRouter.post('/sos', authenticateOrResolveUser(['user']), asyncHandler(triggerUserSosAlert));
// While an SOS is open the app posts its position every 10 s (plan §4.7).
userRouter.post('/sos/:alertId/location', authenticate(['user']), asyncHandler(updateUserSosLocation));
userRouter.get('/wallet', authenticateOrResolveUser(['user']), asyncHandler(getUserWallet));
userRouter.post('/wallet/topup', authenticateOrResolveUser(['user']), asyncHandler(topupUserWallet));
userRouter.post('/wallet/transfer', authenticateOrResolveUser(['user']), asyncHandler(transferUserWallet));
userRouter.post('/wallet/transfer/driver', authenticateOrResolveUser(['user']), asyncHandler(transferUserWalletToDriver));
userRouter.post('/wallet/razorpay/order', authenticateOrResolveUser(['user']), asyncHandler(createRazorpayWalletTopupOrder));
userRouter.post('/wallet/razorpay/verify', authenticateOrResolveUser(['user']), asyncHandler(verifyRazorpayWalletTopup));
userRouter.post('/wallet/phonepe/order', authenticateOrResolveUser(['user']), asyncHandler(createPhonePeWalletTopupOrder));
userRouter.get('/wallet/phonepe/status/:merchantTransactionId', authenticateOrResolveUser(['user']), asyncHandler(verifyPhonePeWalletTopup));

