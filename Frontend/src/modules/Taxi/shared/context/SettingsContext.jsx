import React, { createContext, useContext, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api/axiosInstance';
import { BACKEND_ORIGIN } from '../api/runtimeConfig';

let activeFaviconObjectUrl = '';
const DEFAULT_ADMIN_THEME_COLOR = '#405189';
const DEFAULT_LANDING_THEME_COLOR = '#0ab39c';
const DEFAULT_SIDEBAR_TEXT_COLOR = '#cbd5e1';
const DEFAULT_SETTINGS_CONTEXT = {
  settings: {
    general: {
      app_name: '',
      logo: '',
      favicon: '',
    },
    customization: {
      admin_theme_color: '',
      currency_symbol: '',
    },
    transportRide: {
      enable_bus_service: '0',
    },
    bidRide: {
      bidding_low_percentage: '10',
      bidding_high_percentage: '20',
      bidding_amount_increase_or_decrease: '10',
      user_bidding_low_percentage: '10',
      user_bidding_high_percentage: '20',
      user_bidding_amount_increase_or_decrease: '10',
      user_fare_increase_wait_minutes: '2',
    },
    paymentGateway: null,
  },
  loading: true,
  refreshSettings: () => {},
};
const SettingsContext = createContext(DEFAULT_SETTINGS_CONTEXT);

const normalizeHexColor = (value, fallback = '') => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return fallback;

  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  const shortHexMatch = withHash.match(/^#([0-9a-fA-F]{3})$/);
  if (shortHexMatch) {
    const [r, g, b] = shortHexMatch[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  if (/^#([0-9a-fA-F]{6})$/.test(withHash)) {
    return withHash.toUpperCase();
  }

  return fallback;
};

const hexToRgb = (hex) => {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;

  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
};

const getReadableTextColor = (hex, dark = '#0F172A', light = '#FFFFFF') => {
  const rgb = hexToRgb(hex);
  if (!rgb) return light;

  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return brightness > 160 ? dark : light;
};

const ensureHeadLink = (selector, relValue) => {
  let link = document.head.querySelector(selector);
  if (!link) {
    link = document.createElement('link');
    link.rel = relValue;
    document.head.appendChild(link);
  }
  return link;
};

const getFaviconType = (faviconUrl = '') => {
  if (!faviconUrl) return 'image/png';

  if (faviconUrl.startsWith('data:image/')) {
    return faviconUrl.split(';')[0].split(':')[1] || 'image/png';
  }

  const cleanUrl = faviconUrl.split('?')[0].toLowerCase();

  if (cleanUrl.endsWith('.svg')) return 'image/svg+xml';
  if (cleanUrl.endsWith('.png')) return 'image/png';
  if (cleanUrl.endsWith('.jpg') || cleanUrl.endsWith('.jpeg')) return 'image/jpeg';
  if (cleanUrl.endsWith('.webp')) return 'image/webp';
  if (cleanUrl.endsWith('.gif')) return 'image/gif';
  if (cleanUrl.endsWith('.ico')) return 'image/x-icon';

  return 'image/png';
};

const dataUrlToBlob = (dataUrl = '') => {
  const [meta, content] = dataUrl.split(',');
  const mimeMatch = meta.match(/data:(.*?)(;base64)?$/i);
  const mime = mimeMatch?.[1] || 'image/png';
  const binary = window.atob(content || '');
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mime });
};

const buildFaviconHref = (faviconUrl = '') => {
  if (!faviconUrl) {
    if (activeFaviconObjectUrl) {
      URL.revokeObjectURL(activeFaviconObjectUrl);
      activeFaviconObjectUrl = '';
    }
    return '';
  }

  if (faviconUrl.startsWith('data:')) {
    if (activeFaviconObjectUrl) {
      URL.revokeObjectURL(activeFaviconObjectUrl);
    }
    activeFaviconObjectUrl = URL.createObjectURL(dataUrlToBlob(faviconUrl));
    return activeFaviconObjectUrl;
  }

  if (activeFaviconObjectUrl) {
    URL.revokeObjectURL(activeFaviconObjectUrl);
    activeFaviconObjectUrl = '';
  }

  let finalUrl = faviconUrl;
  if (!/^(https?:|data:image\/|blob:)/i.test(faviconUrl)) {
    if (faviconUrl.startsWith('/')) {
      finalUrl = `${BACKEND_ORIGIN}${faviconUrl}`;
    } else {
      finalUrl = `${BACKEND_ORIGIN}/${faviconUrl}`;
    }
  }

  return `${finalUrl}${finalUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
};

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS_CONTEXT.settings);
  const [loading, setLoading] = useState(true);
  const [activeModule, setActiveModule] = useState('landing');
  const location = useLocation();

  useEffect(() => {
    const pathname = location.pathname;
    if (pathname.startsWith('/admin') || pathname.startsWith('/taxi/admin') || pathname.startsWith('/taxi/owner') || pathname.startsWith('/food/admin')) {
      setActiveModule('admin');
    } else if (pathname.startsWith('/food/delivery')) {
      setActiveModule('food_delivery_partner');
    } else if (pathname.startsWith('/food/restaurant') || pathname.startsWith('/restaurant')) {
      setActiveModule('food_restaurant');
    } else if (pathname.startsWith('/food')) {
      setActiveModule('food');
    } else if (pathname.startsWith('/taxi/driver')) {
      setActiveModule('taxi_driver');
    } else if (pathname.startsWith('/taxi')) {
      setActiveModule('taxi');
    } else if (pathname.startsWith('/delivery/partner')) {
      setActiveModule('delivery_partner');
    } else if (pathname.startsWith('/delivery')) {
      setActiveModule('delivery');
    } else {
      setActiveModule('landing');
    }
  }, [location.pathname]);

  const fetchSettings = async () => {
    try {
      const bootstrapResponse = await api.get('/common/settings');
      const bootstrapData = bootstrapResponse?.data?.data || bootstrapResponse?.data || {};

      setSettings({
        general: bootstrapData.general || {},
        customization: bootstrapData.customization || {},
        transportRide: bootstrapData.transportRide || { enable_bus_service: '0' },
        bidRide: bootstrapData.bidRide || DEFAULT_SETTINGS_CONTEXT.settings.bidRide,
        paymentGateway: bootstrapData.paymentGateway || null,
      });
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    let appName = settings.general?.app_name || 'Quick Drop';
    const lowerAppName = appName.toLowerCase();
    if (lowerAppName.includes('eqosy') || lowerAppName.includes('appzeto') || lowerAppName.includes('rideon') || lowerAppName.includes('rydon') || lowerAppName.includes('k9')) {
      appName = 'Quick Drop';
    }
    document.title = appName;

    const favicons = settings.customization?.favicons || {};
    const favicon = favicons[activeModule] || settings.general?.favicon || settings.customization?.favicon;
    if (favicon) {
      const href = buildFaviconHref(favicon);
      const type = getFaviconType(favicon);

      const iconLink = ensureHeadLink("link[rel='icon']", 'icon');
      const shortcutIconLink = ensureHeadLink("link[rel='shortcut icon']", 'shortcut icon');
      const appleTouchIconLink = ensureHeadLink("link[rel='apple-touch-icon']", 'apple-touch-icon');

      [iconLink, shortcutIconLink, appleTouchIconLink].forEach((link) => {
        link.href = href;
        link.type = type;
        link.sizes = '64x64';
      });
    }

    return () => {
      if (activeFaviconObjectUrl) {
        URL.revokeObjectURL(activeFaviconObjectUrl);
        activeFaviconObjectUrl = '';
      }
    };
  }, [settings.general?.app_name, settings.general?.favicon, settings.customization?.favicon, settings.customization?.favicons, activeModule]);

  useEffect(() => {
    const root = document.documentElement;
    const adminThemeColor = normalizeHexColor(
      settings.customization?.admin_theme_color,
      DEFAULT_ADMIN_THEME_COLOR
    );
    const landingThemeColor = normalizeHexColor(
      settings.customization?.landing_theme_color,
      DEFAULT_LANDING_THEME_COLOR
    );
    const sidebarTextColor = normalizeHexColor(
      settings.customization?.sidebar_text_color,
      DEFAULT_SIDEBAR_TEXT_COLOR
    );
    const primaryColor = normalizeHexColor(settings.customization?.primary_color, '#dc2626');
    const accentColor = normalizeHexColor(settings.customization?.accent_color, '#f97316');
    const themeMode = settings.customization?.theme_mode || 'light';

    const rgb = hexToRgb(adminThemeColor) || { r: 64, g: 81, b: 137 };

    root.style.setProperty('--admin-theme-color', adminThemeColor);
    root.style.setProperty('--admin-theme-color-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    root.style.setProperty('--admin-theme-contrast', getReadableTextColor(adminThemeColor));
    root.style.setProperty('--landing-theme-color', landingThemeColor);
    root.style.setProperty('--admin-sidebar-text-color', sidebarTextColor);
    
    // Set global theme variables
    root.style.setProperty('--primary-color', primaryColor);
    root.style.setProperty('--accent-color', accentColor);

    // Toggle dark mode (do not toggle if in an admin page that overrides this manually, 
    // but the app structure suggests the toggle works globally)
    if (themeMode === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

  }, [
    settings.customization?.admin_theme_color,
    settings.customization?.landing_theme_color,
    settings.customization?.sidebar_text_color,
    settings.customization?.primary_color,
    settings.customization?.accent_color,
    settings.customization?.theme_mode,
  ]);

  const refreshSettings = () => fetchSettings();

  const getActiveLogo = () => {
    const logos = settings.customization?.logos || {};
    const logoUrl = logos[activeModule] || settings.general?.logo || settings.customization?.logo;
    if (logoUrl && typeof logoUrl === 'string' && logoUrl.startsWith('/')) {
      return `${BACKEND_ORIGIN}${logoUrl}`;
    }
    return logoUrl;
  };

  return (
    <SettingsContext.Provider value={{ settings, loading, refreshSettings, activeModule, activeLogo: getActiveLogo() }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  return useContext(SettingsContext);
};
