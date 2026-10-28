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

    res.status(200).json({
      success: true,
      data: {
        totalEarnings,
        pendingJobs: pendingJobsCount,
        activeJobs: activeJobsCount,
        completedJobs: completedJobsCount,
        rating: averageRating,
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

module.exports = {
  getDashboardStats
};
