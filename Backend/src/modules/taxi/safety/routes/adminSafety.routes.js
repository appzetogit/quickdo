import express from 'express';
import * as adminSafetyController from '../controllers/adminSafety.controller.js';
import { authMiddleware, requireAdmin } from '../../../../core/auth/auth.middleware.js';
import { requireServiceAccess } from '../../../../core/roles/serviceAccess.middleware.js';

export const adminSafetyRouter = express.Router();

// SOS alerts and safety reports are taxi data: a Food-only admin has no business here.
adminSafetyRouter.use(authMiddleware, requireAdmin, requireServiceAccess('taxi'));

// Dashboard & Analytics
adminSafetyRouter.get('/analytics', adminSafetyController.getAnalytics);

// Settings
adminSafetyRouter.get('/settings', adminSafetyController.getSettings);
adminSafetyRouter.put('/settings', adminSafetyController.updateSettings);

// Emergency Alerts (SOS)
adminSafetyRouter.get('/alerts', adminSafetyController.getAlerts);
adminSafetyRouter.put('/alerts/:id/status', adminSafetyController.updateAlertStatus);

// Safety Reports
adminSafetyRouter.get('/reports', adminSafetyController.getReports);
adminSafetyRouter.put('/reports/:id/status', adminSafetyController.updateReportStatus);

// Ride Check Logs
adminSafetyRouter.get('/ride-checks', adminSafetyController.getRideCheckLogs);

// Safety Tips Management
adminSafetyRouter.get('/tips', adminSafetyController.getSafetyTips);
adminSafetyRouter.post('/tips', adminSafetyController.addSafetyTip);
adminSafetyRouter.put('/tips/:id', adminSafetyController.updateSafetyTip);
adminSafetyRouter.delete('/tips/:id', adminSafetyController.deleteSafetyTip);
