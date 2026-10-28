import { saveImageBuffer } from './storage.service.js';

/**
 * Legacy name kept so existing services keep working without Cloudinary.
 * All image uploads are stored on the VPS and served by nginx.
 */
export const uploadImageBuffer = async (buffer, folder = 'uploads') => {
    const saved = await saveImageBuffer(buffer, folder);
    return saved.url;
};

export const uploadImageBufferDetailed = async (buffer, folder = 'uploads') => {
    const saved = await saveImageBuffer(buffer, folder);
    return {
        secure_url: saved.url,
        public_id: saved.path,
        url: saved.url,
        path: saved.path,
        filename: saved.filename
    };
};
