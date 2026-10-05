import {
    registerRestaurant,
    listApprovedRestaurants,
    getApprovedRestaurantByIdOrSlug,
    getCurrentRestaurantProfile,
    updateRestaurantProfile,
    updateRestaurantAcceptingOrders,
    updateCurrentRestaurantDiningSettings,
    uploadRestaurantProfileImage,
    uploadRestaurantMenuImage,
    uploadRestaurantCoverImages,
    uploadRestaurantMenuImages,
    uploadRestaurantAttachment,
    listPublicOffers,
    getRestaurantComplaints,
    deleteCurrentRestaurantAccount,
    createRestaurantOnboardingFeeOrder,
} from '../services/restaurant.service.js';
import { getRestaurantSubscriptionHistory } from '../services/subscriptionHistory.service.js';
import { validateRestaurantRegisterDto } from '../validators/restaurant.validator.js';
import { sendResponse, sendError } from '../../../../utils/response.js';
import { FoodUnregisteredRestaurant } from '../models/unregisteredRestaurant.model.js';


export const uploadRestaurantAttachmentController = async (req, res, next) => {
    try {
        const { folder } = req.body;
        const result = await uploadRestaurantAttachment(req.file, folder);
        return sendResponse(res, 200, 'Image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const registerRestaurantController = async (req, res, next) => {
    try {
        const validated = validateRestaurantRegisterDto(req.body);
        const restaurant = await registerRestaurant(validated, req.files);
        return sendResponse(res, 201, 'Restaurant registered successfully', restaurant);
    } catch (error) {
        next(error);
    }
};

export const createOnboardingFeeOrderController = async (req, res, next) => {
    try {
        const ownerPhone = String(req.body?.ownerPhone || '').trim();
        const data = await createRestaurantOnboardingFeeOrder({ ownerPhone });
        return sendResponse(res, 200, 'Onboarding fee order created', data);
    } catch (error) {
        next(error);
    }
};

export const listApprovedRestaurantsController = async (req, res, next) => {
    try {
        const data = await listApprovedRestaurants(req.query);
        return sendResponse(res, 200, 'Restaurants fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getApprovedRestaurantController = async (req, res, next) => {
    try {
        const restaurant = await getApprovedRestaurantByIdOrSlug(req.params.id);
        if (!restaurant) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        return sendResponse(res, 200, 'Restaurant fetched successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const getCurrentRestaurantController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await getCurrentRestaurantProfile(restaurantId);
        return sendResponse(res, 200, 'Restaurant fetched successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateRestaurantProfileController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateRestaurantProfile(restaurantId, req.body || {});
        return sendResponse(res, 200, 'Restaurant updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateRestaurantAcceptingOrdersController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateRestaurantAcceptingOrders(restaurantId, req.body?.isAcceptingOrders);
        return sendResponse(res, 200, 'Restaurant availability updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateCurrentRestaurantDiningSettingsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateCurrentRestaurantDiningSettings(restaurantId, req.body || {});
        return sendResponse(res, 200, 'Dining settings updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantProfileImageController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantProfileImage(restaurantId, req.file);
        return sendResponse(res, 200, 'Profile image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantMenuImageController = async (req, res, next) => {
    try {
        const result = await uploadRestaurantMenuImage(req.file);
        return sendResponse(res, 200, 'Menu image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantCoverImagesController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantCoverImages(restaurantId, req.files || []);
        return sendResponse(res, 200, 'Restaurant photos uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantMenuImagesController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantMenuImages(restaurantId, req.files || []);
        return sendResponse(res, 200, 'Menu photos uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const listPublicOffersController = async (req, res, next) => {
    try {
        const data = await listPublicOffers({ ...req.query, userId: req.user?.userId });
        return sendResponse(res, 200, 'Offers fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getRestaurantComplaintsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const data = await getRestaurantComplaints(restaurantId, req.query || {});
        return sendResponse(res, 200, 'Complaints fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const deleteCurrentRestaurantAccountController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await deleteCurrentRestaurantAccount(restaurantId);
        return sendResponse(res, 200, 'Restaurant account deleted successfully', result);
    } catch (error) {
        next(error);
    }
};

export const getRestaurantSubscriptionHistoryController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const data = await getRestaurantSubscriptionHistory(restaurantId, req.query || {});
        return sendResponse(res, 200, 'Subscription history fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const registerUnregisteredRestaurantController = async (req, res, next) => {
    try {
        const { ownerName, restaurantName, mobileNumber, emailId, location } = req.body;
        if (!ownerName || !restaurantName || !mobileNumber || !emailId || !location) {
            return sendError(res, 400, 'All fields are required');
        }
        const newUnregistered = await FoodUnregisteredRestaurant.create({
            ownerName,
            restaurantName,
            mobileNumber,
            emailId,
            location
        });
        return sendResponse(res, 201, 'Restaurant details submitted successfully', newUnregistered);
    } catch (error) {
        next(error);
    }
};
