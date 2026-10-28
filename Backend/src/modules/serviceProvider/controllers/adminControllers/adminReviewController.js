const Review = require('../../models/Review');
const Booking = require('../../models/Booking');

/**
 * Get all reviews with pagination and filters
 */
exports.getAllReviews = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      rating,
      vendorId,
      serviceId,
      userId
    } = req.query;

    const query = {};
    if (status) query.status = status;
    if (rating) query.rating = parseInt(rating);
    if (vendorId) query.vendorId = vendorId;
    if (serviceId) query.serviceId = serviceId;
    if (userId) query.userId = userId;

    // Auto-migration: If no reviews exist in Review model, check Booking model
    const reviewCount = await Review.countDocuments();
    if (reviewCount === 0) {
      const bookingsWithReviews = await Booking.find({
        rating: { $exists: true, $ne: null }
      });

      if (bookingsWithReviews.length > 0) {
        const reviewsToCreate = bookingsWithReviews.map(booking => ({
          bookingId: booking._id,
          userId: booking.userId,
          serviceId: booking.serviceId,
          vendorId: booking.vendorId,
          workerId: booking.workerId,
          rating: booking.rating,
          review: booking.review || '',
          images: booking.reviewImages || [],
          status: 'active',
          createdAt: booking.reviewedAt || booking.updatedAt
        }));

        await Review.insertMany(reviewsToCreate, { ordered: false }).catch(err => {
          console.error('Error during auto-migration of reviews:', err);
        });
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const reviews = await Review.find(query)
      .populate('userId', 'name phone email profilePhoto')
      .populate('vendorId', 'businessName name phone')
      .populate('serviceId', 'title iconUrl')
      .populate('workerId', 'name phone')
      .populate('bookingId', 'bookingNumber status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Review.countDocuments(query);

    res.status(200).json({
      success: true,
      data: reviews,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get all reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews'
    });
  }
};

/**
 * Update review status (active, hidden, deleted)
 */
exports.updateReviewStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'hidden', 'deleted'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const review = await Review.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    res.status(200).json({
      success: true,
      message: `Review status updated to ${status}`,
      data: review
    });
  } catch (error) {
    console.error('Update review status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update review status'
    });
  }
};

/**
 * Get review statistics
 */
exports.getReviewStats = async (req, res) => {
  try {
    const stats = await Review.aggregate([
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
          star5: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
          star4: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
          star3: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
          star2: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
          star1: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
        }
      }
    ]);

    const statusStats = await Review.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      stats: stats[0] || { averageRating: 0, totalReviews: 0, star5: 0, star4: 0, star3: 0, star2: 0, star1: 0 },
      statusStats
    });
  } catch (error) {
    console.error('Get review stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch review statistics'
    });
  }
};
