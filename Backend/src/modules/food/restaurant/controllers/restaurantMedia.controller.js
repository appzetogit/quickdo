import { sendResponse } from '../../../../utils/response.js';
import {
    getRestaurantMedia,
    uploadRestaurantCoverImage,
    uploadRestaurantGalleryImages,
    deleteRestaurantGalleryImage
} from '../services/restaurantMedia.service.js';

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
        // The URL arrives in the body, not as a path param: image URLs contain
        // slashes, which no single path segment can carry.
        const data = await deleteRestaurantGalleryImage(req.user?.userId, req.body?.imageUrl);
        return sendResponse(res, 200, 'Gallery image deleted successfully', data);
    } catch (error) {
        next(error);
    }
};
