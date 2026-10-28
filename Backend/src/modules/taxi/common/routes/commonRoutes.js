import { Router } from 'express';
import * as commonController from '../controllers/commonController.js';
import { upload } from '../../../../middleware/upload.js';

export const commonRouter = Router();

// Universal image upload endpoint
commonRouter.post('/common/upload/image', upload.single('image'), commonController.uploadImage);
commonRouter.get('/common/referrals/translation', commonController.getReferralTranslation);
commonRouter.get('/common/referrals/settings', commonController.getReferralSettingsContent);
commonRouter.get('/common/settings', commonController.getPublicSettingsBootstrap);
commonRouter.get('/common/payment-gateway', commonController.getPaymentGatewayConfig);
commonRouter.post('/common/payment-gateway/phonepe/callback', commonController.acknowledgePhonePeCallback);
commonRouter.get('/common/landing-page/settings', commonController.getLandingPageSettings);
