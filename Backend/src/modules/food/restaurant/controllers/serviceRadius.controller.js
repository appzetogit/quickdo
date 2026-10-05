/**
 * Delivery radius endpoints, for both sides.
 *
 * Kept in one file so the restaurant's and the admin's handlers are visibly the
 * same call with a different actor and a different way of knowing which
 * restaurant is meant. Neither does anything the other does not.
 */
import { sendResponse, sendError } from '../../../../utils/response.js';
import * as serviceRadius from '../services/serviceRadius.service.js';

/** The radius value from a request body. `null` clears; absent is an error. */
function radiusFrom(body) {
    const source = body && typeof body === 'object' ? body : {};
    return Object.prototype.hasOwnProperty.call(source, 'serviceRadiusKm')
        ? { present: true, value: source.serviceRadiusKm }
        : { present: false, value: undefined };
}

// ----- restaurant (its own outlet, from the token) -----

export const getOwnServiceRadiusController = async (req, res, next) => {
    try {
        const data = await serviceRadius.getRestaurantServiceRadius(req.user?.userId);
        return sendResponse(res, 200, 'Delivery radius fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const updateOwnServiceRadiusController = async (req, res, next) => {
    try {
        const { present, value } = radiusFrom(req.body);
        if (!present) {
            return sendError(res, 400, 'Send serviceRadiusKm: a number of km, or null to remove the radius.');
        }
        const data = await serviceRadius.setRestaurantServiceRadius(req.user?.userId, value, { actor: 'restaurant' });
        return sendResponse(res, 200, 'Delivery radius saved successfully', data);
    } catch (error) {
        next(error);
    }
};

// ----- admin (any restaurant, from the path) -----

export const getRestaurantServiceRadiusAdminController = async (req, res, next) => {
    try {
        const data = await serviceRadius.getRestaurantServiceRadius(req.params.id);
        return res.status(200).json({ success: true, message: 'Delivery radius fetched successfully', data });
    } catch (error) {
        next(error);
    }
};

export const updateRestaurantServiceRadiusAdminController = async (req, res, next) => {
    try {
        const { present, value } = radiusFrom(req.body);
        if (!present) {
            return res.status(400).json({
                success: false,
                message: 'Send serviceRadiusKm: a number of km, or null to remove the radius.',
            });
        }
        const data = await serviceRadius.setRestaurantServiceRadius(req.params.id, value, { actor: 'admin' });
        return res.status(200).json({ success: true, message: 'Delivery radius saved successfully', data });
    } catch (error) {
        next(error);
    }
};

export const getServiceRadiusSettingsAdminController = async (req, res, next) => {
    try {
        const data = await serviceRadius.getServiceRadiusOverview();
        return res.status(200).json({ success: true, message: 'Delivery radius settings fetched successfully', data });
    } catch (error) {
        next(error);
    }
};

export const updateServiceRadiusSettingsAdminController = async (req, res, next) => {
    try {
        const data = await serviceRadius.updateServiceRadiusSettings(req.body || {});
        return res.status(200).json({ success: true, message: 'Delivery radius settings saved successfully', data });
    } catch (error) {
        next(error);
    }
};
