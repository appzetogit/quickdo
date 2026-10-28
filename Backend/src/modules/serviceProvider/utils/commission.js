const Settings = require('../models/Settings');

/**
 * Single source of truth for the platform/vendor revenue split.
 *
 * Before this existed the same rate was written three different ways:
 * the Settings schema defaulted to 90, the billing controllers fell back to 70,
 * and the dashboards hardcoded 80 (as `* 0.2` / `* 0.8`). Reports therefore
 * disagreed with the actual ledger whenever the configured split wasn't 80.
 *
 * Note: this is the SERVICE split only. Parts use partsPayoutPercentage, and
 * withdrawal-time TDS/platform fees are separate (see settlementController).
 */

// Must stay in sync with the Settings schema default.
const DEFAULT_SERVICE_PAYOUT_PCT = 90;

/**
 * Resolve the configured service payout percentage (vendor's share, 0-100).
 */
const getServicePayoutPct = async () => {
  const settings = await Settings.findOne({ type: 'global' })
    .select('servicePayoutPercentage')
    .lean();
  return settings?.servicePayoutPercentage ?? DEFAULT_SERVICE_PAYOUT_PCT;
};

/**
 * Resolve the split as fractions, ready to multiply against an amount.
 * @returns {Promise<{vendorShare: number, platformShare: number}>}
 */
const getCommissionRates = async () => {
  const payoutPct = await getServicePayoutPct();
  return {
    vendorShare: payoutPct / 100,
    platformShare: (100 - payoutPct) / 100
  };
};

module.exports = {
  DEFAULT_SERVICE_PAYOUT_PCT,
  getServicePayoutPct,
  getCommissionRates
};
