import { sendResponse, sendError } from '../../../../utils/response.js';
import { getRestaurantFinance } from '../services/restaurantFinance.service.js';
import { currentCommissionFor } from '../../admin/services/medicalCommission.service.js';

export const getRestaurantFinanceController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        if (!restaurantId) return sendError(res, 401, 'Restaurant authentication required');

        const data = await getRestaurantFinance(restaurantId, req.query || {});
        // The rate new orders are charged (admin: Commission), shown on the payouts screen.
        const commission = await currentCommissionFor(restaurantId).catch(() => null);
        if (data && typeof data === 'object' && commission) data.commission = commission;
        // `sendResponse` already uses `data` as the top-level payload key.
        return sendResponse(res, 200, 'Finance fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

