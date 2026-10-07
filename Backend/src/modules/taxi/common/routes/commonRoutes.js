import { Router } from 'express';
import * as commonController from '../controllers/commonController.js';
import { upload } from '../../../../middleware/upload.js';
import { authenticate } from '../../middlewares/authMiddleware.js';

export const commonRouter = Router();

// Universal image upload endpoint. Every caller (admin pages, driver settings, user
// profile) is signed in; it used to accept files from anyone. allowPending so a driver
// still under review can upload their documents.
commonRouter.post('/common/upload/image', authenticate([], { allowPending: true }), upload.single('image'), commonController.uploadImage);
commonRouter.get('/common/referrals/translation', commonController.getReferralTranslation);
commonRouter.get('/common/referrals/settings', commonController.getReferralSettingsContent);
commonRouter.get('/common/settings', commonController.getPublicSettingsBootstrap);
commonRouter.get('/common/payment-gateway', commonController.getPaymentGatewayConfig);
commonRouter.post('/common/payment-gateway/phonepe/callback', commonController.acknowledgePhonePeCallback);
commonRouter.get('/common/landing-page/settings', commonController.getLandingPageSettings);
