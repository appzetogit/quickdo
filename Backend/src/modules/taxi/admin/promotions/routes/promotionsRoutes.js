import { Router } from 'express';
import { authenticate } from '../../../middlewares/authMiddleware.js';
import { requireServiceAccess } from '../../../../../core/roles/serviceAccess.middleware.js';
import { enforceAdminAccess } from '../../../../../core/admin/enforceAdminAccess.middleware.js';
import { resolveTaxiAdminResource } from '../../../../../core/admin/adminAccessPolicy.js';
import {
  createBanner,
  createPromoCode,
  deleteBanner,
  deleteNotification,
  deletePromoCode,
  getBanners,
  getNotifications,
  getPromoCodes,
  getPromotionsBootstrap,
  getPromotionsServiceLocations,
  getPromotionsUsers,
  pushBanner,
  sendNotification,
  togglePromoCodeStatus,
  updateBanner,
  updatePromoCode,
} from '../controllers/promotionsController.js';

export const promotionsRouter = Router();

promotionsRouter.use('/admin', authenticate(['admin']));

/*
 * This router is also mounted at /api/v1 (the taxi promo page calls
 * /api/v1/admin/promos), outside the taxi admin router's service-access and
 * permission checks, so a Food-only sub-admin could create taxi promo codes or
 * push to every taxi user. Gate just these paths: other modules' /v1/admin/*
 * routes pass through this router untouched.
 */
const TAXI_PROMOTION_PATH = /^\/admin\/(promotions|promos|notifications|push-notifications|banners)(\/|$)/;
const taxiServiceAccess = requireServiceAccess('taxi');
const taxiPermission = enforceAdminAccess('taxi', resolveTaxiAdminResource);
promotionsRouter.use((req, res, next) => {
  if (!TAXI_PROMOTION_PATH.test(req.path)) return next();
  return taxiServiceAccess(req, res, (err) => (err ? next(err) : taxiPermission(req, res, next)));
});

promotionsRouter.get('/admin/promotions/bootstrap', getPromotionsBootstrap);
promotionsRouter.get('/admin/promos', getPromoCodes);
promotionsRouter.post('/admin/promos', createPromoCode);
promotionsRouter.patch('/admin/promos/:id', updatePromoCode);
promotionsRouter.patch('/admin/promos/:id/toggle', togglePromoCodeStatus);
promotionsRouter.delete('/admin/promos/:id', deletePromoCode);
promotionsRouter.get('/admin/promos/users', getPromotionsUsers);
promotionsRouter.get('/admin/promos/service-locations', getPromotionsServiceLocations);

promotionsRouter.get('/admin/notifications', getNotifications);
promotionsRouter.post('/admin/notifications', sendNotification);
promotionsRouter.post('/admin/notifications/send', sendNotification);
promotionsRouter.delete('/admin/notifications/:id', deleteNotification);
promotionsRouter.delete('/admin/push-notifications/:id', deleteNotification);

promotionsRouter.get('/admin/banners', getBanners);
promotionsRouter.post('/admin/banners', createBanner);
promotionsRouter.patch('/admin/banners/:id', updateBanner);
promotionsRouter.delete('/admin/banners/:id', deleteBanner);
promotionsRouter.post('/admin/banners/:id/push', pushBanner);
