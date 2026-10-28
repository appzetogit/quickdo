import { sendResponse } from '../../../../utils/response.js';
import { syncUserCart } from '../services/userCart.service.js';

export const syncUserCartController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const pricing = req.body?.pricing || null;
        const firstItem = items[0] || {};

        const payload = items.map((item) => ({
            ...item,
            restaurantId: item?.restaurantId || firstItem?.restaurantId || req.body?.restaurantId || '',
            restaurantName: item?.restaurant || item?.restaurantName || firstItem?.restaurant || req.body?.restaurantName || '',
        }));

        const result = await syncUserCart(userId, payload, pricing);
        return sendResponse(res, 200, 'Cart synced successfully', {
            synced: Boolean(result),
            itemCount: result?.itemCount || 0,
        });
    } catch (error) {
        next(error);
    }
};
