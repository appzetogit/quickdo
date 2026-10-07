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

/* ---- search suggestions, recent searches, barcode (plan §5.5, §5.6) ---- */

/** GET /search/suggest?q=&limit=&zoneId= -- prefix suggestions; signed-in customers also get their recent searches. */
export const suggestController = async (req, res, next) => {
    try {
        const { suggestQc } = await import('../services/suggest.service.js');
        const data = await suggestQc({
            q: req.query.q,
            limit: req.query.limit,
            zoneId: req.query.zoneId,
            userId: req.user?.role === 'USER' ? req.user.userId : null,
        });
        return sendResponse(res, 200, 'Suggestions', data);
    } catch (error) {
        next(error);
    }
};

export const listRecentSearchesController = async (req, res, next) => {
    try {
        const { listRecentSearches } = await import('../../../../../../core/search/suggest.service.js');
        return sendResponse(res, 200, 'Recent searches', { recent: await listRecentSearches(req.user?.userId, 'quickCommerce') });
    } catch (error) {
        next(error);
    }
};

/** POST /search/recent { q } -- the app calls this when the customer submits a search. */
export const recordRecentSearchController = async (req, res, next) => {
    try {
        const { recordRecentSearch } = await import('../../../../../../core/search/suggest.service.js');
        const recent = await recordRecentSearch(req.user?.userId, 'quickCommerce', req.body?.q ?? req.body?.term);
        return sendResponse(res, 200, 'Saved', { recent });
    } catch (error) {
        next(error);
    }
};

/** DELETE /search/recent?term= -- one term, or all of them. */
export const clearRecentSearchesController = async (req, res, next) => {
    try {
        const { clearRecentSearches } = await import('../../../../../../core/search/suggest.service.js');
        const recent = await clearRecentSearches(req.user?.userId, 'quickCommerce', req.query.term || null);
        return sendResponse(res, 200, 'Cleared', { recent });
    } catch (error) {
        next(error);
    }
};

/** GET /products/by-barcode/:code?zoneId= -- what the app's camera scan opens. */
export const productsByBarcodeController = async (req, res, next) => {
    try {
        const { findProductsByBarcode } = await import('../services/suggest.service.js');
        const data = await findProductsByBarcode(req.params.code, { zoneId: req.query.zoneId });
        if (!data.products.length) return sendError(res, 404, 'No product with this barcode here');
        return sendResponse(res, 200, 'Products', data);
    } catch (error) {
        next(error);
    }
};
