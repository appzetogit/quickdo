const Booking = require('../../models/Booking');
const VendorBill = require('../../models/VendorBill');
const Worker = require('../../models/Worker');
const Service = require('../../models/UserService');
const Settings = require('../../models/Settings');
const { BOOKING_STATUS, PAYMENT_STATUS, WORKER_STATUS } = require('../../utils/constants');

/**
 * Get vendor dashboard stats
 */
const getDashboardStats = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const mongoose = require('mongoose');
    const vId = new mongoose.Types.ObjectId(vendorId);

    // ── Get categories from req.user (from auth middleware) ──
    const vendorCategories = [
      ...(Array.isArray(req.user.categories) ? req.user.categories : []),
      ...(Array.isArray(req.user.service) ? req.user.service : [])
    ];

    // ─── SINGLE PARALLEL BLAST ───────────────────────────────────────────────
    const [bookingData, workersOnline, earningsResult] = await Promise.all([
      // 1. ALL BOOKING DATA (Counts + Recent List + Rating) in ONE round-trip
      Booking.aggregate([
        {
          $facet: {
            // General Stats
            counts: [
              {
                $match: {
                  $or: [
                    { vendorId: vId, status: { $ne: BOOKING_STATUS.AWAITING_PAYMENT } },
                    {
                      vendorId: null,
                      status: { $in: [BOOKING_STATUS.REQUESTED, BOOKING_STATUS.SEARCHING] },
                      'potentialVendors.vendorId': vId
                    }
                  ]
                }
              },
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  completed: { $sum: { $cond: [{ $eq: ['$status', BOOKING_STATUS.COMPLETED] }, 1, 0] } },
                  inProgress: {
                    $sum: {
                      $cond: [
                        {
                          $in: ['$status', [
                            BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.ASSIGNED, BOOKING_STATUS.CONFIRMED,
                            BOOKING_STATUS.JOURNEY_STARTED, BOOKING_STATUS.VISITED, BOOKING_STATUS.IN_PROGRESS,
                            BOOKING_STATUS.WORK_DONE, 'started', 'reached', 'on_the_way'
                          ]]
                        }, 1, 0
                      ]
                    }
                  },
                  pending: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            { $and: [{ $eq: ['$vendorId', vId] }, { $eq: ['$status', BOOKING_STATUS.REQUESTED] }] },
                            { $and: [{ $eq: ['$vendorId', null] }, { $in: ['$status', [BOOKING_STATUS.REQUESTED, BOOKING_STATUS.SEARCHING]] }] }
                          ]
                        }, 1, 0
                      ]
                    }
                  }
                }
              }
            ],
            // Average Rating
            rating: [
              { $match: { vendorId: vId, rating: { $ne: null } } },
              { $group: { _id: null, avg: { $avg: '$rating' } } }
            ],
            // Recent Bookings List (Optimized Projection)
            recent: [
              {
                $match: {
                  $or: [
                    { vendorId: vId, status: { $ne: BOOKING_STATUS.AWAITING_PAYMENT } },
                    {
                      vendorId: null,
                      status: { $in: [BOOKING_STATUS.REQUESTED, BOOKING_STATUS.SEARCHING] },
                      'potentialVendors.vendorId': vId
                    }
                  ]
                }
              },
              { $sort: { createdAt: -1 } },
              { $limit: 15 },
              {
                $project: {
                  _id: 1,
                  bookingNumber: 1,
                  status: 1,
                  serviceName: 1,
                  scheduledDate: 1,
                  scheduledTime: 1,
                  finalAmount: 1,
                  vendorEarnings: 1,
                  'address.addressLine1': 1,
                  userId: 1,
                  workerId: 1,
                  serviceId: 1,
                  potentialVendors: 1,
                  serviceCategory: 1,
                  brandName: 1,
                  brandIcon: 1,
                  categoryIcon: 1,
                  createdAt: 1,
                  expiresAt: 1
                }
              }
            ]
          }
        }
      ]),

      // 2. Workers online count
      Worker.countDocuments({ vendorId: vId, status: WORKER_STATUS.ONLINE }),

      // 3. Earnings (Simplified)
      VendorBill.aggregate([
        { $match: { vendorId: vId, status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$vendorTotalEarning' } } }
      ])
    ]);

    // ─── UNPACK & POPULATE ──────────────────────────────────────────────────
    const facet = bookingData[0];
    const counts = facet.counts?.[0] || { total: 0, completed: 0, inProgress: 0, pending: 0 };
    const recentBookings = facet.recent || [];
    const rating = facet.rating?.[0]?.avg || req.user.rating || 0;
    const vendorEarnings = earningsResult[0]?.total || 0;

    // Minimal population for recent bookings (Lean)
    await Booking.populate(recentBookings, [
      { path: 'userId', select: 'name phone', options: { lean: true } },
      { path: 'workerId', select: 'name', options: { lean: true } },
      {
        path: 'serviceId',
        select: 'title iconUrl categoryId',
        populate: { path: 'categoryId', select: 'title' },
        options: { lean: true }
      }
    ]);

    // 5. Fetch Global Settings for Timing
    const globalSettings = await Settings.findOne({ type: 'global' }).lean();

    res.status(200).json({
      success: true,
      data: {
        config: {
          maxSearchTime: globalSettings?.maxSearchTime || 5, // mins
          waveDuration: globalSettings?.waveDuration || 60  // secs
        },
        stats: {
          totalBookings: counts.total,
          pendingBookings: counts.pending,
          completedBookings: counts.completed,
          inProgressBookings: counts.inProgress,
          totalRevenue: vendorEarnings, // UI shows totalEarnings as sum
          vendorEarnings: vendorEarnings,
          workersOnline,
          rating: parseFloat(rating.toFixed(1))
        },
        recentBookings
      }
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats' });
  }
};

/**
 * Get revenue analytics
 */
const getRevenueAnalytics = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { period = 'monthly' } = req.query; // daily, weekly, monthly

    let groupFormat = '%Y-%m-%d';
    if (period === 'weekly') {
      groupFormat = '%Y-%W'; // Year-Week
    } else if (period === 'monthly') {
      groupFormat = '%Y-%m'; // Year-Month
    }

    // Revenue analytics from VendorBill
    const revenueData = await VendorBill.aggregate([
      {
        $match: {
          vendorId: vendorId,
          status: 'paid'
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: groupFormat,
              date: '$paidAt'
            }
          },
          revenue: { $sum: '$grandTotal' },
          earnings: { $sum: '$vendorTotalEarning' },
          bookings: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        period,
        revenueData
      }
    });
  } catch (error) {
    console.error('Get revenue analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch revenue analytics. Please try again.'
    });
  }
};

/**
 * Get worker performance
 */
const getWorkerPerformance = async (req, res) => {
  try {
    const vendorId = req.user.id;

    // Get workers for this vendor
    const workers = await Worker.find({ vendorId })
      .select('name phone rating totalJobs completedJobs');

    // Get booking stats per worker
    const workerStats = await Booking.aggregate([
      {
        $match: {
          vendorId: vendorId,
          workerId: { $ne: null }
        }
      },
      {
        $group: {
          _id: '$workerId',
          totalJobs: { $sum: 1 },
          completedJobs: {
            $sum: {
              $cond: [{ $eq: ['$status', BOOKING_STATUS.COMPLETED] }, 1, 0]
            }
          },
          totalRevenue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', BOOKING_STATUS.COMPLETED] },
                    { $eq: ['$paymentStatus', PAYMENT_STATUS.SUCCESS] }
                  ]
                },
                '$finalAmount',
                0
              ]
            }
          }
        }
      }
    ]);

    // Combine worker data with stats
    const performance = workers.map(worker => {
      const stats = workerStats.find(s => s._id.toString() === worker._id.toString());
      return {
        workerId: worker._id,
        name: worker.name,
        phone: worker.phone,
        rating: worker.rating || 0,
        totalJobs: stats?.totalJobs || 0,
        completedJobs: stats?.completedJobs || 0,
        totalRevenue: stats?.totalRevenue || 0,
        completionRate: stats?.totalJobs
          ? ((stats.completedJobs / stats.totalJobs) * 100).toFixed(2)
          : 0
      };
    });

    res.status(200).json({
      success: true,
      data: performance
    });
  } catch (error) {
    console.error('Get worker performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch worker performance. Please try again.'
    });
  }
};

/**
 * Get service performance metrics
 */
const getServicePerformance = async (req, res) => {
  try {
    const vendorId = req.user.id;

    // Get service stats
    const serviceStats = await Booking.aggregate([
      {
        $match: {
          vendorId: vendorId
        }
      },
      {
        $group: {
          _id: '$serviceId',
          totalBookings: { $sum: 1 },
          completedBookings: {
            $sum: {
              $cond: [{ $eq: ['$status', BOOKING_STATUS.COMPLETED] }, 1, 0]
            }
          },
          totalRevenue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', BOOKING_STATUS.COMPLETED] },
                    { $eq: ['$paymentStatus', PAYMENT_STATUS.SUCCESS] }
                  ]
                },
                '$finalAmount',
                0
              ]
            }
          },
          averageRating: { $avg: '$rating' }
        }
      }
    ]);

    // Populate service details
    const serviceIds = serviceStats.map(s => s._id);
    const services = await Service.find({ _id: { $in: serviceIds } })
      .select('title iconUrl slug');

    const performance = serviceStats.map(stat => {
      const service = services.find(s => s._id.toString() === stat._id.toString());
      return {
        serviceId: stat._id,
        serviceName: service?.title || 'Unknown Service',
        iconUrl: service?.iconUrl,
        totalBookings: stat.totalBookings,
        completedBookings: stat.completedBookings,
        totalRevenue: stat.totalRevenue,
        averageRating: stat.averageRating ? stat.averageRating.toFixed(2) : null,
        completionRate: stat.totalBookings
          ? ((stat.completedBookings / stat.totalBookings) * 100).toFixed(2)
          : 0
      };
    });

    res.status(200).json({
      success: true,
      data: performance
    });
  } catch (error) {
    console.error('Get service performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch service performance. Please try again.'
    });
  }
};

module.exports = {
  getDashboardStats,
  getRevenueAnalytics,
  getWorkerPerformance,
  getServicePerformance
};

