import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { requireFinancePermission } from '../admin/requireFinancePermission.middleware.js';
import { refuseRestrictedAdminWrites } from '../admin/enforceAdminAccess.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import {
    summaryFor,
    quoteRedemption,
    loyaltySettings,
    saveLoyaltySettings,
    listLedgerAdmin,
} from './loyalty.service.js';

/**
 * Loyalty points (plan §5.7).
 *
 * Customer routes are built per vertical, because each vertical signs its
 * customers in with its own middleware: mounted at /v1/qc/loyalty (behind
 * Quick's auth) and /v1/platform/loyalty (platform customers, Food/Taxi).
 *
 *   GET /me                              balance, rules, history
 *   GET /quote?points=&orderValue=       what a basket may redeem (capped)
 *
 * Admin (/v1/platform/loyalty/admin):
 *   GET /settings?vertical=              the rules in force
 *   PUT /settings  { vertical?, enabled, pointsPerRupee, rupeesPerPoint, maxRedeemPercent, expiryDays }
 *   GET /ledger?userId=&page=&limit=
 */

const fail = (res, err, fallback) => {
    const status = Number(err?.statusCode) || 500;
    return sendError(res, status, status < 500 ? err.message : fallback);
};
const customerOf = (req) => String(req.user?.userId || req.user?.id || '');

export function buildLoyaltyCustomerRouter(vertical) {
    const router = express.Router();
    router.get('/me', async (req, res) => {
        try {
            return sendResponse(res, 200, 'Loyalty points', await summaryFor(customerOf(req), vertical));
        } catch (err) {
            return fail(res, err, 'Could not load your points');
        }
    });
    router.get('/quote', async (req, res) => {
        try {
            const data = await quoteRedemption({
                customerId: customerOf(req),
                vertical,
                points: req.query.points,
                orderValue: req.query.orderValue,
            });
            return sendResponse(res, 200, 'Loyalty quote', data);
        } catch (err) {
            return fail(res, err, 'Could not price your points');
        }
    });
    return router;
}

const router = express.Router();
const admin = express.Router();
admin.use(authMiddleware, requireRoles('ADMIN'), refuseRestrictedAdminWrites);

admin.get('/settings', async (req, res) => {
    try {
        const vertical = req.query.vertical ? String(req.query.vertical) : null;
        return sendResponse(res, 200, 'Loyalty rules', { vertical, ...(await loyaltySettings(vertical)) });
    } catch (err) {
        return fail(res, err, 'Could not load the loyalty rules');
    }
});
admin.put('/settings', requireFinancePermission('PLATFORM_SETTING_SET'), async (req, res) => {
    try {
        const vertical = req.body?.vertical ? String(req.body.vertical) : null;
        if (vertical && !['quickCommerce', 'food', 'taxi', 'serviceProvider'].includes(vertical)) {
            return sendError(res, 400, 'Unknown vertical');
        }
        const data = await saveLoyaltySettings(req.body || {}, {
            vertical,
            updatedBy: String(req.user?.userId || ''),
        });
        return sendResponse(res, 200, 'Loyalty rules saved', { vertical, ...data });
    } catch (err) {
        return fail(res, err, 'Could not save the loyalty rules');
    }
});
admin.get('/ledger', async (req, res) => {
    try {
        return sendResponse(res, 200, 'Loyalty ledger', await listLedgerAdmin(req.query));
    } catch (err) {
        return fail(res, err, 'Could not load the ledger');
    }
});

router.use('/admin', admin);
// Platform customers (Food, Taxi): the platform's own customer auth.
router.use(authMiddleware, requireRoles('USER'), buildLoyaltyCustomerRouter('food'));

export default router;
