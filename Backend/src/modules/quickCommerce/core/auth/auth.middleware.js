import mongoose from 'mongoose';
import { verifyAccessToken } from './token.util.js';
import { sendError } from '../../utils/response.js';
import { FoodUser } from '../users/user.model.js';
// The shared `users` collection -- the customer's one identity across the
// whole platform. Same exported name as the satellite above, so it is
// aliased to keep the two impossible to confuse.
import { FoodUser as PlatformUser } from '../../../../core/users/user.model.js';
import { FoodRestaurant } from '../../modules/food/restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';

export const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
        return sendError(res, 403, 'Admin access required');
    }
    next();
};

/**
 * Accounts whose sessions are single-device.
 *
 * Admins are intentionally absent: the panel is routinely used across several
 * browser tabs and machines, so evicting the others on each sign-in would be a
 * regression rather than a safeguard.
 */
const SESSION_SCOPED_MODELS = {
    USER: FoodUser,
    RESTAURANT: FoodRestaurant,
    DELIVERY_PARTNER: FoodDeliveryPartner
};

/**
 * The satellite account this token belongs to, or null.
 *
 * Only USER is translated. A restaurant or delivery token is minted by this
 * module's own login and already carries the right id, so those keep the
 * single findById they have always had.
 *
 * Never throws: any failure returns null and the caller answers 401, which is
 * what an unresolvable token deserves and what it did before.
 */
const resolveSessionAccount = async (model, decoded) => {
    const select = 'isActive tokenVersion';
    // The id under whichever name the issuer used (taxi signs `sub`). With no
    // id at all, `findOne({ platformUserId: undefined })` became `findOne({})`
    // -- mongoose drops undefined keys -- and returned the FIRST customer, so a
    // taxi token signed in as someone else entirely.
    const id = decoded?.userId || decoded?.sub;
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;

    // 1. A token minted by this module: the id IS the satellite id.
    const direct = await model.findById(id).select(select).lean();
    if (direct) return direct;

    if (decoded.role !== 'USER') return null;

    // 2. A shared-login token whose satellite is already linked.
    const linked = await model
        .findOne({ platformUserId: id })
        .select(select)
        .lean();
    if (linked) return linked;

    // 3. No satellite yet. The customer is signed in and real -- they are in
    //    the shared users collection -- so one is made for them rather than
    //    refusing the order.
    const platform = await PlatformUser.findById(id)
        .select('phone name email isActive')
        .lean();
    if (!platform || platform.isActive === false) return null;

    // Phones are stored inconsistently across verticals (+91 prefixed, spaced,
    // bare), so they are matched on the last ten digits -- the same rule
    // core/identity/identityLink.service.js uses.
    const suffix = String(platform.phone || '').replace(/\D/g, '').slice(-10);
    if (suffix.length !== 10) return null;
    const byPhone = new RegExp(suffix + '$');

    // Adopt an existing unlinked row before creating one: production already
    // has qc_users rows with no platformUserId, and a second row for the same
    // phone would split that customer's orders across two accounts.
    const orphan = await model
        .findOne({ phone: byPhone, platformUserId: null })
        .select(select)
        .lean();
    if (orphan) {
        await model.updateOne(
            { _id: orphan._id },
            { $set: { platformUserId: id } }
        );
        return orphan;
    }

    try {
        const created = await model.create({
            phone: suffix,
            platformUserId: id,
            ...(platform.name ? { name: platform.name } : {}),
            ...(platform.email ? { email: platform.email } : {})
        });
        return {
            _id: created._id,
            isActive: true,
            tokenVersion: created.tokenVersion
        };
    } catch (err) {
        // Two requests from the same customer racing on a first order: the
        // unique phone index makes one lose. The winner's row is the account.
        if (err && err.code === 11000) {
            return model.findOne({ phone: byPhone }).select(select).lean();
        }
        return null;
    }
};

export const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
        return sendError(res, 401, 'Authentication token missing');
    }

    let decoded;
    try {
        decoded = verifyAccessToken(token);
    } catch (error) {
        return sendError(res, 401, 'Invalid or expired token');
    }

    req.user = {
        userId: decoded.userId,
        // Uppercased to match master's middleware: every role gate downstream compares
        // against 'ADMIN'/'SUPER_ADMIN' literals, and tokens mint lowercase roles.
        role: String(decoded.role || '').toUpperCase(),
        adminType: decoded.adminType
    };

    /*
     * Looked up by the UPPERCASED role, and the account must resolve.
     *
     * Keyed on the raw role, a token whose role differed only in case -- a taxi
     * customer token { role: 'user', sub } -- found no model and went straight through
     * as role USER with no userId. Every module signs with the same secret, so any
     * self-registered taxi customer got in, and getOrderById's `if (userId && ...)`
     * ownership check was skipped: any quick-commerce order, with the customer's and
     * rider's names, phones and address. Now such a token must resolve to a real
     * account like any other (a genuine account whose role is stored lowercase still
     * does), and a non-admin token with no user id is refused.
     */
    const normalizedDecoded = { ...decoded, role: req.user.role };
    const model = SESSION_SCOPED_MODELS[req.user.role];
    if (!model) {
        const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
        if (!req.user.userId && !isAdmin) {
            return sendError(res, 401, 'Invalid token for this service');
        }
        return next();
    }

    // One indexed lookup of two small fields. USER already paid for this to check
    // isActive; the version travels in the same query rather than a second round
    // trip, and the other two roles now share the same path.
    resolveSessionAccount(model, normalizedDecoded)
        .then((doc) => {
            if (!doc) return sendError(res, 401, 'Account not found');

            // The rest of this module addresses the customer by its OWN id --
            // orders, addresses and the cart are all keyed on qc_users._id.
            // The token carries the platform id, so it is translated here,
            // once, rather than in every controller that reads req.user.
            req.user.userId = String(doc._id);
            req.user.platformUserId = String(decoded.userId);
            if (normalizedDecoded.role === 'USER' && doc.isActive === false) {
                return sendError(res, 401, 'User account is deactivated');
            }

            // A token minted before the latest login belongs to a device that has
            // since been replaced.
            //
            // Tokens issued BEFORE this feature shipped carry no version at all.
            // Treating those as 0 would sign every existing user out the moment a
            // single new login bumped anyone; instead they are accepted until the
            // account next logs in, which is when the eviction genuinely applies.
            const stored = Number(doc.tokenVersion) || 0;
            const presented = decoded.tokenVersion;
            if (presented !== undefined && Number(presented) !== stored) {
                return sendError(
                    res,
                    401,
                    'You have been signed out because this account was used on another device'
                );
            }

            return next();
        })
        .catch(() => sendError(res, 401, 'Authentication failed'));
};
export const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
        return next();
    }

    try {
        const decoded = verifyAccessToken(token);
        req.user = {
            userId: decoded.userId,
            role: decoded.role,
            adminType: decoded.adminType
        };
        next();
    } catch (error) {
        // Silently ignore invalid tokens in optional auth
        next();
    }
};
