import mongoose from 'mongoose';

const foodTransactionSchema = new mongoose.Schema({
    // Identifiers
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCOrder', required: true, unique: true, index: true },

    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCUser', required: true, index: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCRestaurant', required: true, index: true },
    deliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCDeliveryPartner', index: true },

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
        deliveryFeeGst: { type: Number, default: 0, min: 0 },
        platformFeeGst: { type: Number, default: 0, min: 0 },
        platformFee: { type: Number, default: 0, min: 0 },
        restaurantCommission: { type: Number, default: 0, min: 0 },
        discount: { type: Number, default: 0, min: 0 },
        couponCode: { type: String, default: null, trim: true, uppercase: true },
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
        restaurantShare: { type: Number, required: true, min: 0 },
        restaurantCommission: { type: Number, required: true, min: 0 },
        riderShare: { type: Number, required: true, min: 0 },
        // Can be negative when discounts/rider pay exceed platform income; store the real value.
        platformNetProfit: { type: Number, required: true },
        taxAmount: { type: Number, default: 0, min: 0 },
        adminDiscountShare: { type: Number, default: 0, min: 0 },
        restaurantDiscountShare: { type: Number, default: 0, min: 0 },
        discountAdminBearPercentage: { type: Number, default: 0, min: 0, max: 100 },
        discountRestaurantBearPercentage: { type: Number, default: 0, min: 0, max: 100 },
        /**
         * Money given back through returns after delivery. The shares above are
         * reduced by exactly this much between them (recordReturnRefund), so they
         * always sum to totalCustomerPaid - refundedAmount: what the customer kept
         * paying for, credited once.
         */
        refundedAmount: { type: Number, default: 0, min: 0 },
        /** The part of refundedAmount taken back from the seller (seller-fault returns). */
        sellerReturnDebit: { type: Number, default: 0, min: 0 }
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

export const FoodTransaction = mongoose.models.QCTransaction || mongoose.model('QCTransaction', foodTransactionSchema, 'qc_transactions');
