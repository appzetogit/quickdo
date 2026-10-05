import * as restaurantService from '../services/restaurant.service.js';
import { sendResponse, sendError } from '../../../../utils/response.js';
import { validateCreateOfferDto } from '../../admin/validators/offer.validator.js';

export const createRestaurantOfferController = async (req, res) => {
    try {
        const restaurantId = req.user.userId;
        // Inject restaurantId into body for validation
        const payload = validateCreateOfferDto({
            ...req.body,
            restaurantScope: 'selected',
            restaurantId: restaurantId
        });
        const doc = await restaurantService.createRestaurantOffer(restaurantId, payload);
        return sendResponse(res, 201, 'Offer created successfully', { doc });
    } catch (err) {
        return sendError(res, err.statusCode || 400, err.message);
    }
};

export const listRestaurantOffersController = async (req, res) => {
    try {
        const restaurantId = req.user.userId;
        const list = await restaurantService.listRestaurantOffers(restaurantId);
        return sendResponse(res, 200, 'Offers fetched successfully', { offers: list });
    } catch (err) {
        return sendError(res, err.statusCode || 400, err.message);
    }
};

export const deleteRestaurantOfferController = async (req, res) => {
    try {
        const restaurantId = req.user.userId;
        const { id: offerId } = req.params;
        await restaurantService.deleteRestaurantOffer(restaurantId, offerId);
        return sendResponse(res, 200, 'Offer deleted successfully');
    } catch (err) {
        return sendError(res, err.statusCode || 400, err.message);
    }
};

export const updateRestaurantOfferStatusController = async (req, res) => {
    try {
        const restaurantId = req.user.userId;
        const { id: offerId } = req.params;
        const { status } = req.body;
        const doc = await restaurantService.updateRestaurantOfferStatus(restaurantId, offerId, status);
        return sendResponse(res, 200, 'Offer status updated successfully', { doc });
    } catch (err) {
        return sendError(res, err.statusCode || 400, err.message);
    }
};
