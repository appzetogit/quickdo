const VendorServiceCatalog = require('../../models/VendorServiceCatalog');
const VendorPartsCatalog = require('../../models/VendorPartsCatalog');
const { validationResult } = require('express-validator');
const { SERVICE_STATUS } = require('../../utils/constants');

/**
 * Get all vendor services
 * GET /api/admin/vendor-services
 */
const getAllVendorServices = async (req, res) => {
  try {
    const services = await VendorServiceCatalog.find()
      .populate('categoryId', 'title')
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: services.length, services });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch vendor services' });
  }
};

/**
 * Create vendor service
 * POST /api/admin/vendor-services
 */
const createVendorService = async (req, res) => {
  try {
    const { name, price, basePrice, status, description, categoryId } = req.body;
    // Handle either price or basePrice from frontend
    const finalPrice = price || basePrice;

    const service = await VendorServiceCatalog.create({
      name,
      price: finalPrice,
      status,
      description,
      categoryId
    });
    res.status(201).json({ success: true, service });
  } catch (error) {
    console.error('Create vendor service error:', error);
    res.status(500).json({ success: false, message: 'Failed to create vendor service' });
  }
};

/**
 * Update vendor service
 * PUT /api/admin/vendor-services/:id
 */
const updateVendorService = async (req, res) => {
  try {
    const { basePrice, price, ...rest } = req.body;
    const updateData = { ...rest };
    if (basePrice !== undefined || price !== undefined) {
      updateData.price = price || basePrice;
    }

    const service = await VendorServiceCatalog.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!service) return res.status(404).json({ success: false, message: 'Service not found' });
    res.status(200).json({ success: true, service });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update vendor service' });
  }
};

/**
 * Delete vendor service
 * DELETE /api/admin/vendor-services/:id
 */
const deleteVendorService = async (req, res) => {
  try {
    await VendorServiceCatalog.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Service deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete vendor service' });
  }
};

/**
 * Get all vendor parts
 * GET /api/admin/vendor-parts
 */
const getAllVendorParts = async (req, res) => {
  try {
    const parts = await VendorPartsCatalog.find()
      .populate('categoryId', 'title')
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: parts.length, parts });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch vendor parts' });
  }
};

/**
 * Create vendor part
 * POST /api/admin/vendor-parts
 */
const createVendorPart = async (req, res) => {
  try {
    const { name, price, basePrice, hsnCode, gstApplicable, gstPercentage, status, description, categoryId } = req.body;
    const finalPrice = price || basePrice;
    const part = await VendorPartsCatalog.create({
      name,
      price: finalPrice,
      hsnCode,
      gstApplicable,
      gstPercentage,
      status,
      description,
      categoryId
    });
    res.status(201).json({ success: true, part });
  } catch (error) {
    console.error('Create vendor part error:', error);
    res.status(500).json({ success: false, message: 'Failed to create vendor part' });
  }
};

/**
 * Update vendor part
 * PUT /api/admin/vendor-parts/:id
 */
const updateVendorPart = async (req, res) => {
  try {
    const { basePrice, price, categoryId, ...rest } = req.body;
    const updateData = { ...rest };
    if (basePrice !== undefined || price !== undefined) {
      updateData.price = price || basePrice;
    }
    if (categoryId) {
      updateData.categoryId = categoryId;
    }

    const part = await VendorPartsCatalog.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!part) return res.status(404).json({ success: false, message: 'Part not found' });
    res.status(200).json({ success: true, part });
  } catch (error) {
    console.error('Update vendor part error:', error);
    res.status(500).json({ success: false, message: 'Failed to update vendor part' });
  }
};

/**
 * Delete vendor part
 * DELETE /api/admin/vendor-parts/:id
 */
const deleteVendorPart = async (req, res) => {
  try {
    await VendorPartsCatalog.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Part deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete vendor part' });
  }
};

module.exports = {
  getAllVendorServices,
  createVendorService,
  updateVendorService,
  deleteVendorService,
  getAllVendorParts,
  createVendorPart,
  updateVendorPart,
  deleteVendorPart
};
