import express from 'express';
import { sendResponse, sendError } from '../../utils/response.js';
import { listMyOrders } from './myOrders.service.js';

/**
 * GET /v1/platform/me/orders -- the signed-in customer's orders from every
 * service, newest first (myOrders.service.js). Mounted behind the customer
 * auth in routes/index.js, like /v1/food/user.
 *
 *   ?service=food|quick|medical|taxi|parcel|rental|services
 *   ?state=ongoing|past
 *   ?before=<ISO date from nextBefore>   next page
 *   ?limit=1..50                         default 20
 */
const router = express.Router();

router.get('/orders', async (req, res) => {
  try {
    return sendResponse(res, 200, 'OK', await listMyOrders(req.user?.userId || req.user?.id, req.query));
  } catch (err) {
    return sendError(res, 500, 'Could not load your orders. Please try again.');
  }
});

export default router;
