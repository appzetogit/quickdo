import { sendResponse } from '../../../../utils/response.js';
import { listUserCartsForAdmin, getUserCartPricingForAdmin } from '../../user/services/userCart.service.js';

export const listUserCartsAdminController = async (req, res, next) => {
    try {
        const result = await listUserCartsForAdmin(req.query || {});
        return sendResponse(res, 200, 'User carts retrieved successfully', result);
    } catch (error) {
        next(error);
    }
};

export const getUserCartPricingAdminController = async (req, res, next) => {
    try {
        const pricing = await getUserCartPricingForAdmin(req.params?.cartId);
        return sendResponse(res, 200, 'Cart pricing retrieved successfully', { pricing });
    } catch (error) {
        next(error);
    }
};
