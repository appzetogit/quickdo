import axios from 'axios';
import { API_BASE_URL, BACKEND_ORIGIN } from './runtimeConfig';
import { syncAdminSessionBridge } from '../../modules/admin/services/adminSession';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

const DEDUPED_GET_TTL_MS = 2500;
const dedupedGetRequests = new Map();
const recentDedupedGetResponses = new Map();

const isDedupedGet = (url = '') => {
  const requestPath = String(url || '').split('?')[0];

  return /^\/users\/me$/.test(requestPath) ||
    /^\/drivers\/me$/.test(requestPath) ||
    /^\/rides\/active\/me$/.test(requestPath) ||
    /^\/deliveries\/active\/me$/.test(requestPath) ||
    /^\/admin\/general-settings\/[^/]+$/.test(requestPath) ||
    /^\/common\/payment-gateway$/.test(requestPath) ||
    /^\/admin\/(countries|service-locations|notification-channels)$/.test(requestPath) ||
    /^\/(countries|common\/ride_modules)$/.test(requestPath);
};

const getDedupedRequestKey = (url = '', config = {}) => {
  const params = config?.params ? JSON.stringify(config.params) : '';
  return `${String(url || '')}|${params}`;
};

const decodeBase64Url = (value) => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4)) % 4;
  return normalized + '='.repeat(padding);
};

const getTokenPayload = (token) => {
  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    const payload = token.split('.')[1];

    if (!payload) {
      return null;
    }

    return JSON.parse(atob(decodeBase64Url(payload)));
  } catch {
    return null;
  }
};

const normalizeAuthRole = (role) => {
  const value = String(role || '').toLowerCase();
  if (value === 'super-admin') {
    return 'admin';
  }
  return value;
};

const getSessionItem = (key) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const getStoredTokenByRole = (role) => {
  const normalizedRole = normalizeAuthRole(role);
  const entries = (
    normalizedRole === 'driver' || normalizedRole === 'owner'
      ? [
          getSessionItem('driverToken'),
          getSessionItem('token'),
          localStorage.getItem('driverToken'),
          localStorage.getItem('token'),
        ]
      : [
          normalizedRole === 'admin' ? localStorage.getItem('admin_accessToken') : null,
          localStorage.getItem(`${role}Token`),
          localStorage.getItem('token'),
        ]
  ).filter(Boolean);

  return entries.find((token) => normalizeAuthRole(getTokenPayload(token)?.role) === normalizedRole) || null;
};

const getRoleFromPathname = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  const pathname = String(window.location.pathname || '').toLowerCase();

  if (pathname.includes('/admin')) {
    return 'admin';
  }

  // Owners currently authenticate with driver tokens (fleet-owner flow).
  if (pathname.includes('/taxi/owner')) {
    return 'driver';
  }

  if (pathname.includes('/taxi/driver') || pathname.includes('/driver')) {
    return 'driver';
  }

  if (pathname.includes('/taxi/user') || pathname.includes('/user')) {
    return 'user';
  }

  return '';
};

const clearStaleAuthState = (role = '', staleToken = '') => {
  const normalizedRole = normalizeAuthRole(role);
  const currentGenericToken = localStorage.getItem('token');
  const currentSessionGenericToken = getSessionItem('token');
  const shouldClearGenericToken =
    !staleToken ||
    currentGenericToken === staleToken ||
    currentSessionGenericToken === staleToken ||
    normalizeAuthRole(getTokenPayload(currentGenericToken)?.role) === normalizedRole;

  if (shouldClearGenericToken) {
    localStorage.removeItem('token');
    try {
      sessionStorage.removeItem('token');
    } catch {}
  }

  if (!normalizedRole || normalizedRole === 'user') {
    if (!staleToken || localStorage.getItem('userToken') === staleToken) {
      localStorage.removeItem('userToken');
    }
    localStorage.removeItem('userInfo');
  }

  if (!normalizedRole || normalizedRole === 'driver' || normalizedRole === 'owner') {
    if (!staleToken || localStorage.getItem('driverToken') === staleToken) {
      localStorage.removeItem('driverToken');
    }
    try {
      if (!staleToken || getSessionItem('driverToken') === staleToken) {
        sessionStorage.removeItem('driverToken');
      }
      sessionStorage.removeItem('driverInfo');
      sessionStorage.removeItem('chatRole');
    } catch {}
    localStorage.removeItem('driverInfo');
  }

  if (!normalizedRole || normalizedRole === 'admin') {
    if (!staleToken || localStorage.getItem('admin_accessToken') === staleToken) {
      localStorage.removeItem('admin_accessToken');
    }
    localStorage.removeItem('admin_refreshToken');
    localStorage.removeItem('admin_user');
    localStorage.removeItem('admin_access');
    if (!staleToken || localStorage.getItem('adminToken') === staleToken) {
      localStorage.removeItem('adminToken');
    }
    localStorage.removeItem('adminInfo');
  }

  localStorage.removeItem('chatRole');
};

const isAuthTokenFailure = (message = '') => {
  const normalized = String(message || '').trim().toLowerCase();
  if (!normalized) return false;

  return normalized.includes('authorization token has expired') ||
    normalized.includes('authorization token is invalid') ||
    normalized.includes('authorization token is required') ||
    normalized.includes('jwt expired');
};

// Request Interceptor: Attach Auth Token automatically
api.interceptors.request.use(
  (config) => {
    syncAdminSessionBridge();
    const requestPath = String(config.url || '').split('?')[0];
    const existingAuthorization =
      config.headers?.Authorization ||
      config.headers?.authorization ||
      (config.headers && typeof config.headers.get === 'function' ? config.headers.get('Authorization') : null);

    if (existingAuthorization) {
      return config;
    }

    const chatRole = localStorage.getItem('chatRole');
    const normalizedChatRole = String(chatRole || '').toLowerCase();
    const userToken = getStoredTokenByRole('user');
    const driverToken = getStoredTokenByRole('driver');
    const ownerToken = getStoredTokenByRole('owner');
    const adminToken = getStoredTokenByRole('admin') || localStorage.getItem('adminToken');

    const isPublicUserRoute =
      /^\/users\/(app-modules|goods-types|vehicle-types|register|signup|login|profile-image|auth\/send-otp|auth\/verify-otp|otp-login)(\/|$)/.test(requestPath);
    const isPublicDriverRoute =
      /^\/drivers\/(register|login|auth\/send-otp|auth\/verify-otp|onboarding\/send-otp|onboarding\/verify-otp|onboarding\/personal|onboarding\/referral|onboarding\/vehicle|onboarding\/documents|onboarding\/complete|onboarding\/session\/|service-locations)(\/|$)/.test(requestPath);
    const isAdminRoute =
      /^\/admin(\/|$)/.test(requestPath) ||
      /^\/(countries|common\/ride_modules|types\/|on-boarding(?:-|\/|$)|roles\/|permissions\/)/.test(requestPath);
    const isDriverRoute = /^\/drivers?(\/|$)/.test(requestPath);
    const isUserRoute = /^\/(users|rides|deliveries|promos)(\/|$)/.test(requestPath);
    const isSupportRoute = /^\/support(\/|$)/.test(requestPath);
    const isChatRoute = /^\/chats?(\/|$)/.test(requestPath);
    const pathRole = getRoleFromPathname();

    let token = null;

    if (isPublicUserRoute || isPublicDriverRoute) {
      token = null;
    } else if (isChatRoute) {
      if (normalizedChatRole === 'admin') {
        token = adminToken;
      } else if (normalizedChatRole === 'driver') {
        token = driverToken || ownerToken;
      } else if (normalizedChatRole === 'owner') {
        token = ownerToken || driverToken;
      } else if (normalizedChatRole === 'user') {
        token = userToken;
      }
    } else if (isAdminRoute) {
      token = adminToken;
    } else if (isSupportRoute) {
      if (pathRole === 'admin') {
        token = adminToken;
      } else if (pathRole === 'driver') {
        token = driverToken || ownerToken;
      } else {
        token = userToken;
      }
    } else if (isUserRoute) {
      token = userToken;
    } else if (isDriverRoute) {
      token = driverToken || ownerToken;
    } else {
      token = userToken || driverToken || ownerToken || adminToken;
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response Interceptor: Simplify responses and handle global errors
/*
 * Refreshing an expired access token.
 *
 * This client had no refresh at all. The moment an access token aged out, every
 * screen in the taxi panel showed "Authorization token has expired" and the
 * interceptor below cleared the session -- while a valid refresh token sat
 * untouched in localStorage. The food panel's client has refreshed since it was
 * written; this one simply never learned how, so the two halves of the same
 * admin session behaved differently.
 *
 * The admin session is shared: both panels read `admin_accessToken` and
 * `admin_refreshToken`, and /food/auth is the platform-wide auth service rather
 * than a food-specific one, so refreshing here refreshes the session the food
 * panel is using too.
 *
 * Plain axios, not `api`: this instance's response interceptor unwraps
 * `response.data` and clears auth on 401, both of which would fire on the
 * refresh call itself and turn one expired token into a logout.
 */
let refreshInFlight = null;
// True when the last refresh was refused by the server, false when it merely
// could not get through (restart, network). Only a refusal signs the admin out.
let lastRefreshRejected = false;

const readRefreshToken = () => {
  try {
    return localStorage.getItem('admin_refreshToken')
      || localStorage.getItem('refreshToken')
      || null;
  } catch {
    return null;
  }
};

const refreshAdminAccessToken = async () => {
  const refreshToken = readRefreshToken();
  if (!refreshToken) return null;

  // One refresh for however many requests hit 401 together. Without this a
  // dashboard that fires eight calls on load sends eight refreshes.
  if (!refreshInFlight) {
    /*
     * Built from BACKEND_ORIGIN, not API_BASE_URL.
     *
     * API_BASE_URL is always taxi-scoped -- runtimeConfig appends '/taxi' if it is
     * not already there -- so basing the refresh on it produced
     * /api/v1/taxi/food/auth/refresh-token, a 404. The request failed, the catch
     * below returned null, no retry was attempted and the session was cleared:
     * exactly the "Authorization token has expired" this function exists to
     * prevent, which is why adding it changed nothing.
     *
     * /food/auth is the platform-wide auth service and sits directly under
     * /api/v1, which is why the login call reaches it the same way.
     */
    const origin = String(BACKEND_ORIGIN || '').replace(/\/+$/, '');
    const url = `${origin}/api/v1/food/auth/refresh-token`;
    /*
     * Ride out an API restart (~15s of 502s): retry a transient failure after
     * 2s, 4s and 8s. A refusal (400/401/403) is final at once. Which of the two
     * it was is remembered, because only a refusal may end the session -- see
     * the response interceptor.
     */
    const post = async () => {
      let lastError;
      for (const delay of [0, 2000, 4000, 8000]) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          return await axios.post(url, { refreshToken }, { timeout: 10000 });
        } catch (err) {
          if ([400, 401, 403].includes(err?.response?.status)) {
            lastRefreshRejected = true;
            throw err;
          }
          lastError = err;
        }
      }
      throw lastError;
    };
    lastRefreshRejected = false;
    refreshInFlight = post()
      .then((res) => {
        const token = res?.data?.data?.accessToken || res?.data?.accessToken || null;
        if (token) {
          try {
            localStorage.setItem('admin_accessToken', token);
            // The food client listens for this and picks the token up without
            // a reload, so one refresh serves both panels.
            window.dispatchEvent(new CustomEvent('authRefreshed', {
              detail: { module: 'admin', token },
            }));
          } catch { /* private window: the in-memory retry below still works */ }
        }
        return token;
      })
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }

  return refreshInFlight;
};

api.interceptors.response.use(
  (response) => {
    // Pro-Level: Many APIs return data in data.data or data.result, you can flatten it here
    return response.data;
  },
  async (error) => {
    if (error.response) {
      // Global error handling: e.g. deleted or inactive account logout
      if (error.response.status === 401 || error.response.status === 403) {
        const serverMessage = String(error.response.data?.message || '');
        const authHeader = error.config?.headers?.Authorization || error.config?.headers?.authorization || '';
        const token = String(authHeader).startsWith('Bearer ') ? String(authHeader).slice(7) : '';
        const tokenRole = normalizeAuthRole(getTokenPayload(token)?.role || '');

        /*
         * An expired admin token is recoverable: refresh it and replay the
         * request, rather than clearing the session and showing the error.
         *
         * Only for an admin whose token has genuinely expired -- an invalid or
         * missing token, or a deleted account, is not something a refresh fixes,
         * and retrying those would loop. `_retry` bounds it to one attempt per
         * request whatever else goes wrong.
         */
        const isExpired = error.response.status === 401
          && String(serverMessage).toLowerCase().includes('expired');
        // Any admin-ish role, not just the default 'ADMIN'. A platform superadmin
        // carries role 'superadmin', which normalizeAuthRole leaves untouched --
        // gating on 'admin' alone would silently skip the refresh for exactly the
        // accounts that live in this panel all day.
        const isAdminToken = ['admin', 'superadmin', 'super-admin'].includes(tokenRole);
        if (isExpired && isAdminToken && error.config && !error.config._retry) {
          error.config._retry = true;
          const fresh = await refreshAdminAccessToken();
          if (fresh) {
            error.config.headers = error.config.headers || {};
            error.config.headers.Authorization = `Bearer ${fresh}`;
            return api(error.config);
          }
          /*
           * The refresh could not reach the server (API restarting, network).
           * The refresh token may be perfectly good, so fail this request and
           * keep the session: clearing it here is what threw admins out to
           * the login page several times a day.
           */
          if (readRefreshToken() && !lastRefreshRejected) {
            return Promise.reject({ ...error.response.data, status: error.response.status });
          }
        }

        const shouldClearAuth =
          (error.response.status === 401 && isAuthTokenFailure(serverMessage)) ||
          serverMessage === 'Authenticated account no longer exists' ||
          (tokenRole === 'user' && serverMessage === 'User account is not active');

        if (shouldClearAuth) {
          clearStaleAuthState(tokenRole, token);
          window.dispatchEvent(new CustomEvent('app:auth-stale', {
            detail: { role: tokenRole || null, message: serverMessage, token },
          }));
        }
      }
      return Promise.reject({ ...error.response.data, status: error.response.status });
    }

    return Promise.reject({ message: 'Network error or server down.' });
  }
);

const rawGet = api.get.bind(api);

api.get = (url, config = {}) => {
  if (!isDedupedGet(url)) {
    return rawGet(url, config);
  }

  const key = getDedupedRequestKey(url, config);
  const now = Date.now();
  const cached = recentDedupedGetResponses.get(key);

  if (cached && now - cached.timestamp < DEDUPED_GET_TTL_MS) {
    return Promise.resolve(cached.data);
  }

  const pending = dedupedGetRequests.get(key);

  if (pending) {
    return pending;
  }

  const request = rawGet(url, config)
    .then((data) => {
      recentDedupedGetResponses.set(key, {
        data,
        timestamp: Date.now(),
      });
      return data;
    })
    .finally(() => {
      dedupedGetRequests.delete(key);
    });

  dedupedGetRequests.set(key, request);
  return request;
};

export default api;
