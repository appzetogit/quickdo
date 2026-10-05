const MOBILE_PLATFORM_ALIASES = new Set([
    'mobile',
    'android',
    'ios',
    'iphone',
    'ipad',
    'ipados',
    'apple',
    'native',
    'app'
]);

const WEB_PLATFORM_ALIASES = new Set([
    'web',
    'browser',
    'website',
    'pwa'
]);

export const normalizePlatform = (platform, options = {}) => {
    const { fallback = 'web', allowUndefined = false } = options;
    const normalized = String(platform ?? '').trim().toLowerCase();

    if (!normalized) {
        return allowUndefined ? undefined : fallback;
    }

    if (MOBILE_PLATFORM_ALIASES.has(normalized)) {
        return 'mobile';
    }

    if (WEB_PLATFORM_ALIASES.has(normalized)) {
        return 'web';
    }

    return allowUndefined ? undefined : fallback;
};

export const isMobilePlatform = (platform) =>
    normalizePlatform(platform, { allowUndefined: true }) === 'mobile';
