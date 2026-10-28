import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { requireFinancePermission } from '../admin/requireFinancePermission.middleware.js';
import { refuseRestrictedAdminWrites } from '../admin/enforceAdminAccess.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import {
    resolveAppServicesAt,
    getAdminView,
    setServiceEnabled,
    setZoneEnabled,
} from './appServices.service.js';

/**
 * Which services the customer app shows. Mounted at /v1/platform/app-services.
 *
 *   GET  /?lat=&lng=                         the app: what to show here (public)
 *   GET  /admin                              the panel: every switch
 *   PUT  /admin/:service                     { enabled } -- everywhere
 *   PUT  /admin/:service/zones/:zoneId       { enabled } -- one zone
 *
 * At the platform root rather than under a vertical's /admin, like the other
 * master settings: it covers all of them.
 */
const router = express.Router();

const actorOf = (req) => String(req.user?.userId || req.user?.id || '');

const fail = (res, err, fallback) => {
    const status = Number(err?.statusCode) || 500;
    return sendError(res, status, status < 500 ? err.message : fallback);
};

// Public: the app asks before anyone signs in, and the answer is not secret.
router.get('/', async (req, res) => {
    try {
        const data = await resolveAppServicesAt({ lat: req.query.lat, lng: req.query.lng });
        // Short browser cache: a switch flipped in the panel should reach the app
        // within a minute, not an hour.
        res.set('Cache-Control', 'public, max-age=30');
        return sendResponse(res, 200, 'App services', data);
    } catch (err) {
        return fail(res, err, 'Could not load app services');
    }
});

const admin = express.Router();
admin.use(authMiddleware, requireRoles('ADMIN'), refuseRestrictedAdminWrites);

admin.get('/', async (_req, res) => {
    try {
        return sendResponse(res, 200, 'App services', await getAdminView());
    } catch (err) {
        return fail(res, err, 'Could not load app services');
    }
});

// Writes are a platform setting: the same permission, and the same audit row.
admin.put('/:service', requireFinancePermission('PLATFORM_SETTING_SET'), async (req, res) => {
    try {
        const data = await setServiceEnabled(req.params.service, req.body?.enabled, { actorId: actorOf(req) });
        return sendResponse(res, 200, 'Saved', data);
    } catch (err) {
        return fail(res, err, 'Could not save');
    }
});

admin.put('/:service/zones/:zoneId', requireFinancePermission('PLATFORM_SETTING_SET'), async (req, res) => {
    try {
        const data = await setZoneEnabled(req.params.service, req.params.zoneId, req.body?.enabled, {
            actorId: actorOf(req),
        });
        return sendResponse(res, 200, 'Saved', data);
    } catch (err) {
        return fail(res, err, 'Could not save');
    }
});

router.use('/admin', admin);

export default router;
