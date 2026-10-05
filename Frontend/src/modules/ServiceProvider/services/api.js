import axios from 'axios';
import { apiCache } from '../utils/apiCache';

// API Base URL.
//
// Standalone this was `${host}/api` and every service called '/admin/...', '/users/...'.
// Inside master the module is mounted at /api/v1/sp, so pointing the base there keeps
// all ~200 existing call sites working untouched. Vite proxies /api/v1 to the backend
// in dev (see vite.config.js), so a relative base works in both dev and prod.
const API_BASE_URL = import.meta.env.VITE_SP_API_BASE_URL || '/api/v1/sp';

// Master owns the admin session; the SP panel is a section inside master's /admin
// shell, so it must read master's keys rather than mint a parallel session. The
// legacy adminAccessToken/adminData keys stay as a fallback so a browser that still
// has a standalone-Homster session does not get bounced on first load.
const MASTER_ADMIN_KEYS = { access: 'admin_accessToken', refresh: 'admin_refreshToken', data: 'admin_user' };
const LEGACY_ADMIN_KEYS = { access: 'adminAccessToken', refresh: 'adminRefreshToken', data: 'adminData' };

const readToken = (key) => sessionStorage.getItem(key) || localStorage.getItem(key);

// Prefer master's session, fall back to a legacy standalone one.
export const getAdminAccessToken = () =>
  readToken(MASTER_ADMIN_KEYS.access) || readToken(LEGACY_ADMIN_KEYS.access);

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  },
  withCredentials: true // For cookies
});

// Helper to get token keys based on role/path
const getTokenKeys = (url) => {
  // 1. Prioritize current page context for role-based tokens.
  //    Under master the panel lives at /admin/sp/*, which still starts with /admin.
  if (window.location.pathname.startsWith('/admin')) {
    // Whichever session actually exists wins, master's first.
    const keys = readToken(MASTER_ADMIN_KEYS.access) ? MASTER_ADMIN_KEYS : LEGACY_ADMIN_KEYS;
    return { access: keys.access, refresh: keys.refresh, role: 'admin' };
  }
  if (window.location.pathname.startsWith('/vendor')) {
    return { access: 'vendorAccessToken', refresh: 'vendorRefreshToken', role: 'vendor' };
  }
  if (window.location.pathname.startsWith('/worker')) {
    return { access: 'workerAccessToken', refresh: 'workerRefreshToken', role: 'worker' };
  }

  // 2. Explicitly detect auth routes regardless of current page (for cross-role login/actions)
  if (url?.includes('/admin/auth')) {
    const keys = readToken(MASTER_ADMIN_KEYS.access) ? MASTER_ADMIN_KEYS : LEGACY_ADMIN_KEYS;
    return { access: keys.access, refresh: keys.refresh, role: 'admin' };
  }
  if (url?.includes('/vendors/auth')) return { access: 'vendorAccessToken', refresh: 'vendorRefreshToken', role: 'vendor' };
  if (url?.includes('/workers/auth')) return { access: 'workerAccessToken', refresh: 'workerRefreshToken', role: 'worker' };

  // 3. Fallback to user token (most common case for user app)
  return { access: 'accessToken', refresh: 'refreshToken', role: 'user' };
};

// Request interceptor - Add auth token
api.interceptors.request.use(
  (config) => {
    const { access } = getTokenKeys(config.url);
    const token = sessionStorage.getItem(access) || localStorage.getItem(access);

    // For debugging
    // console.log(`Request to ${config.url}, using token key: ${access}, token exists: ${!!token}`);

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Track if we're currently refreshing
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Response interceptor - Handle token refresh
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // If error is 401 and we haven't tried to refresh yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // If already refreshing, queue this request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(token => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch(err => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const { access, refresh, role } = getTokenKeys(originalRequest.url);
      const refreshToken = sessionStorage.getItem(refresh) || localStorage.getItem(refresh);

      if (!refreshToken) {
        // No refresh token, logout
        handleLogout(role);
        return Promise.reject(error);
      }

      try {
        // Determine correct refresh endpoint based on current path
        let refreshEndpoint = `${API_BASE_URL}/users/auth/refresh-token`; // Default to user
        if (role === 'vendor') refreshEndpoint = `${API_BASE_URL}/vendors/auth/refresh-token`;
        else if (role === 'worker') refreshEndpoint = `${API_BASE_URL}/workers/auth/refresh-token`;
        else if (role === 'admin') {
          // The admin session is minted by MASTER's login, not SP's, so it has to be
          // refreshed there too -- SP's own /admin/auth/refresh-token would reject a
          // master-issued refresh token.
          refreshEndpoint = readToken(MASTER_ADMIN_KEYS.access)
            ? '/api/v1/auth/refresh-token'
            : `${API_BASE_URL}/admin/auth/refresh-token`;
        }

        // Try to refresh the token
        const response = await axios.post(refreshEndpoint, { refreshToken });

        // SP replies { accessToken }, master replies { data: { accessToken } }.
        const accessToken = response.data?.accessToken || response.data?.data?.accessToken;
        if (!accessToken) {
          throw new Error('Refresh response contained no access token');
        }

        // Save new access token - Try session first, then local (update where it was found)
        if (sessionStorage.getItem(access)) {
          sessionStorage.setItem(access, accessToken);
        } else {
          localStorage.setItem(access, accessToken);
        }

        // Update authorization header
        api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;

        // Process queued requests
        processQueue(null, accessToken);
        isRefreshing = false;

        // Retry original request
        return api(originalRequest);
      } catch (refreshError) {
        console.error('RefreshToken failed:', refreshError);
        // Refresh failed, logout
        processQueue(refreshError, null);
        isRefreshing = false;
        handleLogout(role);
        return Promise.reject(refreshError);
      }
    }

    // Handle 403 Forbidden - Role mismatch or Invalid Token
    if (error.response?.status === 403) {
      console.error('Access Denied (403):', error.response.data.message);
      // Removed automatic logout to prevent login loops during debugging
    }

    return Promise.reject(error);
  }
);

// Handle logout
export const handleLogout = (role = null) => {
  if (!role) {
    // Determine role from path if not provided
    const path = window.location.pathname;
    if (path.startsWith('/admin')) role = 'admin';
    else if (path.startsWith('/vendor')) role = 'vendor';
    else if (path.startsWith('/worker')) role = 'worker';
    else role = 'user';
  }

  // Clear role-specific tokens selectively
  const clearTokens = (prefix) => {
    // Clear both sessionStorage and localStorage to prevent state mismatch
    sessionStorage.removeItem(`${prefix}AccessToken`);
    sessionStorage.removeItem(`${prefix}RefreshToken`);
    sessionStorage.removeItem(`${prefix}Data`);

    localStorage.removeItem(`${prefix}AccessToken`);
    localStorage.removeItem(`${prefix}RefreshToken`);
    localStorage.removeItem(`${prefix}Data`);
  };

  if (role === 'vendor') {
    clearTokens('vendor');
    if (window.location.pathname !== '/vendor/login') {
      window.location.href = '/vendor/login';
    }
  } else if (role === 'worker') {
    clearTokens('worker');
    sessionStorage.removeItem('workerDashboardCache');
    if (window.location.pathname !== '/worker/login') {
      window.location.href = '/worker/login';
    }
  } else if (role === 'admin') {
    clearTokens('admin'); // legacy adminAccessToken / adminRefreshToken / adminData
    // and master's session keys
    for (const k of Object.values(MASTER_ADMIN_KEYS)) {
      sessionStorage.removeItem(k);
      localStorage.removeItem(k);
    }
    localStorage.removeItem('admin_authenticated');
    if (window.location.pathname !== '/admin/login') {
      window.location.href = '/admin/login';
    }
  } else {
    // User
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userData');
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('refreshToken');
    sessionStorage.removeItem('userData');
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/user/login';
    }
  }
};

export { apiCache };
export default api;

