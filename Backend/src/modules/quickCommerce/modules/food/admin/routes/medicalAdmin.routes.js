import express from 'express';
import { requireAnyAdminPermission } from '../../../../core/roles/adminPermission.middleware.js';
import {
    getMedicalSettingsController,
    listMedicalRequestsController,
    updateMedicalSettingsController,
} from '../controllers/medicalAdmin.controller.js';
import * as partner from '../../partner/partner.service.js';
import * as commission from '../services/medicalCommission.service.js';
import { sendResponse, sendError } from '../../../../../../utils/response.js';

/**
 * The platform's medical rules and the broadcast log, for the Medical panel.
 *
 * The range is the one setting on this router that changes what customers see:
 * it decides both which pharmacies a customer is shown and which ones a
 * prescription is sent to. Writing it therefore asks for an edit permission,
 * while the request log -- a record of who was offered what -- asks only to view.
 *
 * Mounted rather than declared in admin.routes.js so the admin guard, the
 * adminAccess hydration and the section resolver in that file all still run.
 */
const router = express.Router();

const canViewSettings = requireAnyAdminPermission([
    { section: 'restaurant_management', action: 'view' },
    { section: 'order_management', action: 'view' },
    { section: 'report_management', action: 'view' },
]);

const canEditSettings = requireAnyAdminPermission([
    { section: 'restaurant_management', action: 'edit' },
]);

router.get('/settings', canViewSettings, getMedicalSettingsController);
router.put('/settings', canEditSettings, updateMedicalSettingsController);
router.get('/requests', canViewSettings, listMedicalRequestsController);

/*
 * Pharmacy verification: applications with their documents and checklist, and
 * approve / reject. Approving runs the same requirements list the partner saw
 * while applying; rejecting needs a reason, because the pharmacy is shown it.
 */
const wrap = (fn) => async (req, res) => {
    try {
        return sendResponse(res, 200, 'OK', await fn(req));
    } catch (err) {
        const code = Number(err?.statusCode) || 500;
        return sendError(res, code, code < 500 ? err.message : 'Something went wrong');
    }
};
router.get('/verification', canViewSettings, wrap((req) => partner.listApplicationsForAdmin({
    status: req.query.status,
    type: 'medical',
}).then((applications) => ({ applications }))));
router.post('/verification/:id/approve', canEditSettings, wrap((req) => partner.approveApplication(req.params.id)));
router.post('/verification/:id/reject', canEditSettings, wrap((req) => partner.rejectApplication(req.params.id, req.body?.reason)));

/*
 * Commission: one default for every pharmacy, and a shop's own rate where
 * set. Pricing reads both (orders/services/foodTransaction.service.js).
 */
const canEditMoney = requireAnyAdminPermission([
    { section: 'restaurant_management', action: 'edit' },
    { section: 'finance_management', action: 'edit' },
]);
const adminIdOf = (req) => req.user?.userId || req.user?.id || '';
router.get('/commission', canViewSettings, wrap((req) => commission.listMedicalCommissions({ search: req.query.search, status: req.query.status })));
router.put('/commission/default', canEditMoney, wrap((req) => commission.setMedicalDefaultCommission(req.body, adminIdOf(req))));
router.put('/commission/shops/:id', canEditMoney, wrap((req) => commission.setShopCommission(req.params.id, req.body)));
router.delete('/commission/shops/:id', canEditMoney, wrap((req) => commission.clearShopCommission(req.params.id)));

export default router;
