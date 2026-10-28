import express from 'express';
import { requireAnyAdminPermission } from '../../../../core/roles/adminPermission.middleware.js';
import {
    listPrescriptionOrdersController,
    getPrescriptionOrderCountsController,
    getPrescriptionOrderController,
    removePrescriptionOrderController,
} from '../controllers/prescriptionAdmin.controller.js';

/**
 * The prescription queue, for mounting under the admin router.
 *
 * The pharmacist reviews, the admin observes: there is no approve or reject
 * here. The one write is removing a finished order from the queue (kept in
 * the database), which asks for `edit` on orders.
 *
 * Mounted rather than declared in admin.routes.js so the admin guard, the
 * adminAccess hydration and the section resolver in that file all still run --
 * this router is reached through them, not around them.
 */
const router = express.Router();

const canViewOrders = requireAnyAdminPermission([
    { section: 'order_management', action: 'view' },
    { section: 'report_management', action: 'view' },
]);

// '/counts' before '/:orderId', or the tab counts are looked up as an order id.
router.get('/', canViewOrders, listPrescriptionOrdersController);
router.get('/counts', canViewOrders, getPrescriptionOrderCountsController);
router.get('/:orderId', canViewOrders, getPrescriptionOrderController);
router.delete(
    '/:orderId',
    requireAnyAdminPermission([{ section: 'order_management', action: 'edit' }]),
    removePrescriptionOrderController,
);

export default router;
