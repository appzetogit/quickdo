import { FoodFeeSettings } from '../admin/models/feeSettings.model.js';
import { ABSOLUTE_MAX_ORDER_QUANTITY, resolveCeiling } from './orderQuantityRules.js';
import { logger } from '../../../utils/logger.js';

/**
 * The platform-wide cap on how many of one item may be in a single order.
 *
 * Lives on the active fee settings document as `maxOrderQuantityCeiling`, so an
 * admin can change it without a deploy. Unset falls back to
 * ABSOLUTE_MAX_ORDER_QUANTITY, the constant this was before it was configurable,
 * which is what keeps existing behaviour identical until someone sets it.
 *
 * Cached briefly because it is read on every cart write and every checkout, and
 * a settings lookup per line item would be a query per item. Thirty seconds is
 * short enough that an admin sees their change take effect while they are still
 * looking at the screen.
 *
 * Never throws: a settings lookup must not be able to fail a checkout, so any
 * error falls back to the constant.
 */

const CACHE_MS = 30_000;
let cache = null;
let cachedAt = 0;

export const invalidateOrderQuantityCeilingCache = () => {
    cache = null;
    cachedAt = 0;
};

export const getOrderQuantityCeiling = async () => {
    if (cache !== null && Date.now() - cachedAt < CACHE_MS) return cache;

    let value = ABSOLUTE_MAX_ORDER_QUANTITY;
    try {
        const doc = await FoodFeeSettings.findOne({ isActive: true })
            .sort({ createdAt: -1 })
            .select('maxOrderQuantityCeiling')
            .lean();
        value = resolveCeiling(doc?.maxOrderQuantityCeiling);
    } catch (err) {
        logger.error(`Order quantity ceiling lookup failed, using ${ABSOLUTE_MAX_ORDER_QUANTITY}: ${err.message}`);
    }

    cache = value;
    cachedAt = Date.now();
    return cache;
};
