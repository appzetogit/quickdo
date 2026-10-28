/**
 * Local disk storage for quick-commerce media — re-exported from the master
 * service rather than copied.
 *
 * This file used to be a second implementation of src/services/storage.service.js.
 * The two drifted, as two copies do: the master grew video support and magic-byte
 * sniffing that never reached here, and on 14 Sep a document upload was added to
 * this copy while the route that needed it imports the other one. The import
 * failed at boot and took the API down.
 *
 * The direction is the safe one. quickCommerce is a fork of master, so a
 * fork -> base import keeps the dependency pointing the way the rest of the
 * repo already assumes; the reverse, which the master file's own header warns
 * against, would invert it.
 *
 * Both modules' configs read the same environment variables for every value
 * this service uses -- UPLOAD_STORAGE_ROOT, UPLOAD_BASE_URL, UPLOAD_WEBP_QUALITY
 * and UPLOAD_WEBP_MAX_WIDTH, with identical defaults -- so nothing about where
 * files land or what URL they get changes by importing the master one.
 *
 * Kept as a file rather than repointing nine callers at ../../../services: the
 * path they import is part of the fork's own shape, and a one-line move there
 * is a diff nobody can review against a behaviour change.
 */
export {
    buildPublicUrl,
    deleteStoredFile,
    ensureUploadStorageReady,
    isHostedUploadUrl,
    normalizeMediaUrlForStorage,
    optimizeImageForStorage,
    sanitizeUploadFolder,
    saveDocumentFile,
    saveImageBuffer,
    saveImageFile,
    saveImageFromUrl,
} from '../../../services/storage.service.js';
