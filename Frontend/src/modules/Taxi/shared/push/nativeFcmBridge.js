import { saveDriverFcmToken, getLocalDriverToken } from '../../modules/driver/services/registrationService';
import { userAuthService, getLocalUserToken } from '../../modules/user/services/authService';

const PENDING_NATIVE_FCM_KEY = 'pendingNativeFcmRegistration';
const LAST_NATIVE_FCM_KEY = 'lastNativeFcmRegistration';

const isDriverPendingApprovalScreen = () => {
  const pathname = String(window.location.pathname || '').toLowerCase();
  return pathname === '/taxi/driver/registration-status' || pathname === '/taxi/driver/status';
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

const inferRole = (explicitRole) => {
  const normalizedRole = String(explicitRole || '').trim().toLowerCase();

  if (normalizedRole === 'driver' || normalizedRole === 'user') {
    return normalizedRole;
  }

  const pathname = String(window.location.pathname || '').toLowerCase();
  if (pathname.includes('/taxi/driver')) {
    return 'driver';
  }
  if (pathname.includes('/taxi/user')) {
    return 'user';
  }

  const storedCandidates = [
    sessionStorage.getItem('driverToken'),
    sessionStorage.getItem('token'),
    localStorage.getItem('userToken'),
    localStorage.getItem('token'),
  ].filter(Boolean);

  const tokenRole = storedCandidates
    .map((token) => getTokenPayload(token)?.role)
    .find((role) => role === 'driver' || role === 'user');

  return tokenRole || '';
};

const hasRoleSession = (role) => {
  if (role === 'driver') {
    return Boolean(getLocalDriverToken());
  }

  if (role === 'user') {
    return Boolean(getLocalUserToken());
  }

  return false;
};

const persistLastRegistration = (payload) => {
  localStorage.setItem(LAST_NATIVE_FCM_KEY, JSON.stringify({
    ...payload,
    updatedAt: new Date().toISOString(),
  }));
};

const savePendingRegistration = (payload) => {
  localStorage.setItem(PENDING_NATIVE_FCM_KEY, JSON.stringify({
    ...payload,
    updatedAt: new Date().toISOString(),
  }));
};

const readPendingRegistration = () => {
  try {
    return JSON.parse(localStorage.getItem(PENDING_NATIVE_FCM_KEY) || 'null');
  } catch {
    return null;
  }
};

const clearPendingRegistration = () => {
  localStorage.removeItem(PENDING_NATIVE_FCM_KEY);
};

const submitFcmToken = async ({ token, role, platform = 'mobile' }) => {
  const normalizedRole = inferRole(role);
  const normalizedPlatform = String(platform || 'mobile').trim().toLowerCase() || 'mobile';
  const normalizedToken = String(token || '').trim();

  if (!normalizedToken) {
    return { ok: false, reason: 'missing-token' };
  }

  if (!normalizedRole) {
    savePendingRegistration({ token: normalizedToken, role: '', platform: normalizedPlatform });
    return { ok: false, reason: 'missing-role' };
  }

  if (!hasRoleSession(normalizedRole)) {
    savePendingRegistration({ token: normalizedToken, role: normalizedRole, platform: normalizedPlatform });
    return { ok: false, reason: 'missing-auth' };
  }

  if (normalizedRole === 'driver' && isDriverPendingApprovalScreen()) {
    savePendingRegistration({ token: normalizedToken, role: normalizedRole, platform: normalizedPlatform });
    return { ok: false, reason: 'driver-pending-approval' };
  }

  if (normalizedRole === 'driver') {
    await saveDriverFcmToken(normalizedToken, normalizedPlatform);
  } else {
    await userAuthService.saveFcmToken(normalizedToken, normalizedPlatform);
  }

  clearPendingRegistration();
  persistLastRegistration({
    token: normalizedToken,
    role: normalizedRole,
    platform: normalizedPlatform,
  });

  return { ok: true, role: normalizedRole, platform: normalizedPlatform };
};

const flushPendingRegistration = async () => {
  const pending = readPendingRegistration();

  if (!pending?.token) {
    return { ok: false, reason: 'no-pending-token' };
  }

  try {
    return await submitFcmToken(pending);
  } catch (error) {
    console.warn('[native-fcm-bridge] pending registration failed', error?.message || error);
    return { ok: false, reason: 'submit-failed' };
  }
};

export const installNativeFcmBridge = () => {
  window.__saveNativeFcmToken = async (token, role, platform = 'mobile') => {
    try {
      const result = await submitFcmToken({ token, role, platform });
      console.info('[native-fcm-bridge] token registration result', result);
      return result;
    } catch (error) {
      console.error('[native-fcm-bridge] token registration error', error);
      savePendingRegistration({ token, role: inferRole(role), platform });
      return { ok: false, reason: error?.message || 'unknown-error' };
    }
  };

  window.__flushNativeFcmToken = async () => {
    const result = await flushPendingRegistration();
    console.info('[native-fcm-bridge] flush result', result);
    return result;
  };

  const retryPending = () => {
    flushPendingRegistration().catch(() => {});
  };

  window.addEventListener('focus', retryPending);
  window.addEventListener('pageshow', retryPending);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      retryPending();
    }
  });

  window.setTimeout(retryPending, 1500);
  window.setInterval(retryPending, 15000);
};
