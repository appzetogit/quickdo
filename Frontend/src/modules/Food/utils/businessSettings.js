/**
 * Business Settings Utility
 * Handles loading and updating business settings (favicon, title, logo)
 */

import apiClient from "@food/api/axios";
import { API_ENDPOINTS } from "@food/api/config";
import { publicGetOnce } from "@food/api";

const SETTINGS_KEY = 'food_business_settings';

const DEFAULT_COMPANY_NAME = "Quick Drop";

// Names the backend seeds into a fresh settings document, or that survive from earlier
// vendor builds. They are placeholders, not choices, so they get replaced by the default.
//
// This used to be a SUBSTRING test, which meant any name merely CONTAINING one of these
// -- "K9 Rides Pvt Ltd", and every name with a stray "k9" in it -- was silently rewritten
// to "Quick Drop". An operator would save a company name in Business Setup, watch the
// sidebar and tab title keep showing the old brand, and reasonably conclude the save had
// failed. Matching the whole name exactly leaves anything deliberately typed alone.
const SEEDED_PLACEHOLDER_NAMES = new Set([
  "k9 rides",
  "k9rides",
  "appzeto",
  "eqosy",
  "rideon",
  "rydon",
]);

export const normalizeCompanyName = (value) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return DEFAULT_COMPANY_NAME;
  return SEEDED_PLACEHOLDER_NAMES.has(raw.toLowerCase()) ? DEFAULT_COMPANY_NAME : raw;
};

// Initialize from localStorage immediately so it's available for components on mount
let cachedSettings = (() => {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    return null;
  }
})();

// Apply cached settings immediately on module load if they exist
if (cachedSettings) {
  setTimeout(() => {
    updateFavicon(cachedSettings.favicon?.url);
    updateTitle(normalizeCompanyName(cachedSettings.companyName));
  }, 0);
}

let inFlightSettingsPromise = null;

/**
 * Load business settings from backend (public endpoint - no auth required)
 */
export const loadBusinessSettings = async () => {
  try {
    // If we have no cached settings, we MUST fetch
    // If we have cached settings, we still try to fetch in background to ensure they are fresh
    const endpoint = API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS_PUBLIC;
    if (!endpoint || (typeof endpoint === "string" && !endpoint.trim())) {
      return cachedSettings;
    }

    if (inFlightSettingsPromise) {
      return await inFlightSettingsPromise;
    }

    inFlightSettingsPromise = (async () => {
      // Use public endpoint that doesn't require authentication
      // Use noCache to ensure we get fresh data from server this time
      const response = await publicGetOnce(endpoint, { noCache: true });
      const settings = response?.data?.data || response?.data;

      if (settings) {
        const normalizedSettings = {
          ...settings,
          companyName: normalizeCompanyName(settings.companyName),
        };
        cachedSettings = normalizedSettings;
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizedSettings));
        } catch (e) {}
        
        updateFavicon(normalizedSettings.favicon?.url);
        updateTitle(normalizedSettings.companyName);
        return normalizedSettings;
      }
      return cachedSettings;
    })();

    return await inFlightSettingsPromise;
  } catch (error) {
    // Return cached if failed
    return cachedSettings;
  } finally {
    inFlightSettingsPromise = null;
  }
};

/**
 * Update favicon in document
 */
export const updateFavicon = (url) => {
  if (!url || typeof document === 'undefined') return;

  // Remove existing favicons
  const existingFavicons = document.querySelectorAll("link[rel*='icon']");
  existingFavicons.forEach(el => el.remove());

  // Add new favicon
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = url;
  // Prevent third-party cookie warning (Cloudinary)
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
};

/**
 * Update page title
 */
export const updateTitle = (companyName) => {
  if (typeof document !== 'undefined') {
    document.title = normalizeCompanyName(companyName);
  }
};

/**
 * Set cached settings manually (useful after update)
 */
export const setCachedSettings = (settings) => {
  if (settings) {
    const normalizedSettings = {
      ...settings,
      companyName: normalizeCompanyName(settings.companyName),
    };
    cachedSettings = normalizedSettings;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizedSettings));
    } catch (e) {}
    
    updateFavicon(normalizedSettings.favicon?.url);
    updateTitle(normalizedSettings.companyName);
  }
};

/**
 * Clear cached settings (call after updating settings)
 */
export const clearCache = () => {
  cachedSettings = null;
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch (e) {}
};

/**
 * Get cached settings
 */
export const getCachedSettings = () => {
  return cachedSettings;
};

/**
 * Get company name from business settings with fallback
 * @returns {string} Company name or default "Quick Drop"
 */
export const getCompanyName = () => {
  const settings = getCachedSettings();
  return normalizeCompanyName(settings?.companyName);
};

/**
 * Get company name asynchronously (loads if not cached)
 * @returns {Promise<string>} Company name or default "Quick Drop"
 */
export const getCompanyNameAsync = async () => {
  try {
    const settings = await loadBusinessSettings();
    return normalizeCompanyName(settings?.companyName);
  } catch (error) {
    return "Quick Drop";
  }
};

/**
 * Get dynamic logo with fallback to configured branding logos
 */
export const getDynamicLogo = () => {
  const settings = getCachedSettings();
  return settings?.logo?.url ||
    settings?.logos?.admin ||
    settings?.customization?.logos?.admin ||
    settings?.customization?.logos?.landing ||
    settings?.logos?.landing ||
    settings?.logos?.food ||
    "";
};

export const getRestaurantLogo = () => {
  const settings = getCachedSettings();
  return settings?.restaurantLogo?.url ||
    settings?.logos?.food_restaurant ||
    settings?.customization?.logos?.food_restaurant ||
    getDynamicLogo();
};

export const getDeliveryPartnerLogo = () => {
  const settings = getCachedSettings();
  return settings?.deliveryPartnerLogo?.url ||
    settings?.logos?.food_delivery_partner ||
    settings?.customization?.logos?.food_delivery_partner ||
    getDynamicLogo();
};

