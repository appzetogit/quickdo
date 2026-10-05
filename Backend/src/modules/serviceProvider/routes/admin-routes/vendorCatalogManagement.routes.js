const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isAdmin } = require('../../middleware/roleMiddleware');
const {
  getAllVendorServices,
  createVendorService,
  updateVendorService,
  deleteVendorService,
  getAllVendorParts,
  createVendorPart,
  updateVendorPart,
  deleteVendorPart
} = require('../../controllers/adminControllers/vendorCatalogController');

// Vendor Service Routes
router.get('/vendor-services', authenticate, isAdmin, getAllVendorServices);
router.post('/vendor-services', authenticate, isAdmin, createVendorService);
router.put('/vendor-services/:id', authenticate, isAdmin, updateVendorService);
router.delete('/vendor-services/:id', authenticate, isAdmin, deleteVendorService);

// Vendor Part Routes
router.get('/vendor-parts', authenticate, isAdmin, getAllVendorParts);
router.post('/vendor-parts', authenticate, isAdmin, createVendorPart);
router.put('/vendor-parts/:id', authenticate, isAdmin, updateVendorPart);
router.delete('/vendor-parts/:id', authenticate, isAdmin, deleteVendorPart);

module.exports = router;
