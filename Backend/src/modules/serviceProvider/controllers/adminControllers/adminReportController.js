const Booking = require('../../models/Booking');
const Vendor = require('../../models/Vendor');
const Worker = require('../../models/Worker');
const User = require('../../models/User');
const Service = require('../../models/UserService');
const { BOOKING_STATUS, PAYMENT_STATUS, VENDOR_STATUS } = require('../../utils/constants');
const { getCommissionRates } = require('../../utils/commission');

/**
 * Get Booking Report Data
 */
exports.getBookingReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    if (startDate && endDate) {
      filter.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    // Status distribution
    const statusDistribution = await Booking.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Service category distribution
    const serviceDistribution = await Booking.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: 'userservices',
          localField: 'serviceId',
          foreignField: '_id',
          as: 'service'
        }
      },
      { $unwind: '$service' },
      { $group: { _id: '$service.title', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Monthly trends
    const monthlyTrends = await Booking.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', BOOKING_STATUS.COMPLETED] }, 1, 0] }
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ['$status', BOOKING_STATUS.CANCELLED] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        statusDistribution,
        serviceDistribution,
        monthlyTrends
      }
    });
  } catch (error) {
    console.error('Booking report error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch booking report' });
  }
};

/**
 * Get Vendor Report Data
 */
exports.getVendorReport = async (req, res) => {
  try {
    // Top vendors by revenue
    const topVendors = await Booking.aggregate([
      { $match: { status: BOOKING_STATUS.COMPLETED } },
      {
        $group: {
          _id: '$vendorId',
          totalRevenue: { $sum: '$finalAmount' },
          bookingsCount: { $sum: 1 }
        }
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'vendors',
          localField: '_id',
          foreignField: '_id',
          as: 'vendor'
        }
      },
      { $unwind: '$vendor' },
      {
        $project: {
          businessName: '$vendor.businessName',
          name: '$vendor.name',
          totalRevenue: 1,
          bookingsCount: 1
        }
      }
    ]);

    // Vendor status distribution
    const statusDistribution = await Vendor.aggregate([
      { $group: { _id: '$approvalStatus', count: { $sum: 1 } } }
    ]);

    // Vendors by service category
    const categoryDistribution = await Vendor.aggregate([
      { $group: { _id: '$service', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        topVendors,
        statusDistribution,
        categoryDistribution
      }
    });
  } catch (error) {
    console.error('Vendor report error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch vendor report' });
  }
};

/**
 * Get Worker Report Data
 */
exports.getWorkerReport = async (req, res) => {
  try {
    // Top workers by jobs completed
    const topWorkers = await Booking.aggregate([
      { $match: { status: BOOKING_STATUS.COMPLETED, workerId: { $ne: null } } },
      {
        $group: {
          _id: '$workerId',
          completedJobs: { $sum: 1 },
          avgRating: { $avg: '$rating' }
        }
      },
      { $sort: { completedJobs: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'workers',
          localField: '_id',
          foreignField: '_id',
          as: 'worker'
        }
      },
      { $unwind: '$worker' },
      {
        $project: {
          name: '$worker.name',
          phone: '$worker.phone',
          completedJobs: 1,
          avgRating: 1
        }
      }
    ]);

    // Worker availability distribution
    const availabilityDistribution = await Worker.aggregate([
      { $group: { _id: '$isAvailable', count: { $sum: 1 } } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        topWorkers,
        availabilityDistribution
      }
    });
  } catch (error) {
    console.error('Worker report error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch worker report' });
  }
};

/**
 * Get Customer/User Report Data
 */
exports.getCustomerReport = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'user' });
    const totalBookings = await Booking.countDocuments();

    // User verification status distribution
    const verificationStatus = await User.aggregate([
      { $match: { role: 'user' } },
      {
        $group: {
          _id: {
            $cond: [
              { $and: ["$isPhoneVerified", "$isEmailVerified"] },
              "Fully Verified",
              {
                $cond: [
                  { $or: ["$isPhoneVerified", "$isEmailVerified"] },
                  "Partially Verified",
                  "Unverified"
                ]
              }
            ]
          },
          count: { $sum: 1 }
        }
      }
    ]);

    // Top users by bookings
    const topUsers = await Booking.aggregate([
      { $group: { _id: '$userId', bookingCount: { $sum: 1 }, totalSpent: { $sum: '$finalAmount' } } },
      { $sort: { bookingCount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: { $ifNull: ['$user.name', 'Deleted User'] },
          bookingCount: 1,
          totalSpent: 1
        }
      }
    ]);

    // Monthly registration trend
    const monthlyTrend = await User.aggregate([
      { $match: { role: 'user' } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      { $limit: 6 }
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalBookings,
        verificationStatus,
        topUsers,
        monthlyTrend
      }
    });
  } catch (error) {
    console.error('Customer report error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch customer report' });
  }
};

/**
 * Get Revenue Report Data
 */
exports.getRevenueReport = async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;
    let groupFormat = '%Y-%m';
    if (period === 'daily') groupFormat = '%Y-%m-%d';

    const { platformShare } = await getCommissionRates();

    const revenueTrends = await Booking.aggregate([
      { $match: { status: BOOKING_STATUS.COMPLETED, paymentStatus: PAYMENT_STATUS.SUCCESS } },
      {
        $group: {
          _id: { $dateToString: { format: groupFormat, date: '$completedAt' } },
          revenue: { $sum: '$finalAmount' },
          commission: { $sum: { $multiply: ['$finalAmount', platformShare] } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Revenue by service
    const revenueByService = await Booking.aggregate([
      { $match: { status: BOOKING_STATUS.COMPLETED } },
      {
        $lookup: {
          from: 'userservices',
          localField: 'serviceId',
          foreignField: '_id',
          as: 'service'
        }
      },
      { $unwind: '$service' },
      { $group: { _id: '$service.title', revenue: { $sum: '$finalAmount' } } },
      { $sort: { revenue: -1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        revenueTrends,
        revenueByService
      }
    });
  } catch (error) {
    console.error('Revenue report error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch revenue report' });
  }
};
