/**
 * Master Global Settings (plan §7.8, MASTER_PRODUCT_PLAN Phase 6): the country,
 * currency, phone code, time zone and delivery / schedule defaults every service
 * and app should use, read in one call through the settings resolver.
 *
 * Currency: a value set here wins; otherwise the currency already saved in
 * Master > Brand & contact (platformProfile business.currencyCode/Symbol); then
 * the registered default (INR, the rupee sign). So turning this on changes
 * nothing for a platform that has already set its currency.
 *
 * The delivery and schedule defaults are null until an admin sets them; callers
 * treat null as "keep your own default", so every existing per-service reader
 * behaves exactly as before.
 */

export const GLOBAL_PLATFORM_KEYS = [
    'platform.countryCode',
    'platform.currencyCode',
    'platform.currencySymbol',
    'platform.phoneCode',
    'platform.timezone',
    'delivery.defaultRadiusKm',
    'schedule.maxDaysAhead',
    'schedule.minLeadMinutes',
];

export async function getGlobalPlatform() {
    const { getMany } = await import('./resolver.service.js');
    const resolved = await getMany(GLOBAL_PLATFORM_KEYS);
    const v = (k) => resolved[k]?.value;
    let currencyCode = v('platform.currencyCode');
    let currencySymbol = v('platform.currencySymbol');
    if (resolved['platform.currencyCode']?.isDefault || resolved['platform.currencySymbol']?.isDefault) {
        try {
            const { getPlatformProfile } = await import('../settings/platformProfile.service.js');
            const biz = (await getPlatformProfile())?.business || {};
            if (resolved['platform.currencyCode']?.isDefault && biz.currencyCode) currencyCode = String(biz.currencyCode).trim();
            if (resolved['platform.currencySymbol']?.isDefault && biz.currencySymbol) currencySymbol = String(biz.currencySymbol).trim();
        } catch { /* profile unavailable: registered defaults */ }
    }
    return {
        countryCode: v('platform.countryCode'),
        currencyCode,
        currencySymbol,
        phoneCode: v('platform.phoneCode'),
        timezone: v('platform.timezone'),
        delivery: { defaultRadiusKm: v('delivery.defaultRadiusKm') },
        schedule: { maxDaysAhead: v('schedule.maxDaysAhead'), minLeadMinutes: v('schedule.minLeadMinutes') },
    };
}

/** Public read for the apps (before sign-in): GET /v1/platform/global-settings. */
export const getPublicGlobalPlatformController = async (_req, res) => {
    try {
        res.set('Cache-Control', 'public, max-age=300');
        return res.json({ success: true, data: await getGlobalPlatform() });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Could not load platform settings' });
    }
};

