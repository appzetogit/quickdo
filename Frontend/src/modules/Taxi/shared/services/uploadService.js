import api from '../api/axiosInstance';

export const uploadService = {
  /**
   * Upload an image (base64) to Cloudinary via the backend
   * @param {string} base64Image - The base64 string of the image
   * @param {string} folder - Destination folder on Cloudinary
   * @returns {Promise<{url: string, publicId: string, format: string}>}
   */
  uploadImage: async (base64Image, folder = 'general') => {
    try {
      const response = await api.post('/common/upload/image', {
        image: base64Image,
        folder
      });
      return response?.data || response;
    } catch (error) {
      console.error('Upload Service Error:', error);
      throw error;
    }
  },
  /**
   * Upload an image file/blob via multipart form data
   * @param {File|Blob} file - Image file or blob
   * @param {string} folder - Destination folder on Cloudinary
   */
  uploadImageFile: async (file, folder = 'general') => {
    try {
      const formData = new FormData();
      formData.append('image', file, file?.name || 'upload.jpg');
      formData.append('folder', folder);

      const response = await api.post('/common/upload/image', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response?.data || response;
    } catch (error) {
      console.error('Upload Service Error:', error);
      throw error;
    }
  }
};
