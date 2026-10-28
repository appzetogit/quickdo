import express from 'express';
import { requireAnyAdminPermission } from '../../../../core/roles/adminPermission.middleware.js';
import {
    getDrugLicenceSummaryController,
    listDrugLicencesController,
} from '../controllers/drugLicenceAdmin.controller.js';

/**
 * The drug-licence register, for mounting under the admin router.
 *
 * Read-only. Licences are edited through the seller update, which merges them
 * with the store type so a pharmacy can never end up with one and not the other;
 * a second write path here would be a way around that rule.
 *
 * Mounted rather than declared inline in admin.routes.js so the admin guard, the
 * adminAccess hydration and the section resolver in that file all still run --
 * this router is reached through them, not around them.
 */
const router = express.Router();

const canViewSellers = requireAnyAdminPermission([
    { section: 'restaurant_management', action: 'view' },
    { section: 'report_management', action: 'view' },
]);

// '/summary' before any parameterised route, for the same reason the queue puts
// '/counts' first: otherwise it is looked up as a pharmacy id.
router.get('/summary', canViewSellers, getDrugLicenceSummaryController);
router.get('/', canViewSellers, listDrugLicencesController);

export default router;
