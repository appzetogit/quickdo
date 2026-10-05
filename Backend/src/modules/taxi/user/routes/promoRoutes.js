import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticateOrResolveUser } from '../../middlewares/authMiddleware.js';
import { getAvailablePromos, validatePromo } from '../controllers/promoController.js';

export const promoRouter = Router();

promoRouter.post('/validate', authenticateOrResolveUser(['user']), asyncHandler(validatePromo));
promoRouter.get('/available', authenticateOrResolveUser(['user']), asyncHandler(getAvailablePromos));
