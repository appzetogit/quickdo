const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Booking = require('../models/Booking');
const VendorBill = require('../models/VendorBill');
const Settlement = require('../models/Settlement');
const Withdrawal = require('../models/Withdrawal');
const PlatformEarning = require('../models/PlatformEarning');
const Vendor = require('../models/Vendor');
const { BOOKING_STATUS, PAYMENT_STATUS } = require('../utils/constants');

// For local testing from scripts dir
dotenv.config({ path: '../.env' });

const getTodayDateString = (dateInput) => {
  const d = dateInput ? new Date(dateInput) : new Date();
  return d.toISOString().split('T')[0];
};

const syncPlatformEarnings = async () => {
  console.log('Starting historical sync for Platform Earnings...');

  try {
    // 1. Wipe existing history strictly during this sync
    await PlatformEarning.deleteMany({});

    // 2. Map all VendorBills
    console.log('Fetching vendor bills...');
    const bills = await VendorBill.find().lean();
    const billMap = {};
    bills.forEach(b => { billMap[b.bookingId.toString()] = b; });

    // 3. Get all completed bookings with successful payments
    console.log('Fetching completed bookings...');
    const completedBookings = await Booking.find({
      status: BOOKING_STATUS.COMPLETED,
      paymentStatus: {
        $in: [
          PAYMENT_STATUS.SUCCESS,
          PAYMENT_STATUS.COLLECTED_BY_VENDOR,
          'success',
          'collected_by_vendor',
          'collected_by_worker',
          'paid'
        ]
      }
    }).lean();

    console.log(`Found ${completedBookings.length} completed bookings to process`);

    // Map bookings by date to aggregate them
    const dailyEarnings = {};

    completedBookings.forEach(booking => {
      const dateStr = getTodayDateString(booking.completedAt || booking.createdAt);

      if (!dailyEarnings[dateStr]) {
        dailyEarnings[dateStr] = {
          totalRevenue: 0,
          totalBookings: 0,
          platformCommission: 0,
          vendorEarnings: 0,
          totalGST: 0,
          totalTDS: 0,
          totalSettlementReceived: 0,
          totalAmountPaidToVendors: 0
        };
      }

      const bill = billMap[booking._id.toString()];
      const finalAmount = booking.finalAmount || 0;

      const revenue = bill?.grandTotal || finalAmount;
      const commission = bill?.companyRevenue || (finalAmount * 0.2);
      const vendorEarn = bill?.vendorTotalEarning || (finalAmount * 0.8);
      const gst = bill?.totalGST || 0;
      // Note: TDS usually isn't in VendorBill, handled separately in Withdrawals but we leave it at 0 here

      dailyEarnings[dateStr].totalRevenue += revenue;
      dailyEarnings[dateStr].totalBookings += 1;
      dailyEarnings[dateStr].platformCommission += commission;
      dailyEarnings[dateStr].vendorEarnings += vendorEarn;
      dailyEarnings[dateStr].totalGST += gst;
    });

    // 4. Incorporate Settlements
    console.log('Fetching completed settlements...');
    const settlements = await Settlement.find({ status: 'completed' }).lean();
    settlements.forEach(settlement => {
      const dateStr = getTodayDateString(settlement.processedAt || settlement.createdAt);
      if (!dailyEarnings[dateStr]) dailyEarnings[dateStr] = { totalRevenue: 0, totalBookings: 0, platformCommission: 0, vendorEarnings: 0, totalGST: 0, totalTDS: 0, totalSettlementReceived: 0, totalAmountPaidToVendors: 0 };

      dailyEarnings[dateStr].totalSettlementReceived = (dailyEarnings[dateStr].totalSettlementReceived || 0) + settlement.amount;
    });

    // 5. Incorporate Withdrawals
    console.log('Fetching processed withdrawals...');
    const withdrawals = await Withdrawal.find({ status: 'approved' }).lean();
    withdrawals.forEach(withdrawal => {
      const dateStr = getTodayDateString(withdrawal.processedDate || withdrawal.createdAt);
      if (!dailyEarnings[dateStr]) dailyEarnings[dateStr] = { totalRevenue: 0, totalBookings: 0, platformCommission: 0, vendorEarnings: 0, totalGST: 0, totalTDS: 0, totalSettlementReceived: 0, totalAmountPaidToVendors: 0 };

      dailyEarnings[dateStr].totalAmountPaidToVendors = (dailyEarnings[dateStr].totalAmountPaidToVendors || 0) + withdrawal.amount;
      dailyEarnings[dateStr].totalTDS = (dailyEarnings[dateStr].totalTDS || 0) + (withdrawal.tdsAmount || 0); // Include TDS from withdrawals
    });

    // 6. Save into DB
    console.log(`Writing aggregated data for ${Object.keys(dailyEarnings).length} unique dates...`);
    const operations = Object.keys(dailyEarnings).map(dateStr => {
      return {
        updateOne: {
          filter: { date: dateStr },
          update: {
            $set: {
              date: dateStr,
              totalRevenue: dailyEarnings[dateStr].totalRevenue,
              totalBookings: dailyEarnings[dateStr].totalBookings,
              platformCommission: dailyEarnings[dateStr].platformCommission,
              vendorEarnings: dailyEarnings[dateStr].vendorEarnings,
              totalGST: dailyEarnings[dateStr].totalGST,
              totalTDS: dailyEarnings[dateStr].totalTDS || 0,
              totalSettlementReceived: dailyEarnings[dateStr].totalSettlementReceived || 0,
              totalAmountPaidToVendors: dailyEarnings[dateStr].totalAmountPaidToVendors || 0
            }
          },
          upsert: true
        }
      };
    });

    if (operations.length > 0) {
      await PlatformEarning.bulkWrite(operations);
    }

    // 7. Finally, calculate the static pending snapshots for TODAY dynamically and drop it into today's string
    const todayStr = getTodayDateString();

    const vendors = await Vendor.find({}, 'walletBalance').lean();
    let totalPendingSettlement = 0;
    let totalPendingAmountToVendors = 0;

    vendors.forEach(v => {
      if (v.walletBalance < 0) totalPendingSettlement += Math.abs(v.walletBalance);
      else if (v.walletBalance > 0) totalPendingAmountToVendors += v.walletBalance;
    });

    console.log(`Writing current snapshots to today (${todayStr})...`);
    await PlatformEarning.findOneAndUpdate(
      { date: todayStr },
      {
        $set: {
          totalPendingSettlement,
          totalPendingAmountToVendors
        }
      },
      { upsert: true, setDefaultsOnInsert: true }
    );

    console.log('Sync complete!');
  } catch (error) {
    console.error('Error in syncPlatformEarnings:', error);
  } finally {
    mongoose.connection.close();
  }
};

// This used to fall back to a hardcoded Atlas connection string, credentials and all.
// Besides being a secret in source control, a silent fallback meant that running this
// with MONGO_URI unset would quietly rewrite earnings on a completely different cluster.
// Fail loudly instead.
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGO_URI / MONGODB_URI is not set. Refusing to guess a database.');
  process.exit(1);
}

mongoose.connect(uri)
  .then(() => syncPlatformEarnings())
  .catch(err => console.log('MongoDB connection error:', err));
