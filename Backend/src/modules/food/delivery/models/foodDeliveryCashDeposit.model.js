import mongoose from 'mongoose';

const foodDeliveryCashDepositSchema = new mongoose.Schema({
    deliveryPartnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FoodDeliveryPartner',
        required: true,
        index: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'razorpay', 'upi', 'bank_transfer'],
        default: 'cash'
    },
    status: {
        type: String,
        enum: ['Pending', 'Completed', 'Failed'],
        default: 'Pending',
        index: true
    },
    razorpayOrderId: {
        type: String,
        default: ''
    },
    razorpayPaymentId: String,
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    adminNote: String
}, { 
    collection: 'food_delivery_cash_deposits', 
    timestamps: true 
});

foodDeliveryCashDepositSchema.index({ createdAt: -1 });

/*
 * One Razorpay payment settles cash once.
 *
 * Verification used to look the payment up and then create the row -- two
 * steps -- and nothing in the database forbade a second row for the same
 * payment. Two verifications of one Rs 200 payment sent together both found
 * nothing and both wrote a Completed deposit, clearing Rs 400 of cash-in-hand.
 * This index is what makes the upsert in verifyDeliveryCashDepositPayment hold
 * under concurrency. Partial, so rows without a payment id are not constrained.
 */
foodDeliveryCashDepositSchema.index(
    { razorpayPaymentId: 1 },
    { unique: true, partialFilterExpression: { razorpayPaymentId: { $type: 'string' } } }
);

export const FoodDeliveryCashDeposit = mongoose.model('FoodDeliveryCashDeposit', foodDeliveryCashDepositSchema);
