const User = require('../../models/User');
const { uploadProfilePhoto } = require('../../utils/cloudinaryUpload');

/**
 * Upload user profile photo
 */
const uploadUserPhoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a photo'
      });
    }

    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Upload to Cloudinary
    const photoUrl = await uploadProfilePhoto(req.file.buffer, 'user', userId);

    // Update user profile photo
    user.profilePhoto = photoUrl;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile photo uploaded successfully',
      photoUrl
    });
  } catch (error) {
    console.error('Upload user photo error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload photo'
    });
  }
};

module.exports = {
  uploadUserPhoto
};
