import { Router } from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { requireServiceAccess } from '../../../../core/roles/serviceAccess.middleware.js';
import { requireFinancePermission } from '../../../../core/admin/requireFinancePermission.middleware.js';
import {
  createAirport,
  createAdminAccount,
  createAppModule,
  createDriver,
  createDriverNeededDocument,
  bulkImportDrivers,
  createRentalPackageType,
  createOnboardingScreen,
  createPreference,
  createRole,
  createPaymentMethod,
  createServiceLocation,
  createSetPrice,
  createSubscriptionPlan,
  createCustomerSubscriptionPlan,
  createUser,
  createZone,
  bulkImportUsers,
  approveUserDeletionRequest,
  approveDriverDeletionRequest,
  deleteAppModule,
  deleteDriver,
  deleteDriverNeededDocument,
  deleteOnboardingScreen,
  deleteRentalPackageType,
  deleteLanguage,
  deleteOngoingRide,
  deleteTripRequest,
  deletePreference,
  deleteRole,
  deletePaymentMethod,
  deleteSetPrice,
  getSurgeSlots,
  createSurgeSlot,
  updateSurgeSlot,
  deleteSurgeSlot,
  deleteServiceLocation,
  deleteUser,
  deleteZone,
  downloadDriverDutyReport,
  downloadDriverReport,
  downloadFinanceReport,
  downloadUserReport,
  forgotPassword,
  getAdminStatus,
  getAdminEarnings,
  getAirports,
  getAppModules,
  getCancelChart,
  getCountries,
  getDashboardData,
  getDriver,
  getDriverNeededDocument,
  getDriverNeededDocuments,
  getDriverProfile,
  getDriverOnboarding,
  getDrivers,
  getDriverRatings,
  getDriverRatingDetail,
  getNegativeBalanceDrivers,
  getDriverWithdrawalSummaries,
  getDriverWithdrawals,
  getDriverWithdrawalContextByRequestId,
  approveDriverWithdrawalRequest,
  rejectDriverWithdrawalRequest,
  getDeletedDrivers,
  getDriverDeletionRequests,
  getFirebaseSettings,
  getIntercityTrips,
  getReferralTranslations,
  getGeneralSettingsCategory,
  getLandingPageSettings,
  getRentalPackageTypes,
  getLanguages,
  getMailSettings,
  getMapSettings,
  getNearbyServiceLocations,
  getNotificationChannels,
  getOngoingRides,
  getOverallEarnings,
  getPaymentGateways,
  getPaymentMethods,
  getPaymentSettings,
  getPreferences,
  getRideModules,
  getRoles,
  getReferralSettings,
  updateReferralSettings,
  getReferralDashboard,
  getSetPrices,
  getServiceLocations,
  getSmsSettings,
  getSubscriptionPlans,
  getCustomerSubscriptionPlans,
  getSubscriptionSettings,
  getUserSubscriptions,
  updateSubscriptionSettings,
  getTodayEarnings,
  getUserOnboarding,
  getUser,
  getUsers,
  getDeletedUsers,
  getUserDeletionRequests,
  restoreDeletedUser,
  permanentlyDeleteDeletedUser,
  restoreDeletedDriver,
  permanentlyDeleteDeletedDriver,
  getRideRequests,
  rejectUserDeletionRequest,
  rejectDriverDeletionRequest,
  getUserRequests,
  getUserWalletHistory,
  getVehiclePreferenceOptions,
  getVehicleTypeCatalog,
  getVehicleTypes,
  getWithdrawals,
  getZones,
  resetPassword,
  verifyResetOtp,
  toggleChannelMail,
  toggleChannelPush,
  toggleZoneStatus,
  adjustUserWallet,
  listDriverWalletHistory,
  adjustDriverWallet,
  updateAppModule,
  updateAirport,
  updateAdminAccount,
  updateDriver,
  updateDriverNeededDocument,
  updateDriverPassword,
  updateFirebaseSettings,
  updateRentalPackageType,
  updateOnboardingScreen,
  updateGeneralSettingsCategory,
  updateLandingPageSettings,
  updateLanguageStatus,
  updateMailSettings,
  updateMapSettings,
  updatePaymentSettings,
  updatePaymentMethod,
  updatePreferenceStatus,
  updateReferralTranslation,
  updateSetPrice,
  updateServiceLocation,
  updateSmsSettings,
  updateUser,
  updateVehicleType,
  updateZone,
  createVehicleType,
  deleteAirport,
  deleteAdminAccount,
  deleteVehicleType,
  getAdminPermissions,
  getAdmins,
  getTransportTypes,
  uploadImage,
} from '../controllers/adminController.js';
import { promotionsRouter } from '../promotions/routes/index.js';
import { enforceAdminAccess } from '../../../../core/admin/enforceAdminAccess.middleware.js';
import { resolveTaxiAdminResource } from '../../../../core/admin/adminAccessPolicy.js';
import { listSafetyAlerts, resolveSafetyAlert } from '../../safety/controllers/safetyController.js';

export const adminRouter = Router();

adminRouter.get('/admin', getAdminStatus);
adminRouter.get('/admin/status', getAdminStatus);
adminRouter.post('/admin/forgot-password', forgotPassword);
adminRouter.post('/admin/verify-reset-otp', verifyResetOtp);
adminRouter.post('/admin/reset-password', resetPassword);
adminRouter.get('/admin/general-settings/:category', getGeneralSettingsCategory);
adminRouter.get('/admin/countries', getCountries);
adminRouter.get('/admin/service-locations', getServiceLocations);
adminRouter.get('/admin/service-locations/nearby', getNearbyServiceLocations);
adminRouter.get('/admin/notification-channels', getNotificationChannels);
adminRouter.get('/admin/zones', getZones);
adminRouter.use('/admin', authenticate(['admin']), requireServiceAccess('taxi'));
// The shared sub-admin permissions (core/admin/adminAccessPolicy.js). Taxi's own
// list was stored but only the admin-management screen ever checked it.
adminRouter.use('/admin', enforceAdminAccess('taxi', resolveTaxiAdminResource, { prefix: '/admin' }));

adminRouter.get('/admin/permissions', getAdminPermissions);
adminRouter.get('/admin/admin-management/admins', getAdmins);
adminRouter.post('/admin/admin-management/admins', createAdminAccount);
adminRouter.patch('/admin/admin-management/admins/:id', updateAdminAccount);
adminRouter.delete('/admin/admin-management/admins/:id', deleteAdminAccount);

adminRouter.get('/admin/users', getUsers);
adminRouter.post('/admin/users/bulk-import', bulkImportUsers);
adminRouter.post('/admin/users', createUser);
adminRouter.get('/admin/users/deleted', getDeletedUsers);
adminRouter.patch('/admin/users/deleted/:id/restore', restoreDeletedUser);
adminRouter.delete('/admin/users/deleted/:id', permanentlyDeleteDeletedUser);
adminRouter.get('/admin/users/delete-requests', getUserDeletionRequests);
adminRouter.patch('/admin/users/delete-requests/:id/approve', approveUserDeletionRequest);
adminRouter.patch('/admin/users/delete-requests/:id/reject', rejectUserDeletionRequest);
adminRouter.get('/admin/users/:id', getUser);
adminRouter.patch('/admin/users/:id', updateUser);
adminRouter.delete('/admin/users/:id', deleteUser);
adminRouter.get('/admin/users/:id/subscriptions', getUserSubscriptions);
adminRouter.get('/admin/users/:id/requests', getUserRequests);
adminRouter.get('/admin/users/:id/wallet-history', getUserWalletHistory);

adminRouter.get('/admin/drivers', getDrivers);
adminRouter.post('/admin/drivers/bulk-import', bulkImportDrivers);
adminRouter.get('/admin/drivers/deleted', authenticate(['admin']), getDeletedDrivers);
adminRouter.get('/admin/drivers/delete-requests', authenticate(['admin']), getDriverDeletionRequests);
adminRouter.patch('/admin/drivers/delete-requests/:id/approve', authenticate(['admin']), approveDriverDeletionRequest);
adminRouter.patch('/admin/drivers/delete-requests/:id/reject', authenticate(['admin']), rejectDriverDeletionRequest);
adminRouter.patch('/admin/drivers/deleted/:id/restore', authenticate(['admin']), restoreDeletedDriver);
adminRouter.delete('/admin/drivers/deleted/:id', authenticate(['admin']), permanentlyDeleteDeletedDriver);
adminRouter.post('/admin/drivers', createDriver);
adminRouter.get('/admin/drivers/:id/profile', getDriverProfile);
adminRouter.get('/admin/drivers/:id', getDriver);
adminRouter.patch('/admin/drivers/:id', updateDriver);
adminRouter.patch('/admin/drivers/update-password/:id', updateDriverPassword);
adminRouter.delete('/admin/drivers/:id', deleteDriver);
/*
 * The three `/adjust` routes move money by hand and were gated only by
 * `authenticate` -- so any admin token could change any balance, with nothing
 * recording that they had. requireFinancePermission is in tolerant mode by
 * default: it audits a missing `wallet.write` rather than refusing, because
 * `permissions` defaults to [] and enforcing on deploy would lock the operations
 * team out. See config.financePermissionsEnforced.
 *
 * The `/history` routes are reads and stay open to any admin.
 */
adminRouter.post('/admin/wallet/users/:id/adjust', requireFinancePermission('PARTNER_WALLET_ADJUST'), adjustUserWallet);
adminRouter.get('/admin/wallet/users/:id/history', getUserWalletHistory);

adminRouter.post('/admin/wallet/drivers/:id/adjust', requireFinancePermission('PARTNER_WALLET_ADJUST'), adjustDriverWallet);
adminRouter.get('/admin/wallet/drivers/:id/history', listDriverWalletHistory);


adminRouter.get('/admin/wallet/drivers/negative-balance', authenticate(['admin']), getNegativeBalanceDrivers);
adminRouter.get('/admin/wallet/drivers/withdrawals', authenticate(['admin']), getDriverWithdrawalSummaries);
adminRouter.get('/admin/wallet/drivers/withdrawals/request/:requestId', authenticate(['admin']), getDriverWithdrawalContextByRequestId);
adminRouter.get('/admin/wallet/drivers/:id/withdrawals', authenticate(['admin']), getDriverWithdrawals);
adminRouter.patch('/admin/wallet/drivers/withdrawals/:requestId/approve', authenticate(['admin']), approveDriverWithdrawalRequest);
adminRouter.patch('/admin/wallet/drivers/withdrawals/:requestId/reject', authenticate(['admin']), rejectDriverWithdrawalRequest);
adminRouter.get('/admin/driver-ratings', authenticate(['admin']), getDriverRatings);
adminRouter.get('/admin/driver-ratings/:id', authenticate(['admin']), getDriverRatingDetail);

adminRouter.get('/admin/driver-subscriptions/plans/list', getSubscriptionPlans);
adminRouter.post('/admin/driver-subscriptions/plans/create', createSubscriptionPlan);
adminRouter.get('/admin/driver-subscriptions/settings', getSubscriptionSettings);
adminRouter.post('/admin/driver-subscriptions/settings', updateSubscriptionSettings);
adminRouter.get('/admin/user-subscriptions/plans/list', getCustomerSubscriptionPlans);
adminRouter.post('/admin/user-subscriptions/plans/create', createCustomerSubscriptionPlan);

adminRouter.get('/countries', getCountries);
adminRouter.post('/admin/service-locations', createServiceLocation);
adminRouter.patch('/admin/service-locations/:id', updateServiceLocation);
adminRouter.delete('/admin/service-locations/:id', deleteServiceLocation);
adminRouter.get('/common/ride_modules', getRideModules);
adminRouter.get('/admin/types/vehicle-types/list', getVehicleTypes);
adminRouter.get('/admin/types/vehicle-types', getVehicleTypeCatalog);
adminRouter.post('/admin/types/vehicle-types', createVehicleType);
adminRouter.patch('/admin/types/vehicle-types/:id', updateVehicleType);
adminRouter.delete('/admin/types/vehicle-types/:id', deleteVehicleType);
adminRouter.get('/admin/types/set-prices', getSetPrices);
adminRouter.post('/admin/types/set-prices', createSetPrice);
adminRouter.patch('/admin/types/set-prices/:id', updateSetPrice);
adminRouter.delete('/admin/types/set-prices/:id', deleteSetPrice);
adminRouter.get('/admin/types/surge-slots', getSurgeSlots);
adminRouter.post('/admin/types/surge-slots', createSurgeSlot);
adminRouter.patch('/admin/types/surge-slots/:id', updateSurgeSlot);
adminRouter.delete('/admin/types/surge-slots/:id', deleteSurgeSlot);
adminRouter.get('/admin/airports', getAirports);
adminRouter.post('/admin/airports', createAirport);
adminRouter.patch('/admin/airports/:id', updateAirport);
adminRouter.delete('/admin/airports/:id', deleteAirport);
adminRouter.post('/admin/upload-image', uploadImage);
adminRouter.get('/admin/types/rental-packages', getRentalPackageTypes);
adminRouter.post('/admin/types/rental-packages', createRentalPackageType);
adminRouter.patch('/admin/types/rental-packages/:id', updateRentalPackageType);
adminRouter.delete('/admin/types/rental-packages/:id', deleteRentalPackageType);
adminRouter.get('/admin/types/transport-types', getTransportTypes);
adminRouter.get('/admin/vehicle_preference', getVehiclePreferenceOptions);


adminRouter.get('/admin/owner-management/driver-needed-document', getDriverNeededDocuments);
adminRouter.get('/admin/owner-management/driver-needed-document/:id', getDriverNeededDocument);
adminRouter.post('/admin/owner-management/driver-needed-document', createDriverNeededDocument);
adminRouter.patch('/admin/owner-management/driver-needed-document/:id', updateDriverNeededDocument);
adminRouter.delete('/admin/owner-management/driver-needed-document/:id', deleteDriverNeededDocument);
adminRouter.get('/admin/referrals/translation', getReferralTranslations);
adminRouter.patch('/admin/referrals/translation/:languageCode', updateReferralTranslation);
adminRouter.get('/admin/referrals/settings/:type', getReferralSettings);
adminRouter.patch('/admin/referrals/settings/:type', updateReferralSettings);
adminRouter.get('/admin/referral/dashboard', getReferralDashboard);

adminRouter.get('/admin/dashboard/data', getDashboardData);

adminRouter.get('/admin/dashboard/admin-earnings', getAdminEarnings);
adminRouter.get('/admin/dashboard/overall-earnings', getOverallEarnings);
adminRouter.get('/admin/dashboard/today-earnings', getTodayEarnings);
adminRouter.get('/admin/dashboard/cancel-chart', getCancelChart);
adminRouter.get('/admin/safety/alerts', authenticate(['admin']), listSafetyAlerts);
adminRouter.patch('/admin/safety/alerts/:id/resolve', authenticate(['admin']), resolveSafetyAlert);
adminRouter.get('/admin/ongoing-rides', getOngoingRides);
adminRouter.get('/admin/ride-requests', getRideRequests);
adminRouter.delete('/admin/ongoing-rides/:id', deleteOngoingRide);
adminRouter.delete('/admin/ride-requests/:id', deleteTripRequest);
adminRouter.get('/admin/trips', getIntercityTrips);

adminRouter.get('/admin/wallet/withdrawals', getWithdrawals);

adminRouter.post('/admin/zones', createZone);
adminRouter.patch('/admin/zones/:id', updateZone);
adminRouter.delete('/admin/zones/:id', deleteZone);
adminRouter.patch('/admin/zones/:id/toggle-status', toggleZoneStatus);

adminRouter.get('/admin/languages', getLanguages);
adminRouter.patch('/admin/languages/:id/status', updateLanguageStatus);
adminRouter.delete('/admin/languages/:id', deleteLanguage);

adminRouter.get('/admin/preferences', getPreferences);
adminRouter.post('/admin/preferences', createPreference);
adminRouter.patch('/admin/preferences/:id/status', updatePreferenceStatus);
adminRouter.delete('/admin/preferences/:id', deletePreference);

adminRouter.get('/admin/roles', getRoles);
adminRouter.post('/admin/roles', createRole);
adminRouter.delete('/admin/roles/:id', deleteRole);

adminRouter.get('/admin/common/app-modules', getAppModules);
adminRouter.post('/admin/common/app-modules', createAppModule);
adminRouter.patch('/admin/common/app-modules/:id', updateAppModule);
adminRouter.delete('/admin/common/app-modules/:id', deleteAppModule);

adminRouter.patch('/admin/notification-channels/:id/push', toggleChannelPush);
adminRouter.patch('/admin/notification-channels/:id/mail', toggleChannelMail);

adminRouter.get('/admin/integration-settings/payment-gateways', getPaymentGateways);
adminRouter.get('/admin/integration-settings/payment-settings', getPaymentSettings);
adminRouter.patch('/admin/integration-settings/payment-settings', updatePaymentSettings);

adminRouter.get('/admin/payment-methods', authenticate(['admin']), getPaymentMethods);
adminRouter.post('/admin/payment-methods', authenticate(['admin']), createPaymentMethod);
adminRouter.patch('/admin/payment-methods/:id', authenticate(['admin']), updatePaymentMethod);
adminRouter.delete('/admin/payment-methods/:id', authenticate(['admin']), deletePaymentMethod);

adminRouter.get('/admin/integration-settings/sms', getSmsSettings);
adminRouter.patch('/admin/integration-settings/sms', updateSmsSettings);
adminRouter.get('/admin/integration-settings/firebase', getFirebaseSettings);
adminRouter.patch('/admin/integration-settings/firebase', updateFirebaseSettings);
adminRouter.get('/admin/integration-settings/map', getMapSettings);
adminRouter.patch('/admin/integration-settings/map', updateMapSettings);
adminRouter.get('/admin/integration-settings/mail', getMailSettings);
adminRouter.patch('/admin/integration-settings/mail', updateMailSettings);

adminRouter.patch('/admin/general-settings/:category', updateGeneralSettingsCategory);
adminRouter.get('/admin/landing-page/settings', authenticate(['admin']), getLandingPageSettings);
adminRouter.patch('/admin/landing-page/settings', authenticate(['admin']), updateLandingPageSettings);

// Reads stay public: the apps show these screens before anyone signs in. The
// writes had no authentication at all -- outside the /admin prefix, so the
// router-level admin guard never covered them -- letting anyone create, rewrite or
// delete the onboarding screens every new customer sees. The admin panel already
// sends its admin token on these paths.
adminRouter.get('/on-boarding', getUserOnboarding);
adminRouter.post('/on-boarding', authenticate(['admin']), createOnboardingScreen);
adminRouter.patch('/on-boarding/:id', authenticate(['admin']), updateOnboardingScreen);
adminRouter.delete('/on-boarding/:id', authenticate(['admin']), deleteOnboardingScreen);
adminRouter.get('/on-boarding-driver', getDriverOnboarding);

adminRouter.get('/admin/reports/user/download', downloadUserReport);
adminRouter.get('/admin/reports/driver/download', downloadDriverReport);
adminRouter.get('/admin/reports/driver-duty/download', downloadDriverDutyReport);
adminRouter.get('/admin/reports/finance/download', downloadFinanceReport);

adminRouter.use('/', promotionsRouter);
