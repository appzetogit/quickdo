import express from 'express';
import { uploadImage } from '../controllers/upload.controller.js';
import { imageUpload, uploadRateLimiter } from '../middleware/upload.middleware.js';
import { authMiddleware } from '../../../core/auth/auth.middleware.js';
import multer from 'multer';
import { config } from '../../../../../config/env.js';
import { saveDocumentFile } from '../../../../../services/storage.service.js';

const router = express.Router();

// POST /v1/uploads/image?folder=food/users/profile
// multipart field: file (required)
/*
 * Authenticated, but deliberately not role-restricted: every panel that uploads
 * here only ever writes an image, and admin, restaurant and delivery accounts
 * all legitimately do so.
 *
 * This is quick-commerce's own copy of the upload route -- the food module has a
 * separate one, guarded at the same time. Closing only that one left this
 * reachable by anyone, which is a disk waiting to fill and lets the domain host
 * arbitrary pictures. The rate limiter below throttles a caller; it does not
 * establish who they are.
 */
router.post(
    '/image',
    authMiddleware,
    uploadRateLimiter,
    imageUpload.single('file'),
    uploadImage
);


/*
 * Memory storage and a single file, matching the food module's route. The
 * document is written by saveDocumentFile, so a disk-backed multer would only
 * write a temporary file that is immediately moved.
 */
const documentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.uploadMaxFileSizeBytes, files: 1 }
});

// POST /v1/qc/uploads/document
/*
 * A photograph OR a PDF: a prescription arrives either way, and a clinic that
 * emails one sends a PDF that never reaches the phone's gallery.
 *
 * Kept off /image deliberately. That route pushes everything through the image
 * optimiser, which a PDF cannot survive, and widening its whitelist would admit
 * PDFs to every avatar and product photo as well.
 */
router.post('/document', authMiddleware, uploadRateLimiter, documentUpload.single('file'), async (req, res, next) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ success: false, message: 'No file provided' });
        }

        // A caller-supplied folder is a path fragment, so it is stripped of
        // anything that could climb out of the uploads directory.
        const raw = String(req.body?.folder || 'qc/documents').trim();
        const folder = raw.replace(/\\/g, '/').split('/')
            .filter((part) => part && part !== '.' && part !== '..')
            .join('/') || 'qc/documents';

        const stored = await saveDocumentFile(req.file, folder);

        // Same response shape as /image, so the client reads data.url either way.
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
