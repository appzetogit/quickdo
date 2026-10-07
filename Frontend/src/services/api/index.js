/**
 * API layer - auth connected to new backend; rest stubbed for UI compatibility.
 */

import apiClient from "./axios.js";
import { API_ENDPOINTS } from "./config.js";
import * as authService from "./auth.js";

const stub = () =>
  Promise.resolve({
    data: { success: false, message: "Backend not connected", data: null },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {},
  });

/** Search API - unified search for user app */
export const searchAPI = {
  unifiedSearch: (params = {}) =>
    apiClient.get("/food/search/unified", { params }),
  getAdminCategories: (params = {}) =>
    apiClient.get("/food/search/categories/admin", { params }),
};

const createStubAPI = () =>
  new Proxy(
    {},
    {
      get(_, prop) {
        return () => stub();
      },
    },
  );

export default apiClient;
export { API_ENDPOINTS };

// Stub for non-auth endpoints so we don't hit backend for unimplemented routes (avoids 404s and extra calls).
// Auth is done via authAPI/authService which use apiClient directly.
const emptyDataStub = () =>
  Promise.resolve({
    data: { success: false, data: null },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {},
  });

export const api = {
  get: (_url, _config) => emptyDataStub(),
  post: (_url, _data, _config) => emptyDataStub(),
  put: (_url, _data, _config) => emptyDataStub(),
  patch: (_url, _data, _config) => emptyDataStub(),
  delete: (_url, _config) => emptyDataStub(),
};

/** Single in-flight + short cache for user /auth/me - avoids duplicate calls. */
let userMeInFlight = null;
let userMeCached = null;
let userMeCacheTime = 0;
const USER_ME_CACHE_MS = 3000;

const getUserMeOnce = () => {
  const now = Date.now();
  if (userMeCached && now - userMeCacheTime < USER_ME_CACHE_MS) {
    return Promise.resolve(userMeCached);
  }
  if (!userMeInFlight) {
    userMeInFlight = authService
      .getMe("user")
      .then((res) => {
        userMeCached = res;
        userMeCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        userMeInFlight = null;
      });
  }
  return userMeInFlight;
};

/** Auth API - user OTP + admin login via new backend */
export const authAPI = {
  sendUnifiedOTP: (phone) => authService.requestUnifiedOtp(phone),
  verifyUnifiedOTP: (phone, otp, ref, name, fcmToken, platform) => authService.verifyUnifiedOtp(phone, otp, ref, name, fcmToken, platform),
  saveLoginFcmToken: (token, platform = "web") =>
    authService.saveLoginFcmToken(token, platform),

  sendOTP: (phone, _purpose = "login", _email = null) => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestUserOtp(phone);
  },
  verifyOTP: (
    phone,
    otp,
    _purpose,
    _name,
    _email,
    _role,
    _password,
    _referralCode,
    fcmToken = null,
    platform = "web",
  ) => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifyUserOtp(
      phone,
      otp,
      _referralCode,
      _name,
      fcmToken,
      platform,
    );
  },
  getCurrentUser: () => getUserMeOnce(),
  refreshToken: (token) => authService.refreshToken(token),
  logout: (refreshToken, fcmToken = null, platform = "web") => {
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("user_refreshToken")
        : null);
    return authService.logout(token, fcmToken, platform);
  },
};

export const supportAPI = {
  createTicket: (body) =>
    apiClient.post("/food/user/support/ticket", body ?? {}, {
      contextModule: "user",
    }),
  getMyTickets: (params = {}) =>
    apiClient.get("/food/user/support/my-tickets", {
      params,
      contextModule: "user",
    }),
  getSupportTicketsAdmin: (params = {}) =>
    apiClient.get("/food/admin/support-tickets", {
      params,
      contextModule: "admin",
    }),
  updateSupportTicketAdmin: (id, body = {}) =>
    apiClient.patch(`/food/admin/support-tickets/${String(id)}`, body ?? {}, {
      contextModule: "admin",
    }),
};

export const notificationAPI = {
  getInbox: (params = {}, config = {}) =>
    apiClient.get("/food/notifications/inbox", {
      params,
      ...config,
    }),
  markAsRead: (id, config = {}) =>
    apiClient.patch(`/food/notifications/${String(id)}/read`, {}, config),
  dismiss: (id, config = {}) =>
    apiClient.delete(`/food/notifications/${String(id)}`, config),
  dismissAll: (config = {}) =>
    apiClient.delete("/food/notifications/inbox/all", config),
};

/** Admin API - new backend only (GET /auth/me, PATCH /auth/admin/profile, POST /auth/admin/change-password) */
/**
 * Master / Global settings.
 *
 * Under /platform, NOT /food -- which matters for more than tidiness. The axios
 * layer rewrites the whole /food namespace to /qc when the operator is looking at
 * the quick-commerce panel, because those screens are the same components against a
 * forked route table. Master settings are the opposite case: one value, the same
 * from every panel. Living outside /food is what keeps them that way, with no
 * exception needed in the rewrite.
 */
export const platformSettingsAPI = {
  /** One module's zones for the Master zone pickers: [{ id, name, active }]. */
  zones: (module) =>
    apiClient.get(`/platform/settings/zones/${encodeURIComponent(module)}`, { contextModule: "admin" }),
  getCatalogue: () =>
    apiClient.get("/platform/settings/catalogue", { contextModule: "admin" }),
  /** Every setting resolved for one context. `{ vertical, zoneId, partnerId }` */
  resolveAll: (context = {}) =>
    apiClient.get("/platform/settings/resolve", { params: context, contextModule: "admin" }),
  /** One setting: effective value plus the whole override chain beneath it. */
  explain: (key, context = {}) =>
    apiClient.get(`/platform/settings/${encodeURIComponent(key)}/explain`, {
      params: context,
      contextModule: "admin",
    }),
  /** `value: null` clears the override at that level rather than storing a null. */
  set: (key, { level, scopeId, value, reason } = {}) =>
    apiClient.put(
      `/platform/settings/${encodeURIComponent(key)}`,
      { level, scopeId, value, reason },
      { contextModule: "admin" },
    ),
  invalidateCache: () =>
    apiClient.post("/platform/settings/cache/invalidate", {}, { contextModule: "admin" }),
  /** Master > Referral: what each service pays now, and who set it. */
  referralOverview: () =>
    apiClient.get("/platform/settings/referral/overview", { contextModule: "admin" }),
  /** Master > Platform Fee & GST: what each service charges now, and who set it. */
  feesOverview: () =>
    apiClient.get("/platform/settings/fees/overview", { contextModule: "admin" }),
  /** Master > Cancellation Policy: the rule each service uses now, and who set it. */
  cancellationOverview: () =>
    apiClient.get("/platform/settings/cancellation/overview", { contextModule: "admin" }),
  /**
   * What a module pays its riders today, plus its own distance bands.
   *
   * The bands come back with their ids, which is what lets the Master editor
   * start from the module's current table without unhooking the per-band admin
   * delivery commission that is keyed by them.
   */
  getEarnings: (vertical, context = {}) =>
    apiClient.get(`/platform/settings/earnings/${encodeURIComponent(vertical)}`, {
      params: context,
      contextModule: "admin",
    }),
  /**
   * Every customer on the platform, in one list.
   *
   * Food and taxi customers are already the same documents; quick commerce and
   * services are matched in by link or by phone. Read only -- blocking and
   * editing stay on the screens whose schema owns those fields.
   */
  /** Master > Orders: every order, per tab (all | food | quick | taxi). */
  getMasterOrders: (params = {}) =>
    apiClient.get("/platform/settings/orders", { params, contextModule: "admin" }),
  /** Delete one order from Master > All Orders (source: food | quick | taxi). */
  deleteMasterOrder: (source, id) =>
    apiClient.delete(`/platform/settings/orders/${source}/${id}`, { contextModule: "admin" }),
  getGlobalUsers: (params = {}) =>
    apiClient.get("/platform/settings/users", { params, contextModule: "admin" }),
  /** Block or unblock a customer in every app at once. */
  setGlobalUserBlocked: (id, blocked) =>
    apiClient.patch(`/platform/settings/users/${id}/status`, { blocked: Boolean(blocked) }, { contextModule: "admin" }),
  /** The same list as a CSV file. Streamed by the server, so kept as a blob. */
  exportGlobalUsers: (params = {}) =>
    apiClient.get("/platform/settings/users/export", {
      params,
      responseType: "blob",
      contextModule: "admin",
    }),
  /** Terms and privacy per app. */
  getAppLegal: () => apiClient.get("/platform/settings/app-legal", { contextModule: "admin" }),
  /** Empty `content` clears the app's page. */
  saveAppLegal: (app, kind, { title, content }) =>
    apiClient.put(`/platform/settings/app-legal/${app}/${kind}`, { title, content }, { contextModule: "admin" }),
  /** Master settings: brand, contact, legal pages, integrations. Secrets come back masked. */
  getProfile: () => apiClient.get("/platform/settings/profile", { contextModule: "admin" }),
  /** Partial save. A masked or empty secret is left unchanged; `null` clears a field. */
  updateProfile: (payload) => apiClient.patch("/platform/settings/profile", payload, { contextModule: "admin" }),
  /** Connection checks; nothing is saved. `kind` is razorpay | email | sms. */
  testIntegration: (kind, payload) =>
    apiClient.post(`/platform/settings/profile/test/${kind}`, payload, { contextModule: "admin" }),
};

/**
 * Which services the customer app shows, everywhere or per zone. Platform-level
 * like the master settings above, so it lives outside /food and is not rewritten
 * per panel.
 */
export const appServicesAPI = {
  getAdminView: () =>
    apiClient.get("/platform/app-services/admin", { contextModule: "admin" }),
  setService: (service, enabled) =>
    apiClient.put(
      `/platform/app-services/admin/${encodeURIComponent(service)}`,
      { enabled: Boolean(enabled) },
      { contextModule: "admin" },
    ),
  setZone: (service, zoneId, enabled) =>
    apiClient.put(
      `/platform/app-services/admin/${encodeURIComponent(service)}/zones/${encodeURIComponent(zoneId)}`,
      { enabled: Boolean(enabled) },
      { contextModule: "admin" },
    ),
};

/**
 * Admin accounts for every panel (food, quick commerce, taxi). Platform
 * level, so the same list and the same permissions whichever panel it is opened
 * from.
 */
/**
 * Stock per product variant, per store (quick commerce). `scope`
 * picks the admin API (any store) or the store's own. Both are written with
 * /food/ and rewritten to /qc/ by the axios layer for these panels.
 */
const stockBase = (scope) => (scope === "restaurant" ? "/food/restaurant/stock" : "/food/admin/stock")
const stockCtx = (scope) => ({ contextModule: scope === "restaurant" ? "restaurant" : "admin" })
export const stockAPI = {
  list: (scope, params) => apiClient.get(stockBase(scope), { params, ...stockCtx(scope) }),
  adjust: (scope, data) => apiClient.patch(stockBase(scope), data, stockCtx(scope)),
  bulk: (scope, data) => apiClient.post(`${stockBase(scope)}/bulk`, data, stockCtx(scope)),
  history: (scope, params) => apiClient.get(`${stockBase(scope)}/history`, { params, ...stockCtx(scope) }),
};

/**
 * Master > Delivery Incentives: an order-count ladder per duty segment
 * (foodAndQuick / taxiAndPorter — the same split the rider app's
 * DutySegment uses) — e.g. 1-5 orders → ₹100, 5-10 → ₹150, 10-15 → ₹200,
 * each tier paid independently as the rider reaches it. Lives under
 * /food/admin because the Master panel's own pages (/admin/master/*) are
 * never subject to the /food→/qc rewrite below — see rewriteAdminVertical in
 * axios.js — so this is safe to call from here exactly as written, unlike a
 * per-vertical admin screen would be.
 */
export const incentiveRulesAPI = {
  // Under /platform/settings so zone sub-admins can use it from Master too;
  // the server limits them to their own zones.
  list: () => apiClient.get("/platform/settings/incentive-rules", { contextModule: "admin" }),
  /** tiers: [{ fromOrders, toOrders, rewardAmount }, ...], e.g. 1-5 → ₹100, 5-10 → ₹150. */
  /** zoneId empty = the default ladder; set = that zone's own ladder. */
  upsert: ({ segment, title, tiers, zoneId = null, zoneName = "" }) =>
    apiClient.put(
      "/platform/settings/incentive-rules",
      { segment, title, tiers, zoneId, zoneName },
      { contextModule: "admin" },
    ),
  deactivate: (id) =>
    apiClient.delete(`/platform/settings/incentive-rules/${encodeURIComponent(id)}`, { contextModule: "admin" }),
  /** Removes the ladder from the list for good; credits already paid stay. */
  remove: (id) =>
    apiClient.delete(`/platform/settings/incentive-rules/${encodeURIComponent(id)}?permanent=1`, { contextModule: "admin" }),
};

export const adminAccountsAPI = {
  me: () => apiClient.get("/platform/admins/me", { contextModule: "admin" }),
  meta: () => apiClient.get("/platform/admins/meta", { contextModule: "admin" }),
  list: (params) => apiClient.get("/platform/admins", { params, contextModule: "admin" }),
  get: (id) => apiClient.get(`/platform/admins/${encodeURIComponent(id)}`, { contextModule: "admin" }),
  create: (data) => apiClient.post("/platform/admins", data, { contextModule: "admin" }),
  update: (id, data) =>
    apiClient.patch(`/platform/admins/${encodeURIComponent(id)}`, data, { contextModule: "admin" }),
  setStatus: (id, isActive) =>
    apiClient.patch(`/platform/admins/${encodeURIComponent(id)}/status`, { isActive }, { contextModule: "admin" }),
  remove: (id) => apiClient.delete(`/platform/admins/${encodeURIComponent(id)}`, { contextModule: "admin" }),
};

// Master > Commission Overview: what the platform takes, per partner (core/finance).
export const commissionOverviewAPI = {
  get: () => apiClient.get("/platform/commission", { contextModule: "admin" }),
};

// Master > Home Screen Banners: every picture on the app's home screens (core/cms).
// The path avoids the word "banner", which ad blockers abort requests on.
export const homeContentAPI = {
  list: () => apiClient.get("/platform/home-content", { contextModule: "admin" }),
  setLive: (group, id, live) =>
    apiClient.patch(`/platform/home-content/${encodeURIComponent(group)}/${encodeURIComponent(id)}/live`, { live }, { contextModule: "admin" }),
  uploadQuickTop: (formData) =>
    apiClient.post("/platform/home-content/quickTop", formData, { contextModule: "admin" }),
  removeQuickTop: (id) =>
    apiClient.delete(`/platform/home-content/quickTop/${encodeURIComponent(id)}`, { contextModule: "admin" }),
};

// Master > Platform Earnings: what the platform kept, per service (core/finance/platformPnl).
export const platformPnlAPI = {
  get: (params) => apiClient.get("/platform/pnl", { params, contextModule: "admin" }),
};

// Master > Coupons: every service's coupons in one list (core/promotions).
export const couponListAPI = {
  list: (params) => apiClient.get("/platform/coupons", { params, contextModule: "admin" }),
  setLive: (source, id, live) =>
    apiClient.patch(`/platform/coupons/${encodeURIComponent(source)}/${encodeURIComponent(id)}/live`, { live }, { contextModule: "admin" }),
};

// Master > Help & Support: every service's tickets in one inbox (core/support).
export const supportInboxAPI = {
  list: (params) => apiClient.get("/platform/support/tickets", { params, contextModule: "admin" }),
  stats: () => apiClient.get("/platform/support/stats", { contextModule: "admin" }),
  get: (source, id) =>
    apiClient.get(`/platform/support/tickets/${encodeURIComponent(source)}/${encodeURIComponent(id)}`, { contextModule: "admin" }),
  update: (source, id, data) =>
    apiClient.patch(`/platform/support/tickets/${encodeURIComponent(source)}/${encodeURIComponent(id)}`, data, { contextModule: "admin" }),
};

/** Admin orders base for a vertical: Food on /food/admin, Quick on /qc/admin. */
const adminOrdersBase = (vertical) =>
  vertical === "quickCommerce" || vertical === "quick"
    ? "/qc/admin/orders"
    : "/food/admin/orders";

export const adminAPI = {
  getFoodAssignableZones: () =>
    apiClient.get("/food/admin/admin-management/assignable-zones", { contextModule: "admin" }),
  getFoodPermissions: () =>
    apiClient.get("/food/admin/admin-management/permissions", { contextModule: "admin" }),
  getFoodAdmins: (params) =>
    apiClient.get("/food/admin/admin-management/admins", { params, contextModule: "admin" }),
  getFoodAdminById: (id) =>
    apiClient.get(`/food/admin/admin-management/admins/${id}`, { contextModule: "admin" }),
  createFoodAdminAccount: (data) =>
    apiClient.post("/food/admin/admin-management/admins", data, { contextModule: "admin" }),
  updateFoodAdminAccount: (id, data) =>
    apiClient.patch(`/food/admin/admin-management/admins/${id}`, data, { contextModule: "admin" }),
  deleteFoodAdminAccount: (id) =>
    apiClient.delete(`/food/admin/admin-management/admins/${id}`, { contextModule: "admin" }),
  getSidebarBadges: () =>
    apiClient.get("/food/admin/sidebar-badges", { contextModule: "admin" }),
  login: (email, password) => authService.adminLogin(email, password),
  /** POST /auth/admin/forgot-password/request-otp – only accepts registered admin email */
  requestForgotPasswordOtp: (email) =>
    apiClient.post("/auth/admin/forgot-password/request-otp", {
      email: String(email || "")
        .trim()
        .toLowerCase(),
    }),
  /** POST /auth/admin/forgot-password/reset – verify OTP and set new password in one call */
  resetPasswordWithOtp: (email, otp, newPassword) =>
    apiClient.post("/auth/admin/forgot-password/reset", {
      email: String(email || "")
        .trim()
        .toLowerCase(),
      otp: String(otp || "").replace(/\D/g, ""),
      newPassword: String(newPassword || ""),
    }),
  /** Raw /auth/me for admin (e.g. navbar). For Profile & Settings use getAdminProfile. */
  getCurrentAdmin: () => authService.getMe("admin"),
  /** Single API for admin profile: GET /auth/me, returns { data: { admin } }. Use on Profile & Settings only. */
  getAdminProfile: () =>
    authService.getMe("admin").then((res) => {
      const user =
        res?.data?.data?.user ??
        res?.data?.user ??
        res?.data?.data ??
        res?.data;
      return { data: { data: { admin: user }, admin: user } };
    }),
  /** PATCH /auth/admin/profile. Body: name?, phone?, profileImage? */
  updateAdminProfile: (body) =>
    apiClient.patch("/auth/admin/profile", body ?? {}, {
      contextModule: "admin",
    }),
  /** POST /auth/admin/change-password */
  changePassword: (currentPassword, newPassword) =>
    apiClient.post(
      "/auth/admin/change-password",
      { currentPassword, newPassword },
      { contextModule: "admin" },
    ),
  logout: (refreshToken) => {
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("admin_refreshToken")
        : null);
    const fcmToken = typeof localStorage !== "undefined" ? localStorage.getItem("fcm_web_registered_token_admin") : null;
    return authService.logout(token, fcmToken, "web");
  },
  // Restaurant approvals and join requests
  getPendingRestaurants: () =>
    apiClient.get("/food/admin/restaurants/pending", {
      contextModule: "admin",
    }),
  /** List restaurant complaints (admin). */
  getRestaurantComplaints: (params = {}) =>
    apiClient.get("/food/admin/restaurants/complaints", {
      params,
      contextModule: "admin",
    }),
  updateRestaurantComplaint: (id, body) =>
    apiClient.patch(`/food/admin/restaurants/complaints/${id}`, body, {
      contextModule: "admin",
    }),
  /** Global universal search (admin). */
  globalSearch: (query) =>
    apiClient.get("/food/admin/global-search", {
      params: { query },
      contextModule: "admin",
    }),
  approveRestaurant: (id) =>
    apiClient.patch(
      `/food/admin/restaurants/${id}/approve`,
      {},
      {
        contextModule: "admin",
      },
    ),
  rejectRestaurant: (id, reason) =>
    apiClient.patch(
      `/food/admin/restaurants/${id}/reject`,
      { reason },
      { contextModule: "admin" },
    ),
  /** Delivery partner join requests - uses /food/admin/delivery/* (new backend API) */
  getDeliveryPartnerJoinRequests: (params) =>
    apiClient.get("/food/admin/delivery/join-requests", {
      params,
      contextModule: "admin",
    }),
  /** List approved delivery partners (Deliveryman List page) */
  getDeliveryPartners: (params) =>
    apiClient.get("/food/admin/delivery/partners", {
      params,
      contextModule: "admin",
    }),
  getDeliverymanReviews: (params = {}) =>
    apiClient.get("/food/admin/delivery/reviews", {
      params,
      contextModule: "admin",
    }),
  getContactMessages: (params = {}) =>
    apiClient.get("/food/admin/contact-messages", {
      params,
      contextModule: "admin",
    }),
  /** Dashboard summary stats (admin home) */
  getDashboardStats: (params = {}) =>
    apiClient.get("/food/admin/dashboard-stats", {
      params,
      contextModule: "admin",
    }),
  /** List restaurant withdrawal requests (admin). */
  getWithdrawals: (params = {}) =>
    apiClient.get("/food/admin/withdrawals", {
      params,
      contextModule: "admin",
    }),
  /** Update status of a withdrawal request. */
  updateWithdrawalStatus: (id, body) =>
    apiClient.patch(`/food/admin/withdrawals/${id}`, body, {
      contextModule: "admin",
    }),
  /** List delivery withdrawal requests (admin). */
  getDeliveryWithdrawals: (params = {}) =>
    apiClient.get("/food/admin/delivery/withdrawals", {
      params,
      contextModule: "admin",
    }),
  /** Update status of a delivery withdrawal request. */
  updateDeliveryWithdrawalStatus: (id, body) =>
    apiClient.patch(`/food/admin/delivery/withdrawals/${id}`, body, {
      contextModule: "admin",
    }),
  /** Delivery withdrawal aliases */
  getDeliveryWithdrawalRequests: (params) => adminAPI.getDeliveryWithdrawals(params),
  approveDeliveryWithdrawal: (id) => adminAPI.updateDeliveryWithdrawalStatus(id, { status: "approved" }),
  rejectDeliveryWithdrawal: (id, reason) => adminAPI.updateDeliveryWithdrawalStatus(id, { status: "rejected", rejectionReason: reason }),
  // Aliases for RestaurantWithdraws page
  getWithdrawalRequests: (params) => adminAPI.getWithdrawals(params),
  approveWithdrawalRequest: (id) => adminAPI.updateWithdrawalStatus(id, { status: "approved" }),
  rejectWithdrawalRequest: (id, reason) => adminAPI.updateWithdrawalStatus(id, { status: "rejected", rejectionReason: reason }),
  /** Delivery boy wallets (stub until backend implements - returns empty so list still loads) */
  getDeliveryBoyWallets: (params) =>
    apiClient.get("/food/admin/delivery/wallets", {
      params,
      contextModule: "admin",
    }),
  getDeliveryPartnerById: (id) =>
    apiClient.get(`/food/admin/delivery/${id}`, { contextModule: "admin" }),
  /** serviceCapabilities: any of "delivery" | "quickCommerce" | "taxi". Omitted = food only. */
  approveDeliveryPartner: (id, { serviceCapabilities } = {}) =>
    apiClient.patch(
      `/food/admin/delivery/${String(id)}/approve`,
      serviceCapabilities ? { serviceCapabilities } : {},
      {
        contextModule: "admin",
      },
    ),
  /** Deletes the rider permanently; answers 409 with the amounts when money is on the account (then force). */
  deleteDeliveryPartner: (id, { force = false } = {}) =>
    apiClient.delete(`/food/admin/delivery/partners/${String(id)}`, {
      params: force ? { force: 1 } : undefined,
      contextModule: "admin",
    }),
  updateDeliveryPartnerCapabilities: (id, serviceCapabilities) =>
    apiClient.patch(
      `/food/admin/delivery/${String(id)}/capabilities`,
      { serviceCapabilities },
      {
        contextModule: "admin",
      },
    ),
  rejectDeliveryPartner: (id, reason) =>
    apiClient.patch(
      `/food/admin/delivery/${String(id)}/reject`,
      { reason: String(reason || "").trim() },
      {
        contextModule: "admin",
      },
    ),
  /** GET /food/admin/delivery/support-tickets - list all delivery support tickets (query: status, priority, search, page, limit). */
  getDeliverySupportTickets: (params) =>
    apiClient.get("/food/admin/delivery/support-tickets", {
      params,
      contextModule: "admin",
    }),
  getExpiredFssaiNotifications: (params = {}) =>
    apiClient.get("/food/admin/notifications/fssai-expired", {
      params,
      contextModule: "admin",
    }),
  /** GET /food/admin/delivery/support-tickets/stats - counts by status. */
  getDeliverySupportTicketStats: () =>
    apiClient.get("/food/admin/delivery/support-tickets/stats", {
      contextModule: "admin",
    }),
  /** PATCH /food/admin/delivery/support-tickets/:id - update adminResponse, status. */
  updateDeliverySupportTicket: (id, body) =>
    apiClient.patch(`/food/admin/delivery/support-tickets/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  createBroadcastNotification: (body = {}) =>
    apiClient.post("/food/admin/notifications/broadcast", body ?? {}, {
      contextModule: "admin",
    }),
  getBroadcastNotifications: (params = {}) =>
    apiClient.get("/food/admin/notifications/broadcast", {
      params,
      contextModule: "admin",
    }),
  deleteBroadcastNotification: (id) =>
    apiClient.delete(`/food/admin/notifications/broadcast/${String(id)}`, {
      contextModule: "admin",
    }),
  /** List restaurants for admin. Requires admin auth. */
  getRestaurants: (params = {}, config = {}) =>
    apiClient.get("/food/admin/restaurants", {
      params: { limit: 1000, ...params },
      contextModule: "admin",
      ...config,
    }),
  getRestaurantReviews: (params = {}) =>
    apiClient.get("/food/admin/restaurants/reviews", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  /** Categories (admin) */
  getCategories: (params = {}) =>
    apiClient.get("/food/admin/categories", { params, contextModule: "admin" }),
  createCategory: (body) =>
    apiClient.post("/food/admin/categories", body ?? {}, {
      contextModule: "admin",
    }),
  updateCategory: (id, body) =>
    apiClient.patch(`/food/admin/categories/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  deleteCategory: (id) =>
    apiClient.delete(`/food/admin/categories/${id}`, {
      contextModule: "admin",
    }),
  approveCategory: (id) =>
    apiClient.patch(
      `/food/admin/categories/${String(id)}/approve`,
      {},
      { contextModule: "admin" },
    ),
  rejectCategory: (id, reason) =>
    apiClient.patch(
      `/food/admin/categories/${String(id)}/reject`,
      { reason: String(reason || "").trim() },
      { contextModule: "admin" },
    ),
  makeCategoryGlobal: (id) =>
    apiClient.patch(
      `/food/admin/categories/${String(id)}/make-global`,
      {},
      { contextModule: "admin" },
    ),
  toggleCategoryStatus: (id) =>
    apiClient.patch(
      `/food/admin/categories/${id}/toggle`,
      {},
      { contextModule: "admin" },
    ),
  /** Get single restaurant by id (full details for View Details modal). */
  getRestaurantById: (id) =>
    apiClient.get(`/food/admin/restaurants/${id}`, { contextModule: "admin" }),
  /** Get restaurant analytics for POS. */
  getRestaurantAnalytics: (id) =>
    apiClient.get(`/food/admin/restaurants/${id}/insights`, {
      contextModule: "admin",
    }),
  /** Update restaurant basic details (admin). */
  updateRestaurant: (id, body) =>
    apiClient.patch(`/food/admin/restaurants/${String(id)}`, body ?? {}, {
      contextModule: "admin",
    }),
  /** Update restaurant status (admin). Body: { status: boolean } */
  updateRestaurantStatus: (id, status) =>
    apiClient.patch(
      `/food/admin/restaurants/${String(id)}/status`,
      { status: status !== false },
      { contextModule: "admin" },
    ),
  /** Update restaurant location (admin). Body includes lat/lng + address fields. */
  updateRestaurantLocation: (id, body) =>
    apiClient.patch(
      `/food/admin/restaurants/${String(id)}/location`,
      body ?? {},
      { contextModule: "admin" },
    ),
  /** Restaurant menu (admin) */
  getRestaurantMenuById: (id, config = {}) =>
    apiClient.get(`/food/admin/restaurants/${id}/menu`, {
      contextModule: "admin",
      ...config,
    }),
  updateRestaurantMenuById: (id, body) =>
    apiClient.patch(`/food/admin/restaurants/${id}/menu`, body ?? {}, {
      contextModule: "admin",
    }),
  /**
   * A restaurant's spend-threshold reward ladder. Same document the restaurant's
   * own panel edits, so both sides always show the offer actually being applied.
   */
  /**
   * Add-ons, for picking one as a free-item reward.
   *
   * Served from /item-extras rather than /addons: ad blockers kill any XHR whose
   * path contains "addons", which leaves the list silently empty.
   */
  getAddons: (params = {}) =>
    apiClient.get("/food/admin/item-extras", { params, contextModule: "admin" }),
  getRestaurantFreebieOffer: (id) =>
    apiClient.get(`/food/admin/restaurants/${id}/freebie-offer`, { contextModule: "admin" }),
  updateRestaurantFreebieOffer: (id, body) =>
    apiClient.put(`/food/admin/restaurants/${id}/freebie-offer`, body ?? {}, {
      contextModule: "admin",
    }),
  getLandingSettings: () =>
    apiClient.get("/food/hero-banners/landing/settings", { contextModule: "admin" }),
  updateLandingSettings: (body) =>
    apiClient.patch("/food/hero-banners/landing/settings", body ?? {}, { contextModule: "admin" }),
  getRestaurantFreeDelivery: (id) =>
    apiClient.get(`/food/admin/restaurants/${id}/free-delivery`, { contextModule: "admin" }),
  updateRestaurantFreeDelivery: (id, body) =>
    apiClient.put(`/food/admin/restaurants/${id}/free-delivery`, body ?? {}, { contextModule: "admin" }),
  /**
   * How far a restaurant delivers. The restaurant edits the same field from its
   * app and panel; both go through one service on the server, so the two sides
   * always show the radius that is actually enforced.
   */
  getServiceRadiusSettings: () =>
    apiClient.get("/food/admin/service-radius/settings", { contextModule: "admin" }),
  updateServiceRadiusSettings: (maxRadiusKm) =>
    apiClient.put("/food/admin/service-radius/settings", { maxRadiusKm }, { contextModule: "admin" }),
  getRestaurantServiceRadius: (id) =>
    apiClient.get(`/food/admin/restaurants/${id}/service-radius`, { contextModule: "admin" }),
  // `null` removes the radius, so the zone alone decides.
  updateRestaurantServiceRadius: (id, serviceRadiusKm) =>
    apiClient.put(`/food/admin/restaurants/${id}/service-radius`, { serviceRadiusKm }, { contextModule: "admin" }),
  getRestaurantBogoOffer: (id) =>
    apiClient.get(`/food/admin/restaurants/${id}/bogo-offer`, { contextModule: "admin" }),
  updateRestaurantBogoOffer: (id, body) =>
    apiClient.put(`/food/admin/restaurants/${id}/bogo-offer`, body ?? {}, {
      contextModule: "admin",
    }),
  /**
   * Combos: existing dishes grouped into one menu entry at a fixed price.
   * A combo is stored as a FoodItem, so these are dish endpoints rather than
   * offer endpoints, and what an admin saves here is live immediately.
   */
  getRestaurantCombos: (id) =>
    apiClient.get(`/food/admin/restaurants/${id}/combos`, { contextModule: "admin" }),
  createRestaurantCombo: (id, body) =>
    apiClient.post(`/food/admin/restaurants/${id}/combos`, body ?? {}, {
      contextModule: "admin",
    }),
  updateRestaurantCombo: (id, comboId, body) =>
    apiClient.put(`/food/admin/restaurants/${id}/combos/${comboId}`, body ?? {}, {
      contextModule: "admin",
    }),
  deleteRestaurantCombo: (id, comboId) =>
    apiClient.delete(`/food/admin/restaurants/${id}/combos/${comboId}`, {
      contextModule: "admin",
    }),
  /** Foods (admin) - separate collection */
  getFoods: (params = {}) =>
    apiClient.get("/food/admin/foods", { params, contextModule: "admin" }),
  createFood: (body) =>
    apiClient.post("/food/admin/foods", body ?? {}, { contextModule: "admin" }),
  updateFood: (id, body) =>
    apiClient.patch(`/food/admin/foods/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  deleteFood: (id) =>
    apiClient.delete(`/food/admin/foods/${id}`, { contextModule: "admin" }),
  /** Global menu price adjustment (admin) */
  getPriceAdjustments: (params = {}) =>
    apiClient.get("/food/admin/price-adjustments", {
      params,
      contextModule: "admin",
    }),
  /** What each menu currently carries, as opposed to what was asked for. */
  getStandingAdjustments: () =>
    apiClient.get("/food/admin/price-adjustments/standing", {
      contextModule: "admin",
    }),
  getPriceAdjustmentPreview: (params = {}) =>
    apiClient.get("/food/admin/price-adjustments/preview", {
      params,
      contextModule: "admin",
    }),
  applyPriceAdjustment: (body) =>
    apiClient.post("/food/admin/price-adjustments", body ?? {}, {
      contextModule: "admin",
    }),
  revertPriceAdjustment: (id) =>
    apiClient.post(
      `/food/admin/price-adjustments/${String(id)}/revert`,
      {},
      { contextModule: "admin" },
    ),
  /** Food approvals (admin) - pending items created by restaurants */
  getPendingFoodApprovals: (params = {}) =>
    apiClient.get("/food/admin/foods/pending-approvals", {
      params,
      contextModule: "admin",
    }),
  /**
   * Approve a pending dish.
   *
   * `applyGlobalPricing` decides whether it joins the price adjustment
   * standing over that menu. Omitted means no -- the dish goes live at its own
   * base price, which is what every approval did before the option existed.
   */
  approveFoodItem: (id, { applyGlobalPricing = false } = {}) =>
    apiClient.patch(
      `/food/admin/foods/${String(id)}/approve`,
      { applyGlobalPricing: applyGlobalPricing === true },
      { contextModule: "admin" },
    ),
  /** What adjustment stands over this dish's menu, and what either choice costs. */
  getStandingAdjustment: (id) =>
    apiClient.get(`/food/admin/foods/${String(id)}/standing-adjustment`, {
      contextModule: "admin",
    }),
  rejectFoodItem: (id, reason) =>
    apiClient.patch(
      `/food/admin/foods/${String(id)}/reject`,
      { reason: String(reason || "").trim() },
      { contextModule: "admin" },
    ),
  bulkApproveFoodItems: (restaurantId) =>
    apiClient.post(
      "/food/admin/foods/bulk-approve",
      { restaurantId },
      { contextModule: "admin" },
    ),
  /** Customers (admin) */
  getCustomers: (params = {}) =>
    apiClient.get("/food/admin/customers", { params, contextModule: "admin" }),
  getCustomerById: (id) =>
    apiClient.get(`/food/admin/customers/${String(id)}`, {
      contextModule: "admin",
    }),
  updateCustomerStatus: (id, isActive) =>
    apiClient.patch(
      `/food/admin/customers/${String(id)}/status`,
      { isActive: isActive !== false },
      { contextModule: "admin" },
    ),
  updateCustomerCodBlockStatus: (id, isBlockedFromCOD) =>
    apiClient.patch(
      `/food/admin/customers/${String(id)}/cod-block`,
      { isBlockedFromCOD: Boolean(isBlockedFromCOD) },
      { contextModule: "admin" },
    ),
  /** Orders (admin) – list, get by id, assign delivery partner */
  getOrders: (params = {}) =>
    apiClient.get("/food/admin/orders", {
      params: { limit: 50, page: 1, ...params },
      contextModule: "admin",
    }),
  getOrderById: (orderId) =>
    apiClient.get(`/food/admin/orders/${String(orderId)}`, {
      contextModule: "admin",
    }),
  deleteOrder: (orderId) =>
    apiClient.delete(`/food/admin/orders/${String(orderId)}`, {
      contextModule: "admin",
    }),
  /**
   * Manual rider assignment (per order). `vertical` is 'food' or
   * 'quickCommerce' (the /qc admin API). Note the
   * request interceptor still moves any /food URL to /qc while the browser is
   * on a quick-commerce admin path, so 'food' there means the page's
   * own vertical.
   */
  getRiderCandidates: (vertical, orderId, { q, limit } = {}) =>
    apiClient.get(`${adminOrdersBase(vertical)}/${encodeURIComponent(String(orderId))}/rider-candidates`, {
      params: { q: q && String(q).trim() ? String(q).trim() : undefined, limit },
      contextModule: "admin",
    }),
  assignRider: (vertical, orderId, { deliveryPartnerId, force = false } = {}) =>
    apiClient.patch(
      `${adminOrdersBase(vertical)}/${encodeURIComponent(String(orderId))}/assign-rider`,
      { deliveryPartnerId, ...(force ? { force: true } : {}) },
      { contextModule: "admin" },
    ),
  unassignRider: (vertical, orderId) =>
    apiClient.patch(
      `${adminOrdersBase(vertical)}/${encodeURIComponent(String(orderId))}/unassign-rider`,
      {},
      { contextModule: "admin" },
    ),
  /** Create restaurant (admin). Single API: POST /food/admin/restaurants. Body: JSON with image URLs. */
  createRestaurant: (body) =>
    apiClient.post("/food/admin/restaurants", body ?? {}, {
      contextModule: "admin",
    }),
  /** List delivery zones. Query: limit, page, isActive, search */
  getZones: (params = {}) =>
    apiClient.get("/food/admin/zones", {
      params: { limit: 1000, ...params },
      contextModule: "admin",
    }),
  /** Restaurant report (admin). */
  getRestaurantReport: (params = {}) =>
    apiClient.get("/food/admin/reports/restaurants", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  getTransactionReport: (params = {}) =>
    apiClient.get("/food/admin/reports/transactions", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  getTaxReport: (params = {}) =>
    apiClient.get("/food/admin/reports/tax", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  getTaxReportDetail: (id, params = {}) =>
    apiClient.get(`/food/admin/reports/tax/${id}`, {
      params,
      contextModule: "admin",
    }),
  /** Get single zone by id */
  getZoneById: (id) =>
    apiClient.get(`/food/admin/zones/${id}`, { contextModule: "admin" }),
  /** Create zone. Body: name, zoneName?, country?, unit?, coordinates, isActive? */
  createZone: (body) =>
    apiClient.post("/food/admin/zones", body ?? {}, { contextModule: "admin" }),
  /** Update zone. Body: name?, zoneName?, country?, unit?, coordinates?, isActive? */
  updateZone: (id, body) =>
    apiClient.patch(`/food/admin/zones/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  /** Delete zone */
  deleteZone: (id) =>
    apiClient.delete(`/food/admin/zones/${id}`, { contextModule: "admin" }),

  /** Feedback Experience (admin) */
  getFeedbackExperiences: (params = {}) =>
    apiClient.get(API_ENDPOINTS.ADMIN.FEEDBACK_EXPERIENCE, {
      params,
      contextModule: "admin",
    }),
  deleteFeedbackExperience: (id) =>
    apiClient.delete(`${API_ENDPOINTS.ADMIN.FEEDBACK_EXPERIENCE}/${id}`, {
      contextModule: "admin",
    }),

  /** Public env variables (safe subset). Used for runtime keys like Google Maps. */
  // getPublicEnvVariables removed: rely on import.meta.env instead.

  /** Public categories (user app) - zone-aware */
  getPublicCategories: (params = {}, config = {}) =>
    apiClient.get("/food/restaurant/categories/public", {
      params: params ?? {},
      ...config,
    }),

  /** Offers & Coupons (admin) */
  getAllOffers: (params = {}) =>
    apiClient.get("/food/admin/deals", { params, contextModule: "admin" }),
  createAdminOffer: (body) =>
    apiClient.post("/food/admin/deals", body ?? {}, {
      contextModule: "admin",
    }),
  updateAdminOfferCartVisibility: (offerId, itemId, showInCart) =>
    apiClient.patch(
      `/food/admin/deals/${String(offerId)}/cart-visibility`,
      { itemId: String(itemId), showInCart: Boolean(showInCart) },
      { contextModule: "admin" },
    ),
  deleteAdminOffer: (offerId) =>
    apiClient.delete(`/food/admin/deals/${String(offerId)}`, {
      contextModule: "admin",
    }),

  /** Delivery Partner Bonus (admin) */
  getDeliveryPartnerBonusTransactions: (params = {}) =>
    apiClient.get("/food/admin/delivery/bonus-transactions", {
      params,
      contextModule: "admin",
    }),
  /** Delivery Earnings (admin) */
  getDeliveryEarnings: (params = {}) =>
    apiClient.get("/food/admin/delivery/earnings", {
      params,
      contextModule: "admin",
    }),
  addDeliveryPartnerBonus: (deliveryPartnerId, amount, reference = "") =>
    apiClient.post(
      "/food/admin/delivery/bonus",
      {
        deliveryPartnerId: String(deliveryPartnerId),
        amount: Number(amount),
        reference: String(reference || ""),
      },
      { contextModule: "admin" },
    ),

  /** Earning Addon Offers (admin) */
  getEarningAddons: (params = {}) =>
    apiClient.get("/food/admin/delivery/earning-extras", {
      params,
      contextModule: "admin",
    }),
  createEarningAddon: (body) =>
    apiClient.post("/food/admin/delivery/earning-extras", body ?? {}, {
      contextModule: "admin",
    }),
  updateEarningAddon: (id, body) =>
    apiClient.patch(
      `/food/admin/delivery/earning-extras/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  deleteEarningAddon: (id) =>
    apiClient.delete(`/food/admin/delivery/earning-extras/${String(id)}`, {
      contextModule: "admin",
    }),
  toggleEarningAddonStatus: (id, status) =>
    apiClient.patch(
      `/food/admin/delivery/earning-extras/${String(id)}/status`,
      { status: String(status) },
      { contextModule: "admin" },
    ),

  /** Earning Addon History (admin) */
  getEarningAddonHistory: (params = {}) =>
    apiClient.get("/food/admin/delivery/earning-extra-history", {
      params,
      contextModule: "admin",
    }),
  creditEarningToWallet: (historyId, notes = "") =>
    apiClient.post(
      `/food/admin/delivery/earning-extra-history/${String(historyId)}/credit`,
      { notes: String(notes || "") },
      { contextModule: "admin" },
    ),
  cancelEarningAddonHistory: (historyId, reason = "") =>
    apiClient.post(
      `/food/admin/delivery/earning-extra-history/${String(historyId)}/cancel`,
      { reason: String(reason || "") },
      { contextModule: "admin" },
    ),
  checkEarningAddonCompletions: (deliveryPartnerId, force = false) =>
    apiClient.post(
      "/food/admin/delivery/earning-extra-completions/check",
      { deliveryPartnerId: String(deliveryPartnerId), force: Boolean(force) },
      { contextModule: "admin" },
    ),
  getDeliveryWallets: (params = {}) =>
    apiClient.get("/food/admin/delivery/wallets", {
      params,
      contextModule: "admin",
    }),
  getDeliveryWithdrawals: (params = {}) =>
    apiClient.get("/food/admin/delivery/withdrawals", {
      params,
      contextModule: "admin",
    }),
  updateDeliveryWithdrawalStatus: (id, body) =>
    apiClient.patch(`/food/admin/delivery/withdrawals/${String(id)}`, body, {
      contextModule: "admin",
    }),
  getCashLimitSettlements: (params = {}) =>
    apiClient.get("/food/admin/delivery/cash-limit-settlements", {
      params,
      contextModule: "admin",
    }),

  /** Restaurant Commission (admin) */
  getRestaurantCommissionBootstrap: () =>
    apiClient.get("/food/admin/restaurant-commissions/bootstrap", {
      contextModule: "admin",
    }),
  getRestaurantCommissions: (params = {}) =>
    apiClient.get("/food/admin/restaurant-commissions", {
      params,
      contextModule: "admin",
    }),
  getRestaurantCommissionById: (id) =>
    apiClient.get(`/food/admin/restaurant-commissions/${String(id)}`, {
      contextModule: "admin",
    }),
  createRestaurantCommission: (body) =>
    apiClient.post("/food/admin/restaurant-commissions", body ?? {}, {
      contextModule: "admin",
    }),
  updateRestaurantCommission: (id, body) =>
    apiClient.patch(
      `/food/admin/restaurant-commissions/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  deleteRestaurantCommission: (id) =>
    apiClient.delete(`/food/admin/restaurant-commissions/${String(id)}`, {
      contextModule: "admin",
    }),
  toggleRestaurantCommissionStatus: (id) =>
    apiClient.patch(
      `/food/admin/restaurant-commissions/${String(id)}/toggle`,
      {},
      { contextModule: "admin" },
    ),
  /** Backward-compatible alias used in UI */
  getApprovedRestaurants: (params = {}) =>
    apiClient.get("/food/admin/restaurants", {
      params: { status: "approved", limit: 1000, ...params },
      contextModule: "admin",
    }),

  /** Delivery Boy Commission Rules (admin) */
  getCommissionRules: () =>
    apiClient.get("/food/admin/delivery/commission-rules", {
      contextModule: "admin",
    }),
  createCommissionRule: (body) =>
    apiClient.post("/food/admin/delivery/commission-rules", body ?? {}, {
      contextModule: "admin",
    }),
  updateCommissionRule: (id, body) =>
    apiClient.patch(
      `/food/admin/delivery/commission-rules/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  deleteCommissionRule: (id) =>
    apiClient.delete(`/food/admin/delivery/commission-rules/${String(id)}`, {
      contextModule: "admin",
    }),
  toggleCommissionRuleStatus: (id, status) =>
    apiClient.patch(
      `/food/admin/delivery/commission-rules/${String(id)}/status`,
      { status: Boolean(status) },
      { contextModule: "admin" },
    ),
  getZoneSurgeConfigs: () =>
    apiClient.get("/food/admin/delivery/zone-surge", {
      contextModule: "admin",
    }),
  upsertZoneSurgeConfig: (body) =>
    apiClient.put("/food/admin/delivery/zone-surge", body ?? {}, {
      contextModule: "admin",
    }),
  toggleZoneSurgeStatus: (zoneId, status) =>
    apiClient.patch(
      `/food/admin/delivery/zone-surge/${String(zoneId)}/status`,
      { status: Boolean(status) },
      { contextModule: "admin" },
    ),

  /** Fee Settings (admin) */
  getFeeSettings: () =>
    apiClient.get("/food/admin/fee-settings", { contextModule: "admin" }),
  createOrUpdateFeeSettings: (body) =>
    apiClient.put("/food/admin/fee-settings", body ?? {}, {
      contextModule: "admin",
    }),

  /** How the platform bills restaurants: commission per order, or a recurring plan. */
  getMonetizationMode: () =>
    apiClient.get("/food/admin/monetization-mode", { contextModule: "admin" }),
  updateMonetizationMode: (monetizationMode) =>
    apiClient.patch(
      "/food/admin/monetization-mode",
      { monetizationMode },
      { contextModule: "admin" },
    ),

  /** Referral Settings (admin) */
  getReferralSettings: () =>
    apiClient.get("/food/admin/referral-settings", { contextModule: "admin" }),
  createOrUpdateReferralSettings: (body) =>
    apiClient.put("/food/admin/referral-settings", body ?? {}, {
      contextModule: "admin",
    }),

  /** Safety / Emergency Reports (admin) */
  getSafetyEmergencyReports: (params) =>
    apiClient.get("/food/admin/safety-emergency-reports", {
      params: params ?? {},
      contextModule: "admin",
    }),
  updateSafetyEmergencyStatus: (id, status) =>
    apiClient.put(
      `/food/admin/safety-emergency-reports/${String(id)}/status`,
      { status: String(status) },
      { contextModule: "admin" },
    ),
  updateSafetyEmergencyPriority: (id, priority) =>
    apiClient.put(
      `/food/admin/safety-emergency-reports/${String(id)}/priority`,
      { priority: String(priority) },
      { contextModule: "admin" },
    ),
  deleteSafetyEmergencyReport: (id) =>
    apiClient.delete(`/food/admin/safety-emergency-reports/${String(id)}`, {
      contextModule: "admin",
    }),

  /** Delivery Cash Limit (admin) */
  getDeliveryCashLimit: () =>
    apiClient.get("/food/admin/delivery-cash-limit", {
      contextModule: "admin",
    }),
  updateDeliveryCashLimit: (body) =>
    apiClient.patch("/food/admin/delivery-cash-limit", body ?? {}, {
      contextModule: "admin",
    }),
  getRestaurantWithdrawalSetting: () =>
    apiClient.get("/food/admin/restaurant-withdrawal-setting", {
      contextModule: "admin",
    }),
  updateRestaurantWithdrawalSetting: (body) =>
    apiClient.patch("/food/admin/restaurant-withdrawal-setting", body ?? {}, {
      contextModule: "admin",
    }),

  /** Delivery Emergency Help (admin) */
  getEmergencyHelp: () =>
    apiClient.get("/food/admin/delivery-emergency-help", {
      contextModule: "admin",
    }),
  createOrUpdateEmergencyHelp: (body) =>
    apiClient.put("/food/admin/delivery-emergency-help", body ?? {}, {
      contextModule: "admin",
    }),

  /** Restaurant add-ons approval (admin) */
  getRestaurantAddons: (params = {}) =>
    apiClient.get("/food/admin/item-extras", {
      params: params ?? {},
      contextModule: "admin",
    }),
  updateRestaurantAddon: (id, body) =>
    apiClient.patch(
      `/food/admin/item-extras/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  approveRestaurantAddon: (id) =>
    apiClient.patch(
      `/food/admin/item-extras/${String(id)}/approve`,
      {},
      { contextModule: "admin" },
    ),
  rejectRestaurantAddon: (id, reason) =>
    apiClient.patch(
      `/food/admin/item-extras/${String(id)}/reject`,
      { reason: String(reason || "").trim() },
      { contextModule: "admin" },
    ),
  deleteRestaurantAddon: (id) =>
    apiClient.delete(`/food/admin/item-extras/${String(id)}`, {
      contextModule: "admin",
    }),
  /** Google Maps key (admin) — served to every app via /env/public. */
  getMapSettings: () =>
    apiClient.get("/food/admin/map-settings", { contextModule: "admin" }),
  updateMapSettings: (body) =>
    apiClient.patch("/food/admin/map-settings", body ?? {}, {
      contextModule: "admin",
    }),
  /** Business Settings (admin) */
  getBusinessSettings: () =>
    apiClient.get(API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS, {
      contextModule: "admin",
    }),
  updateBusinessSettings: (data, files = {}) => {
    const formData = new FormData();
    // Add JSON data
    formData.append("data", JSON.stringify(data));
    // Add files
    if (files.logo) formData.append("logo", files.logo);
    if (files.favicon) formData.append("favicon", files.favicon);
    if (files.restaurantLogo) formData.append("restaurantLogo", files.restaurantLogo);
    if (files.deliveryPartnerLogo) formData.append("deliveryPartnerLogo", files.deliveryPartnerLogo);

    return apiClient.patch(API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      contextModule: "admin",
    });
  },
  /** Order status (admin) — admins act across restaurants, so this uses the admin route.
   *  Kitchen statuses only; picked_up/delivered stay owned by the delivery + OTP flow. */
  updateOrderStatus: (orderId, body = {}) =>
    apiClient.patch(`/food/admin/orders/${String(orderId)}/status`, body, {
      contextModule: "admin",
    }),
  acceptOrder: (orderId) =>
    apiClient.patch(`/food/admin/orders/${String(orderId)}/status`,
      { orderStatus: "confirmed" }, { contextModule: "admin" }),
  rejectOrder: (orderId, note = "") =>
    apiClient.patch(`/food/admin/orders/${String(orderId)}/status`,
      { orderStatus: "cancelled_by_restaurant", note }, { contextModule: "admin" }),

  /** PetPooja integration (admin) */
  getPetpoojaSettings: () =>
    apiClient.get(API_ENDPOINTS.ADMIN.PETPOOJA_SETTINGS, { contextModule: "admin" }),
  updatePetpoojaSettings: (data) =>
    apiClient.put(API_ENDPOINTS.ADMIN.PETPOOJA_SETTINGS, data ?? {}, { contextModule: "admin" }),
  getPetpoojaSyncLogs: (params) =>
    apiClient.get(API_ENDPOINTS.ADMIN.PETPOOJA_SYNC_LOGS, { params, contextModule: "admin" }),
  retryPetpoojaSyncLog: (logId) =>
    apiClient.post(`${API_ENDPOINTS.ADMIN.PETPOOJA_SYNC_LOGS}/${String(logId)}/retry`, {}, { contextModule: "admin" }),
};

/** Restaurant API - OTP login via new backend; no email/password. */
export const restaurantAPI = {
  deleteAccount: () => apiClient.delete('/food/restaurant/profile/account', { contextModule: 'restaurant' }),
  getWallet: () => apiClient.get('/food/delivery/wallet', { contextModule: 'delivery' }),
  getWallet: () => apiClient.get('/food/restaurant/finance', { contextModule: 'restaurant' }),
  sendOTP: (phone, _purpose = "login") => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestRestaurantOtp(phone);
  },
  verifyOTP: (phone, otp, _purpose, _name, _email, fcmToken = null, platform = "web") => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifyRestaurantOtp(phone, otp, fcmToken, platform);
  },
  getMe: () => authService.getMe("restaurant"),
  /** Restaurant dashboard: fetch current restaurant profile (deduped + short-cached). */
  getCurrentRestaurant: () => getRestaurantCurrentOnce(),
  /** Finance dashboard for `hub-finance`. */
  getFinance: (params = {}) =>
    apiClient.get("/food/restaurant/finance", {
      contextModule: "restaurant",
      params: params || {},
    }),
  /** Fetch restaurant by owner (stub for missing backend endpoint). */
  getRestaurantByOwner: () =>
    Promise.resolve({
      data: {
        success: true,
        data: {
          restaurant: {
            name: "Your Restaurant",
            restaurantId: "REST000001",
            address: "Your address",
          },
        },
      },
    }),
  /** Submit a real withdrawal request to the backend. */
  createWithdrawalRequest: (amount) =>
    apiClient.post("/food/restaurant/withdraw", { amount: Number(amount) }, {
      contextModule: "restaurant"
    }),
  /** List withdrawal history for current restaurant. */
  getWithdrawalHistory: () =>
    apiClient.get("/food/restaurant/withdrawals", {
      contextModule: "restaurant"
    }),
  /** Update restaurant profile fields (name/cuisines/location/menuImages). */
  updateProfile: (body) =>
    apiClient
      .patch("/food/restaurant/profile", body ?? {}, {
        contextModule: "restaurant",
      })
      .then((res) => {
        // Keep cache coherent to avoid an immediate refetch storm.
        restaurantCurrentCached = res;
        restaurantCurrentCacheTime = Date.now();
        return res;
      }),
  /** PATCH /food/restaurant/availability. Body: { isAcceptingOrders: boolean } */
  updateAcceptingOrders: (isAcceptingOrders) =>
    apiClient
      .patch(
        "/food/restaurant/availability",
        { isAcceptingOrders: Boolean(isAcceptingOrders) },
        { contextModule: "restaurant" },
      )
      .then((res) => {
        // Keep cache coherent to avoid an immediate refetch storm.
        restaurantCurrentCached = res;
        restaurantCurrentCacheTime = Date.now();
        return res;
      }),
  /** Upload and set restaurant profile image (multipart). Field name: file */
  uploadProfileImage: (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.post("/food/restaurant/profile/profile-image", formData, {
      contextModule: "restaurant",
    });
  },
  /** Upload a menu/cover image (multipart). Does not auto-attach; use updateProfile(menuImages) after. */
  uploadMenuImage: (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.post("/food/restaurant/profile/menu-image", formData, {
      contextModule: "restaurant",
    });
  },
  uploadCoverImages: (files = []) => {
    const normalizedFiles = Array.from(files || []).filter(Boolean);
    if (normalizedFiles.length === 0) {
      return Promise.reject(new Error("At least one file is required"));
    }
    const formData = new FormData();
    normalizedFiles.forEach((file) => formData.append("files", file));
    return apiClient.post("/food/restaurant/profile/cover-images", formData, {
      contextModule: "restaurant",
    });
  },
  uploadMenuImages: (files = []) => {
    const normalizedFiles = Array.from(files || []).filter(Boolean);
    if (normalizedFiles.length === 0) {
      return Promise.reject(new Error("At least one file is required"));
    }
    const formData = new FormData();
    normalizedFiles.forEach((file) => formData.append("files", file));
    return apiClient.post("/food/restaurant/profile/menu-images", formData, {
      contextModule: "restaurant",
    });
  },
  /** My Offers (Coupons) */
  listMyOffers: () => apiClient.get("/food/restaurant/my-deals", { contextModule: "restaurant" }),
  createMyOffer: (body) => apiClient.post("/food/restaurant/my-deals", body, { contextModule: "restaurant" }),
  deleteMyOffer: (id) => apiClient.delete(`/food/restaurant/my-deals/${id}`, { contextModule: "restaurant" }),
  updateMyOfferStatus: (id, status) => apiClient.patch(`/food/restaurant/my-deals/${id}/status`, { status }, { contextModule: "restaurant" }),
  /** Public Offers for users (global/selected restaurant) */
  getPublicOffers: () => apiClient.get("/food/restaurant/deals"),
  /** Backward-compat helper used by Cart: returns coupons array for an item by adapting public offers */
  getCouponsByItemIdPublic: (restaurantId, _itemId) =>
    apiClient.get("/food/restaurant/deals").then((res) => {
      const list = res?.data?.data?.allOffers || res?.data?.allOffers || [];
      const now = Date.now();
      const coupons = list
        .filter((o) => {
          // Guard: respect selected restaurant scope
          if (String(o?.restaurantScope) === "selected") {
            if (!restaurantId) return false;
            return String(o.restaurantId || "") === String(restaurantId || "");
          }
          return true;
        })
        .map((o) => {
          const isPct = o.discountType === "percentage";
          const discountVal = Number(o.discountValue || 0);
          return {
            couponCode: o.couponCode,
            discountType: o.discountType,
            discountPercentage: isPct ? discountVal : 0,
            discountValue: discountVal,
            // For backward compat with Cart.jsx mapping (original - discounted = savings)
            originalPrice: isPct ? 0 : discountVal,
            discountedPrice: 0,
            minOrderValue: Number(o.minOrderValue || 0),
            minOrder: Number(o.minOrderValue || 0),
            maxDiscount: o.maxDiscount != null ? Number(o.maxDiscount) : null,
            customerGroup: o.customerScope || "all",
            isGlobalCoupon: true,
            endDate: o.endDate || null,
            showInCart: o.showInCart !== false,
            _ts: now,
          };
        });
      return { data: { success: true, data: { coupons } } };
    }),
  /** Categories (restaurant dashboard) */
  getCategories: (params = {}) =>
    // Compact payload for item creation forms (id + name only).
    apiClient.get("/food/restaurant/categories", {
      params: { compact: true, limit: 1000, ...params },
      contextModule: "restaurant",
    }),
  // For MenuCategoriesPage compatibility
  getAllCategories: (params = {}) =>
    apiClient.get("/food/restaurant/categories", {
      params: {
        includeInactive: true,
        withCounts: true,
        limit: 1000,
        ...params,
      },
      contextModule: "restaurant",
    }),
  createCategory: (body) =>
    apiClient.post("/food/restaurant/categories", body ?? {}, {
      contextModule: "restaurant",
    }),
  updateCategory: (id, body) =>
    apiClient.patch(`/food/restaurant/categories/${String(id)}`, body ?? {}, {
      contextModule: "restaurant",
    }),
  deleteCategory: (id) =>
    apiClient.delete(`/food/restaurant/categories/${String(id)}`, {
      contextModule: "restaurant",
    }),
  /** Menu (restaurant dashboard) */
  getMenu: (params = {}) =>
    apiClient.get("/food/restaurant/menu", {
      params,
      contextModule: "restaurant",
    }),
  /** Orders (restaurant dashboard) */
  getOrders: (params = {}) =>
    apiClient.get("/food/restaurant/orders", {
      params: { limit: 50, page: 1, ...params },
      contextModule: "restaurant",
    }),
  getOrderById: (orderId) =>
    apiClient.get(`/food/restaurant/orders/${String(orderId)}`, {
      contextModule: "restaurant",
    }),
  updateMenu: (body) =>
    apiClient.patch("/food/restaurant/menu", body ?? {}, {
      contextModule: "restaurant",
    }),
  saveFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const path =
      platform === "mobile" ? "/fcm-tokens/mobile/save" : "/fcm-tokens/save";
    const payload =
      platform === "mobile"
        ? { token: String(token) }
        : { token: String(token), platform };
    return apiClient.post(
      path,
      payload,
      { contextModule: "restaurant" },
    );
  },
  removeFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    return apiClient.delete(
      `/fcm-tokens/remove/${encodeURIComponent(String(token))}`,
      {
        data: { token: String(token), platform },
        contextModule: "restaurant",
      },
    );
  },
  /** Outlet timings (restaurant dashboard) */
  getOutletTimings: () =>
    apiClient.get("/food/restaurant/outlet-timings", {
      contextModule: "restaurant",
    }),
  saveOutletTimings: (outletTimings) =>
    apiClient.put(
      "/food/restaurant/outlet-timings",
      { outletTimings: outletTimings || {} },
      { contextModule: "restaurant" },
    ),
  /** Foods (restaurant) - stored in food_items collection */
  createFood: (body) =>
    apiClient.post("/food/restaurant/foods", body ?? {}, {
      contextModule: "restaurant",
    }),
  updateFood: (id, body) =>
    apiClient.patch(`/food/restaurant/foods/${String(id)}`, body ?? {}, {
      contextModule: "restaurant",
    }),
  bulkUploadTemplate: () =>
    apiClient.get("/food/restaurant/bulk-upload/template", { 
      responseType: 'blob', 
      contextModule: "restaurant" 
    }),
  bulkUpload: (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.post("/food/restaurant/bulk-upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      contextModule: "restaurant",
    });
  },
  /** Orders (restaurant dashboard) */
  getOrders: (() => {
    // Single-flight de-dupe to avoid duplicate GETs in React StrictMode / double-mount.
    let inFlight = null;
    let inFlightKey = "";
    let cache = null;
    let cacheKey = "";
    let cacheAt = 0;
    const CACHE_MS = 800;

    const buildKey = (p = {}) => JSON.stringify({ limit: 50, page: 1, ...p });

    return (params = {}) => {
      const key = buildKey(params);
      const now = Date.now();

      if (cache && cacheKey === key && now - cacheAt < CACHE_MS) {
        return Promise.resolve(cache);
      }

      if (inFlight && inFlightKey === key) return inFlight;

      inFlightKey = key;
      inFlight = apiClient
        .get("/food/restaurant/orders", {
          params: { limit: 50, page: 1, ...params },
          contextModule: "restaurant",
        })
        .then((res) => {
          // Backend paginated shape: { data: { data: [...], meta: {...} } }
          // Normalize to { data: { data: { orders: [...], meta } } } for restaurant UI pages.
          const payload = res?.data?.data || {};
          const rowsRaw = Array.isArray(payload.data) ? payload.data : [];

          // Normalize backend order fields to match existing restaurant UI expectations.
          // UI historically uses: order.status, order.address, order.total, order.paymentMethod
          const normalizeStatus = (s) => {
            const v = String(s || "").toLowerCase();
            // Backend: created -> treat as confirmed/new in UI
            if (v === "created") return "confirmed";
            // Backend: ready_for_pickup -> ready
            if (v === "ready_for_pickup") return "ready";
            // Backend: picked_up -> out_for_delivery (restaurant handed over)
            if (v === "picked_up") return "out_for_delivery";
            if (v.includes("cancel")) return "cancelled";
            return v || "confirmed";
          };

          const rows = rowsRaw.map((o) => {
            const status = normalizeStatus(o.orderStatus || o.status);
            const address = o.deliveryAddress || o.address;
            const total = o.pricing?.total ?? o.total ?? 0;
            const paymentMethod = o.payment?.method || o.paymentMethod || null;
            return { ...o, status, address, total, paymentMethod };
          });
          const meta = payload.meta || {};
          const normalized = {
            ...res,
            data: {
              ...res.data,
              data: { orders: rows, meta },
            },
          };

          cache = normalized;
          cacheKey = key;
          cacheAt = Date.now();
          return normalized;
        })
        .finally(() => {
          inFlight = null;
          inFlightKey = "";
        });

      return inFlight;
    };
  })(),
  updateOrderStatus: (orderId, body) => {
    const raw = body ?? {};
    const outgoing = { ...raw };

    // Translate UI-friendly statuses to backend enum values.
    const normalizeOutgoingStatus = (s) => {
      const v = String(s || "")
        .toLowerCase()
        .trim();
      if (!v) return v;
      if (v === "ready") return "ready_for_pickup";
      if (v === "out_for_delivery") return "picked_up";
      if (v === "cancelled") return "cancelled_by_restaurant";
      return v;
    };

    if (outgoing.orderStatus) {
      outgoing.orderStatus = normalizeOutgoingStatus(outgoing.orderStatus);
    }

    return apiClient.patch(
      `/food/restaurant/orders/${String(orderId)}/status`,
      outgoing,
      { contextModule: "restaurant" },
    );
  },
  /**
   * Accept an incoming order (restaurant).
   * UI expects this to move order into "preparing" bucket.
   * Backend supports PATCH /food/restaurant/orders/:orderId/status with { orderStatus }.
   */
  acceptOrder: (orderId, _prepTimeMins = null) =>
    restaurantAPI.updateOrderStatus(orderId, { orderStatus: "preparing" }),
  /**
   * Reject/cancel order by restaurant.
   * Backend orderStatus enum: cancelled_by_restaurant.
   */
  rejectOrder: (orderId, reason = "") =>
    restaurantAPI.updateOrderStatus(orderId, {
      orderStatus: "cancelled_by_restaurant",
      note: reason,
    }),
  /** Mark order ready (restaurant handoff). */
  markOrderReady: (orderId) =>
    restaurantAPI.updateOrderStatus(orderId, {
      orderStatus: "ready_for_pickup",
    }),
  /**
   * Get a single order by id for restaurant screens.
   * Prefer direct endpoint; fallback to list+filter for backward compatibility.
   */
  getOrderById: async (orderId) => {
    return await apiClient.get(`/food/restaurant/orders/${String(orderId)}`, {
      contextModule: "restaurant",
    });
  },
  /**
   * The commission rate currently charged to this restaurant, so the item form
   * can show what a dish earns before it is saved.
   */
  getCommission: () =>
    apiClient.get("/food/restaurant/commission", {
      contextModule: "restaurant",
    }),
  /**
   * Whether this restaurant's menu prices already contain GST, together with
   * the platform's GST rate -- the flag alone tells the panel nothing it can
   * show the restaurant.
   */
  getTaxSettings: () =>
    apiClient.get("/food/restaurant/tax-settings", { contextModule: "restaurant" }),
  // The "GST on menu prices" switch. The admin can set the same flag on
  // Edit Restaurant; both write the one stored field.
  updateTaxSettings: (priceIncludesGst) =>
    apiClient.put(
      "/food/restaurant/tax-settings",
      { priceIncludesGst: Boolean(priceIncludesGst) },
      { contextModule: "restaurant" },
    ),
  /**
   * The restaurant's "spend this much, get this free" ladder. The admin panel
   * edits the same document, so both sides always show the offer that is
   * actually being applied.
   */
  /**
   * How far this outlet delivers. The admin panel edits the same field, within
   * a ceiling only the admin sets. `null` removes the radius.
   */
  getServiceRadius: () =>
    apiClient.get("/food/restaurant/service-radius", { contextModule: "restaurant" }),
  updateServiceRadius: (serviceRadiusKm) =>
    apiClient.put("/food/restaurant/service-radius", { serviceRadiusKm }, { contextModule: "restaurant" }),
  getFreebieOffer: () =>
    apiClient.get("/food/restaurant/freebie-offer", { contextModule: "restaurant" }),
  updateFreebieOffer: (body) =>
    apiClient.put("/food/restaurant/freebie-offer", body ?? {}, { contextModule: "restaurant" }),
  /**
   * The restaurant's buy-one-get-one dishes. Shares the freebie ladder's
   * arrangement: one document per restaurant, editable from either panel.
   */
  getBogoOffer: () =>
    apiClient.get("/food/restaurant/bogo-offer", { contextModule: "restaurant" }),
  updateBogoOffer: (body) =>
    apiClient.put("/food/restaurant/bogo-offer", body ?? {}, { contextModule: "restaurant" }),
  /**
   * Combos. Saved by a restaurant these enter the approval queue exactly as a new
   * dish does -- a combo is a dish, so it is not a way around approval.
   */
  getCombos: () =>
    apiClient.get("/food/restaurant/combos", { contextModule: "restaurant" }),
  createCombo: (body) =>
    apiClient.post("/food/restaurant/combos", body ?? {}, { contextModule: "restaurant" }),
  updateCombo: (comboId, body) =>
    apiClient.put(`/food/restaurant/combos/${comboId}`, body ?? {}, {
      contextModule: "restaurant",
    }),
  deleteCombo: (comboId) =>
    apiClient.delete(`/food/restaurant/combos/${comboId}`, { contextModule: "restaurant" }),
  /** Add-ons (restaurant) - approval handled by admin */
  getAddons: (params = {}) =>
    apiClient.get("/food/restaurant/item-extras", {
      // Backend validator enforces limit <= 100
      params: { limit: 100, page: 1, ...params },
      contextModule: "restaurant",
    }),
  addAddon: (body) =>
    apiClient.post("/food/restaurant/item-extras", body ?? {}, {
      contextModule: "restaurant",
    }),
  updateAddon: (id, body) =>
    apiClient.patch(`/food/restaurant/item-extras/${String(id)}`, body ?? {}, {
      contextModule: "restaurant",
    }),
  deleteAddon: (id) =>
    apiClient.delete(`/food/restaurant/item-extras/${String(id)}`, {
      contextModule: "restaurant",
    }),
  logout: (refreshToken) => {
    restaurantCurrentInFlight = null;
    restaurantCurrentCached = null;
    restaurantCurrentCacheTime = 0;
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("restaurant_refreshToken")
        : null);
    const fcmToken = typeof localStorage !== "undefined" ? localStorage.getItem("fcm_web_registered_token_restaurant") : null;
    return authService.logout(token, fcmToken, "web");
  },
  /** Backend has no email/password login; use phone OTP only. */
  login: (_email, _password) =>
    Promise.reject(new Error("Please use phone number and OTP to sign in.")),
  /**
   * Register a restaurant (multipart FormData).
   * Backend: POST /v1/food/restaurant/register (path relative to baseURL /api/v1)
   */
  register: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return apiClient.post("/food/restaurant/register", formData);
  },
  /** Upload a single attachment for background onboarding uploads */
  uploadAttachment: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return apiClient.post("/food/restaurant/upload-attachment", formData);
  },
  /** Public: list approved restaurants for user app */
  getRestaurants: (params = {}, config = {}) =>
    getPublicRestaurantsOnce(params, config),
  /** Public: get single approved restaurant by id or slug */
  getRestaurantById: (id, config = {}) =>
    apiClient.get(`/food/restaurant/restaurants/${String(id)}`, { ...config }),
  getReviews: (id, config = {}) =>
    apiClient.get(`/food/restaurant/restaurants/${String(id)}/reviews`, { ...config }),
  /** Public: get approved menu by restaurant id or slug */
  getMenuByRestaurantId: (id, config = {}) =>
    getPublicRestaurantMenuOnce(id, config),
  /** Public: get outlet timings by restaurant id */
  getOutletTimingsByRestaurantId: (id, config = {}) =>
    getPublicRestaurantOutletTimingsOnce(id, config),
  /** Public (user app): approved add-ons by restaurant id/slug */
  getAddonsByRestaurantId: (id, config = {}) =>
    apiClient.get(`/food/restaurant/restaurants/${String(id)}/item-extras`, {
      ...config,
    }),
  getPublicOffers: (params = {}, config = {}) =>
    apiClient.get("/food/restaurant/deals", { params, ...config }),
  /** Resend delivery notification (restaurant dashboard) */
  resendDeliveryNotification: (orderId) =>
    apiClient.post(`/food/restaurant/orders/${String(orderId)}/resend-notification`, {}, {
      contextModule: "restaurant",
    }),
  /** List restaurant complaints (for current restaurant dashboard) */
  getComplaints: (params = {}) =>
    apiClient.get("/food/restaurant/complaints", {
      params,
      contextModule: "restaurant",
    }),
  /** Restaurant support tickets */
  createSupportTicket: (body = {}) =>
    apiClient.post("/food/restaurant/support/tickets", body ?? {}, {
      contextModule: "restaurant",
    }),
  getSupportTickets: (params = {}) =>
    apiClient.get("/food/restaurant/support/tickets", {
      params,
      contextModule: "restaurant",
    }),
};

function stableStringify(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function createInFlightCache({ ttlMs }) {
  const inFlight = new Map();
  const cached = new Map(); // key -> { t, v }

  const getCached = (key) => {
    const hit = cached.get(key);
    if (!hit) return null;
    if (Date.now() - hit.t > ttlMs) {
      cached.delete(key);
      return null;
    }
    return hit.v;
  };

  const getOrCreate = (key, factory) => {
    const cachedValue = getCached(key);
    if (cachedValue) return Promise.resolve(cachedValue);
    if (inFlight.has(key)) return inFlight.get(key);
    const p = Promise.resolve()
      .then(factory)
      .then((res) => {
        cached.set(key, { t: Date.now(), v: res });
        return res;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, p);
    return p;
  };

  return { getOrCreate };
}

// Public user-app endpoints can be called by multiple components/effects on refresh (and React StrictMode in dev).
// A small in-flight + short TTL cache collapses duplicate requests without changing functionality.
const publicRestaurantsCache = createInFlightCache({ ttlMs: 3000 });
const publicRestaurantMenuCache = createInFlightCache({ ttlMs: 3000 });
const publicRestaurantOutletTimingsCache = createInFlightCache({ ttlMs: 3000 });
const publicGenericGetCache = createInFlightCache({ ttlMs: 3000 });

export const publicGetOnce = (url, config = {}) => {
  const safeUrl = typeof url === "string" ? url.trim() : "";
  const { noCache, params, ...axiosConfig } = config || {};
  if (!safeUrl) return Promise.reject(new Error("url is required"));

  if (noCache) {
    return apiClient.get(safeUrl, { params, ...axiosConfig });
  }

  const keyParams =
    params && typeof params === "object" ? { ...params } : params;
  if (keyParams && typeof keyParams === "object") {
    // `_ts` is used as a cache-buster in some call sites; ignore it for dedupe purposes.
    delete keyParams._ts;
  }

  const key = `GET:${safeUrl}:${stableStringify(keyParams)}`;
  return publicGenericGetCache.getOrCreate(key, () =>
    apiClient.get(safeUrl, { params, ...axiosConfig }),
  );
};

const getPublicRestaurantsOnce = (params = {}, config = {}) => {
  const { noCache, ...axiosConfig } = config || {};
  if (noCache) {
    return apiClient.get("/food/restaurant/restaurants", {
      params: { limit: 1000, ...params },
      ...axiosConfig,
    });
  }
  const keyParams = { limit: 1000, ...params };
  // `_ts` is an explicit cache-buster in many call sites; ignore it for dedupe purposes.
  if (keyParams && typeof keyParams === "object") {
    delete keyParams._ts;
  }
  const key = `restaurants:${stableStringify(keyParams)}`;
  return publicRestaurantsCache.getOrCreate(key, () =>
    apiClient.get("/food/restaurant/restaurants", {
      params: { limit: 1000, ...params },
      ...axiosConfig,
    }),
  );
};

const getPublicRestaurantMenuOnce = (id, config = {}) => {
  const safeId = String(id || "").trim();
  const { noCache, ...axiosConfig } = config || {};
  if (!safeId) {
    return Promise.resolve({
      data: { success: false, data: null },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });
  }
  if (noCache) {
    return apiClient.get(`/food/restaurant/restaurants/${safeId}/menu`, {
      ...axiosConfig,
    });
  }
  const key = `menu:${safeId}`;
  return publicRestaurantMenuCache.getOrCreate(key, () =>
    apiClient.get(`/food/restaurant/restaurants/${safeId}/menu`, {
      ...axiosConfig,
    }),
  );
};

const getPublicRestaurantOutletTimingsOnce = (id, config = {}) => {
  const safeId = String(id || "").trim();
  const { noCache, ...axiosConfig } = config || {};
  if (!safeId) {
    return Promise.resolve({
      data: { success: false, data: null },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });
  }
  if (noCache) {
    return apiClient.get(
      `/food/restaurant/restaurants/${safeId}/outlet-timings`,
      { ...axiosConfig },
    );
  }
  const key = `outletTimings:${safeId}`;
  return publicRestaurantOutletTimingsCache.getOrCreate(key, () =>
    apiClient.get(`/food/restaurant/restaurants/${safeId}/outlet-timings`, {
      ...axiosConfig,
    }),
  );
};

/** Single in-flight + short cache for restaurant /food/restaurant/current - prevents request storms. */
let restaurantCurrentInFlight = null;
let restaurantCurrentCached = null;
let restaurantCurrentCacheTime = 0;
const RESTAURANT_CURRENT_CACHE_MS = 3000;

const getRestaurantCurrentOnce = () => {
  const now = Date.now();
  if (
    restaurantCurrentCached &&
    now - restaurantCurrentCacheTime < RESTAURANT_CURRENT_CACHE_MS
  ) {
    return Promise.resolve(restaurantCurrentCached);
  }
  if (!restaurantCurrentInFlight) {
    restaurantCurrentInFlight = apiClient
      .get("/food/restaurant/current", { contextModule: "restaurant" })
      .then((res) => {
        restaurantCurrentCached = res;
        restaurantCurrentCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        restaurantCurrentInFlight = null;
      });
  }
  return restaurantCurrentInFlight;
};

/** Single in-flight + short cache for delivery /auth/me - one call per page load / refresh. */
let deliveryMeInFlight = null;
let deliveryMeCached = null;
let deliveryMeCacheTime = 0;
const DELIVERY_ME_CACHE_MS = 3000;

const getDeliveryMeOnce = () => {
  const now = Date.now();
  if (deliveryMeCached && now - deliveryMeCacheTime < DELIVERY_ME_CACHE_MS) {
    return Promise.resolve(deliveryMeCached);
  }
  if (!deliveryMeInFlight) {
    deliveryMeInFlight = authService
      .getMe("delivery")
      .then((res) => {
        deliveryMeCached = res;
        deliveryMeCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        deliveryMeInFlight = null;
      });
  }
  return deliveryMeInFlight;
};

/** Delivery API - OTP login + registration via new backend. */
export const deliveryAPI = {
  deleteAccount: () => apiClient.delete('/food/delivery/profile/account', { contextModule: 'delivery' }),
  getWallet: () => apiClient.get('/food/delivery/wallet', { contextModule: 'delivery' }),
  getWallet: () => apiClient.get('/food/restaurant/finance', { contextModule: 'restaurant' }),
  sendOTP: (phone, _purpose = "login") => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestDeliveryOtp(phone);
  },
  verifyOTP: (phone, otp, _purpose, _name, fcmToken = null, platform = "web") => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifyDeliveryOtp(phone, otp, fcmToken, platform);
  },
  getMe: () => getDeliveryMeOnce(),
  /** Get delivery profile (same as getMe under the hood; maps response to profile shape). */
  getProfile: () =>
    getDeliveryMeOnce().then((res) => ({
      ...res,
      data: {
        ...res.data,
        data: { profile: res.data?.data?.user ?? res.data?.data },
      },
    })),
  getReferralStats: () =>
    apiClient.get("/food/delivery/referrals/stats", {
      contextModule: "delivery",
    }),
  logout: (refreshToken) => {
    deliveryMeCached = null;
    deliveryMeCacheTime = 0;
    try {
      localStorage.removeItem("app:isOnline");
    } catch (_) {}
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("delivery_refreshToken")
        : null);
    const fcmToken = typeof localStorage !== "undefined" ? localStorage.getItem("fcm_web_registered_token_delivery") : null;
    return authService.logout(token, fcmToken, "web");
  },
  /** POST /food/delivery/register - multipart FormData (new partner, no token). */
  register: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(
        new Error("FormData with details and document files is required"),
      );
    }
    return apiClient.post("/food/delivery/register", formData);
  },
  /** PATCH /food/delivery/profile - complete profile after OTP (Bearer token required). */
  completeProfile: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(
        new Error("FormData with details and document files is required"),
      );
    }
    return apiClient.patch("/food/delivery/profile", formData, {
      contextModule: "delivery",
    });
  },
  /** PATCH /food/delivery/profile/details - JSON updates (vehicle number, etc). */
  updateProfileDetails: (payload) =>
    apiClient.patch("/food/delivery/profile/details", payload ?? {}, {
      contextModule: "delivery",
    }),
  /** PATCH /food/delivery/profile - multipart updates for photos/documents (uses same endpoint). */
  updateProfileMultipart: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return apiClient.patch("/food/delivery/profile", formData, {
      contextModule: "delivery",
    });
  },
  /** POST /food/delivery/profile/photo-base64 - Flutter in-app camera base64 upload. */
  updateProfilePhotoBase64: (payload) =>
    apiClient.post("/food/delivery/profile/photo-base64", payload ?? {}, {
      contextModule: "delivery",
    }),
  /** PATCH /food/delivery/profile/bank-details - update bank details + PAN (JSON, Bearer required). */
  updateProfile: (payload) =>
    apiClient.patch("/food/delivery/profile/bank-details", payload ?? {}, {
      contextModule: "delivery",
    }),
  /** PATCH /food/delivery/profile/bank-details - multipart updates for bank details + UPI QR (FormData required). */
  updateBankDetailsMultipart: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return apiClient.patch("/food/delivery/profile/bank-details", formData, {
      contextModule: "delivery",
    });
  },
  saveFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const path =
      platform === "mobile" ? "/fcm-tokens/mobile/save" : "/fcm-tokens/save";
    const payload =
      platform === "mobile"
        ? { token: String(token) }
        : { token: String(token), platform };
    return apiClient.post(
      path,
      payload,
      { contextModule: "delivery" },
    );
  },
  removeFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    return apiClient.delete(
      `/fcm-tokens/remove/${encodeURIComponent(String(token))}`,
      {
        data: { token: String(token), platform },
        contextModule: "delivery",
      },
    );
  },
  /** GET /food/delivery/support-tickets - list tickets for logged-in delivery partner. */
  getSupportTickets: () =>
    apiClient.get("/food/delivery/support-tickets", {
      contextModule: "delivery",
    }),
  /** POST /food/delivery/support-tickets - create ticket (body: subject, description, category?, priority?). */
  createSupportTicket: (body) =>
    apiClient.post("/food/delivery/support-tickets", body ?? {}, {
      contextModule: "delivery",
    }),
  /** GET /food/delivery/support-tickets/:id - get one ticket (own only). */
  getSupportTicketById: (id) =>
    apiClient.get(`/food/delivery/support-tickets/${id}`, {
      contextModule: "delivery",
    }),
  /** PATCH /food/delivery/availability - set online/offline (and optional lat/lng). */
  updateOnlineStatus: (isOnline) =>
    apiClient.patch(
      "/food/delivery/availability",
      { status: isOnline ? "online" : "offline" },
      { contextModule: "delivery" },
    ),
  updateLocation: (latitude, longitude, isOnline, extras = {}) =>
    apiClient.patch(
      "/food/delivery/availability",
      { status: isOnline ? "online" : "offline", latitude, longitude, ...extras },
      { contextModule: "delivery" },
    ),
  /** Orders */
  getOrders: (() => {
    // Collapse duplicate list fetches triggered by multiple effects + StrictMode.
    let inFlight = new Map(); // key -> Promise
    let cache = new Map(); // key -> { at, res }
    const CACHE_MS = 2500;

    const stableKey = (p = {}) => {
      const safe = p && typeof p === "object" ? { ...p } : {};
      // Ensure stable ordering + defaults.
      const normalized = { limit: 50, page: 1, ...safe };
      // Remove cache-busters if any.
      delete normalized._ts;
      return JSON.stringify(
        Object.keys(normalized)
          .sort()
          .reduce((acc, k) => {
            acc[k] = normalized[k];
            return acc;
          }, {}),
      );
    };

    return (params = {}) => {
      const key = stableKey(params);
      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.at < CACHE_MS)
        return Promise.resolve(cached.res);

      const existing = inFlight.get(key);
      if (existing) return existing;

      const p = apiClient
        .get("/food/delivery/orders/available", {
          params: { limit: 50, page: 1, ...params },
          contextModule: "delivery",
        })
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  getOrderDetails: (() => {
    // Collapse duplicate calls coming from multiple effects (and React StrictMode in dev).
    let inFlight = new Map(); // key -> Promise
    let cache = new Map(); // key -> { at, res }
    const CACHE_MS = 1200;

    const isProbablyOrderIdentity = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return false;
      // Mongo ObjectId
      return /^[a-f0-9]{24}$/i.test(raw);
    };

    return (orderId) => {
      const key = String(orderId || "").trim();
      if (!isProbablyOrderIdentity(key)) {
        return Promise.resolve({
          data: { success: false, message: "Invalid order id", data: null },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {},
        });
      }

      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.at < CACHE_MS)
        return Promise.resolve(cached.res);

      const existing = inFlight.get(key);
      if (existing) return existing;

      const p = apiClient
        .get(`/food/delivery/orders/${key}`, { contextModule: "delivery" })
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  /** GET /food/delivery/current - fallback for some UI hooks */
  getCurrentDelivery: () => apiClient.get("/food/delivery/orders/current", { contextModule: "delivery" }),
  acceptOrder: (orderId, body = {}) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/accept`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  rejectOrder: (orderId, body = {}) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/reject`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  /**
   * PATCH /food/delivery/orders/:orderId/reached-pickup
   * Marks "reached pickup" (arrival at restaurant) in backend order deliveryState.
   */
  confirmReachedPickup: (orderId) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/reached-pickup`,
      {},
      { contextModule: "delivery" },
    ),
  /**
   * Confirm order ID and upload bill image (Picked Up slide).
   * Backend endpoint: PATCH /food/delivery/orders/:id/confirm-pickup
   */
  confirmOrderId: (orderId, confirmedOrderId, location = {}, data = {}) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/confirm-pickup`,
      {
        confirmedOrderId,
        latitude: location.lat,
        longitude: location.lng,
        billImageUrl: data.billImageUrl,
      },
      {
        contextModule: "delivery",
      },
    ),
  confirmReachedDrop: (orderId) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/reached-drop`,
      {},
      {
        contextModule: "delivery",
      },
    ),
  verifyDropOtp: (orderId, otp) =>
    apiClient.post(
      `/food/delivery/orders/${String(orderId)}/verify-drop-otp`,
      { otp: String(otp) },
      {
        contextModule: "delivery",
      },
    ),
  /** POST /food/delivery/orders/:orderId/collect/qr - create Razorpay payment link (COD collection) */
  createCollectQr: (orderId, body = {}) =>
    apiClient.post(
      `/food/delivery/orders/${String(orderId)}/collect/qr`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  /** GET /food/delivery/orders/:orderId/payment-status - check COD/QR payment status */
  getPaymentStatus: (orderId) =>
    apiClient.get(`/food/delivery/orders/${String(orderId)}/payment-status`, {
      contextModule: "delivery",
    }),

  switchToCash: (orderId) =>
    apiClient.post(`/food/delivery/orders/${String(orderId)}/collect/cash`, {}, {
      contextModule: "delivery",
    }),
  completeDelivery: (orderId, body = {}) => {

    // Backward-compatible: older UI calls completeDelivery(orderId, rating, review)
    // where rating is a number (sent as raw JSON like "3"). Normalize to an object.
    let payload = body ?? {};
    if (
      typeof payload === "number" ||
      typeof payload === "string" ||
      payload == null
    ) {
      payload = { rating: payload == null ? null : Number(payload) };
    }
    return apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/complete`,
      payload,
      {
        contextModule: "delivery",
      },
    );
  },
  updateOrderStatus: (orderId, body = {}) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/status`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  /** Registration Re-verification */
  reverify: () =>
    apiClient.post(
      "/food/delivery/reverify",
      {},
      { contextModule: "delivery" },
    ),
  /** GET /food/delivery/wallet - wallet for Pocket/requests page (backend) */
  getWallet: () =>
    apiClient.get("/food/delivery/wallet", { contextModule: "delivery" }),
  /** GET /food/delivery/earnings - earnings summary for Pocket/requests page */
  getEarnings: (params) =>
    apiClient.get("/food/delivery/earnings", {
      params: params ?? {},
      contextModule: "delivery",
    }),
  /** Earning Addons (Hotspots/Bonus) */
  getActiveEarningAddons: () =>
    apiClient.get("/food/delivery/earning-extras/active", {
      contextModule: "delivery",
    }),
  /** GET /food/delivery/trip-history - completed/cancelled/pending trips for delivery partner */
  getTripHistory: (params) =>
    apiClient.get("/food/delivery/trip-history", {
      params: params ?? {},
      contextModule: "delivery",
    }),
  /** GET /food/delivery/pocket-details - single-call week details (trips + transactions) */
  getPocketDetails: (params) =>
    apiClient.get("/food/delivery/pocket-details", {
      params: params ?? {},
      contextModule: "delivery",
    }),
  /** GET /food/delivery/emergency-help - admin-set emergency numbers for delivery partner */
  getEmergencyHelp: () =>
    apiClient.get("/food/delivery/emergency-help", {
      contextModule: "delivery",
    }),
  /** GET /food/delivery/cash-limit - admin-set cash limit for delivery partner */
  getCashLimit: () =>
    apiClient.get("/food/delivery/cash-limit", {
      contextModule: "delivery",
    }),
  createWithdrawalRequest: (body) =>
    apiClient.post("/food/delivery/wallet/withdraw", body ?? {}, {
      contextModule: "delivery"
    }),
  createDepositOrder: (amount) =>
    apiClient.post("/food/delivery/wallet/deposit/order", { amount }, {
      contextModule: "delivery"
    }),
  verifyDepositPayment: (body) =>
    apiClient.post("/food/delivery/wallet/deposit/verify", body ?? {}, {
      contextModule: "delivery"
    }),
  /** Wallet transactions - from wallet response (no separate backend endpoint) */
  getWalletTransactions: (params) =>
    apiClient
      .get("/food/delivery/wallet", {
        params: params ?? {},
        contextModule: "delivery",
      })
      .then((res) => ({
        ...res,
        data: {
          ...res.data,
          data: {
            transactions: res?.data?.data?.wallet?.transactions ?? [],
          },
        },
      })),
  /** Zone discovery */
  getZonesInRadius: (lat, lng, radiusKm = 10) =>
    apiClient.get("/food/zones/nearby", {
      params: { lat, lng, radius: radiusKm },
      contextModule: "delivery",
    }),
};

export const userAPI = {
  getPublicFeeSettings: () => apiClient.get("/food/user/fee-settings", { contextModule: "user" }),
  deleteCurrentUserAccount: () => apiClient.delete('/food/user/profile', { contextModule: 'user' }),
  /** Get current user profile (Bearer USER). */
  getProfile: () =>
    getUserMeOnce().then((res) => {
      const user =
        res?.data?.data?.user ??
        res?.data?.user ??
        res?.data?.data ??
        res?.data;
      return { ...res, data: { ...res.data, data: { user } } };
    }),
  /** PATCH /food/user/profile (Bearer USER) */
  updateProfile: (body) =>
    apiClient.patch("/food/user/profile", body ?? {}, {
      contextModule: "user",
    }),
  /** Upload and set user profile image (multipart). Field name: file */
  uploadProfileImage: (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.post("/food/user/profile/profile-image", formData, {
      contextModule: "user",
    });
  },
  /** GET /food/user/wallet (Bearer USER). Deduped + short-cached. */
  getWallet: (() => {
    let inFlight = null;
    let cached = null;
    let cacheTime = 0;
    const CACHE_MS = 3000;
    return () => {
      const now = Date.now();
      if (cached && now - cacheTime < CACHE_MS) return Promise.resolve(cached);
      if (!inFlight) {
        inFlight = apiClient
          .get("/food/user/wallet", { contextModule: "user" })
          .then((res) => {
            cached = res;
            cacheTime = Date.now();
            return res;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    };
  })(),
  /** GET /food/user/referrals/stats (Bearer USER) */
  getReferralStats: () =>
    apiClient.get("/food/user/referrals/stats", { contextModule: "user" }),
  /** GET /food/user/referrals/details (Bearer USER) */
  getReferralDetails: () =>
    apiClient.get("/food/user/referrals/details", { contextModule: "user" }),
  /** POST /food/user/wallet/topup/order (Bearer USER). Body: { amount } */
  createWalletTopupOrder: (amount) =>
    apiClient.post(
      "/food/user/wallet/topup/order",
      { amount: Number(amount) },
      { contextModule: "user" },
    ),
  /** POST /food/user/wallet/topup/verify (Bearer USER) */
  verifyWalletTopupPayment: (body) =>
    apiClient.post("/food/user/wallet/topup/verify", body ?? {}, {
      contextModule: "user",
    }),
  /** GET /food/user/addresses (Bearer USER). Deduped + short-cached. */
  getAddresses: (() => {
    let inFlight = null;
    let cached = null;
    let cacheTime = 0;
    const CACHE_MS = 3000;
    return () => {
      const now = Date.now();
      if (cached && now - cacheTime < CACHE_MS) return Promise.resolve(cached);
      if (!inFlight) {
        inFlight = apiClient
          .get("/food/user/addresses", { contextModule: "user" })
          .then((res) => {
            cached = res;
            cacheTime = Date.now();
            return res;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    };
  })(),
  /** POST /food/user/addresses (Bearer USER) */
  addAddress: (body) =>
    apiClient.post("/food/user/addresses", body ?? {}, {
      contextModule: "user",
    }),
  /** PATCH /food/user/addresses/:id (Bearer USER) */
  updateAddress: (id, body) =>
    apiClient.patch(`/food/user/addresses/${String(id)}`, body ?? {}, {
      contextModule: "user",
    }),
  /** DELETE /food/user/addresses/:id (Bearer USER) */
  deleteAddress: (id) =>
    apiClient.delete(`/food/user/addresses/${String(id)}`, {
      contextModule: "user",
    }),
  /** PATCH /food/user/addresses/:id/default (Bearer USER) */
  setDefaultAddress: (id) =>
    apiClient.patch(
      `/food/user/addresses/${String(id)}/default`,
      {},
      { contextModule: "user" },
    ),
  /** POST /food/user/safety-emergency-reports (Bearer USER) */
  createSafetyEmergencyReport: (message) =>
    apiClient.post(
      "/food/user/safety-emergency-reports",
      { message: String(message || "") },
      { contextModule: "user" },
    ),
  /** GET /food/user/safety-emergency-reports (Bearer USER) */
  getMySafetyEmergencyReports: (params) =>
    apiClient.get("/food/user/safety-emergency-reports", {
      params: params ?? {},
      contextModule: "user",
    }),
  /**
   * Legacy UI compatibility: update "current user location".
   * We already persist the user's selected location in localStorage in the UI.
   * Keep this as a no-op success so existing flows don't break.
   */
  updateLocation: (_payload) =>
    Promise.resolve({
      data: { success: true, message: "Location saved (client)", data: null },
    }),
  saveFcmToken: (token, options = {}) => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    const path =
      platform === "mobile" ? "/fcm-tokens/mobile/save" : "/fcm-tokens/save";
    const payload =
      platform === "mobile"
        ? { token: String(token) }
        : { token: String(token), platform };
    return apiClient.post(
      path,
      payload,
      { contextModule: "user" },
    );
  },
  removeFcmToken: (token, options = {}) => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    return apiClient.delete(
      `/fcm-tokens/remove/${encodeURIComponent(String(token))}`,
      {
        data: { token: String(token), platform },
        contextModule: "user",
      },
    );
  },
  testFcmNotification: (options = {}) => {
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    return apiClient.post("/fcm-tokens/test", { platform }, { contextModule: "user" });
  },
};
export const locationAPI = createStubAPI();
export const zoneAPI = {
  /** Public: detect active service zone for a lat/lng point. */
  detectZone: (lat, lng) =>
    apiClient.get("/food/zones/detect", {
      params: { lat, lng },
    }),
  /** Public: list active zones (for onboarding dropdowns). */
  getPublicZones: (params = {}, config = {}) =>
    apiClient.get("/food/zones/public", { params: params ?? {}, ...config }),
};
export const uploadAPI = {
  /**
   * Upload a single image file to the backend (Cloudinary-backed).
   * @param {File|Blob} file
   * @param {{ folder?: string }} options
   */
  uploadMedia: (file, options = {}) => {
    if (!file) {
      return Promise.reject(new Error("File is required for upload"));
    }

    const formData = new FormData();
    formData.append("file", file);
    if (options.folder) {
      formData.append("folder", options.folder);
    }

    return apiClient.post("/uploads/image", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
};
/** Order API (user app – Bearer USER token). Minimal calls: single create/verify, list/details cached by caller. */
export const orderAPI = {
  calculateOrder: (payload) =>
    apiClient.post("/food/orders/calculate", payload ?? {}, {
      contextModule: "user",
    }),
  createOrder: (payload) =>
    apiClient.post("/food/orders", payload ?? {}, { contextModule: "user" }),
  verifyPayment: (body) =>
    apiClient.post("/food/orders/verify-payment", body ?? {}, {
      contextModule: "user",
    }),
  getOrders: (params = {}) =>
    apiClient
      .get("/food/orders", {
        params: { limit: 20, page: 1, ...params },
        contextModule: "user",
      })
      .then((res) => {
        const payload = res?.data?.data;

        // Normalize backend paginated shape:
        // { data: { data: [...], meta: { total, page, limit, totalPages } } }
        // into UI-friendly:
        // { data: { orders: [...], pagination: { total, page, limit, pages } } }
        if (
          payload &&
          typeof payload === "object" &&
          Array.isArray(payload.data) &&
          payload.meta &&
          typeof payload.meta === "object"
        ) {
          const meta = payload.meta;
          return {
            ...res,
            data: {
              ...res.data,
              data: {
                ...payload,
                orders: payload.data,
                pagination: {
                  total: Number(meta.total || 0),
                  page: Number(meta.page || 1),
                  limit: Number(meta.limit || params.limit || 20),
                  pages: Number(meta.totalPages || 1),
                },
              },
            },
          };
        }

        return res;
      }),
  getOrderDetails: (() => {
    const inFlight = new Map();
    const cache = new Map();
    /** Dedupes overlapping calls (StrictMode, poll + socket) without hiding fresh data for long. */
    const CACHE_MS = 800;

    return (orderId, options = {}) => {
      const key = String(orderId ?? "").trim();
      if (!key) {
        return Promise.reject(new Error("orderId required"));
      }

      const force = options.force === true;
      const now = Date.now();
      if (!force) {
        const hit = cache.get(key);
        if (hit && now - hit.at < CACHE_MS) {
          return Promise.resolve(hit.res);
        }
      }

      const pending = inFlight.get(key);
      if (pending) return pending;

      const p = apiClient
        .get(`/food/orders/${key}`, { contextModule: "user" })
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  cancelOrder: (orderId, body = {}) =>
    apiClient.patch(`/food/orders/${String(orderId)}/cancel`, body ?? {}, {
      contextModule: "user",
    }),
  updateOrderInstructions: (orderId, instructions) =>
    apiClient.patch(`/food/orders/${String(orderId)}/instructions`, { instructions }, {
      contextModule: "user",
    }),
  submitOrderRatings: (orderId, body = {}) =>
    apiClient.patch(`/food/orders/${String(orderId)}/ratings`, body ?? {}, { contextModule: "user" }),
  /** Submit a complaint for an order (user). */
  submitComplaint: (payload) =>
    apiClient.post(
      "/food/user/support/ticket",
      {
        type: "order",
        orderId: payload.orderId,
        issueType: payload.complaintType,
        description: `${payload.subject}: ${payload.description}`,
      },
      { contextModule: "user" }
    ),
};
export const heroBannerAPI = createStubAPI();
export const publicAPI = createStubAPI();
