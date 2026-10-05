import { sendResponse } from '../../../../utils/response.js';
import * as svc from '../services/restaurantAppBanner.service.js';

// ── Admin ──
export async function listBannersAdminController(_req, res, next) {
    try {
        return sendResponse(res, 200, 'Restaurant app banners fetched', await svc.listBannersAdmin());
    } catch (e) { next(e); }
}

export async function createBannerController(req, res, next) {
    try {
        const banner = await svc.createBanner(req.file, req.body || {});
        return sendResponse(res, 201, 'Banner created', { banner });
    } catch (e) { next(e); }
}

export async function updateBannerController(req, res, next) {
    try {
        const banner = await svc.updateBanner(req.params.id, req.body || {}, req.file);
        return sendResponse(res, 200, 'Banner updated', { banner });
    } catch (e) { next(e); }
}

export async function deleteBannerController(req, res, next) {
    try {
        return sendResponse(res, 200, 'Banner deleted', await svc.deleteBanner(req.params.id));
    } catch (e) { next(e); }
}

export async function toggleBannerStatusController(req, res, next) {
    try {
        const banner = await svc.toggleBannerStatus(req.params.id, req.body?.isActive);
        return sendResponse(res, 200, 'Banner status updated', { banner });
    } catch (e) { next(e); }
}

export async function reorderBannersController(req, res, next) {
    try {
        return sendResponse(res, 200, 'Banners reordered', await svc.reorderBanners(req.body?.banners));
    } catch (e) { next(e); }
}

// ── Restaurant partner app ──
export async function listBannersForRestaurantAppController(_req, res, next) {
    try {
        return sendResponse(res, 200, 'Banners fetched', await svc.listBannersForRestaurantApp());
    } catch (e) { next(e); }
}
