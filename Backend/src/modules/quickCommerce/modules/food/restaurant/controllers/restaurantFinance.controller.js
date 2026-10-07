import { sendResponse, sendError } from '../../../../utils/response.js';
import { getRestaurantFinance } from '../services/restaurantFinance.service.js';
import mongoose from 'mongoose';
import { FoodRestaurantCommission } from '../../admin/models/restaurantCommission.model.js';

/** The commission rate this store's new orders are charged: its own rule, or none. */
async function currentCommissionFor(restaurantId) {
    if (!mongoose.Types.ObjectId.isValid(String(restaurantId || ''))) return { type: 'percentage', value: 0, source: 'none' };
    const rule = await FoodRestaurantCommission.findOne({ restaurantId, status: { $ne: false } }).lean();
    if (rule) {
        return { type: rule.defaultCommission?.type || 'percentage', value: Number(rule.defaultCommission?.value) || 0, source: 'own' };
    }
    return { type: 'percentage', value: 0, source: 'none' };
}

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

