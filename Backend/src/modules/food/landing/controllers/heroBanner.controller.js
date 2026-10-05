import {
    listHeroBanners,
    createHeroBannersFromFiles,
    deleteHeroBanner,
    updateHeroBannerOrder,
    toggleHeroBannerStatus,
    linkRestaurantsToHeroBanner
} from '../services/heroBanner.service.js';
import { sendResponse } from '../../../../utils/response.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodHeroBanner } from '../models/heroBanner.model.js';

export const listHeroBannersController = async (req, res, next) => {
    try {
        // Optional: the panel filters the list to the section being edited.
        const data = await listHeroBanners(req.query?.module);
        // Wrap in { banners } to match LandingPageManagement.jsx expectations
        return sendResponse(res, 200, 'Hero banners fetched successfully', { banners: data });
    } catch (error) {
        next(error);
    }
};

export const uploadHeroBannersController = async (req, res, next) => {
    try {
        if (!req.files || !req.files.length) {
            throw new ValidationError('No files uploaded');
        }

        let linkedIds = [];
        if (req.body.linkedRestaurantIds) {
            try {
                linkedIds = JSON.parse(req.body.linkedRestaurantIds);
            } catch (_) {
                if (typeof req.body.linkedRestaurantIds === 'string') {
                    linkedIds = req.body.linkedRestaurantIds.split(',').map(id => id.trim()).filter(Boolean);
                }
            }
        } else if (req.body.restaurantIds) {
            try {
                linkedIds = JSON.parse(req.body.restaurantIds);
            } catch (_) {
                if (typeof req.body.restaurantIds === 'string') {
                    linkedIds = req.body.restaurantIds.split(',').map(id => id.trim()).filter(Boolean);
                }
            }
        }

        const meta = {
            title: req.body.title,
            ctaText: req.body.ctaText,
            ctaLink: req.body.ctaLink,
            linkedRestaurantIds: linkedIds,
            // Which section this artwork heads. Absent means food, so the
            // existing upload form keeps working without being changed.
            module: req.body.module
        };

        const results = await createHeroBannersFromFiles(req.files, meta);
        return sendResponse(res, 201, 'Hero banners uploaded', { results });
    } catch (error) {
        next(error);
    }
};

export const deleteHeroBannerController = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!id) {
            throw new ValidationError('Banner id is required');
        }
        const result = await deleteHeroBanner(id);
        return sendResponse(res, 200, result.deleted ? 'Hero banner deleted' : 'Hero banner not found', result);
    } catch (error) {
        next(error);
    }
};

export const updateHeroBannerOrderController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { sortOrder } = req.body;
        if (!id || typeof sortOrder !== 'number') {
            throw new ValidationError('id and numeric sortOrder are required');
        }
        const updated = await updateHeroBannerOrder(id, sortOrder);
        return sendResponse(res, 200, 'Hero banner order updated', updated);
    } catch (error) {
        next(error);
    }
};

export const toggleHeroBannerStatusController = async (req, res, next) => {
    try {
        const { id } = req.params;
        let { isActive } = req.body;
        if (!id) {
            throw new ValidationError('id is required');
        }

        if (typeof isActive !== 'boolean') {
            const banner = await FoodHeroBanner.findById(id);
            if (!banner) {
                return sendResponse(res, 404, 'Hero banner not found');
            }
            isActive = !banner.isActive;
        }

        const updated = await toggleHeroBannerStatus(id, isActive);
        return sendResponse(res, 200, 'Hero banner status updated', updated);
    } catch (error) {
        next(error);
    }
};

export const linkHeroBannerRestaurantsController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { restaurantIds } = req.body;
        if (!id || !Array.isArray(restaurantIds)) {
            throw new ValidationError('id and restaurantIds array are required');
        }
        const updated = await linkRestaurantsToHeroBanner(id, restaurantIds);
        return sendResponse(res, 200, 'Restaurants linked to hero banner successfully', updated);
    } catch (error) {
        next(error);
    }
};

