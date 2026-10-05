import { searchUnified, searchProducts, getAdminCategories } from '../services/search.service.js';
import { sendResponse, sendError } from '../../../../utils/response.js';

/**
 * Unified Search for Restaurants, Food Items, and Cuisines
 */
export const searchController = async (req, res, next) => {
    try {
        const { q, lat, lng, radiusKm, categoryId, minRating, maxDeliveryTime, isVeg, page, limit, zoneId, strictZone } = req.query;

        const results = await searchUnified({
            q,
            lat,
            lng,
            radiusKm,
            categoryId,
            minRating,
            maxDeliveryTime,
            isVeg,
            page: parseInt(page, 10) || 1,
            limit: parseInt(limit, 10) || 20,
            zoneId,
            strictZone
        });

        return sendResponse(res, 200, 'Search results fetched successfully', results.data);
    } catch (error) {
        next(error);
    }
};

/**
 * Product search — returns items, not the sellers that stock them.
 */
export const searchProductsController = async (req, res, next) => {
    try {
        const { q, categoryId, zoneId, isVeg, inStockOnly, page, limit } = req.query;

        const results = await searchProducts({
            q,
            categoryId,
            zoneId,
            isVeg,
            inStockOnly,
            page: parseInt(page, 10) || 1,
            limit: parseInt(limit, 10) || 20
        });

        return sendResponse(res, 200, 'Products fetched successfully', results);
    } catch (error) {
        next(error);
    }
};

/**
 * Fetch List of Admin-only Categories
 */
export const listAdminCategoriesController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        const categories = await getAdminCategories({ zoneId });
        
        return sendResponse(res, 200, 'Admin categories fetched successfully', { categories });
    } catch (error) {
        next(error);
    }
};
