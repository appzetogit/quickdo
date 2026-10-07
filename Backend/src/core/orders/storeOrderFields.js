import mongoose from 'mongoose';
// Registered with the schema that refers to it, so the ref always resolves.
import './parentOrder.model.js';

/**
 * Fields every store order (quick commerce today, food where it applies) carries
 * for the SOW §5 features. Declared once here and added to each vertical's order
 * schema, so the shape cannot drift between the two forks.
 *
 * Every field is optional with a default that means "as before": an order
 * written before these existed reads back as a delivery order, not scheduled,
 * not part of a multi-store checkout, with no proof photo and no loyalty.
 */
export function addStoreOrderFields(schema) {
    schema.add({
        /** §5.1 The multi-store checkout this order belongs to (core/orders/parentOrder.model.js). */
        parentOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ParentOrder', default: null, index: true },
        /** §5.1 This order's share of the parent's shared charges, as charged. */
        parentSplit: {
            type: new mongoose.Schema(
                {
                    deliveryFee: { type: Number, default: 0 },
                    platformFee: { type: Number, default: 0 },
                    discount: { type: Number, default: 0 },
                    loyaltyDiscount: { type: Number, default: 0 },
                    loyaltyPoints: { type: Number, default: 0 },
                    basis: { type: String, default: 'subtotal' },
                },
                { _id: false },
            ),
            default: undefined,
        },
        /** §5.2 delivery (default) or pickup: the customer collects from the store. */
        fulfilmentType: { type: String, enum: ['delivery', 'pickup'], default: 'delivery', index: true },
        /**
         * §5.2 The code the customer shows at the counter. Hidden from every
         * query unless asked for (`+pickupOtp`), like the drop OTP.
         */
        pickupOtp: { type: String, default: '', select: false },
        pickupVerification: {
            type: new mongoose.Schema(
                {
                    verified: { type: Boolean, default: false },
                    verifiedAt: { type: Date, default: null },
                    attempts: { type: Number, default: 0 },
                },
                { _id: false },
            ),
            default: undefined,
        },
        /** §5.3 The admin-defined slot `scheduledAt` was booked into. */
        deliverySlot: {
            type: new mongoose.Schema(
                {
                    slotId: { type: mongoose.Schema.Types.ObjectId, default: null },
                    date: { type: String, default: '' },
                    startTime: { type: String, default: '' },
                    endTime: { type: String, default: '' },
                    label: { type: String, default: '' },
                    releasedAt: { type: Date, default: null },
                },
                { _id: false },
            ),
            default: undefined,
        },
        /** §5.3 When rider search starts for a scheduled order, and the one-time claim on it. */
        scheduledDispatch: {
            type: new mongoose.Schema(
                {
                    dispatchAt: { type: Date, default: null },
                    via: { type: String, default: '' },
                    firedAt: { type: Date, default: null },
                },
                { _id: false },
            ),
            default: undefined,
        },
        /** §5.4 The customer asked to have it left at the door: a photo replaces the handover code. */
        contactlessDelivery: { type: Boolean, default: false },
        /** §5.4 Proof of delivery, taken by the rider at the door. */
        dropProof: {
            type: new mongoose.Schema(
                {
                    photoUrl: { type: String, default: '' },
                    lat: { type: Number, default: null },
                    lng: { type: Number, default: null },
                    at: { type: Date, default: null },
                    reason: { type: String, default: '' },
                },
                { _id: false },
            ),
            default: undefined,
        },
        /** §5.7 Points redeemed on this order and points it earned when delivered. */
        loyalty: {
            type: new mongoose.Schema(
                {
                    pointsRedeemed: { type: Number, default: 0 },
                    discount: { type: Number, default: 0 },
                    redeemKey: { type: String, default: '' },
                    pointsEarned: { type: Number, default: 0 },
                    earnedAt: { type: Date, default: null },
                    reversedAt: { type: Date, default: null },
                },
                { _id: false },
            ),
            default: undefined,
        },
    });
    // The loyalty part of the bill, beside the coupon in the pricing snapshot.
    const pricing = schema.path('pricing')?.schema;
    if (pricing && !pricing.path('loyaltyDiscount')) {
        pricing.add({
            loyaltyDiscount: { type: Number, default: 0, min: 0 },
            loyaltyPoints: { type: Number, default: 0, min: 0 },
        });
    }
    schema.index({ 'scheduledDispatch.dispatchAt': 1, 'scheduledDispatch.firedAt': 1 }, { sparse: true });
    return schema;
}

/** A fresh 4-digit pickup code. */
export function generatePickupOtp() {
    return String(Math.floor(1000 + Math.random() * 9000));
}
