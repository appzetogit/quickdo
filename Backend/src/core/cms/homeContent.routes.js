import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import { upload } from '../../middleware/upload.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import * as content from './homeContent.service.js';
import { canAdminDelete } from '../admin/adminAccessPolicy.js';

/**
 * Master > Home Screen Banners: /v1/platform/home-content.
 *
 * Named without "banner" on purpose: ad blockers abort any request whose URL
 * contains it (see PATH_ALIASES in routes/index.js), which is how banner
 * screens have silently rendered empty before.
 */
const router = express.Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
router.use(authMiddleware, requireRoles('ADMIN'));
router.use(async (req, res, next) => {
  try {
    const admin = await loadAdminCached(req.user?.userId || req.user?.id);
    if (!admin) return sendError(res, 403, 'Admin account not found');
    if (admin.isActive === false) return sendError(res, 403, 'Your admin account has been deactivated');
    req.platformAdmin = admin;
    return next();
  } catch (err) {
    return next(err);
  }
});

const handle = (fn, message = 'OK') => async (req, res) => {
  try {
    return sendResponse(res, 200, message, await fn(req));
  } catch (err) {
    const status = err?.statusCode || err?.status || 500;
    return sendError(res, status, status >= 500 ? 'Could not complete that. Please try again.' : err.message);
  }
};

router.get('/', handle((req) => content.listHomeContent(req.platformAdmin)));
router.patch('/:group/:id/live', handle((req) => content.setHomeContentLive(req.platformAdmin, req.params.group, req.params.id, req.body?.live), 'Saved'));

/*
 * Quick's top banners: the API existed with no admin screen, so the top of
 * Quick's home was always empty. Uploaded here through Quick's own handler, so
 * storage, ordering and the public read are exactly Quick's.
 */
router.post(
  '/quickTop',
  (req, res, next) => (content.canUploadQuickTop(req.platformAdmin)
    ? next()
    : sendError(res, 403, 'You do not have access to Quick banners')),
  upload.array('files'),
  async (req, res, next) => {
    try {
      const { uploadTopBannersController } = await import(
        '../../modules/quickCommerce/modules/food/landing/controllers/topBanner.controller.js'
      );
      return uploadTopBannersController(req, res, next);
    } catch (err) {
      return next(err);
    }
  },
);

router.delete(
  '/quickTop/:id',
  (req, res, next) => {
    if (!content.canUploadQuickTop(req.platformAdmin)) return sendError(res, 403, 'You do not have access to Quick banners');
    // The per-admin delete switch (Admin Accounts > Can delete), as every panel enforces it.
    if (!canAdminDelete(req.platformAdmin)) {
      return sendError(res, 403, 'You do not have delete access. Ask an owner to turn it on for your account');
    }
    return next();
  },
  async (req, res, next) => {
    try {
      const { deleteTopBannerController } = await import(
        '../../modules/quickCommerce/modules/food/landing/controllers/topBanner.controller.js'
      );
      return deleteTopBannerController(req, res, next);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
