import mongoose from 'mongoose';

/**
 * Money that was supposed to move and did not.
 *
 * Today a credit that fails inside the payment processor is caught, logged at
 * error level, and forgotten:
 *
 *     } catch (err) {
 *         logger.error(`Failed to credit delivery partner: ${err.message}`);
 *     }
 *
 * The rider is simply not paid. Nothing retries it, nothing reports it, and the
 * only trace is a line in a log file that nobody reads unless they already suspect
 * something. A week later the rider asks where their money is and there is no way
 * to answer beyond grepping.
 *
 * The obvious fix -- rethrow and let BullMQ retry -- is NOT SAFE YET, and that is
 * worth being explicit about. `handleDeliveryCompleted` performs three separate
 * credits in sequence. If the restaurant and the rider are paid and the platform
 * credit fails, a retry re-runs all three, and none of them is idempotent: the
 * restaurant and rider are paid TWICE. Turning silent under-payment into silent
 * double-payment is not an improvement.
 *
 * So this is the safe half, available now: the failure stops being invisible.
 * Every swallowed financial operation is written here with enough of its payload
 * to be replayed by hand or by a job later. When the ledger's unique
 * `idempotencyKey` index lands, retrying becomes safe and these rows become its
 * work queue.
 */
const failedFinancialOperationSchema = new mongoose.Schema(
    {
        /** What was being attempted, e.g. 'credit_delivery_partner', 'refund'. */
        operation: { type: String, required: true, index: true },
        vertical: { type: String, default: '' },

        /** Who should have been paid, so a support query can be answered by id. */
        entityType: { type: String, default: '' },
        entityId: { type: String, default: '', index: true },
        amount: { type: Number, default: 0 },

        /** What it was for. Indexed: "did order X settle?" is the common question. */
        orderId: { type: String, default: '', index: true },
        paymentId: { type: String, default: '' },

        /**
         * The full arguments of the failed call. Enough to replay it exactly, which
         * is the whole reason this row exists rather than just a log line.
         */
        payload: { type: mongoose.Schema.Types.Mixed, default: {} },

        errorMessage: { type: String, default: '' },
        errorStack: { type: String, default: '' },

        /**
         * How many times a replay has been attempted. Stays 0 until retrying is
         * safe -- see the note above about double-crediting.
         */
        replayAttempts: { type: Number, default: 0 },
        /** Set when the money has actually been moved, by a job or by a human. */
        resolvedAt: { type: Date, default: null, index: true },
        resolvedBy: { type: String, default: '' },
        resolutionNote: { type: String, default: '' },
    },
    { collection: 'failed_financial_operations', timestamps: true },
);

failedFinancialOperationSchema.index({ resolvedAt: 1, createdAt: -1 });

export const FailedFinancialOperation =
    mongoose.models.FailedFinancialOperation
    || mongoose.model('FailedFinancialOperation', failedFinancialOperationSchema);
