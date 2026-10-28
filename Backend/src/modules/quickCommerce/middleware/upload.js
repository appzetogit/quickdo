import multer from 'multer';

const storage = multer.memoryStorage();

/**
 * Per-file upload ceiling.
 *
 * There was no limit here at all, so the only thing stopping a huge upload was
 * nginx's client_max_body_size — which rejects at the proxy with a bare 413 and
 * an HTML body, giving the panel nothing it can show the admin. A limit here
 * fails inside the app, as JSON, with a message that names the actual cap.
 *
 * 25MB rather than 20: animated GIFs are the largest thing anyone uploads, and
 * multipart framing plus the field data mean a 20MB file is slightly more than
 * 20MB on the wire. A cap set exactly at the intended file size rejects files
 * that are just under it. nginx is set to match.
 *
 * Files are buffered in memory (memoryStorage), so this is also the per-request
 * memory cost — worth remembering before raising it much further.
 */
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 25 * 1024 * 1024;

export const upload = multer({
    storage,
    limits: { fileSize: MAX_UPLOAD_BYTES },
});

export const MAX_UPLOAD_MB = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));

