const Worker = require('../../models/Worker');
const { validationResult } = require('express-validator');
const cloudinaryService = require('../../services/cloudinaryService');

/**
 * Get worker profile
 */
const getProfile = async (req, res) => {
  try {
    const workerId = req.user.id;

    const worker = await Worker.findById(workerId).select('-password -__v').lean();

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found'
      });
    }

    res.status(200).json({
      success: true,
      worker: {
        id: worker._id,
        name: worker.name,
        email: worker.email,
        phone: worker.phone,
        serviceCategories: worker.serviceCategories || [],
        serviceCategory: worker.serviceCategories?.[0] || '', // Legacy support
        skills: worker.skills || [],
        address: worker.address || null,
        rating: worker.rating || 0,
        totalJobs: worker.totalJobs || 0,
        completedJobs: worker.completedJobs || 0,
        status: worker.status,
        profilePhoto: worker.profilePhoto || null,
        settings: worker.settings || { notifications: true, language: 'en' },
        isPhoneVerified: worker.isPhoneVerified || false,
        isEmailVerified: worker.isEmailVerified || false,
        isOnline: worker.isOnline || false,
        createdAt: worker.createdAt,
        updatedAt: worker.updatedAt
      }
    });
  } catch (error) {
    console.error('Get worker profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile. Please try again.'
    });
  }
};

/**
 * Update worker profile
 */
const updateProfile = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const workerId = req.user.id;
    const { name, serviceCategories, serviceCategory, skills, address, status, profilePhoto } = req.body;

    const worker = await Worker.findById(workerId);

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found'
      });
    }

    // Update fields
    if (name) worker.name = name.trim();

    // Handle categories: prefer array, fallback to single legacy string
    if (serviceCategories && Array.isArray(serviceCategories)) {
      worker.serviceCategories = serviceCategories;
    } else if (serviceCategory) {
      worker.serviceCategories = [serviceCategory.trim()];
    }

    if (skills && Array.isArray(skills)) worker.skills = skills;
    if (address) {
      worker.address = {
        addressLine1: address.addressLine1 || worker.address?.addressLine1 || '',
        addressLine2: address.addressLine2 || worker.address?.addressLine2 || '',
        city: address.city || worker.address?.city || '',
        state: address.state || worker.address?.state || '',
        pincode: address.pincode || worker.address?.pincode || '',
        landmark: address.landmark || worker.address?.landmark || ''
      };
    }
    if (status) worker.status = status;
    // Update profile photo - upload to Cloudinary if it's a base64 string
    if (profilePhoto !== undefined) {
      if (profilePhoto && profilePhoto.startsWith('data:')) {
        const uploadRes = await cloudinaryService.uploadFile(profilePhoto, { folder: 'workers/profiles' });
        if (uploadRes.success) {
          worker.profilePhoto = uploadRes.url;
        }
      } else {
        worker.profilePhoto = profilePhoto;
      }
    }

    if (req.body.settings) {
      worker.settings = {
        notifications: req.body.settings.notifications !== undefined ? req.body.settings.notifications : (worker.settings?.notifications ?? true),
        soundAlerts: req.body.settings.soundAlerts !== undefined ? req.body.settings.soundAlerts : (worker.settings?.soundAlerts ?? true),
        language: req.body.settings.language || worker.settings?.language || 'en'
      };
    }

    await worker.save();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      worker: {
        id: worker._id,
        name: worker.name,
        email: worker.email,
        phone: worker.phone,
        serviceCategories: worker.serviceCategories,
        serviceCategory: worker.serviceCategories?.[0] || '',
        skills: worker.skills,
        address: worker.address,
        rating: worker.rating,
        totalJobs: worker.totalJobs,
        completedJobs: worker.completedJobs,
        status: worker.status,
        profilePhoto: worker.profilePhoto, // Include in response
        settings: worker.settings,
        isPhoneVerified: worker.isPhoneVerified,
        isEmailVerified: worker.isEmailVerified
      }
    });
  } catch (error) {
    console.error('Update worker profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile. Please try again.'
    });
  }
};

/**
 * Update worker real-time location (called periodically when online)
 */
const updateLocation = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { lat, lng } = req.body;

    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ success: false, message: 'Latitude and Longitude are required' });
    }

    // Update both location formats:
    // - location: simple lat/lng for display
    // - geoLocation: GeoJSON Point for 2dsphere spatial queries (booking matching)
    await Worker.findByIdAndUpdate(workerId, {
      location: { lat, lng, updatedAt: new Date() },
      geoLocation: {
        type: 'Point',
        coordinates: [lng, lat] // GeoJSON format: [longitude, latitude]
      },
      lastSeenAt: new Date()
    });

    res.status(200).json({ success: true, message: 'Location updated' });
  } catch (error) {
    console.error('Location update error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Toggle worker online/offline status
 * When going ONLINE: requires lat/lng to set current position
 * When going OFFLINE: clears online status
 */
const toggleOnline = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { isOnline, lat, lng } = req.body;

    const updateData = {
      status: isOnline ? 'ONLINE' : 'OFFLINE', // Manual duty status
      isOnline: !!isOnline,
      lastSeenAt: new Date()
    };

    // When going online, also update live location
    if (isOnline && lat !== undefined && lng !== undefined) {
      updateData.location = { lat, lng, updatedAt: new Date() };
      updateData.geoLocation = {
        type: 'Point',
        coordinates: [lng, lat]
      };
    }

    const worker = await Worker.findByIdAndUpdate(workerId, updateData, { new: true })
      .select('isOnline geoLocation location');

    if (!worker) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    console.log(`[Worker] ${workerId} is now ${isOnline ? '🟢 ONLINE' : '🔴 OFFLINE'}${isOnline ? ` at [${lat}, ${lng}]` : ''}`);

    res.status(200).json({
      success: true,
      message: isOnline ? 'You are now online! You will receive job alerts.' : 'You are now offline.',
      data: { isOnline: worker.isOnline }
    });
  } catch (error) {
    console.error('Toggle online error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Delete worker profile
 */
const deleteProfile = async (req, res) => {
  try {
    const workerId = req.user.id;
    
    // Check if worker exists
    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found'
      });
    }

    // Delete worker
    await Worker.findByIdAndDelete(workerId);

    res.status(200).json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Delete profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account. Please try again.'
    });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  updateLocation,
  toggleOnline,
  deleteProfile
};
