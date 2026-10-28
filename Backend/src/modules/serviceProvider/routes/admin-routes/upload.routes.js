const express = require('express');
const router = express.Router();
const { uploadImage } = require('../../middleware/uploadMiddleware');
const { getSignature } = require('../../controllers/cloudinaryController');
const { authenticate } = require('../../middleware/authMiddleware');

/*
 * Both require a signed-in account. They were public, and mounted at the SP root as
 * well as under /admin: anyone could fetch a Cloudinary signature for any folder
 * (plus the API key) and upload whatever they liked to the platform's account, or
 * post files straight through /upload. The only caller -- the admin catalogue
 * screens -- sends its token. (/image/upload is a separate route used by the partner
 * apps without a token, and is unchanged.)
 */
router.get('/upload/sign-signature', authenticate, getSignature);

// Upload single file to Cloudinary
router.post('/upload', authenticate, uploadImage, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // When using multer-storage-cloudinary, req.file.path is the secure_url
    res.status(200).json({
      success: true,
      imageUrl: req.file.path,
      message: 'File uploaded successfully'
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file',
      error: error.message
    });
  }
});

module.exports = router;
