const Worker = require('../../models/Worker');
const Booking = require('../../models/Booking');
const { validationResult } = require('express-validator');
const cloudinaryService = require('../../services/cloudinaryService');
const { WORKER_STATUS, BOOKING_STATUS } = require('../../utils/constants');

/**
 * Get vendor's workers
 */
const getVendorWorkers = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { status, page = 1, limit = 20 } = req.query;

    // Build query
    const query = { vendorId };
    if (status) {
      query.status = status;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get workers
    const workers = await Worker.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const total = await Worker.countDocuments(query);

    res.status(200).json({
      success: true,
      data: workers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get vendor workers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch workers. Please try again.'
    });
  }
};

/**
 * Add worker
 */
const addWorker = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const vendorId = req.user.id;
    const {
      name,
      email,
      phone,
      aadhar,
      serviceCategories,
      address
    } = req.body;

    // Upload Aadhar document to Cloudinary if it's a base64 string
    let aadharUrl = aadhar && aadhar.document ? aadhar.document : null;
    if (aadharUrl && aadharUrl.startsWith('data:')) {
      const uploadRes = await cloudinaryService.uploadFile(aadharUrl, { folder: 'workers/documents' });
      if (uploadRes.success) aadharUrl = uploadRes.url;
    }

    // Check if worker already exists
    let worker = await Worker.findOne({ phone });

    if (worker) {
      // If worker exists but has no vendor, link them and update details
      if (!worker.vendorId) {
        worker.vendorId = vendorId;
        worker.name = name;
        worker.email = email;
        if (aadhar) {
          worker.aadhar = {
            number: aadhar.number,
            document: aadharUrl
          };
        }
        if (serviceCategories) worker.serviceCategories = serviceCategories;
        if (address) worker.address = address;
        worker.status = WORKER_STATUS.ACTIVE;

        await worker.save();

        return res.status(200).json({
          success: true,
          message: 'Existing worker successfully linked to your account',
          data: worker
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Worker with this phone number is already registered with a vendor'
      });
    }

    // Create worker
    worker = await Worker.create({
      name,
      email: email || null, // Handle empty string as null for sparse index
      phone,
      aadhar: {
        number: aadhar.number,
        document: aadharUrl
      },
      vendorId,
      serviceCategories: serviceCategories || [],
      address: address || {},
      status: WORKER_STATUS.ACTIVE
    });

    res.status(201).json({
      success: true,
      message: 'Worker added successfully',
      data: worker
    });
  } catch (error) {
    console.error('Add worker error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add worker. Please try again.'
    });
  }
};

/**
 * Link existing worker by phone
 */
const linkWorker = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const worker = await Worker.findOne({ phone });

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found with this phone number'
      });
    }

    if (worker.vendorId) {
      return res.status(400).json({
        success: false,
        message: 'Worker is already linked to another vendor'
      });
    }

    // Link worker
    worker.vendorId = vendorId;
    worker.status = WORKER_STATUS.ACTIVE;
    await worker.save();

    res.status(200).json({
      success: true,
      message: 'Worker linked successfully',
      data: worker
    });

  } catch (error) {
    console.error('Link worker error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to link worker'
    });
  }
};

/**
 * Update worker details
 */
const updateWorker = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const vendorId = req.user.id;
    const { id } = req.params;
    const updateData = req.body;

    // Verify worker belongs to vendor
    const worker = await Worker.findOne({ _id: id, vendorId });

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found or does not belong to your vendor account'
      });
    }

    // Update fields
    if (updateData.name) worker.name = updateData.name;
    if (updateData.email !== undefined) worker.email = updateData.email || null;
    if (updateData.serviceCategories) worker.serviceCategories = updateData.serviceCategories;
    if (updateData.address) worker.address = { ...worker.address, ...updateData.address };
    if (updateData.status) worker.status = updateData.status;

    // Update Aadhar if provided
    if (updateData.aadhar) {
      let aadharUrl = updateData.aadhar.document || worker.aadhar?.document;
      if (aadharUrl && aadharUrl.startsWith('data:')) {
        const uploadRes = await cloudinaryService.uploadFile(aadharUrl, { folder: 'workers/documents' });
        if (uploadRes.success) aadharUrl = uploadRes.url;
      }
      worker.aadhar = {
        number: updateData.aadhar.number || worker.aadhar?.number,
        document: aadharUrl
      };
    }

    // Update Profile Photo if provided
    if (updateData.profilePhoto !== undefined) {
      let photoUrl = updateData.profilePhoto;
      if (photoUrl && photoUrl.startsWith('data:')) {
        const uploadRes = await cloudinaryService.uploadFile(photoUrl, { folder: 'workers/profiles' });
        if (uploadRes.success) photoUrl = uploadRes.url;
      }
      worker.profilePhoto = photoUrl;
    }

    await worker.save();

    res.status(200).json({
      success: true,
      message: 'Worker updated successfully',
      data: worker
    });
  } catch (error) {
    console.error('Update worker error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update worker. Please try again.'
    });
  }
};

/**
 * Remove worker
 */
const removeWorker = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;

    // Verify worker belongs to vendor
    const worker = await Worker.findOne({ _id: id, vendorId });

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found or does not belong to your vendor account'
      });
    }

    // Check if worker has active bookings
    const activeBookings = await Booking.countDocuments({
      workerId: id,
      status: { $in: [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.IN_PROGRESS] }
    });

    if (activeBookings > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot remove worker with ${activeBookings} active booking(s)`
      });
    }

    // Remove worker (soft delete by setting status to inactive)
    worker.status = WORKER_STATUS.INACTIVE;
    worker.vendorId = null; // Unassign from vendor
    await worker.save();

    res.status(200).json({
      success: true,
      message: 'Worker removed successfully'
    });
  } catch (error) {
    console.error('Remove worker error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove worker. Please try again.'
    });
  }
};

/**
 * Get worker performance stats
 */
const getWorkerPerformance = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;

    // Verify worker belongs to vendor
    const worker = await Worker.findOne({ _id: id, vendorId });

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found or does not belong to your vendor account'
      });
    }

    // Get booking stats
    const stats = await Booking.aggregate([
      {
        $match: { workerId: id }
      },
      {
        $group: {
          _id: null,
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
                    { $eq: ['$paymentStatus', 'success'] }
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

    const performance = stats[0] || {
      totalJobs: 0,
      completedJobs: 0,
      totalRevenue: 0,
      averageRating: 0
    };

    res.status(200).json({
      success: true,
      data: {
        worker: {
          id: worker._id,
          name: worker.name,
          phone: worker.phone,
          rating: worker.rating || 0
        },
        performance: {
          ...performance,
          completionRate: performance.totalJobs
            ? ((performance.completedJobs / performance.totalJobs) * 100).toFixed(2)
            : 0,
          averageRating: performance.averageRating
            ? performance.averageRating.toFixed(2)
            : 0
        }
      }
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
 * Get single worker by ID
 */
const getVendorWorkerById = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;

    const worker = await Worker.findOne({ _id: id, vendorId });

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found or does not belong to your vendor account'
      });
    }

    res.status(200).json({
      success: true,
      data: worker
    });
  } catch (error) {
    console.error('Get worker by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch worker details'
    });
  }
};

module.exports = {
  getVendorWorkers,
  getVendorWorkerById,
  addWorker,
  linkWorker,
  updateWorker,
  removeWorker,
  getWorkerPerformance
};

