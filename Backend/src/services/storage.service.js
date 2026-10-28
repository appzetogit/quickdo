/**
 * Local disk image storage — the store of record for food media.
 *
 * Food used to upload to Cloudinary. That account (`dx26sj1as`) is disabled:
 * every delivery URL returns 401 `cloud_name is disabled`, and so does every
 * new upload. quickCommerce had already moved to local disk; this is the same
 * implementation on the master side so food can follow.
 *
 * It mirrors modules/quickCommerce/services/storage.service.js rather than
 * importing it: master is the base and quickCommerce is a fork of it, so a
 * master -> fork import
 * import would invert that dependency. Leaf utilities are
 * already duplicated across that boundary throughout this repo.
 *
 * Images are normalized to WebP on the way in (GIF passes through so animation
 * survives), which is why the stored extension rarely matches the uploaded one.
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import sharp from 'sharp';
import { config } from '../config/env.js';
import { ValidationError } from '../core/auth/errors.js';
import { isPrivatePath, privateRoot, privateUrl } from '../core/files/privateFiles.js';

const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif'
]);

const WEBP_MIME = 'image/webp';
const GIF_MIME = 'image/gif';
const FOLDER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/;

/** Hero banners may be video, so the store is not images-only. */
const VIDEO_MIME_EXTENSIONS = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-m4v': '.m4v',
    'video/ogg': '.ogv',
};

/**
 * Identify a buffer by its magic bytes.
 *
 * Most callers hand us a bare Buffer with no mime type -- the old Cloudinary
 * helpers took `(buffer, folder)` and let the service sniff server-side. Sharp
 * could infer image types on its own, but video has to bypass sharp entirely,
 * so the type must be known before choosing a path.
 */
export const detectMimeType = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.toString('ascii', 0, 3) === 'GIF') return GIF_MIME;
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return WEBP_MIME;
    if (buffer.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'video/webm';

    return null;
};

export const isVideoMimeType = (mimeType) =>
    Object.prototype.hasOwnProperty.call(VIDEO_MIME_EXTENSIONS, String(mimeType || '').toLowerCase());

/**
 * Folder names arrive from client form data, so they are path-traversal input
 * until proven otherwise. Rejecting `..` is not enough on its own — getAbsolutePath
 * re-checks the resolved path stays under the storage root.
 */
export const sanitizeUploadFolder = (folder) => {
    const normalized = String(folder || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalized) {
        throw new ValidationError('Folder is required');
    }
    if (normalized.includes('..') || normalized.startsWith('.')) {
        throw new ValidationError('Invalid folder path');
    }
    if (!FOLDER_PATTERN.test(normalized)) {
        throw new ValidationError('Folder may only contain letters, numbers, /, _, and -');
    }
    return normalized;
};

const buildFilename = (extension) => {
    const stamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `${stamp}-${random}${extension}`;
};

export const fixMediaUrlProtocol = (url) => String(url || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(https?):\/(?!\/)/i, '$1://')
    .replace(/^(https?:\/\/)(https?:\/\/)+/i, '$1');

/**
 * Turn a stored relative path into the URL clients receive.
 *
 * A localhost base is never persisted: those rows outlive the dev machine that
 * wrote them and resolve to nothing in production or in the APK.
 */
export const buildPublicUrl = (relativePath) => {
    const cleanPath = String(relativePath || '').replace(/^\/+/, '');
    // Identity documents are not public: their link goes through the signed
    // file route (core/files/privateFiles.js), which also re-signs it per response.
    if (isPrivatePath(cleanPath)) return privateUrl(cleanPath);
    const base = fixMediaUrlProtocol(String(config.uploadBaseUrl || '').replace(/\/+$/, ''));

    if (
        !base
        || base === '/uploads'
        || /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/uploads)?$/i.test(base)
    ) {
        return `/uploads/${cleanPath}`;
    }

    return `${base}/${cleanPath}`;
};

/** Normalize any media URL before it is written to Mongo. */
export const normalizeMediaUrlForStorage = (url) => {
    const trimmed = fixMediaUrlProtocol(url);
    if (!trimmed) return '';

    if (trimmed.startsWith('/uploads/')) {
        return trimmed;
    }

    try {
        const parsed = new URL(trimmed);
        if (/^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname) && parsed.pathname.startsWith('/uploads/')) {
            return parsed.pathname;
        }
        if (parsed.pathname.startsWith('/uploads/')) {
            return fixMediaUrlProtocol(parsed.toString());
        }
    } catch {
        /* not a full URL */
    }

    return trimmed;
};

const getAbsolutePath = (relativePath) => {
    // Identity documents live under a root that nothing serves directly.
    const root = isPrivatePath(relativePath) ? privateRoot() : path.resolve(config.uploadStorageRoot);
    const absolute = path.resolve(root, relativePath);
    if (!absolute.startsWith(`${root}${path.sep}`) && absolute !== root) {
        throw new ValidationError('Invalid file path');
    }
    return absolute;
};

const getWebpQuality = () => {
    const raw = Number(config.uploadWebpQuality);
    if (!Number.isFinite(raw)) return 90;
    return Math.min(100, Math.max(1, Math.round(raw)));
};

const getWebpMaxWidth = () => {
    const raw = Number(config.uploadWebpMaxWidth);
    if (!Number.isFinite(raw) || raw < 1) return 2560;
    return Math.round(raw);
};

/**
 * Convert JPEG/PNG/WebP to optimized WebP. GIF is returned untouched so
 * animation survives; PNGs with alpha use lossless WebP so transparency does
 * not turn into fringing.
 */
export const optimizeImageForStorage = async (inputBuffer, mimeType) => {
    const normalizedMime = String(mimeType || '').toLowerCase();

    if (normalizedMime === GIF_MIME) {
        return { buffer: inputBuffer, mimeType: GIF_MIME, extension: '.gif' };
    }

    if (!['image/jpeg', 'image/jpg', 'image/png', WEBP_MIME].includes(normalizedMime)) {
        throw new ValidationError('Unsupported image type');
    }

    const maxWidth = getWebpMaxWidth();
    const quality = getWebpQuality();

    /*
     * The declared type is only what the browser or app claimed. An iPhone HEIC
     * photo sent as image/jpeg, or a truncated upload, reaches here and sharp
     * throws "Input buffer contains unsupported image format" -- which surfaced
     * as a 500 on rider registration. It is the uploader's file, so say so.
     */
    let metadata;
    try {
        metadata = await sharp(inputBuffer, { failOn: 'none' }).metadata();
    } catch {
        throw new ValidationError('This photo could not be read. Please upload a JPEG, PNG or WebP image.');
    }
    const needsResize = Boolean(metadata.width && metadata.width > maxWidth);

    if (normalizedMime === WEBP_MIME && !needsResize) {
        return { buffer: inputBuffer, mimeType: WEBP_MIME, extension: '.webp' };
    }

    let pipeline = sharp(inputBuffer, { failOn: 'none' }).rotate();

    if (needsResize) {
        pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
    }

    const hasAlpha = Boolean(metadata.hasAlpha);
    const webpOptions = hasAlpha
        ? { lossless: true, effort: 4 }
        : { quality, effort: 4, smartSubsample: true };

    return {
        buffer: await pipeline.webp(webpOptions).toBuffer(),
        mimeType: WEBP_MIME,
        extension: '.webp'
    };
};

/** Create the upload root (and optional subfolder) if missing. */
export const ensureUploadStorageReady = async (folder = '') => {
    const root = path.resolve(config.uploadStorageRoot);
    await fs.mkdir(root, { recursive: true });

    if (folder) {
        await fs.mkdir(getAbsolutePath(sanitizeUploadFolder(folder)), { recursive: true });
    }

    return root;
};

const PDF_MIME = 'application/pdf';

/**
 * A prescription or a pharmacy bill, which is a photograph OR a PDF.
 *
 * Separate from saveImageFile rather than widening it. That function exists to
 * put every uploaded picture through the optimiser, and a PDF cannot go through
 * it -- sharp would reject the buffer, and a "PDF" that survived being
 * re-encoded as WebP would be a blank image where a prescription used to be.
 * Widening the whitelist there would also let a PDF into every avatar and menu
 * photo on the platform.
 *
 * PDFs are written byte for byte: this is a document someone may have to
 * produce later, so it is stored exactly as it was sent. Images still take the
 * ordinary optimised path.
 */
export const saveDocumentFile = async (file, folder) => {
    if (!file?.buffer?.length) {
        throw new ValidationError('File is required');
    }

    const mimeType = String(file.mimetype || '').toLowerCase();
    if (mimeType !== PDF_MIME) {
        if (!ALLOWED_MIME_TYPES.has(mimeType)) {
            throw new ValidationError('Upload a photo (JPEG, PNG, WebP) or a PDF');
        }
        return saveImageFile(file, folder);
    }

    const safeFolder = sanitizeUploadFolder(folder);
    const filename = buildFilename('.pdf');
    const relativePath = path.posix.join(safeFolder, filename);
    const absolutePath = getAbsolutePath(relativePath);

    await ensureUploadStorageReady(safeFolder);
    await fs.writeFile(absolutePath, file.buffer);

    return {
        url: buildPublicUrl(relativePath),
        path: relativePath,
        filename,
        mimeType: PDF_MIME,
        size: file.buffer.length
    };
};

export const saveImageFile = async (file, folder) => {
    if (!file?.buffer?.length) {
        throw new ValidationError('File is required');
    }

    const mimeType = String(file.mimetype || '').toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        throw new ValidationError('Only JPEG, PNG, WebP, and GIF images are allowed');
    }

    const safeFolder = sanitizeUploadFolder(folder);
    const optimized = await optimizeImageForStorage(file.buffer, mimeType);
    const filename = buildFilename(optimized.extension);
    const relativePath = path.posix.join(safeFolder, filename);
    const absolutePath = getAbsolutePath(relativePath);

    await ensureUploadStorageReady(safeFolder);
    await fs.writeFile(absolutePath, optimized.buffer);

    return {
        url: buildPublicUrl(relativePath),
        path: relativePath,
        filename,
        mimeType: optimized.mimeType,
        size: optimized.buffer.length
    };
};

export const saveImageBuffer = async (buffer, folder, options = {}) => saveImageFile(
    {
        buffer,
        mimetype: options.mimeType || 'image/jpeg',
        originalname: options.originalname || 'upload.jpg'
    },
    folder
);

/**
 * Store an image OR a video, sniffing the type when the caller does not know it.
 *
 * This is the local equivalent of Cloudinary's `resource_type: 'auto'`, which
 * hero banners depend on: a banner may be a video, and the home page decides
 * between <img> and <video> from the stored resource type. Video is written
 * through untouched -- sharp is an image pipeline and would reject it.
 */
export const saveMediaBuffer = async (buffer, folder, options = {}) => {
    if (!buffer?.length) {
        throw new ValidationError('File is required');
    }

    const mimeType = String(options.mimeType || detectMimeType(buffer) || 'image/jpeg').toLowerCase();

    if (!isVideoMimeType(mimeType)) {
        const stored = await saveImageBuffer(buffer, folder, { ...options, mimeType });
        return { ...stored, resourceType: 'image' };
    }

    const safeFolder = sanitizeUploadFolder(folder);
    const filename = buildFilename(VIDEO_MIME_EXTENSIONS[mimeType]);
    const relativePath = path.posix.join(safeFolder, filename);

    await ensureUploadStorageReady(safeFolder);
    await fs.writeFile(getAbsolutePath(relativePath), buffer);

    return {
        url: buildPublicUrl(relativePath),
        path: relativePath,
        filename,
        mimeType,
        size: buffer.length,
        resourceType: 'video'
    };
};

export const deleteStoredFile = async (relativePath) => {
    const safePath = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!safePath) return false;

    try {
        await fs.unlink(getAbsolutePath(safePath));
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
};

const inferMimeFromUrl = (url) => {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    const map = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif'
    };
    return map[ext] || 'image/jpeg';
};

export const isHostedUploadUrl = (url) => {
    const normalized = String(url || '').trim();
    if (!normalized) return false;
    const base = String(config.uploadBaseUrl || '').replace(/\/+$/, '');
    if (base && normalized.startsWith(base)) return true;
    return /\/uploads\//i.test(normalized);
};

/** Fetch a remote image and store it locally. Used to seed and to re-host. */
export const saveImageFromUrl = async (imageUrl, folder) => {
    const url = String(imageUrl || '').trim();
    if (!url) {
        throw new ValidationError('Image URL is required');
    }

    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: config.uploadMaxFileSizeBytes,
        maxBodyLength: config.uploadMaxFileSizeBytes,
        headers: { 'User-Agent': 'QuickDrop/1.0 (media import)' }
    });

    const buffer = Buffer.from(response.data);
    const mimeType = String(response.headers['content-type'] || inferMimeFromUrl(url))
        .split(';')[0].trim().toLowerCase();

    return saveImageBuffer(buffer, folder, {
        mimeType,
        originalname: path.basename(new URL(url).pathname) || 'remote.jpg'
    });
};
