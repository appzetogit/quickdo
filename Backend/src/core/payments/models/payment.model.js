import mongoose from 'mongoose';

/**
 * Payment — one record per payment attempt on an order.
 * Tracks gateway interactions and final payment status.
 */
/**
 * Which product the payment belongs to. `module` already existed with the comment
 * "future: dining, grocery, etc." -- this is that future. `vertical` is the name used
 * going forward; `module` is kept in step by a pre-save hook so nothing that reads it
 * breaks.
 */
export const PAYMENT_VERTICALS = Object.freeze(['food', 'quickCommerce', 'taxi', 'serviceProvider']);

/**
 * Model each vertical's payer and subject documents live in. Defaults reproduce the
 * previous hard refs exactly, so existing documents populate as they always did.
 */
const PAYER_MODELS = Object.freeze(['FoodUser', 'TaxiUser', 'SPUser', 'QCUser']);
const SUBJECT_MODELS = Object.freeze(['FoodOrder', 'QCOrder', 'TaxiRide', 'SPBooking']);

const paymentSchema = new mongoose.Schema(
    {
        // Was `required: true` with a hard ref to FoodOrder. A taxi ride or a service
        // booking has no FoodOrder, so the subject is now polymorphic. Kept optional
        // and un-renamed so every existing reader and index still works.
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodOrder',
            index: true
        },

        /** Polymorphic subject: the order / ride / booking this payment is for. */
        subjectModel: { type: String, enum: SUBJECT_MODELS, default: 'FoodOrder' },
        subjectId: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: 'subjectModel',
            index: true
        },

        userId: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: 'payerModel',
            required: true,
            index: true
        },
        /** Defaults to FoodUser so documents written before this change populate unchanged. */
        payerModel: { type: String, enum: PAYER_MODELS, default: 'FoodUser' },
        amount: { type: Number, required: true, min: 0 },
        currency: { type: String, default: 'INR', trim: true },

        method: {
            type: String,
            // 'cod' and 'collected_by_vendor' come from service-provider, which settles
            // cash through the vendor rather than the rider.
            enum: ['cash', 'cod', 'collected_by_vendor', 'razorpay', 'razorpay_qr', 'wallet', 'upi', 'card', 'netbanking'],
            required: true
        },
        gateway: {
            type: String,
            enum: ['razorpay', 'stripe', 'paypal', 'none'],
            default: 'none'
        },

        gatewayOrderId: { type: String, default: '', sparse: true },
        gatewayPaymentId: { type: String, default: '', sparse: true },

        status: {
            type: String,
            enum: ['created', 'pending', 'success', 'failed', 'refunded'],
            default: 'created',
            index: true
        },

        /** Product this payment belongs to. Preferred over `module`. */
        vertical: { type: String, enum: PAYMENT_VERTICALS, default: 'food', index: true },

        /** Legacy name for `vertical`. Kept in step by the hook below; do not write directly. */
        module: { type: String, default: 'food', trim: true, index: true },

        /** Full gateway response snapshot — stored for audit/support. Never expose to clients. */
        rawResponse: { type: mongoose.Schema.Types.Mixed, default: undefined },

        metadata: { type: mongoose.Schema.Types.Mixed, default: undefined }
    },
    { collection: 'payments', timestamps: true }
);

paymentSchema.index({ orderId: 1, createdAt: -1 });
paymentSchema.index({ userId: 1, status: 1, createdAt: -1 });
// Cross-vertical reporting and the per-vertical reconciliation queries.
paymentSchema.index({ vertical: 1, status: 1, createdAt: -1 });
paymentSchema.index({ subjectModel: 1, subjectId: 1 });

/**
 * Keep `vertical` and the legacy `module` identical in both directions, so a caller
 * that writes either one gets a consistent document. Without this, reports that still
 * group by `module` would silently miss every payment written by a new vertical.
 */
paymentSchema.pre('save', function keepVerticalAndModuleInStep(next) {
    if (this.isModified('vertical') && !this.isModified('module')) this.module = this.vertical;
    else if (this.isModified('module') && !this.isModified('vertical')) this.vertical = this.module;
    else if (!this.vertical && this.module) this.vertical = this.module;
    next();
});

export const Payment = mongoose.model('Payment', paymentSchema);
