const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const { isUser, isVendor, isAdmin } = require('../middleware/roleMiddleware');
const {
  createScrap,
  getMyScrap,
  getAvailableScrap,
  getMyAcceptedScrap,
  acceptScrap,
  completeScrap,
  getAllScrapAdmin,
  getScrapById,
  deleteScrap
} = require('../controllers/scrapController');

// User Routes
router.post('/', authenticate, isUser, createScrap);
router.get('/my', authenticate, isUser, getMyScrap);

// Vendor/Admin Actions - Now Admin Only
router.put('/:id/accept', authenticate, isAdmin, acceptScrap);
router.put('/:id/complete', authenticate, isAdmin, completeScrap);
router.delete('/:id', authenticate, deleteScrap); // Allow delete (controller checks auth)
// Admin Routes
router.get('/all', authenticate, isAdmin, getAllScrapAdmin);

// Shared/Specific ID Route
router.get('/:id', authenticate, getScrapById);

module.exports = router;
