const ADMIN_ACCESS_TOKEN_KEY = 'admin_accessToken';
const ADMIN_REFRESH_TOKEN_KEY = 'admin_refreshToken';
const ADMIN_USER_KEY = 'admin_user';
const LEGACY_ADMIN_TOKEN_KEY = 'adminToken';
const LEGACY_ADMIN_INFO_KEY = 'adminInfo';

const safeParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const decodePayload = (token) => {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const normalized = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(normalized));
  } catch {
    return null;
  }
};

const isTokenExpired = (token) => {
  const payload = decodePayload(token);
  if (!payload?.exp) return true;
  return Number(payload.exp) * 1000 <= Date.now();
};

export const normalizeAdminProfile = (profile = {}) => {
  const source = profile && typeof profile === 'object' ? profile : {};
  
  const isSuper = 
    source.adminLevel === 'platform_superadmin' || 
    source.adminLevel === 'food_superadmin' || 
    source.adminLevel === 'taxi_superadmin' || 
    String(source.admin_type || source.role || '').toLowerCase() === 'superadmin' ||
    (!source.parentAdminId && (source.role === 'ADMIN' || source.role === 'superadmin' || !source.admin_type));

  const adminType = isSuper ? 'superadmin' : 'subadmin';

  const permissions = Array.isArray(source.permissions)
    ? [...new Set(source.permissions.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];

  return {
    ...source,
    admin_type: adminType,
    role: String(source.role || adminType).trim() || adminType,
    permissions: adminType === 'superadmin'
      ? (permissions.includes('*') ? permissions : ['*', ...permissions])
      : permissions,
    service_location_ids: Array.isArray(source.service_location_ids) ? source.service_location_ids : [],
    zone_ids: Array.isArray(source.zone_ids) ? source.zone_ids : [],
  };
};

export const getUnifiedAdminToken = () =>
  localStorage.getItem(ADMIN_ACCESS_TOKEN_KEY) || localStorage.getItem(LEGACY_ADMIN_TOKEN_KEY) || null;

export const getUnifiedAdminProfile = () => {
  const unified = safeParse(localStorage.getItem(ADMIN_USER_KEY) || 'null');
  if (unified) return normalizeAdminProfile(unified);
  const legacy = safeParse(localStorage.getItem(LEGACY_ADMIN_INFO_KEY) || 'null');
  return normalizeAdminProfile(legacy || {});
};

export const isUnifiedAdminAuthenticated = () => {
  const token = getUnifiedAdminToken();
  return !!token && !isTokenExpired(token);
};

export const syncAdminSessionBridge = () => {
  const token = getUnifiedAdminToken();
  if (!token || isTokenExpired(token)) {
    return { token: null, user: null, isAuthenticated: false };
  }

  const user = getUnifiedAdminProfile();
  localStorage.setItem(LEGACY_ADMIN_TOKEN_KEY, token);
  localStorage.setItem(LEGACY_ADMIN_INFO_KEY, JSON.stringify(user));
  if (!localStorage.getItem(ADMIN_ACCESS_TOKEN_KEY)) {
    localStorage.setItem(ADMIN_ACCESS_TOKEN_KEY, token);
  }
  if (!localStorage.getItem(ADMIN_USER_KEY)) {
    localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(user));
  }

  return { token, user, isAuthenticated: true };
};

export const setUnifiedAdminSession = ({ token, user, refreshToken = null } = {}) => {
  if (!token) return;
  const normalizedUser = normalizeAdminProfile(user || {});

  localStorage.setItem(ADMIN_ACCESS_TOKEN_KEY, token);
  localStorage.setItem(LEGACY_ADMIN_TOKEN_KEY, token);
  localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(normalizedUser));
  localStorage.setItem(LEGACY_ADMIN_INFO_KEY, JSON.stringify(normalizedUser));

  if (refreshToken && typeof refreshToken === 'string') {
    localStorage.setItem(ADMIN_REFRESH_TOKEN_KEY, refreshToken);
  }
};

export const clearUnifiedAdminSession = () => {
  localStorage.removeItem(ADMIN_ACCESS_TOKEN_KEY);
  localStorage.removeItem(ADMIN_REFRESH_TOKEN_KEY);
  localStorage.removeItem(ADMIN_USER_KEY);
  localStorage.removeItem(LEGACY_ADMIN_TOKEN_KEY);
  localStorage.removeItem(LEGACY_ADMIN_INFO_KEY);
};
