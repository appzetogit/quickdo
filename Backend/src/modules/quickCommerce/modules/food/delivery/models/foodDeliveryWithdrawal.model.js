import mongoose from 'mongoose';

const foodDeliveryWithdrawalSchema = new mongoose.Schema({
    deliveryPartnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'QCDeliveryPartner',
        required: true,
        index: true
    },
    amount: {
        type: Number,
        required: true,
        min: [1, 'Minimum withdrawal amount is ₹1']
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
        index: true
    },
    paymentMethod: {
        type: String,
        default: 'bank_transfer'
    },
    bankDetails: {
        accountNumber: String,
        ifscCode: String,
        bankName: String,
        accountHolderName: String
    },
    upiId: String,
    upiQrCode: String,
    adminNote: String,
    rejectionReason: String,
    transactionId: String, // Final bank transaction reference from admin
    processedAt: Date
}, { 
    collection: 'food_delivery_withdrawals', 
    timestamps: true 
});

foodDeliveryWithdrawalSchema.index({ createdAt: -1 });

export const FoodDeliveryWithdrawal = mongoose.models.QCDeliveryWithdrawal || mongoose.model('QCDeliveryWithdrawal', foodDeliveryWithdrawalSchema, 'qc_delivery_withdrawals');
