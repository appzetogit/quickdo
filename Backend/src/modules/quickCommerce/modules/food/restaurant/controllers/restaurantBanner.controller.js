import { sendResponse } from '../../../../utils/response.js';
import {
    listRestaurantBanners,
    uploadRestaurantBanners,
    deleteRestaurantBanner,
    reorderRestaurantBanners,
    getRestaurantMedia,
    uploadRestaurantCoverImage,
    uploadRestaurantGalleryImages,
    deleteRestaurantGalleryImage
} from '../services/restaurantBanner.service.js';

export const listBannersController = async (req, res, next) => {
    try {
        const data = await listRestaurantBanners(req.user?.userId);
        return sendResponse(res, 200, 'Banners fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const uploadBannersController = async (req, res, next) => {
    try {
        const data = await uploadRestaurantBanners(req.user?.userId, req.files || []);
        return sendResponse(res, 201, 'Banners uploaded successfully', data);
    } catch (error) {
        next(error);
    }
};

export const deleteBannerController = async (req, res, next) => {
    try {
        // URL comes in the body — banner URLs contain slashes and can't be a path param.
        const data = await deleteRestaurantBanner(req.user?.userId, req.body?.bannerUrl);
        return sendResponse(res, 200, 'Banner deleted successfully', data);
    } catch (error) {
        next(error);
    }
};

export const reorderBannersController = async (req, res, next) => {
    try {
        const data = await reorderRestaurantBanners(req.user?.userId, req.body?.banners);
        return sendResponse(res, 200, 'Banners reordered successfully', data);
    } catch (error) {
        next(error);
    }
};

// ── Main cover image + premises gallery ──
export const getMediaController = async (req, res, next) => {
    try {
        const data = await getRestaurantMedia(req.user?.userId);
        return sendResponse(res, 200, 'Media fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const uploadCoverImageController = async (req, res, next) => {
    try {
        const data = await uploadRestaurantCoverImage(req.user?.userId, req.file);
        return sendResponse(res, 200, 'Cover image updated successfully', data);
    } catch (error) {
        next(error);
    }
};

export const uploadGalleryImagesController = async (req, res, next) => {
    try {
        const data = await uploadRestaurantGalleryImages(req.user?.userId, req.files || []);
        return sendResponse(res, 201, 'Gallery images uploaded successfully', data);
    } catch (error) {
        next(error);
    }
};

export const deleteGalleryImageController = async (req, res, next) => {
    try {
        const data = await deleteRestaurantGalleryImage(req.user?.userId, req.body?.imageUrl);
        return sendResponse(res, 200, 'Gallery image deleted successfully', data);
    } catch (error) {
        next(error);
    }
};
