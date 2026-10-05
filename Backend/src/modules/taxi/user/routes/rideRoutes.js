import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate, authenticateOrResolveUser } from '../../middlewares/authMiddleware.js';
import {
  acceptRideBid,
  createRazorpayRideCompletionOrder,
  cancelRide,
  createRazorpayRideTipOrder,
  createRide,
  getRideBids,
  getRideAppTipSettings,
  getMyActiveRide,
  getRideById,
  listMyRides,
  listAvailableDrivers,
  payRideCompletionWithWallet,
  submitRideReview,
  updateRideBidCeiling,
  updateRideStatus,
  addParcelPhotos,
  verifyRazorpayRideCompletion,
  verifyRazorpayRideTip,
  validateLocation,
  getPoolGroupById,
  quoteRide,
} from '../controllers/rideController.js';

export const rideRouter = Router();

rideRouter.post('/', authenticateOrResolveUser(['user']), asyncHandler(createRide));
// Public: the booking screen shows fares before the rider signs in.
rideRouter.post('/quote', asyncHandler(quoteRide));
rideRouter.post('/validate-location', asyncHandler(validateLocation));
rideRouter.get('/', authenticateOrResolveUser(['user', 'driver']), asyncHandler(listMyRides));
rideRouter.get('/app-settings/tip', asyncHandler(getRideAppTipSettings));
rideRouter.get('/available-drivers', asyncHandler(listAvailableDrivers));
rideRouter.get('/active/me', authenticateOrResolveUser(['user', 'driver']), asyncHandler(getMyActiveRide));
rideRouter.get('/pooling/group/:poolGroupId', authenticateOrResolveUser(['user', 'driver']), asyncHandler(getPoolGroupById));
rideRouter.patch('/:rideId/cancel', authenticate(['user']), asyncHandler(cancelRide));
rideRouter.get('/:rideId/bids', authenticate(['user']), asyncHandler(getRideBids));
rideRouter.patch('/:rideId/bids/ceiling', authenticate(['user']), asyncHandler(updateRideBidCeiling));
rideRouter.post('/:rideId/bids/:bidId/accept', authenticate(['user']), asyncHandler(acceptRideBid));
rideRouter.get('/:rideId', authenticateOrResolveUser(['user', 'driver']), asyncHandler(getRideById));
rideRouter.patch('/:rideId/status', authenticate(['driver']), asyncHandler(updateRideStatus));
rideRouter.post('/:rideId/parcel-photos', authenticate(['driver']), asyncHandler(addParcelPhotos));
rideRouter.post('/:rideId/complete-payment/razorpay/order', authenticate(['user']), asyncHandler(createRazorpayRideCompletionOrder));
rideRouter.post('/:rideId/complete-payment/razorpay/verify', authenticate(['user']), asyncHandler(verifyRazorpayRideCompletion));
rideRouter.post('/:rideId/complete-payment/wallet', authenticate(['user']), asyncHandler(payRideCompletionWithWallet));
rideRouter.post('/:rideId/tip/razorpay/order', authenticate(['user']), asyncHandler(createRazorpayRideTipOrder));
rideRouter.post('/:rideId/tip/razorpay/verify', authenticate(['user']), asyncHandler(verifyRazorpayRideTip));
rideRouter.patch('/:rideId/feedback', authenticate(['user']), asyncHandler(submitRideReview));
