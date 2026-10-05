const express = require('express');
const router = express.Router();
const {
  getAllCities,
  getCity,
  createCity,
  updateCity,
  deleteCity,
  toggleCityStatus,
  getActiveCities
} = require('../controllers/cityController');

const { protect, authorize } = require('../middleware/auth');

// Public routes
router.get('/public', getActiveCities);

// Protected routes (Super Admin only)
router.use(protect);
router.use(authorize('super_admin'));

router
  .route('/')
  .get(getAllCities)
  .post(createCity);

router
  .route('/:id')
  .get(getCity)
  .put(updateCity)
  .delete(deleteCity);

router.patch('/:id/status', toggleCityStatus);

module.exports = router;
