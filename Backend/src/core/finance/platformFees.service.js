import { logger } from '../../utils/logger.js';

/**
 * The platform fee on an order, and the GST on it, set once in
 * Master > Platform Fee & GST.
 *
 * Food (food_fee_settings) and Quick Commerce (qc_fee_settingses) each kept
 * their own platform fee, so the two could disagree without anyone deciding
 * they should. When Master has a value -- for every service, or for one -- it
 * is what that service's checkout charges; unset keeps the service's own, so
 * nothing changes until an admin saves one.
 *
 * GST on the platform fee: Food always charges it (18% unless set). Quick
 * Commerce charges it at Master's rate when Master sets one (since 2026-09-28,
 * on the business's request); with no Master rate it is not charged there.
 *
 * Taxi's platform fee is a different thing -- a percentage or flat amount on
 * each vehicle's price row (taxi/common/platformFee.js) -- and stays there.
 */

const FEE_KEY = 'fees.platformFee';
const GST_KEY = 'fees.platformFeeGstRate';
const DEFAULT_PLATFORM_FEE_GST_RATE = 18;

const num = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

/** Master's values for one service; null where not set. Fails open to "not set". */
export async function resolveMasterFees(vertical, zoneId) {
  try {
    const { getMany } = await import('../config/resolver.service.js');
    const rows = await getMany([FEE_KEY, GST_KEY], {
      vertical: vertical || undefined,
      // A zone's own fee beats the service's (Master > Platform fee & GST, zone picker).
      zoneId: zoneId ? String(zoneId) : undefined,
    });
    const pick = (key) => (rows[key] && !rows[key].isDefault ? num(rows[key].value) : null);
    return { platformFee: pick(FEE_KEY), platformFeeGstRate: pick(GST_KEY) };
  } catch (err) {
    logger.warn(`platformFees: Master read failed for ${vertical}, using the service's own: ${err.message}`);
    return { platformFee: null, platformFeeGstRate: null };
  }
}

/**
 * A service's fee settings with Master's values in place.
 *
 * Returns the same object shape the checkout already reads, so a call site
 * changes only where the settings come from.
 *
 * @param {'food'|'quickCommerce'} vertical
 * @param {object} settings  that service's fee settings (or its defaults)
 */
export async function withMasterFees(vertical, settings, { zoneId } = {}) {
  const master = await resolveMasterFees(vertical, zoneId);
  if (master.platformFee === null && master.platformFeeGstRate === null) return settings;
  const out = { ...(settings || {}) };
  if (master.platformFee !== null) out.platformFee = master.platformFee;
  if (master.platformFeeGstRate !== null) out.platformFeeGstRate = master.platformFeeGstRate;
  return out;
}

/** What each service charges right now and who set it, for the Master screen. */
export async function platformFeesOverview() {
  const [{ FoodFeeSettings }, { FoodFeeSettings: QuickFeeSettings }] = await Promise.all([
    import('../../modules/food/admin/models/feeSettings.model.js'),
    import('../../modules/quickCommerce/modules/food/admin/models/feeSettings.model.js'),
  ]);
  const [foodOwn, quickOwn, foodMaster, quickMaster] = await Promise.all([
    FoodFeeSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean(),
    QuickFeeSettings.findOne({ isActive: { $ne: false } }).sort({ createdAt: -1 }).lean(),
    resolveMasterFees('food'),
    resolveMasterFees('quickCommerce'),
  ]);
  const field = (m, own, fallback = 0) =>
    m !== null ? { value: m, from: 'master' } : { value: num(own) ?? fallback, from: 'service' };
  return {
    services: [
      {
        vertical: 'food',
        platformFee: field(foodMaster.platformFee, foodOwn?.platformFee),
        platformFeeGstRate: field(foodMaster.platformFeeGstRate, foodOwn?.platformFeeGstRate, DEFAULT_PLATFORM_FEE_GST_RATE),
      },
      {
        vertical: 'quickCommerce',
        platformFee: field(quickMaster.platformFee, quickOwn?.platformFee),
        platformFeeGstRate: quickMaster.platformFeeGstRate !== null
          ? { value: quickMaster.platformFeeGstRate, from: 'master' }
          : { value: null, from: 'not_charged' },
      },
    ],
  };
}
