/**
 * Central API client for backend (auth and future APIs).
 * - baseURL from VITE_API_BASE_URL (e.g. https://k9rides.onrender.com/api/v1)
 * - When baseURL ends with /api/v1, request paths must NOT include /v1 (use /food/..., /auth/...)
 * - Attaches Bearer token (user or admin based on request URL)
 * - On 401: attempts refresh, retries once; on refresh failure logs out
 */

import axios from "axios";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const resolveApiBaseUrl = () => {
  const envValue =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL
      ? String(import.meta.env.VITE_API_BASE_URL).trim().replace(/\/$/, "")
      : "";

  if (!envValue) return "";

  // Safety fallback:
  // If a localhost API URL is baked into a deployed build, the browser on production
  // machines will try connecting to THEIR localhost and requests will hang/timeout.
  // In that case, force same-origin API path so production routing/proxy can handle it.
  try {
    const parsed = new URL(envValue);
    if (typeof window !== "undefined") {
      const isEnvLocal = LOCAL_HOSTS.has(parsed.hostname);
      const isBrowserLocal = LOCAL_HOSTS.has(window.location.hostname);
      if (isEnvLocal && !isBrowserLocal) {
        return "";
      }
    }
  } catch (_) {
    // Keep original value when parsing fails (relative/custom values).
  }

  return envValue;
};

// Prefer explicit env. If not set, use same-origin (works with reverse proxy).
const baseURL = resolveApiBaseUrl();

const apiClient = axios.create({
  baseURL: baseURL || undefined,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

function getModuleFromUrl(url = "") {
  const u = typeof url === "string" ? url : (url?.url || "");
  if (!u) return "user";
  
  const normalized = u.toLowerCase();
  
  // Admin detection
  if (
    normalized.includes("/admin/") ||
    normalized.includes("/food/admin/") ||
    normalized.includes("/food/auth/admin") ||
    normalized.includes("/auth/admin") ||
    normalized.includes("admin/login")
  ) return "admin";

  // Landing management (hero/top banners) is an admin surface even though its URLs
  // carry no /admin/ segment -- the backend guards every non-public path on it with
  // requireRoles('ADMIN'). Classifying it as "user" meant no admin token was attached
  // and every banner call 401'd on pages that rely on the interceptor. Public reads
  // stay unclassified so the user app's banner fetches keep working tokenless.
  /*
   * `/showcase-items` is the ad-blocker-safe alias for `/hero-banners`, added
   * after this rule and not covered by it. uBlock and friends abort any XHR
   * whose URL contains "banner", so the client calls the alias and the SERVER
   * rewrites it back -- which means the URL this function sees never says
   * "hero-banners" any more.
   *
   * The result was a 401 on every banner write that carries no /admin/
   * segment, uploading a promotion banner among them: classified as "user", no
   * admin token attached, and the request rejected while the operator was
   * plainly signed in.
   *
   * Public reads stay unclassified so the customer app's banner fetches keep
   * working without a token.
   */
  if (
    (normalized.includes("/hero-banners") ||
      normalized.includes("/showcase-items") ||
      normalized.includes("/top-banners")) &&
    !/\/public(\?|$)/.test(normalized)
  ) return "admin";
  
  // Delivery detection - Catch all delivery-specific functional and auth routes
  if (
    normalized.includes("/food/delivery") || 
    normalized.includes("/auth/delivery") || 
    normalized.includes("/delivery/")
  ) return "delivery";
  
  // Restaurant detection - Catch all restaurant-specific functional and auth routes
  if (
    normalized.includes("/food/restaurant/") || 
    normalized.includes("/auth/restaurant") || 
    normalized.includes("/restaurant/")
  ) {
    // Exception: /food/restaurants (plural) is usually a public user app route
    if (normalized.includes("/food/restaurants") && !normalized.includes("/food/restaurant/")) {
       return "user";
    }
    return "restaurant";
  }
  
  return "user";
}

function getModuleFromConfig(config) {
  if (config?.contextModule) return config.contextModule;
  return getModuleFromUrl(config?.url);
}

function decodeJwtPayload(token) {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isTokenForModule(token, module) {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const role = String(payload.role || "").toLowerCase();

  if (module === "user") return role === "user" && Boolean(payload.userId);
  // super_admin included: promoting an account changed its token role and made this
  // exact match silently DROP the stored admin token from admin requests.
  if (module === "admin") return ["admin", "super_admin"].includes(role) && Boolean(payload.userId);
  if (module === "restaurant") return role === "restaurant" && Boolean(payload.userId);
  if (module === "delivery") return ["delivery_partner", "delivery"].includes(role) && Boolean(payload.userId);

  return true;
}

/**
 * The shared upload endpoint is used by every panel, so no single module owns
 * it. Classifying it (it has no /admin/ or /restaurant/ segment) landed it on
 * "user", which meant an admin session attached no token at all -- fine while
 * the endpoint was open to anyone, and immediately broken once it was not.
 *
 * Whichever panel the operator is signed into is the right token, so try them
 * in turn and send the first real one.
 */
const UPLOAD_TOKEN_ORDER = ["admin", "restaurant", "delivery", "user"];

function getUploadToken(preferred) {
  // Try the module this request was classified as first, then the rest. A
  // restaurant uploading a dish photo holds only restaurant_accessToken, an
  // admin only admin_accessToken, and the endpoint accepts either.
  const order = UPLOAD_TOKEN_ORDER.includes(preferred)
    ? [preferred, ...UPLOAD_TOKEN_ORDER.filter((m) => m !== preferred)]
    : UPLOAD_TOKEN_ORDER;

  for (const module of order) {
    try {
      const token = localStorage.getItem(`${module}_accessToken`);
      if (token && isTokenForModule(token, module)) return token;
    } catch {
      // localStorage can throw in a private window; just try the next one.
    }
  }
  try {
    return localStorage.getItem("accessToken") || null;
  } catch {
    return null;
  }
}

function getAccessToken(config) {
  const module = getModuleFromConfig(config);

  /*
   * Uploads take whichever panel token the operator holds.
   *
   * This was previously gated on `!config.contextModule`, meaning "the caller
   * did not name a module" -- but the request interceptor assigns
   * contextModule before calling this, so the guard was never true. The
   * fallback never ran, /uploads/image classified as "user", and a restaurant
   * adding a dish photo sent no token at all: "Authentication token missing".
   */
  if (/\/uploads\//.test(String(config?.url || ""))) {
    const uploadToken = getUploadToken(module);
    if (uploadToken) return uploadToken;
  }
  const key = `${module}_accessToken`;
  try {
    // 1. Try module-specific token first
    const moduleToken = localStorage.getItem(key);
    if (moduleToken && isTokenForModule(moduleToken, module)) return moduleToken;
    
    // 2. Fallback to generic token only if it matches this Food module shape.
    if (module !== "admin") {
      const genericToken = localStorage.getItem("accessToken");
      return genericToken && isTokenForModule(genericToken, module) ? genericToken : null;
    }
    return null;
  } catch {
    return null;
  }
}

function getRefreshToken(module) {
  try {
    // 1. Try module-specific refresh token
    const moduleRefreshToken = localStorage.getItem(`${module}_refreshToken`);
    if (moduleRefreshToken) return moduleRefreshToken;
    
    // 2. Fallback to generic refresh token only for non-admin modules
    if (module !== "admin") {
      return localStorage.getItem("refreshToken") || null;
    }
    return null;
  } catch {
    return null;
  }
}

function clearModuleAuth(module) {
  try {
    localStorage.removeItem(`${module}_accessToken`);
    localStorage.removeItem(`${module}_refreshToken`);
    localStorage.removeItem(`${module}_authenticated`);
    localStorage.removeItem(`${module}_user`);
    if (module === "restaurant") localStorage.removeItem(RESTAURANT_VERTICAL_KEY);
    if (module === "admin") localStorage.removeItem("admin_access");
    if (module === "user") {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      localStorage.removeItem("authenticated");
      localStorage.removeItem("user");
    }
  } catch (_) {}
}

let isRefreshing = false;
let refreshSubscribers = [];

function subscribeToRefresh(cb) {
  refreshSubscribers.push(cb);
}

function onRefreshed(newToken, module) {
  refreshSubscribers.forEach((cb) => cb(newToken, module));
  refreshSubscribers = [];
}

/** The server looked at the refresh token and said no: the session is over. */
const isRefreshRejected = (error) => [400, 401, 403].includes(error?.response?.status);

/*
 * Refresh, riding out an API restart.
 *
 * A restart leaves the API unreachable for ~15 seconds (502s from nginx), so a
 * transient failure is retried after 2s, 4s and 8s before giving up. A
 * rejection is final at once -- retrying a refused token only delays sign-out.
 */
const REFRESH_RETRY_DELAYS_MS = [2000, 4000, 8000];
async function postRefreshWithRetry(refreshUrl, refreshToken) {
  let lastError;
  for (let attempt = 0; attempt <= REFRESH_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAYS_MS[attempt - 1]));
    }
    try {
      return await axios.post(refreshUrl, { refreshToken }, { timeout: 10000 });
    } catch (error) {
      if (isRefreshRejected(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/** A refresh that could not reach the server: fail the waiting requests, keep the login. */
function onRefreshAborted(module) {
  refreshSubscribers.forEach((cb) => cb(null, module));
  refreshSubscribers = [];
}

function onRefreshFailed(module) {
  clearModuleAuth(module);
  // Fail any queued requests that were waiting for this refresh
  refreshSubscribers.forEach((cb) => cb(null, module));
  refreshSubscribers = [];
  
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("authRefreshFailed", { detail: { module } }));
  }
}

/**
 * Point the admin screens at quick-commerce when they are being viewed there.
 *
 * /admin/food and /admin/quick-commerce render the SAME components (see AdminRouter),
 * because quick-commerce is a fork of this repo's food module and its admin API is the
 * identical route table under /v1/qc/admin. Rather than thread a prefix through the
 * ~150 call sites in services/api, the swap happens here, once.
 *
 * Derived from the current URL rather than held in a module variable on purpose: a
 * mutable global would have to be kept in step with client-side navigation, and would
 * be wrong for any request already in flight when the admin switches vertical.
 *
 * The WHOLE /food namespace moves, not just /food/admin. quick-commerce mounts the
 * same routers master mounts under /v1/food -- admin, restaurant, delivery, orders,
 * user, notifications, search, dining and the landing router that owns hero-banners --
 * so /food/<x> and /qc/<x> are the same endpoint in two verticals.
 *
 * Rewriting only /food/admin (as this first did) left every other screen writing into
 * food while the operator was looking at quick-commerce. Banner uploads were the
 * visible case -- they post to /food/showcase-items/multiple, which is not under
 * /food/admin -- but restaurants, delivery, zones and orders had the same fault.
 *
 * EXCEPT auth: /food/auth/* stays pointed at the platform so one login covers every
 * vertical. That exclusion is the reason this is a negative-lookahead rather than a
 * blanket replace.
 */
const SHARED_FOOD_PREFIXES = ["auth"];

/**
 * The admin bases that speak to the quick-commerce API.
 *
 * Medical is not a fifth vertical: a pharmacy is a quick-commerce seller whose
 * storeType is 'pharmacy', so /admin/medical is these same screens on the same
 * API, narrowed to that one type. `scope` is what narrows them.
 */
const QC_ADMIN_BASES = [
  // "quick": every store type but pharmacy -- medical stores have their own
  // panel and must not be listed (or edited by mistake) under Quick Commerce.
  { base: "/admin/quick-commerce", scope: "quick" },
  { base: "/admin/medical", scope: "pharmacy" },
];

const currentQcBase = () => {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname;
  return QC_ADMIN_BASES.find((entry) => path.startsWith(entry.base)) || null;
};

/*
 * Stores and medical stores use the restaurant web dashboard.
 *
 * They are quick-commerce sellers: the same seller endpoints under /qc instead
 * of /food, which is exactly how the Partner app serves them. The /partner
 * sign-in marks the session; every restaurant-panel request then goes to /qc,
 * token refresh included. A normal restaurant login clears the mark
 * (setAuthData), as does signing out.
 */
export const RESTAURANT_VERTICAL_KEY = "restaurant_vertical"
const restaurantOnQc = () => {
  try {
    return localStorage.getItem(RESTAURANT_VERTICAL_KEY) === "qc"
  } catch {
    return false
  }
}

const rewriteAdminVertical = (url) => {
  if (typeof url !== "string" || !url) return url;
  if (!currentQcBase()) return url;
  const shared = SHARED_FOOD_PREFIXES.join("|");
  return url.replace(new RegExp(`(^|/)food/(?!(?:${shared})(?:/|$))`), "$1qc/");
};

/**
 * Narrow every admin read to the store type the panel is showing.
 *
 * Sent as a request parameter rather than filtered in the browser: the lists
 * are paginated server-side, so filtering the page after it arrives would show
 * "20 sellers" of which three are pharmacies, and page two might hold none. The
 * server refuses a store type it does not know, so a typo here fails loudly
 * instead of quietly widening the list back to every seller.
 *
 * Writes are left alone. They address one record by id, which is already
 * scoped by what the operator could see and click.
 */
/*
 * Zones are the one thing quick commerce and medical do NOT share.
 *
 * Everywhere else /admin/medical is quick commerce narrowed to pharmacies, so
 * a storeType parameter on reads is enough. Zones are their own collections --
 * a zone drawn for groceries must not decide where medicine can go -- and the
 * server cannot tell which panel is asking, because both render the same screen
 * against the same route.
 *
 * So the vertical is sent on EVERY zone call, writes included: creating,
 * renaming and deleting all have to land in the right map, and a write is
 * exactly where getting it wrong is permanent. In the query for reads and
 * deletes, in the body for the rest, because that is where each already carries
 * its payload.
 */
const ZONE_PATH = /(^|\/)(qc|food)\/admin\/zones(\/|$|\?)/;

const applyZoneVertical = (config) => {
  const entry = currentQcBase();
  if (!entry) return config;
  if (!ZONE_PATH.test(String(config.url || ""))) return config;

  const vertical = entry.base === "/admin/medical" ? "medical" : "quick";
  const method = String(config.method || "get").toLowerCase();

  config.params = { ...(config.params || {}), vertical };
  if (method === "post" || method === "patch" || method === "put") {
    if (config.data && typeof config.data === "object" && !(config.data instanceof FormData)) {
      config.data = { ...config.data, vertical };
    }
  }
  return config;
};

const applyVerticalScope = (config) => {
  const entry = currentQcBase();
  if (!entry?.scope) return config;
  const method = String(config.method || "get").toLowerCase();
  if (method !== "get") return config;
  // An explicit storeType from a screen wins: a medical screen may legitimately
  // ask a narrower question, and overriding it here would answer a different one.
  const params = config.params || {};
  if (params.storeType === undefined) {
    config.params = { ...params, storeType: entry.scope };
  }
  return config;
};

apiClient.interceptors.request.use(
  (config) => {
    config.url = rewriteAdminVertical(config.url);
    applyVerticalScope(config);
    // After the rewrite, so the path it matches is the one actually being sent.
    applyZoneVertical(config);
    config.contextModule = getModuleFromConfig(config);
    if (config.contextModule === "restaurant" && restaurantOnQc() && typeof config.url === "string") {
      config.url = config.url.replace(/(^|\/)food\//, "$1qc/");
    }

    // If sending FormData, let the browser set proper multipart boundary.
    if (config.data instanceof FormData) {
      if (config.headers && config.headers["Content-Type"]) {
        delete config.headers["Content-Type"];
      }
    }

    const token = getAccessToken(config);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (err) => Promise.reject(err)
);

apiClient.interceptors.response.use(
  (response) => response,
  async (err) => {
    const original = err?.config;
    if (err?.response?.status === 429) {
      return Promise.reject(err);
    }
    if (err?.response?.status !== 401 || !original || original._retry) {
      return Promise.reject(err);
    }
    /*
     * Never refresh-and-replay a credential being presented.
     *
     * A 401 from request-otp / verify-otp / login means the credential was
     * wrong, expired or already spent -- not that the access token needs
     * refreshing -- so the replay cannot succeed and is not free: verify-otp
     * counts every call against otpMaxAttempts, so five permitted tries became
     * two or three, and each duplicate submission was logged as a pair of
     * 401s rather than one.
     *
     * Other /auth/ routes (me, logout) are ordinary authenticated calls and
     * still refresh normally.
     */
    if (/\/auth\/[^?]*(request-otp|verify-otp|login)/.test(String(original.url || ""))) {
      return Promise.reject(err);
    }
    const module = original.contextModule || getModuleFromUrl(original.url);
    const refreshToken = getRefreshToken(module);
    if (!refreshToken) {
      clearModuleAuth(module);
      return Promise.reject(err);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        subscribeToRefresh((newToken) => {
          if (newToken) {
            original.headers.Authorization = `Bearer ${newToken}`;
            resolve(apiClient(original));
          } else {
            reject(err);
          }
        });
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      // Use relative URL so this works both with an explicit baseURL and with a dev proxy.
      // Use plain axios to avoid interceptor recursion.
      // A store's session was issued by quick commerce, so it refreshes there.
      const authPrefix = module === "restaurant" && restaurantOnQc() ? "qc" : "food";
      const refreshUrl = baseURL ? `${baseURL}/${authPrefix}/auth/refresh-token` : `/api/v1/${authPrefix}/auth/refresh-token`;
      const { data } = await postRefreshWithRetry(refreshUrl, refreshToken);
      const newAccessToken = data?.data?.accessToken || data?.accessToken;
      if (newAccessToken) {
        try {
          localStorage.setItem(`${module}_accessToken`, newAccessToken);
          // Dispatch a custom event specifically for the module that refreshed
          window.dispatchEvent(new CustomEvent("authRefreshed", { 
            detail: { module, token: newAccessToken } 
          }));
        } catch (_) {}
        onRefreshed(newAccessToken, module);
        original.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(original);
      }
    } catch (refreshError) {
      /*
       * Sign out ONLY when the server rejected the refresh token.
       *
       * This used to sign out on any failure -- including a 502 while the API
       * was restarting (each restart is ~15s, and they happen several times a
       * day), a dropped connection, or a 429. An admin whose 15-minute access
       * token expired inside one of those windows was thrown to the login page
       * with a 30-day refresh token that was still perfectly valid: the "panel
       * keeps closing and opening" the client reported. Now a transient failure
       * fails just this request and keeps the session for the next one.
       */
      if (isRefreshRejected(refreshError)) {
        onRefreshFailed(module);
      } else {
        onRefreshAborted(module);
      }
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }

    onRefreshFailed(module);
    return Promise.reject(err);
  }
);

export default apiClient;
