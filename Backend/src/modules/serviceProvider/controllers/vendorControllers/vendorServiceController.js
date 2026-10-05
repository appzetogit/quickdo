const Service = require('../../models/UserService');
const { validationResult } = require('express-validator');
const { SERVICE_STATUS } = require('../../utils/constants');

/**
 * Get vendor's services
 */
const getVendorServices = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { status, page = 1, limit = 20 } = req.query;

    // Build query - services are linked to vendors through bookings
    // For now, we'll get all services and filter by vendor bookings
    // TODO: Add vendorId field to Service model if vendors can own services

    const query = {};
    if (status) {
      query.status = status;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get services (for now, return all active services)
    // In production, services should be linked to vendors
    const services = await Service.find({
      ...query,
      status: SERVICE_STATUS.ACTIVE
    })
      .populate('categoryId', 'title slug')
      .populate('categoryIds', 'title slug')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Service.countDocuments({
      ...query,
      status: SERVICE_STATUS.ACTIVE
    });

    res.status(200).json({
      success: true,
      data: services,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get vendor services error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch services. Please try again.'
    });
  }
};

/**
 * Update service availability (enable/disable)
 */
const updateServiceAvailability = async (req, res) => {
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
    const { serviceId } = req.params;
    const { isAvailable } = req.body;

    // TODO: Verify vendor owns this service
    // For now, just update the service

    const service = await Service.findById(serviceId);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Update availability (using status field)
    if (isAvailable) {
      service.status = SERVICE_STATUS.ACTIVE;
    } else {
      service.status = SERVICE_STATUS.INACTIVE;
    }

    await service.save();

    res.status(200).json({
      success: true,
      message: 'Service availability updated successfully',
      data: service
    });
  } catch (error) {
    console.error('Update service availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update service availability. Please try again.'
    });
  }
};

/**
 * Set service pricing (vendor-specific pricing)
 */
const setServicePricing = async (req, res) => {
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
    const { serviceId } = req.params;
    const { basePrice, discountPrice } = req.body;

    // TODO: Create VendorService model for vendor-specific pricing
    // For now, update the service directly (not ideal for multi-vendor scenario)

    const service = await Service.findById(serviceId);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Update pricing
    if (basePrice !== undefined) {
      service.basePrice = basePrice;
    }
    if (discountPrice !== undefined) {
      service.discountPrice = discountPrice;
    }

    await service.save();

    res.status(200).json({
      success: true,
      message: 'Service pricing updated successfully',
      data: service
    });
  } catch (error) {
    console.error('Set service pricing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update service pricing. Please try again.'
    });
  }
};

module.exports = {
  getVendorServices,
  updateServiceAvailability,
  setServicePricing
};

