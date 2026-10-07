import mongoose from 'mongoose';

/**
 * One checkout that spans several stores (plan §5.1, multi-seller cart).
 *
 * The customer pays ONCE (one Razorpay order, one wallet debit) and uses ONE
 * coupon; the platform then runs one child order per store, each in the vertical's
 * own order collection with its own store acceptance, rider and tracking. This row
 * is the glue: it owns the payment and the coupon, and records how the shared
 * charges were split between the children (core/orders/proRata.js), so a refund of
 * one child returns exactly that child's share.
 *
 * Single-store orders do not get a parent: they keep the shape they always had.
 * Children point back here through `parentOrderId`.
 *
 * Shared by every vertical that sells from several stores (`vertical`), so the
 * collection is not prefixed with any one of them.
 */
const splitSchema = new mongoose.Schema(
    {
        orderId: { type: mongoose.Schema.Types.ObjectId, required: true },
        storeId: { type: mongoose.Schema.Types.ObjectId, required: true },
        orderNumber: { type: String, default: '' },
        subtotal: { type: Number, default: 0 },
        deliveryFee: { type: Number, default: 0 },
        platformFee: { type: Number, default: 0 },
        discount: { type: Number, default: 0 },
        loyaltyDiscount: { type: Number, default: 0 },
        loyaltyPoints: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
    },
    { _id: false },
);

const parentOrderSchema = new mongoose.Schema(
    {
        vertical: { type: String, required: true, enum: ['quickCommerce', 'food'], index: true },
        orderNumber: { type: String, unique: true, sparse: true },
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        childOrderIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
        storeIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
        fulfilmentType: { type: String, enum: ['delivery', 'pickup'], default: 'delivery' },
        scheduledAt: { type: Date, default: null },
        status: {
            type: String,
            enum: ['placing', 'pending_payment', 'placed', 'failed', 'cancelled'],
            default: 'placing',
            index: true,
        },
        pricing: {
            subtotal: { type: Number, default: 0 },
            deliveryFee: { type: Number, default: 0 },
            platformFee: { type: Number, default: 0 },
            discount: { type: Number, default: 0 },
            couponCode: { type: String, default: null },
            loyaltyPoints: { type: Number, default: 0 },
            loyaltyDiscount: { type: Number, default: 0 },
            total: { type: Number, default: 0 },
            /** How the shared charges were divided: 'subtotal' (item value). */
            splitBasis: { type: String, default: 'subtotal' },
        },
        split: { type: [splitSchema], default: [] },
        payment: {
            method: { type: String, default: 'cash' },
            status: { type: String, default: 'created' },
            amountDue: { type: Number, default: 0 },
            razorpay: {
                orderId: { type: String, default: '' },
                paymentId: { type: String, default: '' },
                signature: { type: String, default: '' },
            },
            paidAt: { type: Date, default: null },
        },
        couponUserClaimed: { type: Boolean, default: false },
        couponCountedAt: { type: Date, default: null },
        failureReason: { type: String, default: '' },
    },
    { collection: 'parent_orders', timestamps: true },
);

parentOrderSchema.index({ 'payment.razorpay.orderId': 1 }, { sparse: true });
parentOrderSchema.index({ userId: 1, createdAt: -1 });

parentOrderSchema.pre('save', function (next) {
    if (!this.orderNumber) {
        this.orderNumber = `MSO-${this._id.toString().slice(-10).toUpperCase()}`;
    }
    next();
});

export const ParentOrder = mongoose.models.ParentOrder || mongoose.model('ParentOrder', parentOrderSchema);
