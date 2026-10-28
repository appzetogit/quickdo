const PlatformEarning = require('../models/PlatformEarning');
const Vendor = require('../models/Vendor');

/**
 * Utility to track aggregated daily platform earnings to prevent heavy querying
 */
const getTodayDateString = (dateInput) => {
  const d = dateInput ? new Date(dateInput) : new Date();
  return d.toISOString().split('T')[0];
};

/**
 * Records an individual completed booking's financials into the daily tally.
 */
const recordBookingEarning = async ({
  date,
  totalRevenue = 0,
  platformCommission = 0,
  vendorEarnings = 0,
  totalGST = 0,
  totalTDS = 0,
}) => {
  try {
    const dateStr = getTodayDateString(date);

    await PlatformEarning.findOneAndUpdate(
      { date: dateStr },
      {
        $inc: {
          totalRevenue: totalRevenue,
          totalBookings: 1,
          platformCommission: platformCommission,
          vendorEarnings: vendorEarnings,
          totalGST: totalGST,
          totalTDS: totalTDS
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // After recording earnings, automatically update pending snapshots
    await updatePendingSnapshots(dateStr);
  } catch (err) {
    console.error('[EarningTracker] Failed to record booking earning:', err);
  }
};

/**
 * Records an approved settlement (vendor paid platform)
 */
const recordSettlement = async (date, amount) => {
  try {
    const dateStr = getTodayDateString(date);
    await PlatformEarning.findOneAndUpdate(
      { date: dateStr },
      {
        $inc: { totalSettlementReceived: amount }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await updatePendingSnapshots(dateStr);
  } catch (err) {
    console.error('[EarningTracker] Failed to record settlement:', err);
  }
};

/**
 * Records an approved withdrawal (platform paid vendor)
 */
const recordWithdrawal = async (date, amount) => {
  try {
    const dateStr = getTodayDateString(date);
    await PlatformEarning.findOneAndUpdate(
      { date: dateStr },
      {
        $inc: { totalAmountPaidToVendors: amount }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await updatePendingSnapshots(dateStr);
  } catch (err) {
    console.error('[EarningTracker] Failed to record withdrawal:', err);
  }
};

/**
 * Updates the 'snapshot' metrics for pending vendor payouts and settlements
 * Reads directly from vendor wallet balances to remain perfectly accurate
 */
const updatePendingSnapshots = async (dateStr) => {
  try {
    const vendors = await Vendor.find({}, 'wallet').lean();

    let totalPendingSettlement = 0; // Negative balances (Vendor owes us)
    let totalPendingAmountToVendors = 0; // Positive balances (We owe Vendor)

    vendors.forEach(v => {
      const earnings = v.wallet?.earnings || 0;
      const dues = v.wallet?.dues || 0;
      const net = earnings - dues;
      
      if (net < 0) {
        totalPendingSettlement += Math.abs(net);
      } else if (net > 0) {
        totalPendingAmountToVendors += net;
      }
    });

    await PlatformEarning.findOneAndUpdate(
      { date: dateStr },
      {
        $set: {
          totalPendingSettlement: totalPendingSettlement,
          totalPendingAmountToVendors: totalPendingAmountToVendors
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    console.error('[EarningTracker] Failed to update snapshots:', err);
  }
};

/**
 * Records a worker subscription payment
 */
const recordWorkerSubscription = async (date, amount) => {
  try {
    const dateStr = getTodayDateString(date);
    await PlatformEarning.findOneAndUpdate(
      { date: dateStr },
      {
        $inc: { 
          totalRevenue: amount,
          totalWorkerSubscriptionRevenue: amount 
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    console.error('[EarningTracker] Failed to record worker subscription:', err);
  }
};

module.exports = {
  recordBookingEarning,
  recordSettlement,
  recordWithdrawal,
  recordWorkerSubscription,
  updatePendingSnapshots
};
