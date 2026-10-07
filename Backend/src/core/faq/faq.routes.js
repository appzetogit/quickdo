import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { refuseRestrictedAdminWrites } from '../admin/enforceAdminAccess.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import {
    listPublicFaqs,
    listFaqsAdmin,
    createFaqAdmin,
    updateFaqAdmin,
    deleteFaqAdmin,
    reorderFaqsAdmin,
} from './faq.service.js';

/**
 * FAQs (plan §5.8). Mounted at /v1/platform/faqs.
 *
 *   GET    /?vertical=quickCommerce&category=&includeGeneral=true   public
 *   GET    /admin?vertical=&category=&q=
 *   POST   /admin                         { vertical, category, question, answer, sortOrder?, isActive? }
 *   PATCH  /admin/:id
 *   DELETE /admin/:id
 *   PUT    /admin/reorder                 { items: [{ id, sortOrder }] }
 */
const router = express.Router();

const fail = (res, err, fallback) => {
    const status = Number(err?.statusCode) || 500;
    return sendError(res, status, status < 500 ? err.message : fallback);
};

router.get('/', async (req, res) => {
    try {
        const data = await listPublicFaqs({
            vertical: req.query.vertical,
            category: req.query.category,
            includeGeneral: String(req.query.includeGeneral ?? 'true') !== 'false',
        });
        res.set('Cache-Control', 'public, max-age=60');
        return sendResponse(res, 200, 'FAQs', data);
    } catch (err) {
        return fail(res, err, 'Could not load FAQs');
    }
});

const admin = express.Router();
admin.use(authMiddleware, requireRoles('ADMIN'), refuseRestrictedAdminWrites);
const adminId = (req) => req.user?.userId || req.user?.id;

admin.get('/', async (req, res) => {
    try {
        return sendResponse(res, 200, 'FAQs', await listFaqsAdmin(req.query));
    } catch (err) {
        return fail(res, err, 'Could not load FAQs');
    }
});
admin.put('/reorder', async (req, res) => {
    try {
        return sendResponse(res, 200, 'Order saved', await reorderFaqsAdmin(req.body?.items));
    } catch (err) {
        return fail(res, err, 'Could not save the order');
    }
});
admin.post('/', async (req, res) => {
    try {
        return sendResponse(res, 201, 'FAQ created', await createFaqAdmin(req.body || {}, adminId(req)));
    } catch (err) {
        return fail(res, err, 'Could not create the FAQ');
    }
});
admin.patch('/:id', async (req, res) => {
    try {
        return sendResponse(res, 200, 'FAQ saved', await updateFaqAdmin(req.params.id, req.body || {}, adminId(req)));
    } catch (err) {
        return fail(res, err, 'Could not save the FAQ');
    }
});
admin.delete('/:id', async (req, res) => {
    try {
        return sendResponse(res, 200, 'FAQ deleted', await deleteFaqAdmin(req.params.id));
    } catch (err) {
        return fail(res, err, 'Could not delete the FAQ');
    }
});

router.use('/admin', admin);

export default router;
