import { logger } from '../../utils/logger.js';

/**
 * Record a financial operation that failed, so it stops being invisible.
 *
 * Call this from every `catch` that currently swallows a money movement. It is
 * NOT a retry and does not pretend to be one -- see the model's docstring for why
 * retrying is unsafe until the credits are idempotent.
 *
 * Deliberately cannot throw. A dead letter that fails loudly inside the handler it
 * is protecting would turn a one-party failure into a whole-job failure, which --
 * given the job is not idempotent -- is worse. If even the record cannot be
 * written, that is shouted about at error level with the full payload inline, so
 * the log line itself is a usable replay instruction of last resort.
 */
/*
 * How long to wait for the dead-letter write before giving up and logging inline.
 *
 * Mongoose buffers operations for 10s when the connection is down, and this is
 * called from as many as five catch blocks in one job -- so during a database
 * outage the processor would sit for the better part of a minute per order doing
 * nothing but waiting to record failures it already knows about. Measured while
 * testing this, not theorised.
 *
 * Two seconds is well past a healthy write and well short of stalling the queue.
 */
const WRITE_TIMEOUT_MS = 2000;

const withTimeout = (promise, ms) =>
    Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`dead-letter write timed out after ${ms}ms`)), ms).unref?.(),
        ),
    ]);

export async function recordFailedFinancialOperation({
    operation,
    vertical = '',
    entityType = '',
    entityId = '',
    amount = 0,
    orderId = '',
    paymentId = '',
    payload = {},
    error,
    // What the failure means for the money. Most callers lost a movement ('UNPAID');
    // a ledger mirror failing means the money moved and only its record is missing.
    consequence = 'UNPAID',
} = {}) {
    const summary = `${operation} ${entityType}:${entityId} amount=${amount} order=${orderId}`;

    try {
        const { FailedFinancialOperation } = await import('./failedFinancialOperation.model.js');
        const row = await withTimeout(FailedFinancialOperation.create({
            operation,
            vertical,
            entityType,
            entityId: String(entityId || ''),
            amount: Number(amount) || 0,
            orderId: String(orderId || ''),
            paymentId: String(paymentId || ''),
            payload,
            errorMessage: error?.message || String(error || ''),
            errorStack: error?.stack || '',
        }), WRITE_TIMEOUT_MS);

        // Error level, not warn: somebody has to look at this.
        logger.error(
            `${consequence} [${operation}] ${summary} — recorded as ${row._id} for replay. Cause: ${error?.message || error}`,
        );
        return row._id;
    } catch (recordErr) {
        logger.error(
            `${consequence} AND UNRECORDED [${operation}] ${summary} — dead-letter write ALSO failed `
            + `(${recordErr.message}). Original cause: ${error?.message || error}. `
            + `Payload: ${JSON.stringify(payload)}`,
        );
        return null;
    }
}
