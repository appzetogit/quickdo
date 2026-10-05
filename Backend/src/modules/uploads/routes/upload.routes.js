import express from 'express';
import { authMiddleware } from '../../../core/auth/auth.middleware.js';
import multer from 'multer';
import { config } from '../../../config/env.js';
import { saveDocumentFile, saveImageFile } from '../../../services/storage.service.js';

const router = express.Router();

/**
 * Uploads land on local disk, not Cloudinary. The Cloudinary account is
 * disabled, so `uploadImageBuffer` returned 401 for every call — see
 * services/storage.service.js for the full story.
 *
 * Memory storage, because the image is transcoded to WebP before it is ever
 * written; a disk-backed multer would just write a file we immediately replace.
 */
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.uploadMaxFileSizeBytes, files: 1 }
});

const DEFAULT_FOLDER = 'food/menu-items';

const megabytes = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

/**
 * Turn multer's own failures into something the uploader can act on.
 *
 * A MulterError carries no statusCode, so it fell through to the generic
 * handler and was masked as "Internal server error" -- a restaurant picking a
 * photo straight off a phone camera hits the size limit routinely, and telling
 * them the server broke is both wrong and unactionable.
 */
const runUpload = (req, res, next) => {
    upload.single('file')(req, res, (error) => {
        if (!error) return next();

        const limitMb = megabytes(config.uploadMaxFileSizeBytes);
        const readable = {
            LIMIT_FILE_SIZE: `That image is too large. The limit is ${limitMb}MB — please pick a smaller photo.`,
            LIMIT_FILE_COUNT: 'Please upload one image at a time.',
            LIMIT_UNEXPECTED_FILE: 'Unexpected file field. The image must be sent as "file".',
        }[error.code];

        if (!readable) return next(error);

        return res.status(400).json({ success: false, message: readable, error: readable });
    });
};

/**
 * Coerce a client-supplied folder into something the storage layer accepts.
 *
 * Shipped clients — including Flutter builds already on people's phones, which
 * cannot be updated on our schedule — send `K9 Rides/restaurant/menu-items`.
 * That space fails the storage folder pattern, so rejecting it would break
 * every existing app install. Slugify instead: the old clients keep working and
 * land somewhere sane, and nothing about the stored path is trusted anyway
 * (storage.service re-validates that the resolved path stays under the root).
 */
const normalizeFolder = (raw) => {
    const cleaned = String(raw || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .replace(/\.+/g, '')           // no traversal segments
        .replace(/[^a-zA-Z0-9/_-]+/g, '-')  // spaces and friends become dashes
        .replace(/-+/g, '-')
        .replace(/\/+/g, '/')
        .replace(/^[^a-zA-Z0-9]+/, '');

    return cleaned || DEFAULT_FOLDER;
};

// POST /v1/uploads/image
/*
 * Authenticated, but deliberately not role-restricted: admins, restaurants and
 * delivery partners all legitimately upload here, and the endpoint only ever
 * writes an image.
 *
 * It was open to anyone. Image-only and capped, so not a route to compromise --
 * but an anonymous 5 MB write with no rate limit is a disk waiting to fill, and
 * it let the domain host arbitrary pictures.
 *
 * No registration flow uses this: restaurant signup posts to
 * /food/restaurant/upload-attachment, which stays open on purpose.
 */
router.post('/image', authMiddleware, runUpload, async (req, res, next) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: 'No file provided'
            });
        }

        const stored = await saveImageFile(req.file, normalizeFolder(req.body?.folder));

        // Response shape is unchanged from the Cloudinary era on purpose: web and
        // app clients read `data.url`, and `publicId` stays null now that there
        // is no remote asset id to report.
        return res.status(200).json({
            success: true,
            message: 'Image uploaded successfully',
            data: {
                url: stored.url,
                publicId: null,
                path: stored.path,
                size: stored.size,
                mimeType: stored.mimeType
            }
        });
    } catch (error) {
        next(error);
    }
});

// POST /v1/uploads/document
/*
 * A photograph OR a PDF, for the documents this platform has to keep rather
 * than merely display: a prescription and the pharmacy bill raised against it.
 *
 * Kept off /image on purpose. That route pushes everything through the image
 * optimiser, which a PDF cannot survive, and widening its whitelist would let
 * PDFs into every avatar and menu photo as well. Same auth, same size cap.
 */
router.post('/document', authMiddleware, runUpload, async (req, res, next) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: 'No file provided'
            });
        }

        const stored = await saveDocumentFile(req.file, normalizeFolder(req.body?.folder));

        // Same response shape as /image, so a client that already reads
        // `data.url` needs no second code path to upload a prescription.
        return res.status(200).json({
            success: true,
            message: 'Document uploaded successfully',
            data: {
                url: stored.url,
                publicId: null,
                path: stored.path,
                size: stored.size,
                mimeType: stored.mimeType
            }
        });
    } catch (error) {
        next(error);
    }
});

export default router;
