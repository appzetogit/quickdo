const express = require('express');
const router = express.Router();
const {
  getAllCities,
  getCity,
  createCity,
  updateCity,
  deleteCity,
  toggleCityStatus
} = require('../../controllers/cityController');
const { authenticate } = require('../../middleware/authMiddleware');
const { isSuperAdmin } = require('../../middleware/roleMiddleware');

/**
 * @route   /api/admin/cities
 * @desc    Admin city management routes
 * @access  Private (Super Admin)
 */
router.use(authenticate);
router.use(isSuperAdmin);

router.get('/cities', getAllCities);
router.get('/cities/:id', getCity);
router.post('/cities', createCity);
router.put('/cities/:id', updateCity);
router.delete('/cities/:id', deleteCity);
router.patch('/cities/:id/status', toggleCityStatus);

module.exports = router;
