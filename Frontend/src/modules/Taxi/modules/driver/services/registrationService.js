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
  if (getTokenPayload(direct)?.role === "driver") {
    return direct;
  }

  const fallback = readSessionValue("token");
  if (getTokenPayload(fallback)?.role === "driver") {
    return fallback;
  }

  const persistedDriverToken = String(localStorage.getItem("driverToken") || "");
  if (getTokenPayload(persistedDriverToken)?.role === "driver") {
    return persistedDriverToken;
  }

  const persistedGenericToken = String(localStorage.getItem("token") || "");
  if (getTokenPayload(persistedGenericToken)?.role === "driver") {
    return persistedGenericToken;
  }

  return "";
};

export const getLocalDriverToken = readLocalDriverToken;

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
