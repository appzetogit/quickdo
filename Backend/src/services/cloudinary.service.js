/**
 * Compatibility shim: the Cloudinary API, backed by local disk.
 *
 * The Cloudinary account (`dx26sj1as`) is disabled -- every upload rejects with
 * `cloud_name is disabled`, which surfaced as a 500 on any admin image save and,
 * because some call sites never attached a rejection handler, took the whole API
 * process down with an unhandled rejection.
 *
 * Roughly sixty call sites across food and quickCommerce import these two
 * functions. Rather than edit each one, the functions keep their names, their
 * arguments and their return shapes, and write to local storage instead. The
 * detailed variant still returns `secure_url` and `public_id` because that is
 * what callers destructure; `public_id` is now the file's path under the upload
 * root, which is exactly what deleteStoredAsset needs to remove it.
 *
 * New code should call services/storage.service.js directly.
 */
import {
    saveMediaBuffer,
    deleteStoredFile,
    detectMimeType,
} from './storage.service.js';

const DEFAULT_FOLDER = 'uploads';

/** Stored image/video URL, as a plain string. */
export const uploadImageBuffer = async (buffer, folder = DEFAULT_FOLDER) => {
    if (!buffer) {
        throw new Error('File buffer is required');
    }

    const stored = await saveMediaBuffer(buffer, folder);
    return stored.url;
};

/**
 * Cloudinary-shaped upload result. `resource_type` is reported honestly so hero
 * banners can still tell a video from an image.
 */
export const uploadImageBufferDetailed = async (buffer, folder = DEFAULT_FOLDER) => {
    if (!buffer) {
        throw new Error('File buffer is required');
    }

    const stored = await saveMediaBuffer(buffer, folder);

    return {
        secure_url: stored.url,
        url: stored.url,
        public_id: stored.path,
        resource_type: stored.resourceType,
        format: (stored.mimeType || '').split('/')[1] || '',
        bytes: stored.size,
    };
};

/**
 * Explicit media upload for callers that previously passed
 * `resource_type: 'auto'` -- identical to the detailed variant, named so the
 * intent to accept video is visible at the call site.
 */
export const uploadMediaBufferDetailed = uploadImageBufferDetailed;

/**
 * Replaces cloudinary.uploader.destroy(). Takes the stored `public_id` (a path
 * under the upload root). Never throws: deletion is best-effort at every call
 * site, and a missing file should not block deleting the record that named it.
 */
export const deleteStoredAsset = async (publicId) => {
    try {
        return await deleteStoredFile(publicId);
    } catch {
        return false;
    }
};

export { detectMimeType };
