import { Router } from 'express';
import { deliveryRouter } from './deliveryRoutes.js';
import { promoRouter } from './promoRoutes.js';
import { rideRouter } from './rideRoutes.js';
import { userRouter } from './userRoutes.js';
import { userSafetyRouter } from '../../safety/routes/userSafety.routes.js';

export const userModuleRouter = Router();

userModuleRouter.use('/users', userRouter);
userModuleRouter.use('/rides', rideRouter);
userModuleRouter.use('/deliveries', deliveryRouter);
userModuleRouter.use('/promos', promoRouter);
userModuleRouter.use('/safety', userSafetyRouter);


