import mongoose from 'mongoose';

const foodTransactionSchema = new mongoose.Schema({
    // Identifiers
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodOrder', required: true, unique: true, index: true },

    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', required: true, index: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant', required: true, index: true },
    deliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodDeliveryPartner', index: true },

    // Core Payment Info
    paymentMethod: { 
        type: String, 
        enum: ['cash', 'razorpay', 'razorpay_qr', 'wallet'], 
        required: true 
    },
    status: { 
        type: String, 
        enum: ['pending', 'authorized', 'captured', 'failed', 'refunded'], 
        default: 'pending',
        index: true 
    },
    currency: { type: String, default: 'INR' },

    // Snapshot of order pricing at the time transaction was created
    pricing: {
        subtotal: { type: Number, default: 0, min: 0 },
        tax: { type: Number, default: 0, min: 0 },
        packagingFee: { type: Number, default: 0, min: 0 },
        deliveryFee: { type: Number, default: 0, min: 0 },
        deliveryFeeBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },
        adminDeliveryCommissionEnabled: { type: Boolean, default: false },
        adminDeliveryCommissionPercent: { type: Number, default: 0, min: 0, max: 100 },
        adminDeliveryCommissionAmount: { type: Number, default: 0, min: 0 },
        riderDeliveryEarningAfterAdminCommission: { type: Number, default: 0, min: 0 },
        deliveryPartnerIncentiveEnabled: { type: Boolean, default: false },
        deliveryPartnerIncentivePercent: { type: Number, default: 0, min: 0, max: 100 },
        deliveryPartnerIncentiveAmount: { type: Number, default: 0, min: 0 },
        deliveryPartnerIncentiveEligible: { type: Boolean, default: false },
        platformFee: { type: Number, default: 0, min: 0 },
        surgeAmount: { type: Number, default: 0, min: 0 },
        restaurantCommission: { type: Number, default: 0, min: 0 },
        discount: { type: Number, default: 0, min: 0 },
        /** The rider's, in full: never taxed, never commissioned. */
        tip: { type: Number, default: 0, min: 0 },
        total: { type: Number, default: 0, min: 0 },
        currency: { type: String, default: 'INR', trim: true },
    },

    // Snapshot of payment state at the time of transaction (source of truth for UI)
    payment: {
        method: { type: String, default: 'cash', trim: true },
        status: { type: String, default: 'cod_pending', trim: true },
        amountDue: { type: Number, default: 0, min: 0 },
        razorpay: {
            orderId: { type: String, default: '' },
            paymentId: { type: String, default: '' },
            signature: { type: String, default: '' }
        },
        qr: {
            qrId: { type: String, default: '' },
            imageUrl: { type: String, default: '' },
            paymentLinkId: { type: String, default: '' },
            shortUrl: { type: String, default: '' },
            status: { type: String, default: '' },
            expiresAt: { type: Date, default: null }
        }
    },

    // Financial Breakdown (The Split)
    amounts: {
        totalCustomerPaid: { type: Number, required: true, min: 0 },
        /*
         * No floor at zero, deliberately.
         *
         * A coupon the restaurant funded can exceed what it earned on that
         * order, which leaves it owing money rather than earning none. A `min:
         * 0` here forced the service to clamp, and the clamped amount then
         * vanished from the ledger: an order paying the restaurant -40 was
         * recorded as 0, and the earnings reports read 40 too high.
         *
         * Every consumer sums these, so a negative reduces the total by exactly
         * what was lost, which is the answer wanted.
         */
        restaurantShare: { type: Number, required: true },
        restaurantCommission: { type: Number, required: true, min: 0 },
        riderShare: { type: Number, required: true, min: 0 },
        riderDeliveryFeeShare: { type: Number, default: 0, min: 0 },
        adminDeliveryCommissionAmount: { type: Number, default: 0, min: 0 },
        riderBasePay: { type: Number, default: 0, min: 0 },
        riderSurgePay: { type: Number, default: 0, min: 0 },
        riderIncentivePay: { type: Number, default: 0, min: 0 },
        riderTipPay: { type: Number, default: 0, min: 0 },
        riderTotalPayout: { type: Number, default: 0, min: 0 },
        // Also unfloored: a platform-funded coupon larger than the platform's
        // revenue on that order is a real loss, and recording it as zero
        // overstated profit by exactly the amount lost. See restaurantShare.
        platformNetProfit: { type: Number, required: true },
        taxAmount: { type: Number, default: 0, min: 0 }
    },

    // Gateway / Provider Metadata
    gateway: {
        provider: { type: String, default: 'razorpay' },
        razorpayOrderId: String,
        razorpayPaymentId: String,
        razorpaySignature: String,
        qrUrl: String,
        qrExpiresAt: Date
    },

    // Settlement Tracking
    settlement: {
        isRestaurantSettled: { type: Boolean, default: false },
        restaurantSettledAt: Date,
        isRiderSettled: { type: Boolean, default: false },
        riderSettledAt: Date
    },

    // Audit History (Replacing FoodOrderPayment ledger)
    history: [{
        kind: { type: String, required: true }, // 'created', 'authorized', 'captured', 'refunded', 'settled'
        amount: Number,
        at: { type: Date, default: Date.now },
        note: String,
        recordedBy: { 
            role: { type: String }, 
            id: { type: mongoose.Schema.Types.ObjectId }
        }
    }]
}, { 
    collection: 'food_transactions', 
    timestamps: true 
});

// Powerful indexes for Finance & Analytics
foodTransactionSchema.index({ createdAt: -1 });
foodTransactionSchema.index({ 'settlement.isRestaurantSettled': 1, restaurantId: 1 });
foodTransactionSchema.index({ 'status': 1, paymentMethod: 1 });

export const FoodTransaction = mongoose.model('FoodTransaction', foodTransactionSchema);
