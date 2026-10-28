import { sendResponse } from '../../../../utils/response.js';
import {
    createOrderEmergencyRequest,
    getOrderEmergencyRequestByPartner,
    listOrderEmergencyRequestsByPartner
} from '../services/orderEmergencyRequest.service.js';

/**
 * A rider who cannot finish a job they already accepted — bike broken down, an
 * accident, a medical emergency — asks for the order to be taken off them and
 * given to someone else. An admin acts on the request; a rider only ever sees
 * their own.
 *
 * Kept out of delivery.controller.js: that file is already a thousand lines of
 * profile, wallet and earnings handlers, and this is a separate concern with its
 * own service.
 */

export const listOrderEmergencyRequestsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const requests = await listOrderEmergencyRequestsByPartner(deliveryPartnerId);
        return sendResponse(res, 200, 'Order reassignment requests fetched', { requests });
    } catch (error) {
        next(error);
    }
};

export const createOrderEmergencyRequestController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const request = await createOrderEmergencyRequest(deliveryPartnerId, req.body || {});
        return sendResponse(res, 201, 'Emergency reassignment request created', { request });
    } catch (error) {
        next(error);
    }
};

export const getOrderEmergencyRequestController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const request = await getOrderEmergencyRequestByPartner(
            req.params.id,
            deliveryPartnerId
        );
        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Emergency reassignment request not found'
            });
        }
        return sendResponse(res, 200, 'Emergency reassignment request fetched', { request });
    } catch (error) {
        next(error);
    }
};
