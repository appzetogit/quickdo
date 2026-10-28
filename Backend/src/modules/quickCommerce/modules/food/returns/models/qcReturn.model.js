import mongoose from 'mongoose';
import { RETURN_STATUS, PERISHABILITY } from '../services/returnPolicy.service.js';

/**
 * A customer's request to send part (or all) of a delivered order back.
 *
 * One document per request, not per item: a customer returning three things in one
 * pickup expects one status to follow, one refund, and one conversation with support.
 * Per-item state that genuinely differs — what condition each thing arrived back in,
 * whether it went back on the shelf — lives on the line.
 *
 * Money is written here only as a record of what was decided. The arithmetic itself
 * lives in returnRefund.service.js and the actual movement goes through
 * core/payments/refund.service.js, so this schema never becomes a second place where
 * refund rules are implemented.
 */

const returnLineSchema = new mongoose.Schema(
    {
        itemId: { type: String, required: true, trim: true },
        variantId: { type: String, trim: true, default: '' },
        name: { type: String, required: true, trim: true },
        quantity: { type: Number, required: true, min: 1 },

        /**
         * Unit price snapshotted from the ORDER, never from the request body.
         * Stored so a credit note can be reprinted years later even if the product's
         * price, or the product itself, is long gone.
         */
        unitPrice: { type: Number, required: true, min: 0 },
        refundAmount: { type: Number, required: true, min: 0 },

        /**
         * What actually came back, recorded at inspection.
         * `sealed` is the only condition that can put stock back on the shelf, and
         * only then in combination with an ambient category — see shouldRestock().
         */
        condition: {
            type: String,
            enum: ['sealed', 'opened', 'damaged', 'missing'],
            default: null,
        },
        restocked: { type: Boolean, default: false },
    },
    { _id: false },
);

const statusEventSchema = new mongoose.Schema(
    {
        status: { type: String, required: true },
        at: { type: Date, default: Date.now },
        byRole: { type: String, enum: ['USER', 'ADMIN', 'RESTAURANT', 'DELIVERY_PARTNER', 'SYSTEM'], default: 'SYSTEM' },
        byId: { type: String, default: '' },
        note: { type: String, trim: true, default: '' },
    },
    { _id: false },
);

const qcReturnSchema = new mongoose.Schema(
    {
        /** Human-quotable identifier for support calls. Unique, unlike the ObjectId. */
        returnCode: { type: String, required: true, unique: true, trim: true },

        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCOrder', required: true, index: true },
        orderNumber: { type: String, trim: true, default: '' },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCUser', required: true, index: true },
        /** The seller the returned goods came from — the wallet that gets debited. */
        sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCRestaurant', index: true },

        items: { type: [returnLineSchema], default: [] },

        reasonCode: { type: String, required: true, trim: true },
        reasonNote: { type: String, trim: true, default: '', maxlength: 1000 },

        /**
         * Derived from the reason, never accepted from the client: fault decides
         * whether the delivery and platform fees are refunded, so letting a caller
         * set it would let anyone claim those fees back.
         */
        fault: { type: String, enum: ['seller', 'customer'], required: true },

        perishability: {
            type: String,
            enum: Object.values(PERISHABILITY),
            default: PERISHABILITY.AMBIENT,
        },

        /** Customer's photos of the problem. The evidence an inspection is judged against. */
        images: { type: [String], default: [] },

        status: {
            type: String,
            enum: Object.values(RETURN_STATUS),
            default: RETURN_STATUS.REQUESTED,
            index: true,
        },
        statusHistory: { type: [statusEventSchema], default: [] },

        /** What calculateReturnRefund() decided, kept for the credit note and audits. */
        refund: {
            goods: { type: Number, default: 0, min: 0 },
            tax: { type: Number, default: 0, min: 0 },
            discountReversed: { type: Number, default: 0, min: 0 },
            deliveryFee: { type: Number, default: 0, min: 0 },
            platformFee: { type: Number, default: 0, min: 0 },
            total: { type: Number, default: 0, min: 0 },
            isFullReturn: { type: Boolean, default: false },
            /** True when the order total, not the line maths, decided the amount. */
            capApplied: { type: Boolean, default: false },
        },

        /** Link to the money actually moved (core/payments Refund document). */
        refundId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCRefund', default: null },
        refundedAt: { type: Date, default: null },

        /**
         * Set atomically by the one refundReturn() call allowed to pay this return,
         * and cleared if the payout fails. Without it two admins pressing Refund at
         * once could both pass the status check and pay the same return twice.
         */
        refundClaim: {
            at: { type: Date, default: null },
            by: { type: String, default: '' },
        },

        /**
         * Where the money went and how much: `gateway` is a Razorpay refund to the
         * card/UPI the order was paid with (reference = Razorpay refund id), `wallet`
         * a credit to the customer's quick-commerce wallet.
         */
        payout: {
            method: { type: String, enum: ['wallet', 'gateway', null], default: null },
            reference: { type: String, default: '' },
            amount: { type: Number, default: 0, min: 0 },
        },

        pickup: {
            scheduledFor: { type: Date, default: null },
            partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCDeliveryPartner', default: null },
            pickedUpAt: { type: Date, default: null },
            /** Handover code, so a rider cannot mark a pickup done without the customer. */
            otp: { type: String, default: '' },
        },

        inspection: {
            inspectedAt: { type: Date, default: null },
            inspectedBy: { type: String, default: '' },
            notes: { type: String, trim: true, default: '' },
        },

        /** Snapshotted at creation so a later policy change cannot retroactively expire it. */
        windowExpiresAt: { type: Date, default: null },

        rejectionReason: { type: String, trim: true, default: '' },
    },
    {
        collection: 'qc_returns',
        timestamps: true,
    },
);

// The two list views that exist: a customer's own returns, and the admin queue
// filtered by state. Both are newest-first.
qcReturnSchema.index({ userId: 1, createdAt: -1 });
qcReturnSchema.index({ status: 1, createdAt: -1 });
qcReturnSchema.index({ sellerId: 1, status: 1 });

export const QCReturn = mongoose.models.QCReturn
    || mongoose.model('QCReturn', qcReturnSchema, 'qc_returns');
