import { riderInZoneGuard } from '../../../../core/zones/riderZones.js';
// A zone-limited sub-admin reaches only riders in their zones (core/zones/riderZones.js).
const foodRiderModel = async () => (await import('../../delivery/models/deliveryPartner.model.js')).FoodDeliveryPartner;
const inZone = riderInZoneGuard('food', foodRiderModel);
const bonusInZone = riderInZoneGuard('food', foodRiderModel, { idFrom: (req) => req.body?.deliveryPartnerId });
import express from 'express';
import { AuthError } from '../../../../core/auth/errors.js';
import * as adminController from '../controllers/admin.controller.js';
import * as serviceRadiusController from '../../restaurant/controllers/serviceRadius.controller.js';
import * as foodApprovalController from '../controllers/foodApproval.controller.js';
import * as addonsApprovalController from '../controllers/addonsApproval.controller.js';
import { getMapSettingsController, updateMapSettingsController } from '../controllers/mapSettings.controller.js';
import * as businessSettingsController from '../controllers/businessSettings.controller.js';
import * as feedbackExperienceController from '../controllers/feedbackExperience.controller.js';
import * as notificationBroadcastController from '../controllers/notificationBroadcast.controller.js';
import * as diningAdminController from '../../dining/controllers/diningAdmin.controller.js';
import * as orderController from '../../orders/controllers/order.controller.js';
import { manualAssignControllers } from '../../../../core/delivery/manualAssign.controller.js';
import { getAdminPageController, upsertAdminPageController } from '../controllers/pageContent.controller.js';
import * as incentiveController from '../../../../core/incentives/controllers/incentiveController.js';
import { upload } from '../../../../middleware/upload.js';
import { requireFinancePermission } from '../../../../core/admin/requireFinancePermission.middleware.js';
import { enforceAdminAccess } from '../../../../core/admin/enforceAdminAccess.middleware.js';
import { resolveStoreAdminResource } from '../../../../core/admin/adminAccessPolicy.js';

const router = express.Router();

// ----- Public Business Settings (No Admin Required) -----
router.get('/business-settings/public', businessSettingsController.getBusinessSettings);

const requireAdmin = (req, _res, next) => {
    const user = req.user;
    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
        return next(new AuthError('Admin access required'));
    }
    return next();
};

router.use(requireAdmin);
// Every route below is checked against the admin's permissions (sub-admins only;
// superadmins pass). See core/admin/adminAccessPolicy.js for the path table.
router.use(enforceAdminAccess('food', resolveStoreAdminResource));

// ----- Broadcast Notifications -----
router.post('/notifications/broadcast', notificationBroadcastController.createBroadcastNotificationController);
router.get('/notifications/broadcast', notificationBroadcastController.getBroadcastNotificationsController);
router.delete('/notifications/broadcast/:id', notificationBroadcastController.deleteBroadcastNotificationController);

// ----- Customers -----
router.get('/customers', adminController.getCustomers);
router.get('/customers/:id', adminController.getCustomerById);
router.patch('/customers/:id/status', adminController.updateCustomerStatus);
router.patch('/customers/:id/cod-block', adminController.updateCustomerCodBlockStatus);

// ----- Safety / Emergency Reports -----
router.get('/safety-emergency-reports', adminController.getSafetyEmergencyReports);
router.put('/safety-emergency-reports/:id/status', adminController.updateSafetyEmergencyStatus);
router.put('/safety-emergency-reports/:id/priority', adminController.updateSafetyEmergencyPriority);
router.delete('/safety-emergency-reports/:id', adminController.deleteSafetyEmergencyReport);

// ----- Support Tickets (users) -----
router.get('/support-tickets', adminController.getSupportTicketsController);
router.patch('/support-tickets/:id', adminController.updateSupportTicketController);
router.get('/global-search', adminController.globalSearch);
router.get('/restaurants/complaints', adminController.getRestaurantComplaints);
router.patch('/restaurants/complaints/:id', adminController.updateRestaurantComplaint);

// ----- Restaurants -----
router.get('/restaurants', adminController.getRestaurants);
router.get('/dashboard-stats', adminController.getDashboardStats);
router.get('/reports/restaurants', adminController.getRestaurantReport);
router.get('/reports/transactions', adminController.getTransactionReport);
router.get('/reports/tax', adminController.getTaxReport);
router.get('/reports/tax/:id', adminController.getTaxReportDetail);
router.get('/restaurants/pending', adminController.getPendingRestaurants);
router.get('/restaurants/reviews', adminController.getRestaurantReviews);
router.get('/restaurants/:id', adminController.getRestaurantById);
router.get('/restaurants/:id/analytics', adminController.getRestaurantAnalytics);
router.get('/restaurants/:id/menu', adminController.getRestaurantMenuById);
router.get('/restaurants/:id/freebie-offer', adminController.getRestaurantFreebieOffer);
router.put('/restaurants/:id/freebie-offer', adminController.updateRestaurantFreebieOffer);
router.get('/restaurants/:id/bogo-offer', adminController.getRestaurantBogoOffer);
router.put('/restaurants/:id/bogo-offer', adminController.updateRestaurantBogoOffer);
// Delivery radius: the same field the restaurant edits from its app, through the
// same service. The ceiling is admin-only.
router.get('/service-radius/settings', serviceRadiusController.getServiceRadiusSettingsAdminController);
router.put('/service-radius/settings', serviceRadiusController.updateServiceRadiusSettingsAdminController);
router.get('/restaurants/:id/service-radius', serviceRadiusController.getRestaurantServiceRadiusAdminController);
router.put('/restaurants/:id/service-radius', serviceRadiusController.updateRestaurantServiceRadiusAdminController);
router.get('/restaurants/:id/free-delivery', adminController.getRestaurantFreeDelivery);
router.put('/restaurants/:id/free-delivery', adminController.updateRestaurantFreeDelivery);
router.get('/restaurants/:id/combos', adminController.listRestaurantCombos);
router.post('/restaurants/:id/combos', adminController.createRestaurantCombo);
router.put('/restaurants/:id/combos/:comboId', adminController.updateRestaurantCombo);
router.delete('/restaurants/:id/combos/:comboId', adminController.deleteRestaurantCombo);
router.post('/restaurants', adminController.createRestaurant);
router.patch('/restaurants/:id', adminController.updateRestaurantById);
router.patch('/restaurants/:id/status', adminController.updateRestaurantStatus);
router.patch('/restaurants/:id/location', adminController.updateRestaurantLocation);
router.patch('/restaurants/:id/menu', adminController.updateRestaurantMenuById);
router.patch('/restaurants/:id/approve', adminController.approveRestaurant);
router.patch('/restaurants/:id/reject', adminController.rejectRestaurant);

// ----- Restaurant Commission -----
router.get('/restaurant-commissions/bootstrap', adminController.getRestaurantCommissionBootstrap);
router.get('/restaurant-commissions', adminController.getRestaurantCommissions);
router.post('/restaurant-commissions', adminController.createRestaurantCommission);
router.get('/restaurant-commissions/:id', adminController.getRestaurantCommissionById);
router.patch('/restaurant-commissions/:id', adminController.updateRestaurantCommission);
router.delete('/restaurant-commissions/:id', adminController.deleteRestaurantCommission);
router.patch('/restaurant-commissions/:id/toggle', adminController.toggleRestaurantCommissionStatus);
// Dated overrides of the standing rate above -- festive weeks, promotions, a
// renegotiated month. Declared after the :id routes so "schedules" is not
// swallowed as an id.
router.get('/commission-schedules', adminController.listCommissionSchedules);
router.post('/commission-schedules', adminController.createCommissionSchedule);
router.patch('/commission-schedules/:id', adminController.updateCommissionSchedule);
router.delete('/commission-schedules/:id', adminController.deleteCommissionSchedule);

// ----- Categories -----
router.get('/categories', adminController.getCategories);
router.post('/categories', adminController.createCategory);
router.patch('/categories/:id', adminController.updateCategory);
router.delete('/categories/:id', adminController.deleteCategory);
router.patch('/categories/:id/toggle', adminController.toggleCategoryStatus);
router.patch('/categories/:id/approve', adminController.approveCategory);
router.patch('/categories/:id/reject', adminController.rejectCategory);
router.patch('/categories/:id/make-global', adminController.makeCategoryGlobal);

// ----- Restaurant Add-ons Approval -----
// Google Maps key — consumed by every frontend via /api/v1/env/public.
router.get('/map-settings', getMapSettingsController);
router.patch('/map-settings', updateMapSettingsController);

// Also served under /item-extras: ad blockers kill any XHR whose path contains
// "addons" (ERR_BLOCKED_BY_CLIENT), which left the admin list silently empty.
['/addons', '/item-extras'].forEach((base) => {
    router.get(base, addonsApprovalController.getRestaurantAddons);
    router.patch(`${base}/:id`, addonsApprovalController.updateRestaurantAddon);
    router.patch(`${base}/:id/approve`, addonsApprovalController.approveRestaurantAddon);
    router.patch(`${base}/:id/reject`, addonsApprovalController.rejectRestaurantAddon);
    router.delete(`${base}/:id`, addonsApprovalController.deleteRestaurantAddon);
});

// ----- Foods -----
router.get('/foods', adminController.getFoods);
router.post('/foods', adminController.createFood);
router.patch('/foods/:id', adminController.updateFood);
router.delete('/foods/:id', adminController.deleteFood);
// Food approval queue (pending items created by restaurants)
router.get('/foods/pending-approvals', foodApprovalController.getPendingFoodApprovals);
// What adjustment is standing over this dish's menu, and what approving it
// either way would cost -- so the choice below is made with the numbers in
// view rather than blind.
router.get('/foods/:id/standing-adjustment', foodApprovalController.getStandingAdjustmentController);
router.patch('/foods/:id/approve', foodApprovalController.approveFoodItemController);
router.patch('/foods/:id/reject', foodApprovalController.rejectFoodItemController);
router.post('/foods/bulk-approve', adminController.bulkApproveFoodItems);

// ----- Global Menu Price Adjustment -----
router.get('/price-adjustments', adminController.getPriceAdjustments);
// What each menu currently carries, as opposed to what was asked for.
router.get('/price-adjustments/standing', adminController.getStandingAdjustments);
router.get('/price-adjustments/preview', adminController.getPriceAdjustmentPreview);
router.post('/price-adjustments', adminController.applyPriceAdjustment);
router.post('/price-adjustments/:id/revert', adminController.revertPriceAdjustment);


// ----- Offers & Coupons -----
router.get('/offers', adminController.getAllOffers);
router.post('/offers', adminController.createAdminOffer);
router.patch('/offers/:id/cart-visibility', adminController.updateAdminOfferCartVisibility);
router.delete('/offers/:id', adminController.deleteAdminOffer);

// ----- Feedback Experience (Admin) -----
router.get('/feedback-experiences', feedbackExperienceController.getFeedbackExperiences);
router.delete('/feedback-experiences/:id', feedbackExperienceController.deleteFeedbackExperience);

// ----- Fee Settings -----
router.get('/fee-settings', adminController.getFeeSettings);
router.put('/fee-settings', adminController.createOrUpdateFeeSettings);

// ----- Delivery Incentives (per duty segment: foodAndQuick / taxiAndPorter) -----
router.get('/incentive-rules', incentiveController.listIncentiveRulesController);
router.put('/incentive-rules', incentiveController.upsertIncentiveRuleController);
router.delete('/incentive-rules/:id', incentiveController.deactivateIncentiveRuleController);

// ----- Monetization mode (commission vs plan, platform-wide) -----
// Its own endpoints rather than a field on the fee-settings PUT: that PUT
// replaces the whole settings body, so flipping this through it would make a
// one-field switch depend on the screen having loaded every other fee first.
router.get('/monetization-mode', adminController.getMonetizationMode);
router.patch('/monetization-mode', adminController.updateMonetizationMode);

// ----- Referral Settings -----
router.get('/referral-settings', adminController.getReferralSettings);
router.put('/referral-settings', adminController.createOrUpdateReferralSettings);

// ----- Business Settings -----
router.get('/business-settings/public', businessSettingsController.getBusinessSettings); // Public endpoint
router.get('/business-settings', businessSettingsController.getBusinessSettings);
router.patch('/business-settings', upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'favicon', maxCount: 1 },
    { name: 'restaurantLogo', maxCount: 1 },
    { name: 'deliveryPartnerLogo', maxCount: 1 }
]), businessSettingsController.updateBusinessSettings);

// ----- Delivery Cash Limit -----
router.get('/delivery-cash-limit', adminController.getDeliveryCashLimit);
router.patch('/delivery-cash-limit', adminController.updateDeliveryCashLimit);
router.get('/restaurant-withdrawal-setting', adminController.getRestaurantWithdrawalSetting);
router.patch('/restaurant-withdrawal-setting', adminController.updateRestaurantWithdrawalSetting);

// ----- Delivery Emergency Help -----
router.get('/delivery-emergency-help', adminController.getEmergencyHelp);
router.put('/delivery-emergency-help', adminController.createOrUpdateEmergencyHelp);

/*
 * ----- Withdrawals (admin) -----
 *
 * The PATCH routes below release money; the GET routes only list it. Until now
 * both were gated on `role === 'ADMIN'` alone, which every admin account has --
 * so any admin could approve any payout, and nothing recorded that they had.
 *
 * requireFinancePermission is in TOLERANT mode by default: it logs and audits a
 * missing `wallet.write` rather than refusing, because `permissions` defaults to
 * [] and enforcing immediately would lock the operations team out of this queue.
 * See config.financePermissionsEnforced.
 */
router.get('/withdrawals', adminController.getWithdrawals);
router.patch('/withdrawals/:id', requireFinancePermission('WITHDRAWAL_DECIDE'), adminController.updateWithdrawalStatus);
router.get('/delivery/withdrawals', adminController.getDeliveryWithdrawals);
router.patch('/delivery/withdrawals/:id', requireFinancePermission('WITHDRAWAL_DECIDE'), adminController.updateDeliveryWithdrawalStatus);
router.get('/delivery/cash-limit-settlements', adminController.getCashLimitSettlements);

// ----- Delivery partners & general -----
router.get('/delivery/join-requests', adminController.getDeliveryJoinRequests);
router.get('/delivery/wallets', adminController.getDeliveryWallets);
router.get('/delivery/bonus-transactions', adminController.getDeliveryPartnerBonusTransactions);
router.get('/delivery/earnings', adminController.getDeliveryEarnings);
router.post('/delivery/bonus', bonusInZone, requireFinancePermission('PARTNER_BONUS_GRANT'), adminController.addDeliveryPartnerBonus);
router.get('/delivery/commission-rules', adminController.getDeliveryCommissionRules);
router.post('/delivery/commission-rules', adminController.createDeliveryCommissionRule);
router.patch('/delivery/commission-rules/:id', adminController.updateDeliveryCommissionRule);
router.delete('/delivery/commission-rules/:id', adminController.deleteDeliveryCommissionRule);
router.patch('/delivery/commission-rules/:id/status', adminController.toggleDeliveryCommissionRuleStatus);
router.get('/delivery/zone-surge', adminController.getDeliveryZoneSurgeConfigs);
router.put('/delivery/zone-surge', adminController.upsertDeliveryZoneSurgeConfig);
router.patch('/delivery/zone-surge/:zoneId/status', adminController.toggleDeliveryZoneSurgeStatus);
router.get('/delivery/reviews', adminController.getDeliverymanReviews);
router.get('/contact-messages', adminController.getContactMessages);
router.get('/delivery/earning-addons', adminController.getEarningAddons);
router.post('/delivery/earning-addons', adminController.createEarningAddon);
router.patch('/delivery/earning-addons/:id', adminController.updateEarningAddon);
router.delete('/delivery/earning-addons/:id', adminController.deleteEarningAddon);
router.patch('/delivery/earning-addons/:id/status', adminController.toggleEarningAddonStatus);
router.get('/delivery/earning-addon-history', adminController.getEarningAddonHistory);
router.post('/delivery/earning-addon-history/:id/credit', requireFinancePermission('EARNING_CREDIT'), adminController.creditEarningToWallet);
router.post('/delivery/earning-addon-history/:id/cancel', adminController.cancelEarningAddonHistory);
router.post('/delivery/earning-addon-completions/check', adminController.checkEarningAddonCompletions);
router.get('/delivery/support-tickets/stats', adminController.getSupportTicketStats);
router.get('/delivery/support-tickets', adminController.getSupportTickets);
router.patch('/delivery/support-tickets/:id', adminController.updateSupportTicket);
router.get('/delivery/partners', adminController.getDeliveryPartners);
router.get('/delivery/:id', inZone, adminController.getDeliveryPartnerById);
router.patch('/delivery/:id/approve', inZone, adminController.approveDeliveryPartner);
router.patch('/delivery/:id/reject', inZone, adminController.rejectDeliveryPartner);
router.patch('/delivery/:id/capabilities', inZone, adminController.updateDeliveryPartnerCapabilities);
router.delete('/delivery/partners/:id', inZone, adminController.deactivateDeliveryPartner);

// ----- Zones -----
router.get('/zones', adminController.getZones);
router.get('/zones/:id', adminController.getZoneById);
router.post('/zones', adminController.createZone);
router.patch('/zones/:id', adminController.updateZone);
router.delete('/zones/:id', adminController.deleteZone);

// ----- Dining -----
router.get('/dining/categories', diningAdminController.getDiningCategories);
router.post('/dining/categories', diningAdminController.createDiningCategory);
router.patch('/dining/categories/:id', diningAdminController.updateDiningCategory);
router.delete('/dining/categories/:id', diningAdminController.deleteDiningCategory);
router.get('/dining/restaurants', diningAdminController.getDiningRestaurants);
router.patch('/dining/restaurants/:restaurantId', diningAdminController.updateDiningRestaurant);

// ----- Orders -----
router.get('/orders', orderController.listOrdersAdminController);
router.get('/orders/:orderId', orderController.getOrderByIdAdminController);
router.patch('/orders/:orderId/status', orderController.updateOrderStatusAdminController);
router.delete('/orders/:orderId', orderController.deleteOrderAdminController);
// Assign a rider by hand (core/delivery/manualAssign.js). Same gates as the
// routes above: admin, and the 'orders' permission (write for the PATCHes).
const manualAssign = manualAssignControllers('food');
router.get('/orders/:orderId/rider-candidates', manualAssign.riderCandidates);
router.patch('/orders/:orderId/assign-rider', manualAssign.assignRider);
router.patch('/orders/:orderId/unassign-rider', manualAssign.unassignRider);

// ----- Order cancellation after the restaurant accepts -----
router.get('/order-cancellation', async (_req, res, next) => {
    try {
        const { foodCancelRulesForAdmin } = await import('../../orders/services/cancellationPolicy.js');
        return res.status(200).json({ success: true, message: 'OK', data: await foodCancelRulesForAdmin() });
    } catch (err) { return next(err); }
});
router.put('/order-cancellation', async (req, res, next) => {
    try {
        const { setCancelRules } = await import('../../orders/services/cancellationPolicy.js');
        return res.status(200).json({ success: true, message: 'Saved', data: await setCancelRules(req.body, req.user?.userId) });
    } catch (err) { return next(err); }
});

// ----- Delivery instructions (checkout chip options, e.g. "Leave at door") -----
router.get('/delivery-instructions', async (_req, res, next) => {
    try {
        const { listDeliveryInstructionsForAdmin } = await import('../../orders/services/deliveryInstructions.service.js');
        return res.status(200).json({ success: true, message: 'OK', data: await listDeliveryInstructionsForAdmin() });
    } catch (err) { return next(err); }
});
router.post('/delivery-instructions', async (req, res, next) => {
    try {
        const { createDeliveryInstruction } = await import('../../orders/services/deliveryInstructions.service.js');
        return res.status(201).json({ success: true, message: 'Created', data: await createDeliveryInstruction(req.body) });
    } catch (err) { return next(err); }
});
router.patch('/delivery-instructions/:id', async (req, res, next) => {
    try {
        const { updateDeliveryInstruction } = await import('../../orders/services/deliveryInstructions.service.js');
        return res.status(200).json({ success: true, message: 'Saved', data: await updateDeliveryInstruction(req.params.id, req.body) });
    } catch (err) { return next(err); }
});
router.delete('/delivery-instructions/:id', async (req, res, next) => {
    try {
        const { deleteDeliveryInstruction } = await import('../../orders/services/deliveryInstructions.service.js');
        return res.status(200).json({ success: true, message: 'Deleted', data: await deleteDeliveryInstruction(req.params.id) });
    } catch (err) { return next(err); }
});

// ----- Petpooja Settings & Sync Logs -----
router.get('/petpooja/settings', businessSettingsController.getPetpoojaSettings);
router.put('/petpooja/settings', businessSettingsController.updatePetpoojaSettings);
router.get('/petpooja/sync-logs', orderController.listPetpoojaSyncLogsController);
router.post('/petpooja/sync-logs/:logId/retry', orderController.retryPetpoojaSyncLogController);

// ----- CMS Pages (About + legal) -----
router.get('/pages-social-media/:key', getAdminPageController);
router.put('/pages-social-media/:key', upsertAdminPageController);

router.get('/sidebar-badges', adminController.getSidebarBadges);
router.get('/notifications/fssai-expired', adminController.getExpiredFssaiNotifications);

// ----- Food Admin Hierarchy / Subadmins Management -----
import { attachFoodAdminContext, requireFoodResourceAccess } from '../middlewares/foodAdmin.middleware.js';
import * as subadminController from '../controllers/foodAdminManagement.controller.js';

router.use(attachFoodAdminContext);

router.get('/admin-management/permissions', requireFoodResourceAccess('subadmins', 'subadmins'), subadminController.listFoodAdminPermissions);
router.get('/admin-management/assignable-zones', requireFoodResourceAccess('subadmins', 'subadmins'), subadminController.listAssignableFoodZones);
router.get('/admin-management/admins', requireFoodResourceAccess('subadmins', 'subadmins'), subadminController.listFoodAdmins);
router.get('/admin-management/admins/:id', requireFoodResourceAccess('subadmins', 'subadmins'), subadminController.getFoodAdminById);
router.post('/admin-management/admins', requireFoodResourceAccess('subadmins', 'subadmins'), subadminController.createFoodAdminAccount);
router.patch('/admin-management/admins/:id', requireFoodResourceAccess('subadmins', 'subadmins'), subadminController.updateFoodAdminAccount);
router.delete('/admin-management/admins/:id', requireFoodResourceAccess('subadmins', 'subadmins'), subadminController.deleteFoodAdminAccount);

export default router;
