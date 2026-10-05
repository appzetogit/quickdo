const City = require('../models/City');

// Helper wrapper to avoid repeating try-catch
const catchAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * @desc    Get all cities
 * @route   GET /api/admin/cities
 * @access  Private (Super Admin)
 */
exports.getAllCities = catchAsync(async (req, res) => {
  const cities = await City.find({}).sort({ displayOrder: 1, createdAt: -1 });

  res.status(200).json({
    success: true,
    count: cities.length,
    cities
  });
});

/**
 * @desc    Get active cities (Public)
 * @route   GET /api/public/cities
 * @access  Public
 */
exports.getActiveCities = catchAsync(async (req, res) => {
  const cities = await City.find({ isActive: true })
    .select('name slug state location serviceRadius isDefault currency timezone')
    .sort({ displayOrder: 1, name: 1 });

  res.status(200).json({
    success: true,
    count: cities.length,
    cities
  });
});

/**
 * @desc    Get single city
 * @route   GET /api/admin/cities/:id
 * @access  Private (Super Admin)
 */
exports.getCity = catchAsync(async (req, res) => {
  const city = await City.findById(req.params.id);

  if (!city) {
    return res.status(404).json({
      success: false,
      message: 'City not found'
    });
  }

  res.status(200).json({
    success: true,
    city
  });
});

/**
 * @desc    Create new city
 * @route   POST /api/admin/cities
 * @access  Private (Super Admin)
 */
exports.createCity = catchAsync(async (req, res) => {
  req.body.createdBy = req.user.id;

  const city = await City.create(req.body);

  res.status(201).json({
    success: true,
    message: 'City created successfully',
    city
  });
});

/**
 * @desc    Update city
 * @route   PUT /api/admin/cities/:id
 * @access  Private (Super Admin)
 */
exports.updateCity = catchAsync(async (req, res) => {
  let city = await City.findById(req.params.id);

  if (!city) {
    return res.status(404).json({
      success: false,
      message: 'City not found'
    });
  }

  // Update fields
  Object.keys(req.body).forEach(key => {
    city[key] = req.body[key];
  });

  await city.save();

  res.status(200).json({
    success: true,
    message: 'City updated successfully',
    city
  });
});

/**
 * @desc    Delete city
 * @route   DELETE /api/admin/cities/:id
 * @access  Private (Super Admin)
 */
exports.deleteCity = catchAsync(async (req, res) => {
  const city = await City.findById(req.params.id);

  if (!city) {
    return res.status(404).json({
      success: false,
      message: 'City not found'
    });
  }



  await city.deleteOne();

  res.status(200).json({
    success: true,
    message: 'City deleted successfully'
  });
});

/**
 * @desc    Toggle city status
 * @route   PATCH /api/admin/cities/:id/status
 * @access  Private (Super Admin)
 */
exports.toggleCityStatus = catchAsync(async (req, res) => {
  const city = await City.findById(req.params.id);

  if (!city) {
    return res.status(404).json({
      success: false,
      message: 'City not found'
    });
  }

  // Prevent deactivating the default city
  if (city.isDefault && city.isActive) {
    return res.status(400).json({
      success: false,
      message: 'Cannot deactivate the default city.'
    });
  }

  city.isActive = !city.isActive;
  await city.save();

  res.status(200).json({
    success: true,
    message: `City ${city.isActive ? 'activated' : 'deactivated'} successfully`,
    city
  });
});
