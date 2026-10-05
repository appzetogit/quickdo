const cloudinary = require('../config/cloudinary');
const streamifier = require('streamifier');

/**
 * Cloudinary File Storage Service
 * Uploads files to Cloudinary and returns full URLs
 */

/**
 * Upload file to Cloudinary
 * @param {Buffer|string} file - File buffer or base64 string
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} - Upload result with file path
 */
const uploadFile = async (file, options = {}) => {
  return new Promise((resolve, reject) => {
    try {
      const {
        folder = 'appzeto',
        public_id,
        extension,
        type = 'image'
      } = options;

      const uploadOptions = {
        folder: folder,
        resource_type: type === 'video' ? 'video' : 'auto',
      };

      if (public_id) {
        uploadOptions.public_id = public_id.replace(/[^a-z0-9-]/gi, '-');
      }

      // Handle file input
      let fileBuffer;
      let isBase64 = false;

      if (Buffer.isBuffer(file)) {
        fileBuffer = file;
      } else if (typeof file === 'string') {
        if (file.startsWith('data:')) {
          isBase64 = true;
          // Cloudinary can handle base64 strings directly if we want, 
          // but we'll normalize to buffer if it's not a URL type string
        } else {
          // Assume it's already base64 or a URL
          isBase64 = true;
        }
      }

      if (isBase64) {
        // Upload base64 directly to cloudinary
        cloudinary.uploader.upload(file, uploadOptions, (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            return resolve({ success: false, error: error.message });
          }
          resolve({
            success: true,
            url: result.secure_url,
            path: result.secure_url,
            public_id: result.public_id,
            format: result.format,
            bytes: result.bytes
          });
        });
      } else {
        // Upload buffer using stream
        const uploadStream = cloudinary.uploader.upload_stream(
          uploadOptions,
          (error, result) => {
            if (error) {
              console.error('Cloudinary upload error:', error);
              return resolve({ success: false, error: error.message });
            }
            resolve({
              success: true,
              url: result.secure_url,
              path: result.secure_url,
              public_id: result.public_id,
              format: result.format,
              bytes: result.bytes
            });
          }
        );

        streamifier.createReadStream(fileBuffer).pipe(uploadStream);
      }
    } catch (error) {
      console.error('File upload error:', error);
      resolve({
        success: false,
        error: error.message || error.toString() || 'Unknown error'
      });
    }
  });
};

/**
 * Delete file from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @returns {Promise<Object>} - Delete result
 */
const deleteFile = async (publicId) => {
  try {
    if (!publicId) return { success: false, error: 'No public ID provided' };

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

