import express from 'express';
import { requireFinancePermission } from '../admin/requireFinancePermission.middleware.js';
import {
    getCatalogueController,
    explainSettingController,
    resolveAllController,
    setSettingController,
    invalidateCacheController,
} from './config.controller.js';
import {
    getProfileController,
    updateProfileController,
    testRazorpayController,
    testEmailController,
    testSmsController,
} from '../settings/platformProfile.controller.js';
import { listAppLegal, saveAppLegal } from '../settings/appLegal.js';
import { getEarningsController } from '../finance/earnings.controller.js';
import { listGlobalUsersController, exportGlobalUsersController, setCustomerBlockedController } from '../users/globalUsers.controller.js';
import { referralOverview } from '../referral/referralSettings.service.js';
import { platformFeesOverview } from '../finance/platformFees.service.js';

/**
 * Master / Global settings.
 *
 * Mounted under /v1/platform/settings rather than under a vertical, because that
 * is the whole point: these are the rules that apply everywhere, and putting them
 * beneath /food/admin would reproduce the problem they exist to solve.
 *
 * READS are open to any authenticated admin. WRITES need `settings.write`.
 * Deliberately asymmetric -- an operator who cannot change the cash limit should
 * still be able to see what it is and which level set it, or the first question
 * every support conversation starts with has no answer.
 */
const router = express.Router();

// Master settings: brand, contact, legal pages, integrations
// (core/settings/platformProfile.service.js). Declared before '/:key'.
router.get('/profile', getProfileController);
router.patch('/profile', requireFinancePermission('PLATFORM_SETTING_SET'), updateProfileController);
router.post('/profile/test/razorpay', requireFinancePermission('PLATFORM_SETTING_SET'), testRazorpayController);
router.post('/profile/test/email', requireFinancePermission('PLATFORM_SETTING_SET'), testEmailController);
router.post('/profile/test/sms', requireFinancePermission('PLATFORM_SETTING_SET'), testSmsController);

// Terms and privacy per app (core/settings/appLegal.js).
router.get('/app-legal', listAppLegal);
router.put('/app-legal/:app/:kind', requireFinancePermission('PLATFORM_SETTING_SET'), saveAppLegal);

// What a module pays its riders today, and its own bands to start an edit from
// (core/finance/earnings.controller.js). Declared before '/:key'.
router.get('/earnings/:vertical', getEarningsController);

/*
 * Master > Customers: every customer on the platform, in one list.
 *
 * Reads are open to any authenticated admin, like the rest of this router. The
 * EXPORT is not: a file of every customer's name, phone and spend is a
 * different thing from a paginated screen, so it needs the same permission as
 * changing a platform setting.
 */
router.get('/users', listGlobalUsersController);
// Master > Orders: every order (Food, Quick, Medical, Taxi, Parcel) in one list.
router.get('/orders', async (req, res, next) => {
    try {
        const { listMasterOrders } = await import('../orders/masterOrders.service.js');
        res.json({ success: true, data: await listMasterOrders(req.query || {}) });
    } catch (err) {
        next(err);
    }
});
router.get('/users/export', requireFinancePermission('PLATFORM_SETTING_SET'), exportGlobalUsersController);
// Delete one order from All Orders (rules in masterOrders.service.js deleteMasterOrder). A write, so settings permission.
router.delete('/orders/:source/:id', requireFinancePermission('PLATFORM_SETTING_SET'), async (req, res, next) => {
    try {
        const { deleteMasterOrder } = await import('../orders/masterOrders.service.js');
        const adminId = String(req.user?.userId || req.user?.id || '');
        const data = await deleteMasterOrder({ source: req.params.source, id: req.params.id, adminId });
        if (!data) return res.status(404).json({ success: false, message: 'Order not found' });
        res.json({ success: true, message: 'Order deleted', data });
    } catch (err) {
        next(err);
    }
});
// Blocking a customer is a write, so it needs the settings permission like every other write here.
router.patch('/users/:id/status', requireFinancePermission('PLATFORM_SETTING_SET'), setCustomerBlockedController);

// Master > Referral: what each service pays now, and whether Master or the
// service set it. Declared before '/:key'.
router.get('/referral/overview', async (req, res, next) => {
    try {
        res.json({ success: true, data: await referralOverview() });
    } catch (err) {
        next(err);
    }
});
// Master > Platform Fee & GST: what each service charges now, and who set it.
router.get('/fees/overview', async (req, res, next) => {
    try {
        res.json({ success: true, data: await platformFeesOverview() });
    } catch (err) {
        next(err);
    }
});
// Master > Cancellation Policy: the rules each service is using now, and who set them.
router.get('/cancellation/overview', async (req, res, next) => {
    try {
        const { getCancelRules } = await import('../../modules/food/orders/services/cancellationPolicy.js');
        const { holdSecondsFor } = await import('../orders/orderHold.js');
        const [food, quickCommerce, foodHold, quickHold] = await Promise.all([
            getCancelRules('food'), getCancelRules('quickCommerce'),
            holdSecondsFor('food'), holdSecondsFor('quickCommerce'),
        ]);
        res.json({ success: true, data: { services: [
            { vertical: 'food', ...food, holdSeconds: foodHold },
            { vertical: 'quickCommerce', ...quickCommerce, holdSeconds: quickHold },
        ] } });
    } catch (err) {
        next(err);
    }
});
// Zone pickers on the Master pages: one module's zones (each module draws its own).
router.get('/zones/:module', async (req, res, next) => {
    try {
        const { listZonesFor } = await import('../appServices/appServices.service.js');
        const { zoneAdminContext } = await import('../admin/zoneAdminSettings.js');
        const module = String(req.params.module || '');
        const zones = await listZonesFor(module);
        if (!zones) return res.status(400).json({ success: false, message: 'Unknown module' });
        // A zone sub-admin sees only their zones; `limited` tells the page to
        // drop "All zones" and the module-wide options.
        const ctx = await zoneAdminContext(req);
        if (!ctx.restricted) return res.json({ success: true, data: { zones, limited: false } });
        const mine = await ctx.zoneIdsFor(module);
        const visible = mine === null ? zones : zones.filter((z) => mine.includes(z.id));
        return res.json({ success: true, data: { zones: visible, limited: true } });
    } catch (err) {
        return next(err);
    }
});
/*
 * Incentive ladders, reachable from Master by zone sub-admins too (the food
 * admin routes need the Food panel). A sub-admin sees their zones' ladders and
 * the default one (read-only), and may save, turn off or delete only their own.
 */
router.get('/incentive-rules', async (req, res, next) => {
    try {
        const { zoneAdminContext } = await import('../admin/zoneAdminSettings.js');
        const { listIncentiveRulesController } = await import('../incentives/controllers/incentiveController.js');
        const ctx = await zoneAdminContext(req);
        if (!ctx.restricted) return listIncentiveRulesController(req, res, next);
        const originalJson = res.json.bind(res);
        res.json = async (body) => {
            const keep = async (list) => {
                const out = [];
                for (const r of list || []) {
                    // eslint-disable-next-line no-await-in-loop
                    if (!r.zoneId || (await ctx.zoneAllowed(r.zoneId))) out.push(r);
                }
                return out;
            };
            if (body?.data) {
                body.data.active = await keep(body.data.active);
                body.data.recent = await keep(body.data.recent);
                body.data.limited = true;
            }
            return originalJson(body);
        };
        return listIncentiveRulesController(req, res, next);
    } catch (err) {
        return next(err);
    }
});
router.put('/incentive-rules', async (req, res, next) => {
    try {
        const { zoneAdminContext, LADDER_RESOURCE } = await import('../admin/zoneAdminSettings.js');
        const { upsertIncentiveRuleController } = await import('../incentives/controllers/incentiveController.js');
        const ctx = req.zoneAdmin || (await zoneAdminContext(req));
        if (ctx.restricted) {
            if (!ctx.can(LADDER_RESOURCE, 'write')) return res.status(403).json({ success: false, message: 'You do not have permission to change incentive ladders' });
            if (!req.body?.zoneId) return res.status(403).json({ success: false, message: 'The default ladder is head office only. Pick one of your zones.' });
            if (!(await ctx.zoneAllowed(req.body.zoneId))) return res.status(403).json({ success: false, message: 'That zone is not one of yours' });
        }
        return upsertIncentiveRuleController(req, res, next);
    } catch (err) {
        return next(err);
    }
});
router.delete('/incentive-rules/:id', async (req, res, next) => {
    try {
        const { zoneAdminContext, LADDER_RESOURCE, canDeleteLadder } = await import('../admin/zoneAdminSettings.js');
        const { deactivateIncentiveRuleController } = await import('../incentives/controllers/incentiveController.js');
        const ctx = req.zoneAdmin || (await zoneAdminContext(req));
        if (ctx.restricted) {
            const { DriverIncentiveRule } = await import('../incentives/models/driverIncentiveRule.model.js');
            const rule = await DriverIncentiveRule.findById(req.params.id).select('zoneId').lean();
            if (!rule) return res.status(404).json({ success: false, message: 'Incentive rule not found' });
            if (!ctx.can(LADDER_RESOURCE, 'write')) return res.status(403).json({ success: false, message: 'You do not have permission to change incentive ladders' });
            if (!rule.zoneId || !(await ctx.zoneAllowed(rule.zoneId))) return res.status(403).json({ success: false, message: 'That ladder is not for one of your zones' });
            if (!canDeleteLadder(ctx)) return res.status(403).json({ success: false, message: 'You do not have delete access' });
        }
        return deactivateIncentiveRuleController(req, res, next);
    } catch (err) {
        return next(err);
    }
});
router.get('/catalogue', getCatalogueController);
router.get('/resolve', resolveAllController);
router.get('/:key/explain', explainSettingController);

router.put('/:key', requireFinancePermission('PLATFORM_SETTING_SET'), setSettingController);
router.post('/cache/invalidate', requireFinancePermission('PLATFORM_SETTING_SET'), invalidateCacheController);

export default router;
