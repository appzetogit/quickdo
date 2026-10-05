import axios from 'axios';
import api from '../services/api';

/**
 * Cloudinary Direct Upload Utility
 * Uploads files directly to Cloudinary using a secure signature from our backend.
 * This prevents the backend from handling heavy file bytes.
 */

/**
 * Upload a file directly to Cloudinary
 * @param {File} file - The file object to upload
 * @param {string} folder - Target folder in Cloudinary
 * @param {Function} onProgress - Progress callback (percent) => {}
 * @returns {Promise<string>} - The secure URL of the uploaded image
 */
export const uploadToCloudinary = async (file, folder = 'appzeto', onProgress) => {
  try {
    // 1. Get signature from our backend
    // Use the generic /upload/sign-signature instead of /admin prefix to ensure User access
    const signResponse = await api.get(`/upload/sign-signature?folder=${folder}`);

    if (!signResponse.data.success) {
      throw new Error('Failed to get upload signature');
    }

    const { signature, timestamp, apiKey, cloudName } = signResponse.data;

    // 2. Prepare Form Data
    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);
    formData.append('folder', folder);

    // 3. Upload directly to Cloudinary
    const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;

    const response = await axios.post(cloudinaryUrl, formData, {
      onUploadProgress: (progressEvent) => {
        if (onProgress) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percentCompleted);
        }
      }
    });

    // 4. Return the secure URL
    return response.data.secure_url;
  } catch (error) {
    console.error('Cloudinary Direct Upload Error:', error);
    throw error;
  }
};

export default uploadToCloudinary;

