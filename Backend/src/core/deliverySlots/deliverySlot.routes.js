import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { refuseRestrictedAdminWrites } from '../admin/enforceAdminAccess.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import {
    listAvailableSlots,
    listSlotsAdmin,
    createSlotAdmin,
    updateSlotAdmin,
    deleteSlotAdmin,
} from './deliverySlot.service.js';

/**
 * Delivery slots (plan §5.3). Mounted at /v1/platform/delivery-slots.
 *
 *   GET    /available?vertical=quickCommerce&zoneId=&days=3   the app (public)
 *   GET    /admin?vertical=&zoneId=                           the panel
 *   POST   /admin                                             create
 *   PATCH  /admin/:id                                         edit
 *   DELETE /admin/:id                                         remove (booked orders keep their slot)
 */
const router = express.Router();

const fail = (res, err, fallback) => {
    const status = Number(err?.statusCode) || 500;
    return sendError(res, status, status < 500 ? err.message : fallback);
};

router.get('/available', async (req, res) => {
    try {
        const data = await listAvailableSlots({
            vertical: String(req.query.vertical || 'quickCommerce'),
            zoneId: req.query.zoneId,
            days: req.query.days,
        });
        res.set('Cache-Control', 'no-store');
        return sendResponse(res, 200, 'Delivery slots', data);
    } catch (err) {
        return fail(res, err, 'Could not load delivery slots');
    }
});

const admin = express.Router();
admin.use(authMiddleware, requireRoles('ADMIN'), refuseRestrictedAdminWrites);

admin.get('/', async (req, res) => {
    try {
        return sendResponse(res, 200, 'Delivery slots', await listSlotsAdmin(req.query));
    } catch (err) {
        return fail(res, err, 'Could not load delivery slots');
    }
});
admin.post('/', async (req, res) => {
    try {
        return sendResponse(res, 201, 'Slot created', await createSlotAdmin(req.body || {}));
    } catch (err) {
        return fail(res, err, 'Could not create the slot');
    }
});
admin.patch('/:id', async (req, res) => {
    try {
        return sendResponse(res, 200, 'Slot saved', await updateSlotAdmin(req.params.id, req.body || {}));
    } catch (err) {
        return fail(res, err, 'Could not save the slot');
    }
});
admin.delete('/:id', async (req, res) => {
    try {
        return sendResponse(res, 200, 'Slot removed', await deleteSlotAdmin(req.params.id));
    } catch (err) {
        return fail(res, err, 'Could not remove the slot');
    }
});

router.use('/admin', admin);

export default router;
