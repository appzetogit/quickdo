import { useState, useEffect } from 'react';
import { loadBusinessSettings, getCachedSettings, normalizeCompanyName } from '@food/utils/businessSettings';

/**
 * Custom hook to get company name from business settings
 * @returns {string} Company name with fallback to "Quick Drop"
 */
export const useCompanyName = () => {
  const [companyName, setCompanyName] = useState(() => {
    // Initialize with cached value if available
    const cached = getCachedSettings();
    return normalizeCompanyName(cached?.companyName);
  });

  useEffect(() => {
    const loadCompanyName = async () => {
      try {
        const settings = await loadBusinessSettings();
        if (settings?.companyName) {
          setCompanyName(normalizeCompanyName(settings.companyName));
        }
      } catch (error) {
        // Keep default value on error
        console.warn('Failed to load company name:', error);
      }
    };

    // Load if not cached
    const cached = getCachedSettings();
    if (!cached?.companyName) {
      loadCompanyName();
    } else {
      setCompanyName(normalizeCompanyName(cached.companyName));
    }

    // Listen for business settings updates
    const handleSettingsUpdate = () => {
      const updated = getCachedSettings();
      if (updated?.companyName) {
        setCompanyName(normalizeCompanyName(updated.companyName));
      }
    };

    window.addEventListener('businessSettingsUpdated', handleSettingsUpdate);

    return () => {
      window.removeEventListener('businessSettingsUpdated', handleSettingsUpdate);
    };
  }, []);

  return companyName;
};

