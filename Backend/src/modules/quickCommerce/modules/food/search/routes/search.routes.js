import express from 'express';
import {
    searchController,
    searchProductsController,
    listAdminCategoriesController,
    suggestController,
    listRecentSearchesController,
    recordRecentSearchController,
    clearRecentSearchesController,
} from '../controllers/search.controller.js';
import { authMiddleware, optionalAuth } from '../../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../../../../core/roles/role.middleware.js';
import { cacheResponse } from '../../../../middleware/cache.js';

const router = express.Router();

/**
 * Unified Search Endpoint
 * GET /api/v1/food/search/unified
 */
router.get('/unified', cacheResponse(120, 'search_unified', { browserTtlSeconds: 30 }), searchController);

/**
 * Product Search Endpoint — returns a product grid rather than a seller list.
 * GET /api/v1/food/search/products
 *
 * Cached for 30s rather than the 120s /unified uses: these results carry stock,
 * and a two-minute-old "in stock" is a promise the shelf may not keep.
 */
router.get('/products', cacheResponse(30, 'search_products', { browserTtlSeconds: 10 }), searchProductsController);

/**
 * Admin Categories Only Endpoint (to avoid restaurant-created ones as requested)
 * GET /api/v1/food/search/categories/admin
 */
router.get('/categories/admin', cacheResponse(1800, 'search_categories_admin', { browserTtlSeconds: 300 }), listAdminCategoriesController);

/**
 * Search suggestions (plan §5.5): prefix match on product, category and brand
 * names ranked by popularity. Not cached: the signed-in customer's recent
 * searches ride along.
 * GET /api/v1/qc/search/suggest?q=mil&limit=10&zoneId=
 */
router.get('/suggest', optionalAuth, suggestController);

// The customer's recent searches.
router.get('/recent', authMiddleware, requireRoles('USER'), listRecentSearchesController);
router.post('/recent', authMiddleware, requireRoles('USER'), recordRecentSearchController);
router.delete('/recent', authMiddleware, requireRoles('USER'), clearRecentSearchesController);

export default router;
