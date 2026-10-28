import express from 'express';
import { sendResponse, sendError } from '../../../../utils/response.js';
import * as stock from '../services/stock.service.js';

/**
 * Stock management, mounted twice:
 *   /v1/qc/admin/stock       the admin, any store (?restaurantId= to pick one)
 *   /v1/qc/restaurant/stock  a store, its own products only
 *
 *   GET   /                   rows + summary   ?q= &status= &categoryId= &page= &limit=
 *   PATCH /                   one row          { itemId, variantId, mode, value, lowStockThreshold }
 *   POST  /bulk               several rows     { rows: [...] }
 *   GET   /history            one row's record ?itemId= &variantId=
 */
export function stockRouter({ scope }) {
  const router = express.Router();

  const ctx = (req) => {
    if (scope === 'restaurant') {
      return {
        restaurantId: String(req.user?.userId || ''),
        actor: { role: 'store', id: String(req.user?.userId || ''), name: 'Store' },
      };
    }
    return {
      restaurantId: req.query.restaurantId || req.body?.restaurantId || null,
      actor: { role: 'admin', id: String(req.user?.userId || ''), name: req.user?.name || 'Admin' },
    };
  };

  const handle = (fn, message = 'OK') => async (req, res) => {
    try {
      return sendResponse(res, 200, message, await fn(req));
    } catch (err) {
      const status = err?.statusCode || err?.status || (err?.name === 'ValidationError' ? 400 : 500);
      return sendError(res, status, status >= 500 ? 'Could not update stock. Please try again.' : err.message);
    }
  };

  router.get('/', handle((req) => {
    const { restaurantId } = ctx(req);
    return stock.listStock({ ...req.query, restaurantId: scope === 'restaurant' ? restaurantId : req.query.restaurantId });
  }));

  router.patch('/', handle((req) => {
    const { restaurantId, actor } = ctx(req);
    return stock.adjustStock({
      ...req.body,
      restaurantId: scope === 'restaurant' ? restaurantId : null,
      actor,
      reason: 'manual',
    });
  }, 'Stock updated'));

  router.post('/bulk', handle((req) => {
    const { restaurantId, actor } = ctx(req);
    return stock.bulkAdjust(req.body?.rows, {
      restaurantId: scope === 'restaurant' ? restaurantId : (req.body?.restaurantId || null),
      actor,
      reason: req.body?.source === 'sheet' ? 'import' : 'bulk',
    });
  }, 'Stock updated'));

  router.get('/history', handle((req) => {
    const { restaurantId } = ctx(req);
    return stock.stockHistory({
      itemId: req.query.itemId,
      variantId: req.query.variantId || '',
      restaurantId: scope === 'restaurant' ? restaurantId : null,
    });
  }));

  return router;
}
