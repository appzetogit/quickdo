const Vendor = require('../../models/Vendor');
const Booking = require('../../models/Booking');
const VendorBill = require('../../models/VendorBill');
const { validationResult } = require('express-validator');
const { VENDOR_STATUS, BOOKING_STATUS, PAYMENT_STATUS } = require('../../utils/constants');
const { createNotification } = require('../notificationControllers/notificationController');

/**
 * Get all vendors with filters and pagination
 */
const getAllVendors = async (req, res) => {
  try {
    const {
      search,
      approvalStatus,
      isActive,
      page = 1,
      limit = 20
    } = req.query;

    // Build query
    const query = {};

    if (approvalStatus) {
      query.approvalStatus = approvalStatus;
    }
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Search by name, email, phone, or business name
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { businessName: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get vendors
    const vendors = await Vendor.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const total = await Vendor.countDocuments(query);

    res.status(200).json({
      success: true,
      data: vendors,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get all vendors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendors. Please try again.'
    });
  }
};

/**
 * Get vendor details
 */
const getVendorDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const vendor = await Vendor.findById(id).select('-password');

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Get vendor stats from VendorBill (single source of truth)
    const totalBookings = await Booking.countDocuments({ vendorId: vendor._id });
    const completedBookings = await Booking.countDocuments({ vendorId: vendor._id, status: BOOKING_STATUS.COMPLETED });

    const earningsResult = await VendorBill.aggregate([
      {
        $match: {
          vendorId: vendor._id,
          status: 'paid'
        }
      },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$vendorTotalEarning' },
          totalRevenue: { $sum: '$grandTotal' }
        }
      }
    ]);

    const bookingStats = [{
      totalBookings,
      completedBookings,
      totalEarnings: earningsResult[0]?.totalEarnings || 0,
      totalRevenue: earningsResult[0]?.totalRevenue || 0
    }];

    res.status(200).json({
      success: true,
      data: {
        vendor,
        stats: bookingStats[0] || {
          totalBookings: 0,
          completedBookings: 0,
          totalEarnings: 0
        }
      }
    });
  } catch (error) {
    console.error('Get vendor details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor details. Please try again.'
    });
  }
};

/**
 * Approve vendor registration
 */
const approveVendor = async (req, res) => {
  try {
    const { id } = req.params;

    const vendor = await Vendor.findById(id);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    vendor.approvalStatus = VENDOR_STATUS.APPROVED;
    vendor.approvalDate = new Date();
    await vendor.save();

    // Send notification to vendor
    await createNotification({
      vendorId: vendor._id,
      type: 'vendor_approved',
      title: 'Vendor Registration Approved',
      message: 'Your vendor registration has been approved. You can now start accepting bookings.',
      relatedId: vendor._id,
      relatedType: 'vendor'
    });

    res.status(200).json({
      success: true,
      message: 'Vendor approved successfully',
      data: vendor
    });
  } catch (error) {
    console.error('Approve vendor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve vendor. Please try again.'
    });
  }
};

/**
 * Reject vendor registration
 */
const rejectVendor = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { reason } = req.body;

    const vendor = await Vendor.findById(id);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    vendor.approvalStatus = VENDOR_STATUS.REJECTED;
    vendor.rejectedReason = reason || 'Registration rejected by admin';
    await vendor.save();

    // Send notification to vendor
    await createNotification({
      vendorId: vendor._id,
      type: 'vendor_rejected',
      title: 'Vendor Registration Rejected',
      message: `Your vendor registration has been rejected. Reason: ${vendor.rejectedReason}`,
      relatedId: vendor._id,
      relatedType: 'vendor'
    });

    res.status(200).json({
      success: true,
      message: 'Vendor rejected successfully',
      data: vendor
    });
  } catch (error) {
    console.error('Reject vendor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject vendor. Please try again.'
    });
  }
};

/**
 * Suspend vendor
 */
const suspendVendor = async (req, res) => {
  try {
    const { id } = req.params;

    const vendor = await Vendor.findById(id);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    vendor.approvalStatus = VENDOR_STATUS.SUSPENDED;
    vendor.isActive = false;
    await vendor.save();

    res.status(200).json({
      success: true,
      message: 'Vendor suspended successfully',
      data: vendor
    });
  } catch (error) {
    console.error('Suspend vendor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to suspend vendor. Please try again.'
    });
  }
};

/**
 * View vendor bookings
 */
const getVendorBookings = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, page = 1, limit = 20 } = req.query;

    // Build query
    const query = { vendorId: id };
    if (status) {
      query.status = status;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get bookings
    const bookings = await Booking.find(query)
      .populate('userId', 'name phone')
      .populate('serviceId', 'title iconUrl')
      .populate('workerId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments(query);

    res.status(200).json({
      success: true,
      data: bookings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get vendor bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor bookings. Please try again.'
    });
  }
};

/**
 * View vendor earnings
 */
const getVendorEarnings = async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    // Get earnings from VendorBill (single source of truth)
    const billQuery = {
      // mongoose 7+ made ObjectId a real class -- calling it without `new` throws
      // "Class constructor ObjectId cannot be invoked without 'new'".
      vendorId: new (require('mongoose').Types.ObjectId)(id),
      status: 'paid'
    };

    if (startDate || endDate) {
      billQuery.paidAt = {};
      if (startDate) billQuery.paidAt.$gte = new Date(startDate);
      if (endDate) billQuery.paidAt.$lte = new Date(endDate);
    }

    const earnings = await VendorBill.aggregate([
      { $match: billQuery },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$grandTotal' },
          vendorEarnings: { $sum: '$vendorTotalEarning' },
          platformCommission: { $sum: '$companyRevenue' },
          totalBookings: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: earnings[0] || {
        totalRevenue: 0,
        vendorEarnings: 0,
        platformCommission: 0,
        totalBookings: 0
      }
    });
  } catch (error) {
    console.error('Get vendor earnings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor earnings. Please try again.'
    });
  }
};

/**
 * Get all vendor bookings (global)
 */
const getAllVendorBookings = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;

    const query = { vendorId: { $exists: true, $ne: null } };
    if (status) {
      query.status = status;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // If search is provided, we need to find vendors by business name or name first
    if (search) {
      const vendors = await Vendor.find({
        $or: [
          { businessName: { $regex: search, $options: 'i' } },
          { name: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } }
        ]
      }).select('_id');

      const vendorIds = vendors.map(v => v._id);
      query.vendorId = { $in: vendorIds };
    }

    const bookings = await Booking.find(query)
      .populate('vendorId', 'name businessName phone profileImage')
      .populate('userId', 'name phone')
      .populate('serviceId', 'title iconUrl')
      .populate('workerId', 'name phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments(query);

    res.status(200).json({
      success: true,
      data: bookings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get all vendor bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch all vendor bookings.'
    });
  }
};

/**
 * Get vendor payments summary
 */
const getVendorPaymentsSummary = async (req, res) => {
  try {
    // Return vendors with their wallet balances and earnings
    const vendors = await Vendor.find({
      'wallet.balance': { $exists: true }
    })
      .select('name businessName phone wallet email approvalStatus')
      .sort({ 'wallet.balance': -1 });

    res.status(200).json({
      success: true,
      data: vendors
    });
  } catch (error) {
    console.error('Get vendor payments summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor payments summary.'
    });
  }
};

/**
 * Toggle vendor active status (approve/disable login)
 */
const toggleVendorStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body; // Expecting { isActive: true/false }

    const vendor = await Vendor.findById(id);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    vendor.isActive = isActive;
    await vendor.save();

    // Log the action (optional but recommended)
    // console.log(`Vendor ${vendor._id} status changed to ${isActive}`);

    res.status(200).json({
      success: true,
      message: `Vendor ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: vendor
    });
  } catch (error) {
    console.error('Toggle vendor status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update vendor status'
    });
  }
};

/**
 * Delete vendor
 */
const deleteVendor = async (req, res) => {
  try {
    const { id } = req.params;

    const vendor = await Vendor.findByIdAndDelete(id);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Vendor deleted successfully'
    });
  } catch (error) {
    console.error('Delete vendor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete vendor'
    });
  }
};

module.exports = {
  getAllVendors,
  getVendorDetails,
  approveVendor,
  rejectVendor,
  suspendVendor,
  getVendorBookings,
  getVendorEarnings,
  getAllVendorBookings,
  getVendorPaymentsSummary,
  toggleVendorStatus,
  deleteVendor
};

