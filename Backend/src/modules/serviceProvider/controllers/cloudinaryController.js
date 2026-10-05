const cloudinary = require('../config/cloudinary');

/**
 * Cloudinary Controller
 * Handles server-side logic for Cloudinary interactions
 */

/**
 * Generate a signed upload signature for direct frontend uploads
 * This offloads the file transfer from our server to Cloudinary directly.
 */
exports.getSignature = async (req, res) => {
  try {
    const { folder = 'appzeto' } = req.query;
    const timestamp = Math.round(new Date().getTime() / 1000);

    // Params to be signed
    const paramsToSign = {
      timestamp,
      folder
    };

    // Generate signature using API Secret
    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET
    );

    res.status(200).json({
      success: true,
      signature,
      timestamp,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      folder
    });
  } catch (error) {
    console.error('Cloudinary signature error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate upload signature',
      error: error.message
    });
  }
};
