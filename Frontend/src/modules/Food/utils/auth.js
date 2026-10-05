/**
 * JWT Token Utilities
 * Decode and extract information from JWT tokens
 */

/**
 * Decode JWT token without verification (client-side only)
 * @param {string} token - JWT token
 * @returns {Object|null} - Decoded token payload or null if invalid
 */
export function decodeToken(token) {
  if (!token) return null;

  try {
    // JWT format: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decode base64url encoded payload
    const payload = parts[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));

    return decoded;
  } catch (error) {
    console.error('Error decoding token:', error);
    return null;
  }
}

/**
 * Get user role from token
 * @param {string} token - JWT token
 * @returns {string|null} - User role or null if not found
 */
export function getRoleFromToken(token) {
  const decoded = decodeToken(token);
  return decoded?.role || null;
}

/**
 * Check if token is expired
 * @param {string} token - JWT token
 * @returns {boolean} - True if expired or invalid
 */
export function isTokenExpired(token) {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return true;

  // exp is in seconds, Date.now() is in milliseconds
  return decoded.exp * 1000 < Date.now();
}

/**
 * Get user ID from token
 * @param {string} token - JWT token
 * @returns {string|null} - User ID or null if not found
 */
export function getUserIdFromToken(token) {
  const decoded = decodeToken(token);
  return decoded?.userId || decoded?.id || null;
}

/**
 * Check if user has access to a module based on role
 * @param {string} role - User role
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {boolean} - True if user has access
 */
export function hasModuleAccess(role, module) {
  const roleModuleMap = {
    'admin': 'admin',
    'restaurant': 'restaurant',
    'delivery': 'delivery',
    'user': 'user'
  };

  return roleModuleMap[role] === module;
}

/**
 * Get module-specific access token
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {string|null} - Access token or null
 */
export function getModuleToken(module) {
  return localStorage.getItem(`${module}_accessToken`);
}

/**
 * Get module-specific refresh token (fallback for WebView environments where cookies may be unreliable)
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {string|null} - Refresh token or null
 */
export function getModuleRefreshToken(module) {
  return localStorage.getItem(`${module}_refreshToken`);
}

/**
 * Get current user's role from a specific module's storage/token
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {string|null} - Current user role or null
 */
export function getCurrentUserRole(module = null) {
  if (module) {
    const userStr = localStorage.getItem(`${module}_user`);
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        return user.role || module;
      } catch (e) {
        return module;
      }
    }
  }
  return module || 'user';
}

/**
 * Get current user object from specific module's storage
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {Object|null} - User object or null
 */
export function getCurrentUser(module) {
  if (!module) return null;
  const userStr = localStorage.getItem(`${module}_user`);
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch (e) {
    return null;
  }
}

/**
 * Check if user is authenticated for a specific module
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {boolean} - True if authenticated
 */
export function isModuleAuthenticated(module) {
  const token = getModuleToken(module);
  return !!token && !isTokenExpired(token);
}

/**
 * Clear authentication data for a specific module
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 */
export function clearModuleAuth(module) {
  localStorage.removeItem(`${module}_accessToken`);
  localStorage.removeItem(`${module}_refreshToken`);
  localStorage.removeItem(`${module}_authenticated`);
  localStorage.removeItem(`${module}_user`);
  // What the admin may open is per account: never carry it into the next sign-in.
  if (module === "admin") localStorage.removeItem("admin_access");
  // Clear cached FCM web token for this module
  localStorage.removeItem(`fcm_web_registered_token_${module}`);
  if (module === "restaurant") {
    clearRestaurantSessionCache();
  }
  if (module === "user") {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("authenticated");
    localStorage.removeItem("user");
  }
  // Also clear any sessionStorage data
  sessionStorage.removeItem(`${module}AuthData`);
}

/**
 * Clear restaurant-local cached UI data to prevent cross-account stale state.
 */
export function clearRestaurantSessionCache() {
  const keys = [
    "restaurant_owner_contact",
    "restaurant_onboarding",
    "restaurant_onboarding_data",
    "restaurant_invited_users",
    "restaurant_schedule_off",
    "restaurant_online_status",
    "restaurant_outlet_timings",
    "restaurant_hub_menu_active_tab",
    "restaurant_name",
    "restaurantName",
    "restaurant_pendingPhone",
  ];

  keys.forEach((key) => localStorage.removeItem(key));
}

export function setRestaurantPendingPhone(phone) {
  if (typeof localStorage === "undefined") return;
  if (!phone) {
    localStorage.removeItem("restaurant_pendingPhone");
    return;
  }
  localStorage.setItem("restaurant_pendingPhone", phone);
}

export function getRestaurantPendingPhone() {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem("restaurant_pendingPhone");
}

export function clearRestaurantPendingPhone() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem("restaurant_pendingPhone");
}

/**
 * Clear all authentication data for all modules
 */
export function clearAuthData() {
  const modules = ['admin', 'restaurant', 'delivery', 'user'];
  modules.forEach(module => {
    clearModuleAuth(module);
  });
  // Also clear legacy token if it exists
  localStorage.removeItem('accessToken');
  localStorage.removeItem('user');
}

/**
 * Set authentication data for a specific module
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @param {string} token - Access token
 * @param {Object} user - User data
 * @param {string|null} refreshToken - Optional refresh token
 * @throws {Error} If localStorage is not available or quota exceeded
 */
export function setAuthData(module, token, user, refreshToken = null) {
  try {
    // Check if localStorage is available
    if (typeof Storage === 'undefined' || !localStorage) {
      throw new Error('localStorage is not available');
    }

    // Validate inputs
    if (!module || !token) {
      throw new Error(`Invalid parameters: module=${module}, token=${!!token}`);
    }

    console.log(`[setAuthData] Storing auth for module: ${module}`, {
      hasToken: !!token,
      tokenLength: token?.length,
      hasUser: !!user
    });

    // Store module-specific token (don't clear other modules)
    const tokenKey = `${module}_accessToken`;
    const refreshTokenKey = `${module}_refreshToken`;
    const authKey = `${module}_authenticated`;
    const userKey = `${module}_user`;

    // A new admin sign-in may be a different account with different access.
    if (module === "admin") localStorage.removeItem("admin_access");

    // Prevent stale restaurant profile data from previous account after re-login.
    if (module === "restaurant") {
      clearRestaurantSessionCache();
      // A fresh restaurant login is a food restaurant unless the caller says
      // otherwise straight after (the /partner sign-in does, for stores and
      // medical stores). See RESTAURANT_VERTICAL_KEY in services/api/axios.js.
      localStorage.removeItem("restaurant_vertical");
    }

    localStorage.setItem(tokenKey, token);
    if (refreshToken && typeof refreshToken === "string") {
      localStorage.setItem(refreshTokenKey, refreshToken);
    }
    localStorage.setItem(authKey, 'true');

    if (user) {
      try {
        localStorage.setItem(userKey, JSON.stringify(user));
      } catch (userError) {
        console.warn('Failed to store user data, but token was stored:', userError);
        // Don't throw - token storage is more important
      }
    }

    // Verify the token was stored correctly
    const storedToken = localStorage.getItem(tokenKey);
    const storedAuth = localStorage.getItem(authKey);

    if (storedToken !== token) {
      console.error(`[setAuthData] Token mismatch:`, {
        expected: token?.substring(0, 20) + '...',
        stored: storedToken?.substring(0, 20) + '...'
      });
      throw new Error(`Token storage verification failed for module: ${module}`);
    }

    if (storedAuth !== 'true') {
      console.error(`[setAuthData] Auth flag mismatch:`, {
        expected: 'true',
        stored: storedAuth
      });
      throw new Error(`Authentication flag storage failed for module: ${module}`);
    }

    console.log(`[setAuthData] Successfully stored auth data for ${module}`);
  } catch (error) {
    // If quota exceeded, try to clear some space
    if (error.name === 'QuotaExceededError' || error.code === 22) {
      console.warn('localStorage quota exceeded. Attempting to clear old data...');
      // Clear legacy tokens
      try {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
        // Retry storing
        localStorage.setItem(`${module}_accessToken`, token);
        if (refreshToken && typeof refreshToken === "string") {
          localStorage.setItem(`${module}_refreshToken`, refreshToken);
        }
        localStorage.setItem(`${module}_authenticated`, 'true');
        if (user) {
          localStorage.setItem(`${module}_user`, JSON.stringify(user));
        }

        // Verify again after retry
        const storedToken = localStorage.getItem(`${module}_accessToken`);
        if (storedToken !== token) {
          throw new Error('Token storage failed even after clearing space');
        }
      } catch (retryError) {
        console.error('Failed to store auth data after clearing space:', retryError);
        throw new Error('Unable to store authentication data. Please clear browser storage and try again.');
      }
    } else {
      console.error('[setAuthData] Error storing auth data:', error);
      throw error;
    }
  }
}

/**
 * Set unified authentication data for both Food and Taxi modules
 * @param {Object} data - Unified auth response data
 */
export function setUnifiedAuthData(data) {
  if (!data) return;

  // 1. Set Food Auth Data
  const foodToken = data.accessToken;
  const foodUser = data.user;
  const foodRefreshToken = data.refreshToken;
  if (foodToken && foodUser) {
    setAuthData("user", foodToken, foodUser, foodRefreshToken);
  }

  // 2. Set Taxi Auth Data
  const taxiAuth = data.taxiAuth;
  if (taxiAuth && taxiAuth.token && taxiAuth.user) {
    localStorage.setItem("userToken", taxiAuth.token);
    localStorage.setItem("userInfo", JSON.stringify(taxiAuth.user));
    localStorage.setItem("role", "user");
    localStorage.setItem("chatRole", "user");
    return;
  }

  // Fallback bridge: when unified API doesn't return taxiAuth, reuse common USER session
  // so taxi module does not force a second login.
  if (foodToken && foodUser) {
    localStorage.setItem("userToken", foodToken);
    localStorage.setItem("userInfo", JSON.stringify(foodUser));
    localStorage.setItem("role", "user");
    localStorage.setItem("chatRole", "user");
  }
}

/**
 * Check if user is authenticated for both Food and Taxi
 * @returns {boolean}
 */
export function isUnifiedAuthenticated() {
  const foodToken = localStorage.getItem("user_accessToken");
  const taxiToken = localStorage.getItem("userToken");
  return !!(foodToken && taxiToken);
}
