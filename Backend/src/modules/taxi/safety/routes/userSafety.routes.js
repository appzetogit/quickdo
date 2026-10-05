import express from 'express';
import * as userSafetyController from '../controllers/userSafety.controller.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import multer from 'multer';

export const userSafetyRouter = express.Router();

const upload = multer({ dest: 'uploads/safety/' });
const uploadMiddleware = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'audio', maxCount: 1 }]);

userSafetyRouter.use(authMiddleware);

// Trusted Contacts
userSafetyRouter.get('/trusted-contacts', userSafetyController.getTrustedContacts);
userSafetyRouter.post('/trusted-contacts', userSafetyController.addTrustedContact);
userSafetyRouter.put('/trusted-contacts/:id', userSafetyController.updateTrustedContact);
userSafetyRouter.delete('/trusted-contacts/:id', userSafetyController.deleteTrustedContact);

// Emergency & Safety
userSafetyRouter.post('/sos', userSafetyController.triggerSOS);
userSafetyRouter.post('/trip/share', userSafetyController.shareTrip);
userSafetyRouter.post('/driver/report', uploadMiddleware, userSafetyController.reportDriver);
userSafetyRouter.post('/ride-check-response', userSafetyController.submitRideCheck);

// General Safety Info
userSafetyRouter.get('/tips', userSafetyController.getSafetyTips);
userSafetyRouter.get('/settings', userSafetyController.getEmergencySettings);
