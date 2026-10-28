import { verifyAccessToken } from './token.util.js';
import { sendError } from '../../utils/response.js';
import { FoodUser } from '../users/user.model.js';
import mongoose from 'mongoose';

export const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
        return sendError(res, 403, 'Admin access required');
    }
    next();
};

/*
 * Riders and stores are re-checked on every request, as customers already
 * were. Approval used to be checked only at login, so a rider or store that
 * an admin rejected kept full access -- accepting orders, collecting cash,
 * withdrawing -- until their 7-day refresh token ran out.
 *
 * A rider must be approved. A store must exist and not be rejected (a store
 * sent back to review after a bank change keeps its panel, but not new orders).
 * The id is looked up in food first, then quick commerce, and the answer is
 * attached as req.user.vertical so food-only routes can refuse the other one
 * (see requireFoodDeliveryPartner). Cached for 15s per id: these run on every
 * location ping.
 */
const ACCOUNT_TTL_MS = 15_000;
const accountCache = new Map();

export const invalidateAccountCache = (role, id) => accountCache.delete(`${role}:${id}`);

async function lookupAccount(role, id) {
    const key = `${role}:${id}`;
    const hit = accountCache.get(key);
    if (hit && Date.now() - hit.at < ACCOUNT_TTL_MS) return hit.value;

    let value = null;
    if (role === 'DELIVERY_PARTNER') {
        const { FoodDeliveryPartner } = await import('../../modules/food/delivery/models/deliveryPartner.model.js');
        const food = await FoodDeliveryPartner.findById(id).select('status').lean();
        if (food) value = { vertical: 'food', status: food.status };
        else {
            const { FoodDeliveryPartner: QCPartner } = await import('../../modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js');
            const qc = await QCPartner.findById(id).select('status').lean();
            if (qc) value = { vertical: 'quickCommerce', status: qc.status };
        }
    } else if (role === 'RESTAURANT') {
        const { FoodRestaurant } = await import('../../modules/food/restaurant/models/restaurant.model.js');
        const food = await FoodRestaurant.findById(id).select('status').lean();
        if (food) value = { vertical: 'food', status: food.status };
        else {
            const { FoodRestaurant: QCStore } = await import('../../modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');
            const qc = await QCStore.findById(id).select('status').lean();
            if (qc) value = { vertical: 'quickCommerce', status: qc.status };
        }
    }
    accountCache.set(key, { at: Date.now(), value });
    return value;
}

/** Food rider routes: an approved FOOD rider, not a quick-commerce one. */
export const requireFoodDeliveryPartner = (req, res, next) => {
    if (req.user?.role !== 'DELIVERY_PARTNER') return sendError(res, 403, 'Forbidden: insufficient permissions');
    if (req.user.vertical && req.user.vertical !== 'food') {
        return sendError(res, 403, 'This rider account is not registered for food delivery');
    }
    next();
};

export const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
        return sendError(res, 401, 'Authentication token missing');
    }

    try {
        const decoded = verifyAccessToken(token);
        const userId = decoded.userId || decoded.sub || '';
        const role = String(decoded.role || '').toUpperCase();
        req.user = {
            userId,
            role
        };
        if (role === 'USER') {
            if (!mongoose.Types.ObjectId.isValid(userId)) {
                return sendError(res, 401, 'Invalid user token');
            }
            // Enforce active status in real-time - deactivated users are logged out on next request.
            FoodUser.findById(userId).select('isActive').lean().then((doc) => {
                if (!doc || doc.isActive === false) {
                    return sendError(res, 401, doc ? 'User account is deactivated' : 'User account not found');
                }
                next();
            }).catch(() => sendError(res, 401, 'Invalid user token'));
            return;
        }
        if (role === 'DELIVERY_PARTNER' || role === 'RESTAURANT') {
            if (!mongoose.Types.ObjectId.isValid(userId)) {
                return sendError(res, 401, 'Invalid token');
            }
            lookupAccount(role, userId).then((account) => {
                if (!account) return sendError(res, 401, 'Account not found');
                if (role === 'DELIVERY_PARTNER' && account.status === 'deactivated') {
                    return sendError(res, 403, 'Your delivery account has been deactivated. Please contact support.');
                }
                if (role === 'DELIVERY_PARTNER' && account.status !== 'approved') {
                    return sendError(res, 403, account.status === 'rejected'
                        ? 'Your delivery account has been rejected. Please contact support.'
                        : 'Your delivery account is not approved yet.');
                }
                if (role === 'RESTAURANT' && account.status === 'rejected') {
                    return sendError(res, 403, 'This account has been rejected. Please contact support.');
                }
                req.user.vertical = account.vertical;
                req.user.accountStatus = account.status;
                next();
            }).catch(() => sendError(res, 401, 'Invalid token'));
            return;
        }
        return next();
    } catch (error) {
        return sendError(res, 401, 'Invalid or expired token');
    }
};
