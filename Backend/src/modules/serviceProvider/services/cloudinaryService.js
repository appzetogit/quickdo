const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

/**
 * Configure Cloudinary
 */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload file to Cloudinary
 * @param {Buffer|string} file - File buffer or base64 string
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} - Upload result
 */
const uploadFile = async (file, options = {}) => {
  try {
    const {
      folder = 'appzeto',
      resource_type = 'auto',
      transformation = [],
      public_id,
      ...restOptions
    } = options;

    // Determine MIME type from public_id or default to png
    let mimeType = 'image/png';
    if (public_id) {
      const ext = public_id.split('.').pop()?.toLowerCase();
      if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
      else if (ext === 'gif') mimeType = 'image/gif';
      else if (ext === 'webp') mimeType = 'image/webp';
    }

    const uploadOptions = {
      folder,
      resource_type,
      transformation,
      ...restOptions
    };

    // Remove public_id from uploadOptions if it exists (we'll handle it separately)
    if (public_id) {
      uploadOptions.public_id = public_id;
    }

    let result;
    if (Buffer.isBuffer(file)) {
      // Upload from buffer - convert to base64 data URI
      const base64String = file.toString('base64');
      const dataUri = `data:${mimeType};base64,${base64String}`;
      result = await cloudinary.uploader.upload(dataUri, uploadOptions);
    } else {
      // Upload from base64 or URL
      result = await cloudinary.uploader.upload(file, uploadOptions);
    }

    return {
      success: true,
      url: result.secure_url,
      public_id: result.public_id,
      format: result.format,
      width: result.width,
      height: result.height,
      bytes: result.bytes
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    return {
      success: false,
      error: error.message || error.toString() || 'Unknown error'
    };
  }
};

/**
 * Delete file from Cloudinary
 * @param {string} publicId - Public ID of the file
 * @returns {Promise<Object>} - Delete result
 */
const deleteFile = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return {
      success: result.result === 'ok',
      result: result.result
    };
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  uploadFile,
  deleteFile
};

