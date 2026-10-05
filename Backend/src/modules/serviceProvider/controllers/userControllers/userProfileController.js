const User = require('../../models/User');
const Cart = require('../../models/Cart');
const Settings = require('../../models/Settings');
const { validationResult } = require('express-validator');
const cloudinaryService = require('../../services/cloudinaryService');

/**
 * Get user profile
 */
const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).select('-password -otp -__v');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Lazy Check: Update plan expiry if needed
    if (user.plans && user.plans.isActive && user.plans.expiry) {
      if (new Date() > new Date(user.plans.expiry)) {
        user.plans.isActive = false;
        await user.save();
      }
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name || 'Verified Customer',
        email: user.email || null,
        phone: user.phone || null,
        isPhoneVerified: user.isPhoneVerified || false,
        isEmailVerified: user.isEmailVerified || false,
        profilePhoto: user.profilePhoto || null,
        addresses: user.addresses || [],
        plans: user.plans || {},
        settings: user.settings || {},
        wallet: user.wallet || { balance: 0 },
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile. Please try again.'
    });
  }
};

/**
 * Update user profile
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

    const userId = req.user.id;
    const { name, email, addresses, profilePhoto, settings } = req.body;

    console.log('[Profile Update] Request for user:', userId);
    console.log('[Profile Update] Data received:', { name, email, profilePhoto: profilePhoto ? 'provided' : 'not provided' });

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Build update object
    const updateData = {};

    // Update fields
    if (name && name.trim()) {
      updateData.name = name.trim();
    }

    if (email !== undefined) {
      if (email && email.trim()) {
        const newEmail = email.toLowerCase();
        // Only check for duplicate if the email is actually changing
        if (user.email !== newEmail) {
          const existingUser = await User.findOne({ email: newEmail, _id: { $ne: user._id } });
          if (existingUser) {
            console.log('[Profile Update] DUPLICATE FOUND. My _id:', user._id, 'Duplicate _id:', existingUser._id);
            return res.status(400).json({
              success: false,
              message: 'Email already in use'
            });
          }
        }
        updateData.email = newEmail;
      } else {
        // Allow clearing email
        updateData.email = null;
      }
    }

    // Update profile photo - upload to Cloudinary if it's a base64 string
    if (profilePhoto) {
      if (profilePhoto.startsWith('data:')) {
        const uploadRes = await cloudinaryService.uploadFile(profilePhoto, { folder: 'users/profiles' });
        if (uploadRes.success) {
          updateData.profilePhoto = uploadRes.url;
        }
      } else {
        updateData.profilePhoto = profilePhoto;
      }
    }

    // Update addresses - ENFORCE SINGLE ADDRESS POLICY
    if (addresses && Array.isArray(addresses)) {
      updateData.addresses = addresses.slice(-1); // Only save the last one
    }

    // Update settings
    if (settings) {
      if (settings.notifications !== undefined) {
        updateData['settings.notifications'] = settings.notifications;
      }
      if (settings.language) {
        updateData['settings.language'] = settings.language;
      }
    }

    console.log('[Profile Update] Updating with:', updateData);

    // Use findByIdAndUpdate for atomic update
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password -otp -__v');

    console.log('[Profile Update] Updated user:', updatedUser?.name, updatedUser?.email);

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        isPhoneVerified: updatedUser.isPhoneVerified,
        isEmailVerified: updatedUser.isEmailVerified,
        profilePhoto: updatedUser.profilePhoto || null,
        addresses: updatedUser.addresses || [],
        plans: updatedUser.plans || {},
        settings: updatedUser.settings || {},
        wallet: updatedUser.wallet || { balance: 0 }
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile. Please try again.'
    });
  }
};

/**
 * Get consolidated checkout data (Profile + Cart + Settings)
 */
const getCheckoutData = async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch all 3 in parallel
    const [user, cart, settings] = await Promise.all([
      User.findById(userId).select('addresses phone name'),
      Cart.findOne({ userId }).populate('items.serviceId', 'title iconUrl slug').populate('items.categoryId', 'title slug'),
      Settings.findOne({ type: 'global' }).select('visitedCharges serviceGstPercentage partsGstPercentage')
    ]);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        addresses: user.addresses || []
      },
      cartItems: cart ? cart.items : [],
      settings: settings || { visitedCharges: 29, serviceGstPercentage: 18, partsGstPercentage: 18 },
      bookingModel: settings?.bookingModel || 'worker'
    });
  } catch (error) {
    console.error('Get checkout data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch checkout data'
    });
  }
};

/**
 * Delete user profile
 */
const deleteProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Optional: Delete user's cart
    await Cart.findOneAndDelete({ userId });

    // Delete user
    await User.findByIdAndDelete(userId);

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
  getCheckoutData,
  deleteProfile
};
