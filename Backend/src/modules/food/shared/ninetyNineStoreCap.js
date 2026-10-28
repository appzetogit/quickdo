import { FoodLandingSettings } from '../landing/models/landingSettings.model.js';
import { NINETY_NINE_STORE_MAX_PRICE, resolveNinetyNineCap } from './ninetyNineStore.js';
import { logger } from '../../../utils/logger.js';

/**
 * The price point the Rs 99 store runs at.
 *
 * Lives on the landing settings document as `ninetyNineStoreMaxPrice`, so
 * business can run the shelf at Rs 59 without a deploy. Unset falls back to 99,
 * the constant this was before it became configurable, which keeps behaviour
 * identical until somebody sets it.
 *
 * Cached briefly because it is read on every public feed request and on every
 * dish write; a settings lookup per dish would be a query per dish. Thirty
 * seconds matches the order quantity ceiling, and is short enough that an admin
 * sees the change while still looking at the screen. The admin save invalidates
 * it anyway, so the window only matters across processes.
 *
 * Never throws: a settings lookup must not be able to fail a menu request or a
 * dish save, so any error falls back to the constant.
 */

const CACHE_MS = 30_000;
let cache = null;
let cachedAt = 0;

export const invalidateNinetyNineCapCache = () => {
    cache = null;
    cachedAt = 0;
};

export const getNinetyNineCap = async () => {
    if (cache !== null && Date.now() - cachedAt < CACHE_MS) return cache;

    let value = NINETY_NINE_STORE_MAX_PRICE;
    try {
        const doc = await FoodLandingSettings.findOne().select('ninetyNineStoreMaxPrice').lean();
        value = resolveNinetyNineCap(doc?.ninetyNineStoreMaxPrice);
    } catch (err) {
        logger.error(`Rs 99 store cap lookup failed, using ${NINETY_NINE_STORE_MAX_PRICE}: ${err.message}`);
    }

    cache = value;
    cachedAt = Date.now();
    return cache;
};
