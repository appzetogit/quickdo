const Service = require('../../models/UserService');
const Brand = require('../../models/Brand');
const { validationResult } = require('express-validator');
const { SERVICE_STATUS } = require('../../utils/constants');

/**
 * Get all services (with filter by brandId)
 * GET /api/admin/services
 */
const getAllServices = async (req, res) => {
  try {
    const { status, brandId } = req.query;

    const query = {};
    if (status) query.status = status;
    if (brandId) query.brandId = brandId;

    const services = await Service.find(query)
      .populate('brandId', 'title')
      .populate('categoryId', 'title')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: services.length,
      services
    });
  } catch (error) {
    console.error('Get all services error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch services'
    });
  }
};

/**
 * Get single service by ID
 * GET /api/admin/services/:id
 */
const getServiceById = async (req, res) => {
  try {
    const service = await Service.findById(req.params.id)
      .populate('brandId', 'title')
      .populate('categoryId', 'title');

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    res.status(200).json({
      success: true,
      service
    });
  } catch (error) {
    console.error('Get service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch service'
    });
  }
};

/**
 * Create new service
 * POST /api/admin/services
 */
const createService = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      brandId,
      categoryId,
      title,
      basePrice,
      gstPercentage,
      pricingUnit,
      description,
      status,
      iconUrl
    } = req.body;

    // Verify brand exists
    const brand = await Brand.findById(brandId);
    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    // Try to create service
    // If slug collision happens within same brand, mongoose throws duplicate key error
    const service = await Service.create({
      brandId,
      categoryId,
      title,
      basePrice,
      gstPercentage: gstPercentage || 18,
      pricingUnit,
      description,
      status: status || SERVICE_STATUS.ACTIVE,
      iconUrl
    });

    res.status(201).json({
      success: true,
      message: 'Service created successfully',
      service
    });
  } catch (error) {
    // Handle duplicate slug error specifically
    if (error.code === 11000 && error.keyPattern && error.keyPattern.slug) {
      return res.status(409).json({
        success: false,
        message: 'A service with this name already exists for this brand.'
      });
    }

    console.error('Create service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create service'
    });
  }
};

/**
 * Update service
 * PUT /api/admin/services/:id
 */
const updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const service = await Service.findById(id);
    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // If brandId is being updated, verify it exists
    if (updates.brandId) {
      const brand = await Brand.findById(updates.brandId);
      if (!brand) {
        return res.status(404).json({
          success: false,
          message: 'Brand not found'
        });
      }
    }

    // Update fields
    if (updates.title) service.title = updates.title;
    if (updates.categoryId) service.categoryId = updates.categoryId;
    if (updates.basePrice !== undefined) service.basePrice = updates.basePrice;
    if (updates.gstPercentage !== undefined) service.gstPercentage = updates.gstPercentage;
    if (updates.pricingUnit !== undefined) service.pricingUnit = updates.pricingUnit;
    if (updates.description !== undefined) service.description = updates.description;
    if (updates.status) service.status = updates.status;
    if (updates.iconUrl !== undefined) service.iconUrl = updates.iconUrl;
    if (updates.brandId) service.brandId = updates.brandId;

    // Slugs are auto-updated if title changes via pre-save hook? 
    // Wait, the pre-save hook only runs if slug is empty or we explicitly modify it?
    // In Mongoose schemas, I usually rely on logic. 
    // My previous Service.js schema had logic: if (this.isModified('title') && !this.slug)
    // This implies slug is created once.
    // If user changes title, slug might remain old? 
    // If they want to regenerate usage, they should clear slug?
    // UserService.js has: if (this.isModified('title') && !this.slug)
    // So updating title WON'T update slug unless slug is cleared.
    // This is generally safer for URLs.

    await service.save();

    res.status(200).json({
      success: true,
      message: 'Service updated successfully',
      service
    });
  } catch (error) {
    // Handle duplicate slug error specifically
    if (error.code === 11000 && error.keyPattern && error.keyPattern.slug) {
      return res.status(409).json({
        success: false,
        message: 'A service with this name already exists for this brand.'
      });
    }

    console.error('Update service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update service'
    });
  }
};

/**
 * Delete service
 * DELETE /api/admin/services/:id
 */
const deleteService = async (req, res) => {
  try {
    const { id } = req.params;

    // Hard delete as requested
    const service = await Service.findByIdAndDelete(id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Service deleted permanently'
    });
  } catch (error) {
    console.error('Delete service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete service'
    });
  }
};

module.exports = {
  getAllServices,
  getServiceById,
  createService,
  updateService,
  deleteService
};
