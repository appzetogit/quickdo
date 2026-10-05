import { Router } from 'express';
import { adminRouter } from './adminRoutes.js';
import { adminSafetyRouter } from '../../safety/routes/adminSafety.routes.js';

export const adminModuleRouter = Router();

adminModuleRouter.use('/admin/safety', adminSafetyRouter);
adminModuleRouter.use('/', adminRouter);
