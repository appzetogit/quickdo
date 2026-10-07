import mongoose from 'mongoose';

/**
 * Refund — tracks refund requests against a payment, for every vertical.
 * Supports partial refunds. Gateway refund id stored once the gateway accepts it.
 *
 * Two kinds of row live here:
 *  - wallet refunds (refundTo 'wallet'): the platform credits its own wallet, so
 *    the row is 'processed' the moment that credit lands;
 *  - gateway refunds (refundTo 'gateway'): money goes back to the card/UPI through
 *    Razorpay. The API call only STARTS the refund -- Razorpay reports the result
 *    later with `refund.processed` or `refund.failed`, and `gatewayStatus` follows it.
 *
 * `idempotencyKey` names the refund (a cancellation, a return, an admin action) so
 * a retry, a double-click or a replayed job finds the first row instead of
 * refunding twice. The unique index is what enforces it.
 */
const refundSchema = new mongoose.Schema(
    {
        /** core Payment document, when the vertical keeps one (food's BullMQ path does). */
        paymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Payment',
            default: null,
            index: true
        },
        /** The vertical's own order / booking _id. */
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            index: true
        },
        /** Human order code (FOD-123, BK-456) for the admin screen. */
        orderRef: { type: String, default: '', trim: true },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            index: true
        },

        /** 'food' | 'quickCommerce' | 'serviceProvider' | 'taxi' */
        vertical: { type: String, default: 'food', trim: true, index: true },
        /** What asked for it: 'order_cancelled', 'qc_return', 'admin_refund', 'late_capture', ... */
        source: { type: String, default: '', trim: true },

        amount: { type: Number, required: true, min: 0 },
        currency: { type: String, default: 'INR', trim: true },

        reason: { type: String, default: '', trim: true },

        /**
         * Platform view: 'pending' (asked, result not known), 'processed' (money is on
         * its way back / credited), 'failed' (nothing moved -- needs a retry or a
         * manual refund).
         */
        status: {
            type: String,
            enum: ['pending', 'processed', 'failed'],
            default: 'pending',
            index: true
        },

        /** Original payment method → determines refund path (gateway / wallet credit) */
        refundTo: {
            type: String,
            enum: ['gateway', 'wallet'],
            default: 'wallet'
        },

        /** Razorpay payment the money came from (pay_...). */
        gatewayPaymentId: { type: String, default: '', trim: true, index: true },
        /** Razorpay refund id (rfnd_...), once the gateway accepted the request. */
        gatewayRefundId: { type: String, default: '', trim: true },
        /**
         * Razorpay's own status for the refund: 'initiating' (we have not heard back
         * from the API yet), then 'pending' | 'processed' | 'failed' as Razorpay reports
         * it. Updated by the `refund.processed` / `refund.failed` webhooks.
         */
        gatewayStatus: { type: String, default: '', trim: true },
        failureReason: { type: String, default: '', trim: true },
        attempts: { type: Number, default: 0 },

        idempotencyKey: { type: String, default: undefined, trim: true },

        processedAt: { type: Date, default: null },
        processedBy: { type: mongoose.Schema.Types.ObjectId, default: null },

        metadata: { type: mongoose.Schema.Types.Mixed, default: undefined }
    },
    {
        collection: 'refunds',
        timestamps: true
    }
);

refundSchema.index({ orderId: 1, status: 1 });
refundSchema.index({ createdAt: -1 });
refundSchema.index(
    { idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } }, name: 'refund_idempotencyKey_unique' }
);
refundSchema.index(
    { gatewayRefundId: 1 },
    { partialFilterExpression: { gatewayRefundId: { $type: 'string', $gt: '' } }, name: 'refund_gatewayRefundId' }
);

export const Refund = mongoose.models.Refund || mongoose.model('Refund', refundSchema);
