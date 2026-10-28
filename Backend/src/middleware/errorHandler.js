import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { MAX_UPLOAD_MB, MAX_UPLOAD_FILES } from './upload.js';

const errorHandler = (err, req, res, next) => {
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Server Error';

    /*
     * A MulterError carries no statusCode, so it would fall through as a 500 and
     * then be masked below as "Internal server error" -- telling someone whose
     * phone photo was simply too big that the server broke. Every route sharing
     * the upload middleware is covered here, rather than each wrapping its own
     * callback.
     *
     * The message names the actual number: "file is too large" leaves someone
     * holding a 40MB video with no idea whether to shrink it a little or a lot.
     */
    if (err.name === 'MulterError') {
        statusCode = 400;
        if (err.code === 'LIMIT_FILE_SIZE') {
            statusCode = 413;
            message = `That file is too large. The limit is ${MAX_UPLOAD_MB}MB per file.`;
        } else if (err.code === 'LIMIT_FILE_COUNT') {
            message = `Too many files. Please upload at most ${MAX_UPLOAD_FILES} at a time.`;
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            message = `Unexpected file field "${err.field}".`;
        } else {
            message = err.message || 'Invalid upload';
        }
    }

    /*
     * express.json rejects an oversized body before any route runs, and its
     * "request entity too large" reads to an admin as though the image they picked
     * was too big -- even for a 1MB photo, because the taxi panel base64-encodes
     * images into the JSON body and a third is added in the encoding.
     *
     * Naming the real limit and the real cause is the difference between shrinking
     * one photo and understanding that several images went up in one request.
     */
    if (err.type === 'entity.too.large' || err.name === 'PayloadTooLargeError') {
        statusCode = 413;
        message = `That upload is too large for one request. The limit is ${config.requestJsonLimit} of encoded data, and images sent this way grow by about a third. Try fewer or smaller images at once.`;
    }

    /*
     * A Mongoose schema validation error (a required field the request did not
     * carry) is the caller's data, not a broken server: answer 400 naming the
     * fields instead of a masked "Internal server error" nobody can act on.
     * Our own ValidationError already carries a statusCode and is left alone.
     */
    if (!err.statusCode && err.name === 'ValidationError' && err.errors && typeof err.errors === 'object') {
        statusCode = 400;
        const fields = Object.keys(err.errors).map((k) => k.split('.').pop());
        message = `Some details are missing or invalid: ${[...new Set(fields)].join(', ')}`;
    }

    const requestId = req.requestId || '-';

    logger.error(
        `[${requestId}] ${req.method} ${req.originalUrl} ${statusCode} - ${err.name || 'Error'} - ${message}`
    );

    // 5xx stacks are logged in EVERY environment. They used to be development-only,
    // which is backwards: production is where you cannot reproduce the failure and
    // the stack is the only way to find it. 4xx are deliberate and need no stack.
    if (err.stack && (statusCode >= 500 || config.nodeEnv === 'development')) {
        logger.error(`[${requestId}] ${err.stack}`);
    }

    // A 4xx message is written by us for the caller ("Order not found"), so it is safe
    // to return. A 5xx message is whatever threw — a Mongoose CastError, a driver
    // failure, sometimes a connection string — and was previously sent verbatim to the
    // client. Anything not explicitly given a statusCode falls here and is masked.
    //
    // Development keeps the real text, or debugging every 500 means tailing the log.
    const isClientError = statusCode >= 400 && statusCode < 500;
    // `expose` marks a 5xx whose text we wrote for the user ("could not send the OTP
    // SMS"), as opposed to whatever a library threw.
    const publicMessage = isClientError || err.expose === true || config.nodeEnv === 'development'
        ? message
        : 'Internal server error';

    res.status(statusCode).json({
        success: false,
        // Both keys carry the same text. `error` is the original field; `message`
        // is what almost every client actually reads (483 call sites in the web
        // app, and the shape every non-error response already uses). Without it
        // a validation failure reached the user as axios's own fallback --
        // "Request failed with status code 400" -- instead of the reason we
        // wrote for them, e.g. "Maximum order quantity ... cannot exceed 5".
        message: publicMessage,
        error: publicMessage,
        // Lets a user quote an id that points at the real message in the logs. Without
        // it, masking a 5xx leaves support with nothing to correlate against.
        requestId
    });
};

export default errorHandler;
