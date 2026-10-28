import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticateOrResolveUser } from '../../middlewares/authMiddleware.js';
import {
  createDelivery,
  getDelivery,
  getMyActiveDelivery,
  listMyDeliveries,
} from '../controllers/deliveryController.js';

export const deliveryRouter = Router();

deliveryRouter.post('/', authenticateOrResolveUser(['user']), asyncHandler(createDelivery));
deliveryRouter.get('/', authenticateOrResolveUser(['user']), asyncHandler(listMyDeliveries));
deliveryRouter.get('/active/me', authenticateOrResolveUser(['user', 'driver']), asyncHandler(getMyActiveDelivery));
deliveryRouter.get('/:deliveryId', authenticateOrResolveUser(['user', 'driver']), asyncHandler(getDelivery));
