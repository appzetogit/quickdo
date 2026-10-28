import api from './api';
import { registerFCMToken, removeFCMToken, getFCMToken } from './pushNotificationService';

/**
 * Notify Flutter WebView about successful login
 * This directly calls Flutter's captureLoginResponse handler
 * @param {object} responseData - The login response data containing accessToken and user/vendor/worker info
 */
function notifyFlutterLogin(responseData) {
  try {
    if (window.flutter_inappwebview && window.flutter_inappwebview.callHandler) {
      window.flutter_inappwebview.callHandler('captureLoginResponse', JSON.stringify({
        url: '/auth/login',
        body: responseData
      }));
    }
  } catch (e) {
    console.error('[AUTH] Error notifying Flutter:', e);
  }
}

/**
 * Get the current platform type (web or mobile)
 * @returns {'web' | 'mobile'}
 */
function getPlatformType() {
  if (typeof window === 'undefined') return 'web';
  const ua = window.navigator.userAgent || window.navigator.vendor || window.opera || '';
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS|Fios/i.test(ua);
  const isIPadOS = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isWebView = !!(window.flutter_inappwebview || window.ReactNativeWebView);
  return (isMobileUA || isIPadOS || isWebView) ? 'mobile' : 'web';
}

async function prepareAuthPayload(data = {}) {
  const platform = getPlatformType();
  let fcmToken = data.fcmToken || data.fcmTokenMobile || (data.token && data.token !== 'verification-pending' ? data.token : null);
  if (!fcmToken || fcmToken === 'verification-pending') {
    try {
      const tokenPromise = getFCMToken();
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 500));
      fcmToken = await Promise.race([tokenPromise, timeoutPromise]);
    } catch (e) {
      console.warn('[AUTH] Could not pre-fetch FCM token:', e);
    }
  }
  const cleanFcmToken = (fcmToken && fcmToken !== 'verification-pending') ? fcmToken : null;
  return {
    ...data,
    platform: data.platform || platform,
    ...(cleanFcmToken ? { fcmToken: cleanFcmToken, fcmTokenMobile: cleanFcmToken } : {})
  };
}

/**
 * User Authentication Service
 */
export const userAuthService = {
  // Send OTP
  sendOTP: async (phone, email = null) => {
    const response = await api.post('/users/auth/send-otp', { phone, email });
    return response.data;
  },

  // Verify Login (Unified Flow)
  verifyLogin: async (data) => {
    const payload = await prepareAuthPayload(data);
    const response = await api.post('/users/auth/verify-login', payload);
    if (response.data.success && !response.data.isNewUser && response.data.accessToken) {
      localStorage.setItem('accessToken', response.data.accessToken);
      localStorage.setItem('refreshToken', response.data.refreshToken);
      localStorage.setItem('userData', JSON.stringify(response.data.user));
      notifyFlutterLogin(response.data);
      registerFCMToken('user', false).catch(console.error);
    }
    return response.data;
  },

  // Register
  register: async (data) => {
    const payload = await prepareAuthPayload(data);
    const response = await api.post('/users/auth/register', payload);
    if (response.data.accessToken) {
      localStorage.setItem('accessToken', response.data.accessToken);
      localStorage.setItem('refreshToken', response.data.refreshToken);
      localStorage.setItem('userData', JSON.stringify(response.data.user));
      notifyFlutterLogin(response.data);
      registerFCMToken('user', false).catch(console.error);
    }
    return response.data;
  },

  // Login
  login: async (data) => {
    const payload = await prepareAuthPayload(data);
    const response = await api.post('/users/auth/login', payload);
    if (response.data.accessToken) {
      localStorage.setItem('accessToken', response.data.accessToken);
      localStorage.setItem('refreshToken', response.data.refreshToken);
      localStorage.setItem('userData', JSON.stringify(response.data.user));
      notifyFlutterLogin(response.data);
      registerFCMToken('user', false).catch(console.error);
    }
    return response.data;
  },

  // Logout
  logout: async () => {
    // Remove FCM token before logout
    await removeFCMToken('user');
    try {
      await api.post('/users/auth/logout', { platform: getPlatformType() });
    } catch (error) {
      console.error('Logout error:', error);
    }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userData');
  },

  // Get profile
  getProfile: async () => {
    const response = await api.get('/users/profile');
    if (response.data.user) {
      localStorage.setItem('userData', JSON.stringify(response.data.user));
    }
    return response.data;
  },

  // Update profile
  updateProfile: async (data) => {
    const response = await api.put('/users/profile', data);
    if (response.data.user) {
      localStorage.setItem('userData', JSON.stringify(response.data.user));
    }
    return response.data;
  },

  // Get checkout summary data
  getCheckoutData: async () => {
    const response = await api.get('/users/checkout-data');
    return response.data;
  },

  // Delete account
  deleteAccount: async () => {
    try {
      const response = await api.delete('/users/profile');
      
      // Cleanup locally
      try {
        await removeFCMToken('user');
      } catch (e) {
        console.warn('FCM token removal failed:', e);
      }
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('userData');
      
      return response.data;
    } catch (error) {
      console.error('Delete account error:', error);
      throw error;
    }
  }
};

/**
 * Vendor Authentication Service
 */
export const vendorAuthService = {
  // Send OTP
  sendOTP: async (phone, email = null) => {
    const response = await api.post('/vendors/auth/send-otp', { phone, email });
    return response.data;
  },

  // Verify Login (Unified Flow)
  verifyLogin: async (data) => {
    const response = await api.post('/vendors/auth/verify-login', data);
    if (response.data.success && !response.data.isNewUser && response.data.accessToken) {
      localStorage.setItem('vendorAccessToken', response.data.accessToken);
      localStorage.setItem('vendorRefreshToken', response.data.refreshToken);
      localStorage.setItem('vendorData', JSON.stringify(response.data.vendor));
      notifyFlutterLogin(response.data);
      registerFCMToken('vendor', false).catch(console.error);
    }
    return response.data;
  },

  // Register
  register: async (data) => {
    const response = await api.post('/vendors/auth/register', data);
    return response.data;
  },

  // Login
  login: async (data) => {
    // Remove email from login payload if present
    const { email, ...loginData } = data;
    const response = await api.post('/vendors/auth/login', loginData);
    if (response.data.accessToken) {
      localStorage.setItem('vendorAccessToken', response.data.accessToken);
      localStorage.setItem('vendorRefreshToken', response.data.refreshToken);
      localStorage.setItem('vendorData', JSON.stringify(response.data.vendor));
      notifyFlutterLogin(response.data);
      // Register FCM token after successful login
      console.log('[AUTH] Vendor login successful, registering FCM token...');
      try {
        const fcmToken = await registerFCMToken('vendor', false);
        if (fcmToken) {
          console.log('[AUTH] ✅ Vendor FCM token registered successfully');
        } else {
          console.log('[AUTH] ⚠️ Vendor FCM token registration returned null');
        }
      } catch (err) {
        console.error('[AUTH] ❌ Vendor FCM token registration failed:', err);
      }
    }
    return response.data;
  },

  // Logout
  logout: async () => {
    // Remove FCM token before logout
    await removeFCMToken('vendor');
    try {
      await api.post('/vendors/auth/logout', { platform: getPlatformType() });
    } catch (error) {
      console.error('Logout error:', error);
    }
    localStorage.removeItem('vendorAccessToken');
    localStorage.removeItem('vendorRefreshToken');
    localStorage.removeItem('vendorData');
  },

  // Get profile
  getProfile: async () => {
    const response = await api.get('/vendors/profile');
    if (response.data.vendor) {
      localStorage.setItem('vendorData', JSON.stringify(response.data.vendor));
    }
    return response.data;
  },

  // Update profile
  updateProfile: async (data) => {
    const response = await api.put('/vendors/profile', data);
    if (response.data.vendor) {
      localStorage.setItem('vendorData', JSON.stringify(response.data.vendor));
    }
    return response.data;
  }
};

/**
 * Worker Authentication Service
 */
export const workerAuthService = {
  // Send OTP
  sendOTP: async (phone, email = null) => {
    const response = await api.post('/workers/auth/send-otp', { phone, email });
    return response.data;
  },

  // Verify Login (Unified Flow)
  verifyLogin: async (data) => {
    const payload = await prepareAuthPayload(data);
    const response = await api.post('/workers/auth/verify-login', payload);
    if (response.data.success && !response.data.isNewUser && response.data.accessToken) {
      localStorage.setItem('workerAccessToken', response.data.accessToken);
      localStorage.setItem('workerRefreshToken', response.data.refreshToken);
      localStorage.setItem('workerData', JSON.stringify(response.data.worker));
      notifyFlutterLogin(response.data);
      registerFCMToken('worker', false).catch(console.error);
    }
    return response.data;
  },

  // Register
  register: async (data) => {
    const payload = await prepareAuthPayload(data);
    const response = await api.post('/workers/auth/register', payload);
    if (response.data.accessToken) {
      localStorage.setItem('workerAccessToken', response.data.accessToken);
      localStorage.setItem('workerRefreshToken', response.data.refreshToken);
      localStorage.setItem('workerData', JSON.stringify(response.data.worker));
      notifyFlutterLogin(response.data);
      registerFCMToken('worker', false).catch(console.error);
    }
    return response.data;
  },

  // Login
  login: async (data) => {
    // Remove email from login payload if present
    const { email, ...loginData } = data;
    const payload = await prepareAuthPayload(loginData);
    const response = await api.post('/workers/auth/login', payload);
    if (response.data.accessToken) {
      localStorage.setItem('workerAccessToken', response.data.accessToken);
      localStorage.setItem('workerRefreshToken', response.data.refreshToken);
      localStorage.setItem('workerData', JSON.stringify(response.data.worker));
      notifyFlutterLogin(response.data);
      registerFCMToken('worker', false).catch(console.error);
    }
    return response.data;
  },

  // Logout
  logout: async () => {
    // Remove FCM token before logout
    await removeFCMToken('worker');
    try {
      await api.post('/workers/auth/logout', { platform: getPlatformType() });
    } catch (error) {
      console.error('Logout error:', error);
    }
    localStorage.removeItem('workerAccessToken');
    localStorage.removeItem('workerRefreshToken');
    localStorage.removeItem('workerData');
  },

  // Get profile
  getProfile: async () => {
    const response = await api.get('/workers/profile');
    if (response.data.worker) {
      localStorage.setItem('workerData', JSON.stringify(response.data.worker));
    }
    return response.data;
  },

  // Update profile
  updateProfile: async (data) => {
    const response = await api.put('/workers/profile', data);
    if (response.data.worker) {
      localStorage.setItem('workerData', JSON.stringify(response.data.worker));
    }
    return response.data;
  },

  // Delete account
  deleteAccount: async () => {
    try {
      const response = await api.delete('/workers/profile');
      
      // Cleanup locally
      try {
        await removeFCMToken('worker');
      } catch (e) {
        console.warn('FCM token removal failed:', e);
      }
      localStorage.removeItem('workerAccessToken');
      localStorage.removeItem('workerRefreshToken');
      localStorage.removeItem('workerData');
      
      return response.data;
    } catch (error) {
      console.error('Delete account error:', error);
      throw error;
    }
  }
};

/**
 * Admin Authentication Service
 */
export const adminAuthService = {
  // Login
  login: async (email, password, rememberMe = false) => {
    const response = await api.post('/admin/auth/login', { email, password });
    if (response.data.accessToken) {
      // Clear any session storage to prevent conflicts
      sessionStorage.removeItem('adminAccessToken');
      sessionStorage.removeItem('adminRefreshToken');
      sessionStorage.removeItem('adminData');

      // Always use localStorage for consistency
      localStorage.setItem('adminAccessToken', response.data.accessToken);
      localStorage.setItem('adminRefreshToken', response.data.refreshToken);
      localStorage.setItem('adminData', JSON.stringify(response.data.admin));
    }
    return response.data;
  },

  // Logout
  logout: async () => {
    try {
      await api.post('/admin/auth/logout');
    } catch (error) {
      console.error('Logout error:', error);
    }
    localStorage.removeItem('adminAccessToken');
    localStorage.removeItem('adminRefreshToken');
    localStorage.removeItem('adminData');
  }
};



