import mongoose from 'mongoose';

const referralLogSchema = new mongoose.Schema(
    {
        referrerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        refereeId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        role: {
            type: String,
            enum: ['USER', 'DELIVERY_PARTNER'],
            required: true,
            index: true
        },
        rewardAmount: { type: Number, required: true, min: 0, default: 0 },
        /** Last 10 digits of the referee's phone: one reward per phone, ever. */
        refereePhone: { type: String, default: '', index: true },
        status: {
            type: String,
            enum: ['pending', 'credited', 'rejected'],
            default: 'pending',
            index: true
        },
        reason: { type: String, default: '' }
    },
    { collection: 'food_referral_logs', timestamps: true }
);

// One referral credit decision per created account per role.
referralLogSchema.index({ refereeId: 1, role: 1 }, { unique: true });
referralLogSchema.index({ referrerId: 1, role: 1, createdAt: -1 });

export const FoodReferralLog = mongoose.model('FoodReferralLog', referralLogSchema);

