import { Router } from 'express';
import { chatModuleRouter } from '../chat/routes/index.js';
import { adminModuleRouter } from '../admin/routes/index.js';
import { driverModuleRouter } from '../driver/routes/index.js';
import { supportModuleRouter } from '../support/routes/index.js';
import { userModuleRouter } from '../user/routes/index.js';
import { commonRouter } from '../common/routes/commonRoutes.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { getPublicTrip } from '../safety/controllers/safetyController.js';

export const taxiRouter = Router();

// No sign-in: the page behind a shared trip link (plan §4.8). Mounted first so
// no router-level auth below can catch it.
taxiRouter.get('/public/trip/:token', asyncHandler(getPublicTrip));

taxiRouter.use(chatModuleRouter);
taxiRouter.use(adminModuleRouter);
taxiRouter.use(userModuleRouter);
taxiRouter.use(driverModuleRouter);
taxiRouter.use(supportModuleRouter);
taxiRouter.use(commonRouter);
