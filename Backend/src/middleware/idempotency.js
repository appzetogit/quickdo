import crypto from 'crypto';
import { IdempotencyKey } from '../core/idempotency/idempotencyKey.model.js';
import { logger } from '../utils/logger.js';

const HEADER_NAMES = ['idempotency-key', 'x-idempotency-key'];

const readKey = (req) => {
    for (const name of HEADER_NAMES) {
        const value = req.headers[name];
        if (value && String(value).trim()) return String(value).trim().slice(0, 200);
    }
    return null;
};

const fingerprintOf = (body) => {
    try {
        return crypto.createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
    } catch {
        return '';
    }
};

/**
 * Idempotency middleware for state-changing endpoints.
 *
 * Behaviour:
 *  - No `Idempotency-Key` header  -> pass through unchanged. This is what makes the
 *    middleware safe to mount on live endpoints today: every existing client, including
 *    the shipped Flutter and seller-APK builds, keeps working exactly as before, and
 *    gains protection only once it starts sending the header.
 *  - First request with a key      -> executes, and the response is stored.
 *  - Retry with the same key       -> replays the stored response, no re-execution.
 *  - Same key, different body      -> 422. That is a client bug, not a retry, and
 *                                     replaying the first response would silently
 *                                     discard the second request.
 *  - Retry while the first is still running -> 409, so the caller retries rather than
 *                                     running the same mutation twice concurrently.
 *
 * Failures here FAIL OPEN. A ledger outage must not take down order creation; the
 * worst case is the duplicate protection this middleware adds being unavailable,
 * which is where the system was before it existed.
 *
 * Mount on the money paths: order creation, payment verification, refunds, wallet
 * movements, withdrawals, coupon redemption.
 */
/*
 * `implicitWindowMs`: for routes where a double tap is expensive (placing an
 * order), a client that sends no key still gets protection -- the same owner
 * sending the same body within the window is the same request. The apps do not
 * send Idempotency-Key today, so without this a double tap placed two orders
 * (and could debit the wallet twice). The window is short on purpose: the same
 * cart ordered again a minute later is a real second order.
 */
export function idempotency({ implicitWindowMs = 0 } = {}) {
    return async function idempotencyMiddleware(req, res, next) {
        let key = readKey(req);
        if (!key && implicitWindowMs > 0 && req.user && req.body && typeof req.body === 'object') {
            const fp = fingerprintOf(req.body);
            if (fp) key = `implicit:${fp}:${Math.floor(Date.now() / implicitWindowMs)}`;
        }
        if (!key) return next();

        // The owner is part of the scope so one account can never replay another's
        // stored response, even with a guessed key.
        const owner = req.user?.userId || req.user?.id || 'anon';
        const scope = `${req.method}:${req.baseUrl || ''}${req.path}:${owner}`;
        const fingerprint = fingerprintOf(req.body);

        let record;
        try {
            record = await IdempotencyKey.create({ key, scope, fingerprint, status: 'in_progress' });
        } catch (err) {
            // E11000 means someone got here first: either a completed run to replay,
            // or one still in flight.
            if (err?.code === 11000) {
                const existing = await IdempotencyKey.findOne({ key, scope }).lean().catch(() => null);

                if (!existing) return next(); // vanished (TTL); treat as fresh

                if (existing.fingerprint && fingerprint && existing.fingerprint !== fingerprint) {
                    return res.status(422).json({
                        success: false,
                        message: 'Idempotency-Key was reused with a different request body.',
                    });
                }

                if (existing.status === 'completed') {
                    return res.status(existing.responseStatus || 200).json(existing.responseBody);
                }

                return res.status(409).json({
                    success: false,
                    message: 'A request with this Idempotency-Key is already being processed.',
                });
            }

            logger.warn(`Idempotency middleware error (failing open): ${err?.message || err}`);
            return next();
        }

        // Capture the response as it is sent, then persist it for future replays.
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            // Only successful responses are worth replaying. Storing a 500 would pin
            // a transient failure to the key forever, so the client could never retry
            // its way out of it.
            if (res.statusCode >= 200 && res.statusCode < 300) {
                IdempotencyKey.updateOne(
                    { _id: record._id },
                    { $set: { status: 'completed', responseStatus: res.statusCode, responseBody: body } },
                ).catch((err) => logger.warn(`Idempotency: could not store response: ${err.message}`));
            } else {
                // Release the key so a genuine retry can execute.
                IdempotencyKey.deleteOne({ _id: record._id })
                    .catch((err) => logger.warn(`Idempotency: could not release key: ${err.message}`));
            }
            return originalJson(body);
        };

        // A handler that throws never reaches res.json, which would strand the record
        // at in_progress and 409 every retry until the TTL expires. Release it.
        res.on('close', () => {
            if (res.writableEnded) return;
            IdempotencyKey.deleteOne({ _id: record._id }).catch(() => { /* best effort */ });
        });

        return next();
    };
}
