const express = require('express');
const router = express.Router();
const { uploadImage } = require('../../middleware/uploadMiddleware');
const { authenticate } = require('../../middleware/authMiddleware');

// Upload single file to Cloudinary. Signed-in callers only; it used to be open to anyone.
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
