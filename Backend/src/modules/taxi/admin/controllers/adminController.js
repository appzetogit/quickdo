import { asyncHandler } from "../../../../utils/asyncHandler.js";
import * as adminService from "../services/adminService.js";
import ExcelJS from 'exceljs';
import { LandingPageSetting } from '../models/LandingPageSetting.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { uploadDataUrlToCloudinary } from '../../../../utils/cloudinaryUpload.js';

const ok = (res, data, extra = {}) =>
  res.json({ success: true, data, ...extra });

const sendFile = async (res, filename, reportData, format) => {
  const { headers, rows } = reportData;

  if (format === 'csv') {
    const content = adminService.csvFromRows(headers, rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(content);
  } else {
    // Generate real Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report');

    // Add headers
    worksheet.addRow(headers.map(h => String(h).toUpperCase()));

    // Add rows
    rows.forEach(row => {
      worksheet.addRow(headers.map(h => row[h]));
    });

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  }
};

export const getAdminStatus = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getAdminModuleInfo()),
);
export const loginAdmin = asyncHandler(async (req, res) =>
  ok(res, await adminService.loginAdmin(req.body)),
);
export const forgotPassword = asyncHandler(async (req, res) =>
  ok(res, await adminService.forgotPassword(req.body.email)),
);
export const verifyResetOtp = asyncHandler(async (req, res) =>
  ok(res, await adminService.verifyResetOtp(req.body)),
);
export const resetPassword = asyncHandler(async (req, res) =>
  ok(res, await adminService.resetPassword(req.body)),
);
export const getAdmins = asyncHandler(async (req, res) =>
  ok(res, { results: await adminService.listAdmins(req.auth?.admin) }),
);
export const getAdminPermissions = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listAdminPermissions() }),
);
export const createAdminAccount = asyncHandler(async (req, res) =>
  ok(res, await adminService.createAdminAccount(req.auth?.admin, req.body)),
);
export const updateAdminAccount = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateAdminAccount(req.auth?.admin, req.params.id, req.body)),
);
export const deleteAdminAccount = asyncHandler(async (req, res) => {
  await adminService.deleteAdminAccount(req.auth?.admin, req.params.id);
  ok(res, { deleted: true });
});

export const getUsers = asyncHandler(async (req, res) =>
  ok(res, await adminService.listUsers(req.query)),
);
export const bulkImportUsers = asyncHandler(async (req, res) =>
  ok(res, await adminService.bulkImportUsers(req.body)),
);
export const bulkImportDrivers = asyncHandler(async (req, res) =>
  ok(res, await adminService.bulkImportDrivers(req.body)),
);
export const createUser = asyncHandler(async (req, res) =>
  ok(res, await adminService.createUser(req.body)),
);
export const updateUser = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateUser(req.params.id, req.body)),
);
export const getUser = asyncHandler(async (req, res) =>
  ok(res, await adminService.getUserById(req.params.id)),
);
export const deleteUser = asyncHandler(async (req, res) => {
  await adminService.deleteUser(req.params.id);
  ok(res, { deleted: true });
});

export const getDeletedUsers = asyncHandler(async (req, res) =>
  ok(res, await adminService.listDeletedUsers(req.query)),
);

export const restoreDeletedUser = asyncHandler(async (req, res) =>
  ok(res, await adminService.restoreDeletedUser(req.params.id)),
);

export const permanentlyDeleteDeletedUser = asyncHandler(async (req, res) => {
  await adminService.permanentlyDeleteDeletedUser(req.params.id);
  ok(res, { deleted: true });
});

export const getUserDeletionRequests = asyncHandler(async (req, res) =>
  ok(res, await adminService.listUserDeletionRequests(req.query)),
);

export const approveUserDeletionRequest = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.approveUserDeletionRequest(req.params.id, req.auth?.sub),
  ),
);

export const rejectUserDeletionRequest = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.rejectUserDeletionRequest(
      req.params.id,
      req.body,
      req.auth?.sub,
    ),
  ),
);

export const getUserRequests = asyncHandler(async (req, res) =>
  ok(res, await adminService.listUserRequests(req.params.id)),
);

export const getUserWalletHistory = asyncHandler(async (req, res) =>
  ok(res, await adminService.listUserWalletHistory(req.params.id)),
);

export const adjustUserWallet = asyncHandler(async (req, res) =>
  ok(res, await adminService.adjustUserWallet(req.params.id, req.body)),
);

export const getDrivers = asyncHandler(async (req, res) => {
  ok(res, await adminService.listDrivers(req.query, req.auth?.admin));
});

export const getDriverRatings = asyncHandler(async (req, res) =>
  ok(res, await adminService.listDriverRatings(req.query)),
);

export const getDriverRatingDetail = asyncHandler(async (req, res) =>
  ok(res, await adminService.getDriverRatingDetail(req.params.id)),
);

export const listDriverWalletHistory = asyncHandler(async (req, res) =>
  ok(res, await adminService.listDriverWalletHistory(req.params.id)),
);

export const getNegativeBalanceDrivers = asyncHandler(async (req, res) =>
  ok(res, await adminService.listNegativeBalanceDrivers(req.query)),
);

export const getDriverWithdrawalSummaries = asyncHandler(async (req, res) =>
  ok(res, await adminService.listDriverWithdrawalSummaries(req.query)),
);

export const getDriverWithdrawals = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.listDriverWithdrawals({
      driverId: req.params.id,
      page: req.query.page,
      limit: req.query.limit,
    }),
  ),
);

export const getDriverWithdrawalContextByRequestId = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.getDriverWithdrawalContextByRequestId({
      requestId: req.params.requestId,
      page: req.query.page,
      limit: req.query.limit,
    }),
  ),
);

export const approveDriverWithdrawalRequest = asyncHandler(async (req, res) =>
  ok(res, await adminService.approveDriverWithdrawalRequest(req.params.requestId, req.auth?.sub)),
);

export const rejectDriverWithdrawalRequest = asyncHandler(async (req, res) =>
  ok(res, await adminService.rejectDriverWithdrawalRequest(req.params.requestId)),
);


export const getDeletedDrivers = asyncHandler(async (req, res) =>
  ok(res, await adminService.listDeletedDrivers(req.query)),
);

export const restoreDeletedDriver = asyncHandler(async (req, res) =>
  ok(res, await adminService.restoreDeletedDriver(req.params.id)),
);

export const permanentlyDeleteDeletedDriver = asyncHandler(async (req, res) => {
  await adminService.permanentlyDeleteDeletedDriver(req.params.id);
  ok(res, { deleted: true });
});

export const getDriverDeletionRequests = asyncHandler(async (req, res) =>
  ok(res, await adminService.listDriverDeletionRequests(req.query)),
);

export const approveDriverDeletionRequest = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.approveDriverDeletionRequest(req.params.id, req.auth?.sub),
  ),
);

export const rejectDriverDeletionRequest = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.rejectDriverDeletionRequest(
      req.params.id,
      req.body,
      req.auth?.sub,
    ),
  ),
);

export const createDriver = asyncHandler(async (req, res) =>
  ok(res, await adminService.createDriver(req.body, req.auth?.admin)),
);
export const getDriver = asyncHandler(async (req, res) =>
  ok(res, await adminService.getDriverById(req.params.id, req.auth?.admin)),
);
export const getDriverProfile = asyncHandler(async (req, res) =>
  ok(res, await adminService.getDriverProfile(req.params.id)),
);
export const updateDriver = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateDriver(req.params.id, req.body, req.auth?.admin)),
);
export const updateDriverPassword = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.updateDriverPassword(req.params.id, req.body.password),
  ),
);
export const deleteDriver = asyncHandler(async (req, res) => {
  await adminService.deleteDriver(req.params.id);
  ok(res, { deleted: true });
});

export const adjustDriverWallet = asyncHandler(async (req, res) =>
  ok(res, await adminService.adjustDriverWallet(req.params.id, req.body)),
);

export const getSubscriptionPlans = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listSubscriptionPlans() }),
);
export const createSubscriptionPlan = asyncHandler(async (req, res) =>
  ok(res, await adminService.createSubscriptionPlan(req.body)),
);
export const getCustomerSubscriptionPlans = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listCustomerSubscriptionPlans() }),
);
export const createCustomerSubscriptionPlan = asyncHandler(async (req, res) =>
  ok(res, await adminService.createCustomerSubscriptionPlan(req.body)),
);
export const getUserSubscriptions = asyncHandler(async (req, res) =>
  ok(res, await adminService.listUserSubscriptionsByUserId(req.params.id)),
);

export const getSubscriptionSettings = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getSubscriptionSettings()),
);
export const updateSubscriptionSettings = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateSubscriptionSettings(req.body)),
);

export const getReferralSettings = asyncHandler(async (req, res) =>
  ok(res, await adminService.getReferralSettings(req.params.type)),
);

export const updateReferralSettings = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateReferralSettings(req.params.type, req.body)),
);

export const getReferralDashboard = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getReferralDashboard()),
);

export const getServiceLocations = asyncHandler(async (req, res) =>
  ok(res, await adminService.listServiceLocations(req.auth?.admin)),
);
export const getCountries = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listCountries() }),
);
export const createServiceLocation = asyncHandler(async (req, res) =>
  ok(res, await adminService.createServiceLocation(req.body, req.auth?.admin)),
);
export const updateServiceLocation = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateServiceLocation(req.params.id, req.body, req.auth?.admin)),
);
export const deleteServiceLocation = asyncHandler(async (req, res) => {
  await adminService.deleteServiceLocation(req.params.id, req.auth?.admin);
  ok(res, { deleted: true });
});
export const getNearbyServiceLocations = asyncHandler(async (req, res) =>
  ok(res, {
    results: await adminService.listNearbyServiceLocations(req.query),
  }),
);
export const getRideModules = asyncHandler(async (_req, res) =>
  ok(res, await adminService.listRideModules()),
);
export const getOngoingRides = asyncHandler(async (req, res) =>
  ok(res, await adminService.listOngoingRides(req.query)),
);
export const getRideRequests = asyncHandler(async (req, res) =>
  ok(res, await adminService.listRideRequests(req.query)),
);
export const getIntercityTrips = asyncHandler(async (req, res) =>
  ok(res, await adminService.listIntercityTrips(req.query)),
);
export const deleteTripRequest = asyncHandler(async (req, res) =>
  ok(res, await adminService.removeRideFromTrips(req.params.id, req.auth?.sub)),
);

export const deleteOngoingRide = asyncHandler(async (req, res) =>
  ok(res, await adminService.deleteOngoingRide(req.params.id)),
);
export const getVehicleTypes = asyncHandler(async (req, res) =>
  ok(res, await adminService.listVehicleTypes(req.query)),
);
export const getVehicleTypeCatalog = asyncHandler(async (_req, res) =>
  ok(res, await adminService.listVehicleCatalog()),
);
/**
 * `?appModuleId=` narrows the catalogue to the module the customer is
 * booking from. Omitted, it returns everything, which is what every
 * existing caller gets.
 */
/**
 * The zone a catalogue request is for.
 *
 * An explicit zoneId wins. Otherwise the pickup coordinates are matched
 * against the zone polygons -- the same lookup dispatch uses, so the vehicles
 * a rider is shown are the ones that zone can actually price and dispatch.
 *
 * Returns null when there is no location to go on, or the point falls outside
 * every zone. The caller then filters nothing.
 */
const resolveCatalogZoneId = async (query = {}) => {
  const explicit = String(query.zoneId || '').trim();
  if (explicit) return explicit;

  const lat = Number(query.lat);
  const lng = Number(query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  try {
    const { findZoneByPickup } = await import('../../services/matchingService.js');
    const zone = await findZoneByPickup([lng, lat]);
    return zone?._id ? String(zone._id) : null;
  } catch {
    // A zone lookup that fails must not fail the catalogue: the rider gets
    // the full list rather than an error.
    return null;
  }
};

/**
 * GET /taxi/users/popular-places?lat=&lng=
 *
 * Public, like the vehicle catalogue beside it.
 */
export const getPopularPlaces = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.listPopularPlacesNear({
      lat: req.query?.lat,
      lng: req.query?.lng,
    }),
  ),
);

export const getPublicVehicleTypeCatalog = asyncHandler(async (req, res) => {
  const zoneId = await resolveCatalogZoneId(req.query || {});
  return ok(
    res,
    await adminService.listPublicVehicleCatalog(req.query?.appModuleId || null, { zoneId }),
  );
});
/**
 * Public ride/package tariffs for the rider app.
 *
 * Passing null as currentAdmin is deliberate: listSetPrices only applies the
 * set_prices.view permission check and zone/service-location scoping when an
 * admin is supplied. This mirrors the pre-merge public route exactly, which
 * called the same service the same way.
 */
export const getPublicSetPrices = asyncHandler(async (req, res) => {
  const data = await adminService.listSetPrices(req.query || {}, null);
  // Public list only: vehicles with no row of their own are listed with the row
  // they borrow from a namesake, so an app looking prices up by vehicle finds
  // the one the booking charges from. The admin list is untouched.
  const { addBorrowedRidePriceRows } = await import('../../services/rideService.js');
  const results = await addBorrowedRidePriceRows(data.results);
  res.json({ success: true, ...data, results });
});

export const getVehiclePreferenceOptions = asyncHandler(async (_req, res) =>
  ok(res, await adminService.listVehiclePreferences()),
);
export const createVehicleType = asyncHandler(async (req, res) =>
  ok(res, await adminService.createVehicleType(req.body)),
);
export const updateVehicleType = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateVehicleType(req.params.id, req.body)),
);
export const deleteVehicleType = asyncHandler(async (req, res) => {
  await adminService.deleteVehicleType(req.params.id);
  ok(res, { deleted: true });
});

export const getDashboardData = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getDashboardData()),
);
export const getOverallEarnings = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getOverallEarnings()),
);
export const getAdminEarnings = asyncHandler(async (req, res) =>
  ok(res, await adminService.getAdminEarnings(req.query)),
);
export const getTodayEarnings = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getTodayEarnings()),
);
export const getCancelChart = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getCancelChart()),
);
export const getWithdrawals = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listWithdrawals() }),
);

export const getZones = asyncHandler(async (req, res) =>
  ok(res, { results: await adminService.listZones(req.auth?.admin) }),
);
export const createZone = asyncHandler(async (req, res) =>
  ok(res, await adminService.createZone(req.body, req.auth?.admin)),
);
export const updateZone = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateZone(req.params.id, req.body, req.auth?.admin)),
);
export const deleteZone = asyncHandler(async (req, res) => {
  await adminService.deleteZone(req.params.id, req.auth?.admin);
  ok(res, { deleted: true });
});
export const toggleZoneStatus = asyncHandler(async (req, res) =>
  ok(res, await adminService.toggleZoneStatus(req.params.id, req.auth?.admin)),
);

export const getSetPrices = asyncHandler(async (req, res) => {
  const data = await adminService.listSetPrices(req.query || {}, req.auth?.admin);
  res.json({ success: true, ...data });
});
export const createSetPrice = asyncHandler(async (req, res) =>
  ok(res, await adminService.createSetPrice(req.body, req.auth?.admin)),
);
export const updateSetPrice = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateSetPrice(req.params.id, req.body, req.auth?.admin)),
);
export const deleteSetPrice = asyncHandler(async (req, res) => {
  await adminService.deleteSetPrice(req.params.id, req.auth?.admin);
  ok(res, { deleted: true });
});
export const getSurgeSlots = asyncHandler(async (req, res) =>
  ok(res, { results: await adminService.listSurgeSlots(req.auth?.admin) }),
);
export const createSurgeSlot = asyncHandler(async (req, res) =>
  ok(res, await adminService.createSurgeSlot(req.body, req.auth?.admin)),
);
export const updateSurgeSlot = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateSurgeSlot(req.params.id, req.body, req.auth?.admin)),
);
export const deleteSurgeSlot = asyncHandler(async (req, res) => {
  await adminService.deleteSurgeSlot(req.params.id, req.auth?.admin);
  ok(res, { deleted: true });
});

export const getAirports = asyncHandler(async (req, res) =>
  ok(res, { airports: await adminService.listAirports(req.auth?.admin) }),
);
export const createAirport = asyncHandler(async (req, res) =>
  ok(res, await adminService.createAirport(req.body, req.auth?.admin)),
);
export const updateAirport = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateAirport(req.params.id, req.body, req.auth?.admin)),
);
export const deleteAirport = asyncHandler(async (req, res) => {
  await adminService.deleteAirport(req.params.id, req.auth?.admin);
  ok(res, { deleted: true });
});

export const uploadImage = asyncHandler(async (req, res) => {
  const { image } = req.body;
  if (!image) throw new ApiError(400, 'Image data is required');

  const result = await uploadDataUrlToCloudinary({
    dataUrl: image,
    publicIdPrefix: 'admin-upload',
  });

  res.status(200).json({ success: true, data: { url: result.secureUrl }, message: 'Image uploaded successfully' });
});

export const getRentalPackageTypes = asyncHandler(async (_req, res) =>
  ok(res, { rental_packages: await adminService.listRentalPackageTypes() }),
);
export const createRentalPackageType = asyncHandler(async (req, res) =>
  ok(res, await adminService.createRentalPackageType(req.body)),
);
export const updateRentalPackageType = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateRentalPackageType(req.params.id, req.body)),
);
export const deleteRentalPackageType = asyncHandler(async (req, res) => {
  await adminService.deleteRentalPackageType(req.params.id);
  ok(res, { deleted: true });
});

export const getDriverNeededDocuments = asyncHandler(async (req, res) =>
  ok(res, {
    results: await adminService.listDriverNeededDocuments({
      templateType: req.query?.template_type || 'document',
      includeFields: String(req.query?.template_type || 'document').trim().toLowerCase() !== 'vehicle_field',
    }),
  }),
);
export const getDriverNeededDocument = asyncHandler(async (req, res) =>
  ok(res, await adminService.getDriverNeededDocumentById(req.params.id)),
);
export const createDriverNeededDocument = asyncHandler(async (req, res) =>
  ok(res, await adminService.createDriverNeededDocument(req.body)),
);
export const updateDriverNeededDocument = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateDriverNeededDocument(req.params.id, req.body)),
);
export const deleteDriverNeededDocument = asyncHandler(async (req, res) => {
  await adminService.deleteDriverNeededDocument(req.params.id);
  ok(res, { deleted: true });
});
export const getReferralTranslations = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listReferralTranslations() }),
);
export const updateReferralTranslation = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateReferralTranslation(req.params.languageCode, req.body)),
);

export const getLanguages = asyncHandler(async (_req, res) => {
  const items = await adminService.listLanguages();
  res.json({ success: true, paginator: { data: items }, results: items });
});
export const updateLanguageStatus = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateLanguageStatus(req.params.id, req.body)),
);
export const deleteLanguage = asyncHandler(async (req, res) => {
  await adminService.deleteLanguage(req.params.id);
  ok(res, { deleted: true });
});

export const getPreferences = asyncHandler(async (_req, res) => {
  const items = await adminService.listPreferences();
  res.json({ success: true, paginator: { data: items }, results: items });
});
export const createPreference = asyncHandler(async (req, res) =>
  ok(res, await adminService.createPreference(req.body)),
);
export const updatePreferenceStatus = asyncHandler(async (req, res) =>
  ok(res, await adminService.updatePreferenceStatus(req.params.id, req.body)),
);
export const deletePreference = asyncHandler(async (req, res) => {
  await adminService.deletePreference(req.params.id);
  ok(res, { deleted: true });
});

export const getRoles = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listRoles() }),
);
export const createRole = asyncHandler(async (req, res) =>
  ok(res, await adminService.createRole(req.body)),
);
export const deleteRole = asyncHandler(async (req, res) => {
  await adminService.deleteRole(req.params.id);
  ok(res, { deleted: true });
});

export const getAppModules = asyncHandler(async (req, res) =>
  ok(res, await adminService.listAppModules(req.query)),
);
export const createAppModule = asyncHandler(async (req, res) =>
  ok(res, await adminService.createAppModule(req.body)),
);
export const updateAppModule = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateAppModule(req.params.id, req.body)),
);
export const deleteAppModule = asyncHandler(async (req, res) => {
  await adminService.deleteAppModule(req.params.id);
  ok(res, { deleted: true });
});

export const getNotificationChannels = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listNotificationChannels() }),
);
export const toggleChannelPush = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.updateNotificationChannelField(
      req.params.id,
      "push_notification",
      req.body.push_notification,
    ),
  ),
);
export const toggleChannelMail = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.updateNotificationChannelField(
      req.params.id,
      "mail",
      req.body.mail,
    ),
  ),
);

export const getPaymentGateways = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listPaymentGateways() }),
);
export const getPaymentMethods = asyncHandler(async (_req, res) =>
  ok(res, { results: await adminService.listPaymentMethods() }),
);
export const createPaymentMethod = asyncHandler(async (req, res) =>
  ok(res, await adminService.createPaymentMethod(req.body)),
);
export const updatePaymentMethod = asyncHandler(async (req, res) =>
  ok(res, await adminService.updatePaymentMethod(req.params.id, req.body)),
);
export const deletePaymentMethod = asyncHandler(async (req, res) => {
  await adminService.deletePaymentMethod(req.params.id);
  ok(res, { deleted: true });
});
export const getPaymentSettings = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getPaymentSettings()),
);
export const updatePaymentSettings = asyncHandler(async (req, res) =>
  ok(res, await adminService.updatePaymentSettings(req.body)),
);

export const getSmsSettings = asyncHandler(async (_req, res) =>
  ok(res, await adminService.getSMSSettings()),
);
export const updateSmsSettings = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateSMSSettings(req.body)),
);

export const getFirebaseSettings = asyncHandler(async (_req, res) =>
  ok(res, { settings: await adminService.getFirebaseSettings() }),
);
export const updateFirebaseSettings = asyncHandler(async (req, res) =>
  ok(res, { settings: await adminService.updateFirebaseSettings(req.body) }),
);

export const getMapSettings = asyncHandler(async (_req, res) =>
  ok(res, { settings: await adminService.getMapSettings() }),
);
export const updateMapSettings = asyncHandler(async (req, res) =>
  ok(res, { settings: await adminService.updateMapSettings(req.body) }),
);

export const getMailSettings = asyncHandler(async (_req, res) =>
  ok(res, { settings: await adminService.getMailSettings() }),
);
export const updateMailSettings = asyncHandler(async (req, res) =>
  ok(res, { settings: await adminService.updateMailSettings(req.body) }),
);

export const getUserOnboarding = asyncHandler(async (_req, res) =>
  res.json({
    success: true,
    results: await adminService.listOnboardingScreens("user"),
  }),
);
export const getDriverOnboarding = asyncHandler(async (_req, res) =>
  res.json({
    success: true,
    results: await adminService.listOnboardingScreens("driver"),
  }),
);
export const createOnboardingScreen = asyncHandler(async (req, res) =>
  ok(res, await adminService.createOnboardingScreen(req.body)),
);
export const updateOnboardingScreen = asyncHandler(async (req, res) =>
  ok(res, await adminService.updateOnboardingScreen(req.params.id, req.body)),
);
export const deleteOnboardingScreen = asyncHandler(async (req, res) =>
  ok(res, await adminService.deleteOnboardingScreen(req.params.id)),
);

export const downloadUserReport = asyncHandler(async (req, res) => {
  const format = req.query.file_format || 'csv';
  const data = await adminService.buildUserReport(req.query);
  await sendFile(res, "user-report", data, format);
});

export const downloadDriverReport = asyncHandler(async (req, res) => {
  const format = req.query.file_format || 'csv';
  const data = await adminService.buildDriverReport(req.query);
  await sendFile(res, "driver-report", data, format);
});

export const downloadDriverDutyReport = asyncHandler(async (req, res) => {
  const format = req.query.file_format || 'csv';
  const data = await adminService.buildDriverDutyReport(req.query);
  await sendFile(res, "driver-duty-report", data, format);
});

export const downloadFinanceReport = asyncHandler(async (req, res) => {
  const format = req.query.file_format || 'csv';
  const data = await adminService.buildFinanceReport(req.query);
  await sendFile(res, "finance-report", data, format);
});

export const getGeneralSettingsCategory = asyncHandler(async (req, res) =>
  ok(res, await adminService.getGeneralSettings(req.params.category)),
);
export const updateGeneralSettingsCategory = asyncHandler(async (req, res) =>
  ok(
    res,
    await adminService.updateGeneralSettings(req.params.category, req.body),
  ),
);
export const getTransportTypes = asyncHandler(async (_req, res) => {
  ok(res, await adminService.listTransportTypes());
});

export const getLandingPageSettings = asyncHandler(async (req, res) => {
  let settings = await LandingPageSetting.findOne({ scope: 'default' });
  if (!settings) {
    settings = await LandingPageSetting.create({
      scope: 'default',
      video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      logo_url: '',
      hero_title: 'All-in-One Platform for Rides, Food & Logistics',
      hero_description: 'Quick Drop is the multi-service super-app designed for modern cities. Easily book a taxi, order from your favorite local restaurants, ship parcels, arrange airport transfers, rent vehicles, and coordinate complex supply chains.',
      hero_image_url: '',
      why_us_image_url: '',
      social_links: {
        facebook: 'https://facebook.com/k9rides',
        twitter: 'https://twitter.com/k9rides',
        instagram: 'https://instagram.com/k9rides',
        linkedin: 'https://linkedin.com/company/k9rides',
        youtube: 'https://youtube.com/k9rides'
      },
      contact_email: 'k9bharatrides@gmail.com',
      contact_phone: '+91 7358789910',
      contact_address: 'Quick Drop, Siliguri, West Bengal, India',
      contact_location: { lat: 26.7271, lng: 88.3953 },
      play_store_url: '/login/services',
      app_store_url: '/login/services',
      faqs: [
        {
          question: 'What is Quick Drop?',
          answer: 'Quick Drop is a unified multi-service super-app offering on-demand taxi bookings, local food ordering, courier deliveries, rentals, and airport transfers.',
          order: 0
        },
        {
          question: 'How do I book a ride?',
          answer: 'Simply log in with your phone number, select your pickup and drop locations, choose a vehicle class, and confirm your booking. A driver will be assigned immediately.',
          order: 1
        },
        {
          question: 'What payment methods are supported?',
          answer: 'We support digital payments via UPI, Credit/Debit Cards, Net Banking, and Mobile Wallets, as well as Cash on delivery/ride.',
          order: 2
        },
        {
          question: 'How are surge prices calculated?',
          answer: 'Surge pricing is dynamically applied during peak demand hours, bad weather, or heavy traffic, to balance driver supply with passenger demand.',
          order: 3
        }
      ],
      pages: {
        about_us: '<h1>About Quick Drop</h1><p>Quick Drop is a leading technology platform dedicated to providing safe, reliable, and affordable mobility solutions for everyone. Our mission is to transform urban transportation and logistics by connecting people with professional drivers and efficient services.</p>',
        careers: '<h1>Careers at Quick Drop</h1><p>Join our team and build the future of urban mobility. We are constantly looking for talented software engineers, product managers, driver relationship experts, and support specialists to join our journey.</p>',
        newsroom: '<h1>Quick Drop Newsroom</h1><p>Stay updated with our latest press releases, company announcements, service launches, and regulatory breakthroughs. Quick Drop is growing quickly to serve more cities across Bharat.</p>',
        terms_conditions: '<h1>Terms of Service</h1><p>By using Quick Drop app or website, you agree to these Terms of Service. Quick Drop acts as a technology platform connecting users with third-party service providers. You must provide accurate details and use the platform lawfully.</p>',
        privacy_policy: '<h1>Privacy Policy</h1><p>We value your privacy. Quick Drop collects your personal information (name, contact, location) solely to match and execute rides, deliveries, and orders. We do not sell your personal data to advertisers.</p>',
        refund_policy: '<h1>Refund Policy</h1><p>Refunds are processed for verified overcharges or cancelled bookings prior to partner dispatch. UPI and wallet refunds settle within 1 to 3 days, and bank cards settle in 5 to 10 days.</p>',
        cancellation_policy: '<h1>Cancellation Policy</h1><p>Users may cancel bookings free of charge before a driver accepts. Nominal cancellation charges apply once a driver is assigned or dispatch preparation has already started.</p>'
      }
    });
  }
  return ok(res, settings);
});

export const updateLandingPageSettings = asyncHandler(async (req, res) => {
  const {
    video_url,
    logo_url,
    hero_title,
    hero_description,
    hero_image_url,
    why_us_image_url,
    social_links,
    contact_email,
    contact_phone,
    contact_address,
    contact_location,
    play_store_url,
    app_store_url,
    faqs,
    pages
  } = req.body;

  // 1. Email format validation
  if (contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) {
    throw new ApiError(400, 'Invalid contact email format');
  }

  // 2. Phone number validation
  if (contact_phone && !/^\+?[1-9]\d{1,14}$|^[0-9-\s\+\(\)]+$/.test(contact_phone)) {
    throw new ApiError(400, 'Invalid contact phone format');
  }

  // 3. URL format validation
  const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/i;
  const validateUrl = (url, fieldName) => {
    if (url && !url.startsWith('/') && !urlPattern.test(url)) {
      throw new ApiError(400, `Invalid URL format for ${fieldName}`);
    }
  };

  validateUrl(video_url, 'Video Link');
  validateUrl(play_store_url, 'Google Play Store Link');
  validateUrl(app_store_url, 'Apple App Store Link');
  if (social_links) {
    validateUrl(social_links.facebook, 'Facebook Link');
    validateUrl(social_links.twitter, 'Twitter Link');
    validateUrl(social_links.instagram, 'Instagram Link');
    validateUrl(social_links.linkedin, 'LinkedIn Link');
    validateUrl(social_links.youtube, 'YouTube Link');
  }

  // 4. Required FAQ question/answer check
  if (faqs) {
    for (const faq of faqs) {
      if (!faq.question?.trim() || !faq.answer?.trim()) {
        throw new ApiError(400, 'FAQ question and answer are required');
      }
    }
  }

  // 5. Max upload size validation for inline base64 if sent directly (5MB limit)
  const validateBase64Size = (dataUrl, fieldName) => {
    if (dataUrl && dataUrl.startsWith('data:image')) {
      const approxBytes = (dataUrl.length * 3) / 4;
      if (approxBytes > 5 * 1024 * 1024) {
        throw new ApiError(400, `Image for ${fieldName} exceeds the 5MB size limit`);
      }
    }
  };

  validateBase64Size(logo_url, 'Logo');
  validateBase64Size(hero_image_url, 'Hero Image');
  validateBase64Size(why_us_image_url, 'Why Us Graphics');

  let settings = await LandingPageSetting.findOne({ scope: 'default' });
  if (!settings) {
    settings = new LandingPageSetting({ scope: 'default' });
  }

  if (video_url !== undefined) settings.video_url = video_url;
  if (logo_url !== undefined) settings.logo_url = logo_url;
  if (hero_title !== undefined) settings.hero_title = hero_title;
  if (hero_description !== undefined) settings.hero_description = hero_description;
  if (hero_image_url !== undefined) settings.hero_image_url = hero_image_url;
  if (why_us_image_url !== undefined) settings.why_us_image_url = why_us_image_url;
  if (social_links !== undefined) settings.social_links = social_links;
  if (contact_email !== undefined) settings.contact_email = contact_email;
  if (contact_phone !== undefined) settings.contact_phone = contact_phone;
  if (contact_address !== undefined) settings.contact_address = contact_address;
  if (contact_location !== undefined) settings.contact_location = contact_location;
  if (play_store_url !== undefined) settings.play_store_url = play_store_url;
  if (app_store_url !== undefined) settings.app_store_url = app_store_url;
  if (faqs !== undefined) settings.faqs = faqs;
  if (pages !== undefined) settings.pages = pages;

  settings.markModified('social_links');
  settings.markModified('contact_location');
  settings.markModified('faqs');
  settings.markModified('pages');

  await settings.save();
  return ok(res, settings);
});
