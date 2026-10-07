const mongoose = require('mongoose');
const Booking = require('../../models/Booking');
const Worker = require('../../models/Worker');
const { BOOKING_STATUS } = require('../../utils/constants');

/**
 * Get worker dashboard statistics
 */
const getDashboardStats = async (req, res) => {
  try {
    const workerId = req.user.id;

    // Get Worker Profile for Rating (fallback)
    const worker = await Worker.findById(workerId).lean();

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found'
      });
    }

    // Run counts and recent jobs in parallel
    const [
      pendingJobsCount,
      activeJobsCount,
      completedJobsCount,
      recentJobs
    ] = await Promise.all([
      // Count Pending Jobs
      Booking.countDocuments({
        workerId: worker._id,
        status: {
          $in: [
            BOOKING_STATUS.ASSIGNED,
            BOOKING_STATUS.CONFIRMED,
            'PENDING'
          ]
        }
      }),

      // Count Active Jobs
      Booking.countDocuments({
        workerId: worker._id,
        status: {
          $in: [
            BOOKING_STATUS.VISITED,
            BOOKING_STATUS.IN_PROGRESS,
            BOOKING_STATUS.WORK_DONE,
            'STARTED',
            'REACHED',
            'ON_THE_WAY'
          ]
        }
      }),

      // Count Completed Jobs
      Booking.countDocuments({
        workerId: worker._id,
        status: { $in: [BOOKING_STATUS.COMPLETED, 'WORKER_PAID', 'PAID'] }
      }),

      // Get Recent Jobs
      Booking.find({ workerId: worker._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('userId', 'name')
        .populate('serviceId', 'title')
        .lean()
    ]);

    // Use pre-calculated values from Worker model instead of heavy real-time aggregations
    const totalEarnings = worker.wallet?.earnings || worker.wallet?.totalCashCollected || 0;
    const averageRating = worker.rating || 0;
    // Today / this week / this month (plan §3.6); full series at /dashboard/earnings.
    const { total: _last32Days, ...earningsBreakdown } = summarize(await workerEarningEvents(worker._id, new Date(Date.now() - 32 * 86400000)));

    res.status(200).json({
      success: true,
      data: {
        totalEarnings,
        pendingJobs: pendingJobsCount,
        activeJobs: activeJobsCount,
        completedJobs: completedJobsCount,
        rating: averageRating,
        earningsBreakdown,
        recentJobs
      }
    });

  } catch (error) {
    console.error('Get worker dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics'
    });
  }
};

/*
 * Worker earnings by day / week / month (plan §3.6), like the vendor dashboard.
 *
 * Direct-worker bookings (bookingModel 'worker'): the worker's share of each
 * completed booking -- utils/commission billSplit on the VendorBill, or the
 * booking total less its commissionSnapshot when there is no bill. Workers on a
 * vendor's team are paid by the vendor: those payments (Transaction
 * 'worker_payment') count on the day they were made. Buckets are in IST.
 */
const { billSplit } = require('../../utils/commission');
const { localParts } = require('../../services/providerEligibility');

const bucketKey = (date, period) => {
  const p = localParts(new Date(date));
  if (period === 'monthly') return p.dateStr.slice(0, 7);
  if (period === 'weekly') {
    // ISO week of the local date.
    const d = new Date(`${p.dateStr}T00:00:00Z`);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  return p.dateStr;
};

const workerEarningEvents = async (workerId, from) => {
  const VendorBill = require('../../models/VendorBill');
  const Transaction = require('../../models/Transaction');
  const wId = new mongoose.Types.ObjectId(String(workerId));
  const dateFilter = from ? { $gte: from } : { $exists: true };
  const bookings = await Booking.find({
    workerId: wId,
    status: BOOKING_STATUS.COMPLETED,
    bookingModel: 'worker',
    $or: [{ completedAt: dateFilter }, { completedAt: null, updatedAt: dateFilter }]
  }).select('bookingModel finalAmount commissionSnapshot completedAt updatedAt').lean();
  const bills = await VendorBill.find({ bookingId: { $in: bookings.map((b) => b._id) } }).select('bookingId grandTotal vendorTotalEarning companyRevenue').lean();
  const billBy = new Map(bills.map((b) => [String(b.bookingId), b]));
  const events = bookings.map((b) => {
    const bill = billBy.get(String(b._id));
    let earning;
    let revenue;
    if (bill) {
      const split = billSplit(b, bill);
      earning = split.partnerEarning;
      revenue = split.grandTotal;
    } else {
      revenue = Number(b.finalAmount) || 0;
      earning = Math.max(0, revenue - (Number(b.commissionSnapshot?.amount) || 0));
    }
    return { at: b.completedAt || b.updatedAt, earning, revenue, job: 1 };
  });
  const payments = await Transaction.find({ workerId: wId, type: 'worker_payment', status: 'completed', createdAt: dateFilter })
    .select('amount createdAt').lean();
  payments.forEach((t) => events.push({ at: t.createdAt, earning: Number(t.amount) || 0, revenue: 0, job: 0 }));
  return events;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const summarize = (events, now = new Date()) => {
  const today = bucketKey(now, 'daily');
  const week = bucketKey(now, 'weekly');
  const month = bucketKey(now, 'monthly');
  const sum = (pred) => round2(events.filter(pred).reduce((s, e) => s + e.earning, 0));
  return {
    today: sum((e) => bucketKey(e.at, 'daily') === today),
    thisWeek: sum((e) => bucketKey(e.at, 'weekly') === week),
    thisMonth: sum((e) => bucketKey(e.at, 'monthly') === month),
    total: sum(() => true)
  };
};

/**
 * GET /workers/dashboard/earnings?period=daily|weekly|monthly
 * Default ranges: daily = last 30 days, weekly = last 12 weeks, monthly = last 12 months.
 */
const getEarningsBreakdown = async (req, res) => {
  try {
    const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily';
    const DAY = 86400000;
    const span = { daily: 30 * DAY, weekly: 84 * DAY, monthly: 366 * DAY }[period];
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - span);
    if (Number.isNaN(from.getTime())) return res.status(400).json({ success: false, message: 'from must be a date' });
    const all = await workerEarningEvents(req.user.id, null);
    const inRange = all.filter((e) => new Date(e.at) >= from);
    const buckets = new Map();
    for (const e of inRange) {
      const key = bucketKey(e.at, period);
      const b = buckets.get(key) || { period: key, earnings: 0, revenue: 0, jobs: 0 };
      b.earnings = round2(b.earnings + e.earning);
      b.revenue = round2(b.revenue + e.revenue);
      b.jobs += e.job;
      buckets.set(key, b);
    }
    return res.json({
      success: true,
      data: {
        period,
        from,
        summary: summarize(all),
        earningsData: [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period))
      }
    });
  } catch (error) {
    console.error('Worker earnings breakdown error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch earnings' });
  }
};

module.exports = {
  getDashboardStats,
  getEarningsBreakdown,
  workerEarningEvents,
  summarize,
  bucketKey
};
