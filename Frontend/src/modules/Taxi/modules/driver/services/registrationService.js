import api from "../../../shared/api/axiosInstance";
import { BACKEND_ORIGIN } from "../../../shared/api/runtimeConfig";

const STORAGE_KEY = "driverRegistrationSession";
const DRIVER_AUTH_KEYS = ["token", "driverToken", "driverInfo", "role", "driverRole", "chatRole"];
const readSessionValue = (key) => {
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
};
const writeSessionValue = (key, value) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {}
};
const removeSessionValue = (key) => {
  try {
    sessionStorage.removeItem(key);
  } catch {}
};

const readStoredSession = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export const getStoredDriverRegistrationSession = () => readStoredSession();

export const saveDriverRegistrationSession = (session = {}) => {
  const nextSession = {
    ...readStoredSession(),
    ...session,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
  return nextSession;
};

export const clearDriverRegistrationSession = () => {
  localStorage.removeItem(STORAGE_KEY);
};

export const clearDriverAuthState = () => {
  clearDriverRegistrationSession();
  DRIVER_AUTH_KEYS.forEach((key) => {
    removeSessionValue(key);
    localStorage.removeItem(key);
  });
};

export const persistDriverAuthSession = ({ token = "", role = "driver" } = {}) => {
  const normalizedRole = String(role || "driver").toLowerCase();

  if (token) {
    writeSessionValue("token", token);
    writeSessionValue("driverToken", token);
    localStorage.setItem("token", token);
    localStorage.setItem("driverToken", token);
  }

  writeSessionValue("role", normalizedRole);
  writeSessionValue("driverRole", normalizedRole);
  localStorage.setItem("role", normalizedRole);
  localStorage.setItem("driverRole", normalizedRole);
};

export const getStoredDriverRole = () =>
  readSessionValue("driverRole")
  || readSessionValue("role")
  || String(localStorage.getItem("driverRole") || localStorage.getItem("role") || "driver").toLowerCase();

export const normalizeDriverPortalRole = (role) => {
  const normalized = String(role || "").toLowerCase();

  if (!normalized) return "";

  if (normalized === "owner") return "owner";
  if (normalized === "service_center" || normalized === "service-center" || normalized === "servicecenter") {
    return "service_center";
  }
  if (normalized === "service_center_staff" || normalized === "service-center-staff" || normalized === "servicecenterstaff") {
    return "service_center_staff";
  }
  if (normalized === "bus_driver" || normalized === "bus-driver" || normalized === "busdriver") {
    return "bus_driver";
  }

  return "driver";
};

export const sendDriverOtp = (payload) =>
  api.post("/drivers/onboarding/send-otp", payload);

export const verifyDriverOtp = (payload) =>
  api.post("/drivers/onboarding/verify-otp", payload);

export const sendDriverLoginOtp = (payload) =>
  api.post("/drivers/auth/send-otp", payload);

export const verifyDriverLoginOtp = (payload) =>
  api.post("/drivers/auth/verify-otp", payload);

export const saveDriverPersonalDetails = (payload) =>
  api.patch("/drivers/onboarding/personal", payload);

export const saveDriverReferral = (payload) =>
  api.patch("/drivers/onboarding/referral", payload);

export const saveDriverVehicle = (payload) =>
  api.patch("/drivers/onboarding/vehicle", payload);

export const saveDriverDocuments = (payload) =>
  api.patch("/drivers/onboarding/documents", payload);

export const completeDriverOnboarding = (payload) =>
  api.post("/drivers/onboarding/complete", payload);

const decodeBase64Url = (value) => {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return normalized + "=".repeat(padding);
};

const getTokenPayload = (token) => {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    const payload = token.split(".")[1];
    if (!payload) {
      return null;
    }
    return JSON.parse(atob(decodeBase64Url(payload)));
  } catch {
    return null;
  }
};

const readLocalDriverToken = () => {
  const direct = readSessionValue("driverToken");
  if (["driver", "owner", "bus_driver", "service_center", "service_center_staff"].includes(getTokenPayload(direct)?.role)) {
    return direct;
  }

  const fallback = readSessionValue("token");
  if (["driver", "owner", "bus_driver", "service_center", "service_center_staff"].includes(getTokenPayload(fallback)?.role)) {
    return fallback;
  }

  const persistedDriverToken = String(localStorage.getItem("driverToken") || "");
  if (["driver", "owner", "bus_driver", "service_center", "service_center_staff"].includes(getTokenPayload(persistedDriverToken)?.role)) {
    return persistedDriverToken;
  }

  const persistedGenericToken = String(localStorage.getItem("token") || "");
  if (["driver", "owner", "bus_driver", "service_center", "service_center_staff"].includes(getTokenPayload(persistedGenericToken)?.role)) {
    return persistedGenericToken;
  }

  return "";
};

export const getLocalDriverToken = readLocalDriverToken;

export const getAuthenticatedDriverRole = () => {
  const tokenPayloadRole = normalizeDriverPortalRole(getTokenPayload(readLocalDriverToken())?.role);
  const storedRole = normalizeDriverPortalRole(getStoredDriverRole());

  return tokenPayloadRole || storedRole || "driver";
};

const withDriverAuth = (config = {}) => {
  const token = readLocalDriverToken();

  if (!token) {
    return config;
  }

  return {
    ...config,
    headers: {
      ...(config.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  };
};

export const getCurrentDriver = () => api.get("/drivers/me", withDriverAuth());

export const getDriverRideHistory = (params = {}) =>
  api.get("/rides", withDriverAuth({ params }));

export const updateDriverProfile = (payload) =>
  api.patch("/drivers/me", payload, withDriverAuth());
export const deleteCurrentDriverAccount = () =>
  api.delete("/drivers/me", withDriverAuth());
export const requestDriverAccountDeletion = (reason) =>
  api.post("/drivers/me/delete-request", { reason }, withDriverAuth());
export const getDriverNotifications = (params = {}) =>
  api.get("/drivers/notifications", withDriverAuth({ params }));
export const getDriverScheduledRides = (params = {}) =>
  api.get("/drivers/scheduled-rides", withDriverAuth({ params }));
export const cancelDriverScheduledRide = (rideId) =>
  api.post(`/drivers/scheduled-rides/${rideId}/cancel`, {}, withDriverAuth());
export const deleteDriverNotification = (id) =>
  api.delete(`/drivers/notifications/${id}`, withDriverAuth());
export const clearAllDriverNotifications = () =>
  api.delete("/drivers/notifications", withDriverAuth());
export const getDriverEmergencyContacts = () =>
  api.get("/drivers/emergency-contacts", withDriverAuth());

export const saveDriverFcmToken = (token, platform) =>
  api.post(
    (String(platform || "web").trim().toLowerCase() === "mobile" ||
      String(platform || "web").trim().toLowerCase() === "android" ||
      String(platform || "web").trim().toLowerCase() === "ios")
      ? `${BACKEND_ORIGIN}/api/v1/fcm-tokens/mobile/save`
      : `${BACKEND_ORIGIN}/api/v1/fcm-tokens/save`,
    (String(platform || "web").trim().toLowerCase() === "mobile" ||
      String(platform || "web").trim().toLowerCase() === "android" ||
      String(platform || "web").trim().toLowerCase() === "ios")
      ? { token }
      : { token, platform: "web" },
    withDriverAuth(),
  );
export const addDriverEmergencyContact = (payload) =>
  api.post("/drivers/emergency-contacts", payload, withDriverAuth());
export const deleteDriverEmergencyContact = (contactId) =>
  api.delete(`/drivers/emergency-contacts/${contactId}`, withDriverAuth());

export const updateDriverVehicle = (payload) =>
  api.patch("/drivers/vehicle", payload, withDriverAuth());

export const deleteDriverVehicle = (vehicleId) =>
  api.delete(`/drivers/vehicle/${vehicleId}`, withDriverAuth());

export const getDriverVehicleTypes = async () => {
  const authConfig = withDriverAuth();
  const hasDriverAuthorization = Boolean(
    authConfig?.headers?.Authorization || authConfig?.headers?.authorization,
  );

  if (hasDriverAuthorization) {
    try {
      return await api.get("/admin/types/vehicle-types", authConfig);
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if (status && status !== 401 && status !== 403) {
        throw error;
      }
    }
  }

  return api.get("/users/vehicle-types");
};

export const getDriverApprovalStatus = () => {
  return api.get(
    "/drivers/approval-status",
    withDriverAuth({
      params: {
        t: Date.now(),
      },
    }),
  );
};

export const getOwnerFleetDrivers = () =>
  api.get("/drivers/fleet/drivers", withDriverAuth());

export const getOwnerFleetDashboard = () =>
  api.get("/drivers/fleet/dashboard", withDriverAuth());

export const createOwnerFleetDriver = (payload) =>
  api.post("/drivers/fleet/drivers", payload, withDriverAuth());

export const updateOwnerFleetDriver = (driverId, payload) =>
  api.patch(`/drivers/fleet/drivers/${driverId}`, payload, withDriverAuth());

export const getOwnerFleetVehicles = () =>
  api.get("/drivers/fleet/vehicles", withDriverAuth());

export const getOwnerBusServices = () =>
  api.get("/drivers/fleet/bus-services", withDriverAuth());

export const getOwnerBusBookings = (params = {}) =>
  api.get("/drivers/fleet/bus-bookings", withDriverAuth({ params }));

export const getOwnerBusBookingCalendar = (params = {}) =>
  api.get("/drivers/fleet/bus-bookings/calendar", withDriverAuth({ params }));

export const cancelOwnerBusBookingSeats = (bookingId, payload = {}) =>
  api.post(`/drivers/fleet/bus-bookings/${bookingId}/cancel`, payload, withDriverAuth());

export const createOwnerBusService = (payload) =>
  api.post("/drivers/fleet/bus-services", payload, withDriverAuth());

export const updateOwnerBusService = (busId, payload) =>
  api.patch(`/drivers/fleet/bus-services/${busId}`, payload, withDriverAuth());

export const deleteOwnerBusService = (busId) =>
  api.delete(`/drivers/fleet/bus-services/${busId}`, withDriverAuth());

export const createOwnerFleetVehicle = (payload) =>
  api.post("/drivers/fleet/vehicles", payload, withDriverAuth());

export const updateOwnerFleetVehicle = (vehicleId, payload) =>
  api.patch(`/drivers/fleet/vehicles/${vehicleId}`, payload, withDriverAuth());

export const deleteOwnerFleetVehicle = (vehicleId) =>
  api.delete(`/drivers/fleet/vehicles/${vehicleId}`, withDriverAuth());

export const getServiceCenterVehicles = () =>
  api.get("/drivers/service-center/vehicles", withDriverAuth());

export const createServiceCenterVehicle = (payload) =>
  api.post("/drivers/service-center/vehicles", payload, withDriverAuth());

export const updateServiceCenterVehicle = (vehicleId, payload) =>
  api.patch(`/drivers/service-center/vehicles/${vehicleId}`, payload, withDriverAuth());

export const deleteServiceCenterVehicle = (vehicleId) =>
  api.delete(`/drivers/service-center/vehicles/${vehicleId}`, withDriverAuth());

export const getServiceCenterStaff = () =>
  api.get("/drivers/service-center/staff", withDriverAuth());

export const createServiceCenterStaff = (payload) =>
  api.post("/drivers/service-center/staff", payload, withDriverAuth());

export const updateServiceCenterStaff = (staffId, payload) =>
  api.patch(`/drivers/service-center/staff/${staffId}`, payload, withDriverAuth());

export const deleteServiceCenterStaff = (staffId) =>
  api.delete(`/drivers/service-center/staff/${staffId}`, withDriverAuth());

export const getServiceCenterStaffBiometrics = (staffId) =>
  api.get(`/drivers/service-center/staff/${staffId}/biometrics`, withDriverAuth());

export const enrollServiceCenterStaffBiometric = (payload) =>
  api.post("/drivers/service-center/staff/biometrics/enroll", payload, withDriverAuth());

export const getServiceCenterBookings = () =>
  api.get("/drivers/service-center/bookings", withDriverAuth());

export const getServiceCenterBookingBiometrics = (bookingId) =>
  api.get(`/drivers/service-center/bookings/${bookingId}/biometrics`, withDriverAuth());

export const updateServiceCenterBookingBiometrics = (bookingId, payload) =>
  api.patch(`/drivers/service-center/bookings/${bookingId}/biometrics`, payload, withDriverAuth());

export const captureServiceCenterBookingFingerprint = (bookingId, payload) =>
  api.post(`/drivers/service-center/bookings/${bookingId}/biometrics/fingers`, payload, withDriverAuth());

export const deleteServiceCenterBookingFingerprint = (bookingId, fingerCode) =>
  api.delete(`/drivers/service-center/bookings/${bookingId}/biometrics/fingers/${encodeURIComponent(String(fingerCode || '').trim().toUpperCase())}`, withDriverAuth());

export const verifyServiceCenterBookingFingerprint = (bookingId, payload) =>
  api.post(`/drivers/service-center/bookings/${bookingId}/biometrics/verify`, payload, withDriverAuth());

export const updateServiceCenterBooking = (bookingId, payload) =>
  api.patch(`/drivers/service-center/bookings/${bookingId}`, payload, withDriverAuth());

export const getDriverRegistrationSession = ({ registrationId, phone }) =>
  api.get(`/drivers/onboarding/session/${registrationId}`, {
    params: { phone },
  });

export const getDriverServiceLocations = () =>
  api.get("/drivers/service-locations");
export const getDriverDocumentTemplates = (role = "driver") =>
  api.get("/drivers/document-templates", {
    params: {
      role,
    },
  });

export const getDriverVehicleFieldTemplates = (role = "driver") =>
  api.get("/drivers/vehicle-field-templates", {
    params: {
      role,
    },
  });

export const updateDriverDocument = (documentKey, document) =>
  api.patch(
    `/drivers/documents/${encodeURIComponent(documentKey)}`,
    { document },
    withDriverAuth(),
  );

export const getDriverIncentives = () =>
  api.get("/drivers/incentives", withDriverAuth());

export const claimDriverIncentiveReward = (payload) =>
  api.post("/drivers/incentives/claim", payload, withDriverAuth());
