import multer from 'multer';

const storage = multer.memoryStorage();

/**
 * Per-file ceiling, and how many files one request may carry.
 *
 * There was no limit of any kind here. The only backstop was nginx's
 * client_max_body_size, which rejects at the proxy with a bare 413 and an HTML
 * body the app cannot turn into a message for the uploader. And because files
 * are buffered in memory (memoryStorage), every byte accepted is heap in a
 * process that runs alongside the whole API.
 *
 * 25MB per file matches the quickCommerce copy of this middleware, so one
 * MAX_UPLOAD_BYTES tunes both, and leaves room under nginx's 50M for multipart
 * framing -- a cap set exactly at the intended file size rejects files that are
 * only just under it.
 *
 * The file count matters as much as the size: three landing routes call
 * upload.array('files') with no per-route maxCount, so an unbounded number of
 * files was accepted. 20 matches the largest cap already declared in a route
 * (upload.array('files', 20)), so it bounds the uncapped routes without
 * narrowing any route that already states its own, smaller, limit.
 *
 * Total bytes per request stay bounded by nginx's 50M rather than by
 * files x fileSize, so this is not a 500MB ceiling.
 */
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 25 * 1024 * 1024;
const MAX_UPLOAD_FILES = Number(process.env.MAX_UPLOAD_FILES) || 20;

export const upload = multer({
    storage,
    limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_UPLOAD_FILES },
});

export const MAX_UPLOAD_MB = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));
export { MAX_UPLOAD_FILES };
