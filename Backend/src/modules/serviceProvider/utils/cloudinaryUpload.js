const cloudinary = require('../config/cloudinary');
const streamifier = require('streamifier');

/**
 * Upload file to Cloudinary
 * @param {Buffer} fileBuffer - File buffer from multer
 * @param {String} folder - Cloudinary folder path (e.g., 'homster/documents')
 * @param {String} resourceType - 'image', 'raw', 'video', 'auto'
 * @returns {Promise<Object>} - Cloudinary upload result
 */
const uploadToCloudinary = (fileBuffer, folder = 'homster/documents', resourceType = 'auto') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: resourceType,
        allowed_formats: ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx'],
        max_file_size: 5000000 // 5MB
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    streamifier.createReadStream(fileBuffer).pipe(uploadStream);
  });
};

/**
 * Upload vendor document (Aadhar/PAN)
 * @param {Buffer} fileBuffer - File buffer
 * @param {String} documentType - 'aadhar' or 'pan'
 * @param {String} vendorId - Vendor ID
 * @returns {Promise<String>} - Cloudinary URL
 */
const uploadVendorDocument = async (fileBuffer, documentType, vendorId) => {
  try {
    const folder = `homster/documents/vendors/${vendorId}`;
    const result = await uploadToCloudinary(fileBuffer, folder, 'auto');
    return result.secure_url;
  } catch (error) {
    console.error('Error uploading vendor document:', error);
    throw new Error('Failed to upload document');
  }
};

/**
 * Upload worker document (Aadhar)
 * @param {Buffer} fileBuffer - File buffer
 * @param {String} workerId - Worker ID
 * @returns {Promise<String>} - Cloudinary URL
 */
const uploadWorkerDocument = async (fileBuffer, workerId) => {
  try {
    const folder = `homster/documents/workers/${workerId}`;
    const result = await uploadToCloudinary(fileBuffer, folder, 'auto');
    return result.secure_url;
  } catch (error) {
    console.error('Error uploading worker document:', error);
    throw new Error('Failed to upload document');
  }
};

/**
 * Upload profile photo
 * @param {Buffer} fileBuffer - File buffer
 * @param {String} userType - 'user', 'vendor', 'worker'
 * @param {String} userId - User ID
 * @returns {Promise<String>} - Cloudinary URL
 */
const uploadProfilePhoto = async (fileBuffer, userType, userId) => {
  try {
    const folder = `homster/profiles/${userType}s/${userId}`;
    const result = await uploadToCloudinary(fileBuffer, folder, 'image');
    return result.secure_url;
  } catch (error) {
    console.error('Error uploading profile photo:', error);
    throw new Error('Failed to upload profile photo');
  }
};

/**
 * Delete file from Cloudinary
 * @param {String} publicId - Cloudinary public ID
 * @param {String} resourceType - 'image', 'raw', 'video'
 * @returns {Promise<Object>} - Deletion result
 */
const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType
    });
    return result;
  } catch (error) {
    console.error('Error deleting from Cloudinary:', error);
    throw new Error('Failed to delete file');
  }
};

/**
 * Upload payment screenshot (from base64)
 * @param {String} base64Data - Base64 image data
 * @param {String} transactionId - Transaction ID for folder organization
 * @returns {Promise<String>} - Cloudinary URL
 */
const uploadPaymentScreenshot = async (base64Data, transactionId) => {
  try {
    const folder = `homster/payment_proofs/${transactionId}`;

    const result = await cloudinary.uploader.upload(base64Data, {
      folder: folder,
      resource_type: 'image',
      allowed_formats: ['jpg', 'jpeg', 'png'],
      transformation: [
        { width: 1200, height: 1200, crop: 'limit' }, // Limit max dimensions
        { quality: 'auto:good' } // Auto optimize quality
      ]
    });

    return result.secure_url;
  } catch (error) {
    console.error('Error uploading payment screenshot:', error);
    throw new Error('Failed to upload payment screenshot');
  }
};

module.exports = {
  uploadToCloudinary,
  uploadVendorDocument,
  uploadWorkerDocument,
  uploadProfilePhoto,
  deleteFromCloudinary,
  uploadPaymentScreenshot
};
