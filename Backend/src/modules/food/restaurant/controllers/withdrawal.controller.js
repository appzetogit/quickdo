import { sendResponse, sendError } from '../../../../utils/response.js';
import { FoodRestaurantWithdrawal } from '../models/foodRestaurantWithdrawal.model.js';
import { getRestaurantWithdrawalSettings } from '../../admin/services/admin.service.js';
import { getRestaurantFinance } from '../services/restaurantFinance.service.js';
import { withFinanceLock, restaurantWithdrawalLockKey } from '../../../../core/finance/financeLock.js';

export const createWithdrawalRequestController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { amount, bankDetails } = req.body;
        const parsedAmount = Number(amount);

        if (!restaurantId) return sendError(res, 401, 'Restaurant authentication required');
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return sendError(res, 400, 'Invalid withdrawal amount');

        /*
         * The balance check and the save run under one per-restaurant lock.
         *
         * netAvailable is derived on every read, so "read it, then save the
         * request" had a gap: two Rs 800 requests against Rs 1000, sent
         * together, both read 1000 and both got 201 -- Rs 1600 queued. Under the
         * lock the second waits for the first to be saved, re-reads Rs 200, and
         * is refused.
         */
        return await withFinanceLock(restaurantWithdrawalLockKey(restaurantId), async () => {
            const finance = await getRestaurantFinance(restaurantId);
            const totalEarnings = Number(finance?.currentCycle?.netAvailable ?? finance?.currentCycle?.estimatedPayout ?? 0);
            const withdrawalSettings = await getRestaurantWithdrawalSettings();
            const minimumWithdrawalAmount = Number(withdrawalSettings?.minimumWithdrawalAmount) || 0;

            if (parsedAmount < minimumWithdrawalAmount) {
                return sendError(res, 400, `Minimum withdrawal amount is Rs ${minimumWithdrawalAmount.toLocaleString('en-IN')}`);
            }

            if (parsedAmount > totalEarnings) {
                return sendError(res, 400, `Insufficient balance. Available to withdraw: Rs ${totalEarnings.toLocaleString('en-IN')}`);
            }

            const withdrawal = new FoodRestaurantWithdrawal({
                restaurantId,
                amount: parsedAmount,
                bankDetails,
                status: 'pending'
            });

            await withdrawal.save();

            return sendResponse(res, 201, 'Withdrawal request submitted successfully', withdrawal);
        }, { busyMessage: 'Another withdrawal is being processed. Please try again.' });
    } catch (error) {
        next(error);
    }
};

export const listMyWithdrawalsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        if (!restaurantId) return sendError(res, 401, 'Restaurant authentication required');

        const withdrawals = await FoodRestaurantWithdrawal.find({ restaurantId })
            .sort({ createdAt: -1 })
            .lean();

        return sendResponse(res, 200, 'Withdrawals fetched successfully', withdrawals);
    } catch (error) {
        next(error);
    }
};
