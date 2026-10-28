const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isVendor } = require('../../middleware/roleMiddleware');
const VendorServiceCatalog = require('../../models/VendorServiceCatalog');
const VendorPartsCatalog = require('../../models/VendorPartsCatalog');

/**
 * Get all vendor services for catalog
 * GET /api/vendors/catalog/services
 */
router.get('/services', authenticate, isVendor, async (req, res) => {
  try {
    const services = await VendorServiceCatalog.find({ status: 'active' }).populate('categoryId', 'title').sort({ name: 1 });
    res.status(200).json({ success: true, services });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch services catalog' });
  }
});

/**
 * Get all vendor parts for catalog
 * GET /api/vendors/catalog/parts
 */
router.get('/parts', authenticate, isVendor, async (req, res) => {
  try {
    const parts = await VendorPartsCatalog.find({ status: 'active' })
      .populate('categoryId', 'title')
      .sort({ name: 1 });
    res.status(200).json({ success: true, parts });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch parts catalog' });
  }
});

module.exports = router;
