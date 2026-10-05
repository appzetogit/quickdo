import mongoose from 'mongoose';

const referralSettingsSchema = new mongoose.Schema(
    {
        referralRewardUser: { type: Number, min: 0, default: 0 },
        referralRewardDelivery: { type: Number, min: 0, default: 0 },
        referralLimitUser: { type: Number, min: 0, default: 0 },
        referralLimitDelivery: { type: Number, min: 0, default: 0 },
        /**
         * Shareable invite link templates, one per role. Put {code} where the referral code
         * belongs; if omitted, ?ref=<code> is appended. Blank disables the link and the app
         * shares the bare code instead. Works for a web signup URL or a store listing, e.g.
         *   https://suvio.example.com/food/delivery/signup?ref={code}
         *   https://play.google.com/store/apps/details?id=com.example.app&referrer={code}
         */
        referralLinkUser: { type: String, default: '', trim: true },
        referralLinkDelivery: { type: String, default: '', trim: true },
        isActive: { type: Boolean, default: true, index: true }
    },
    { collection: 'food_referral_settings', timestamps: true }
);

referralSettingsSchema.index({ isActive: 1, createdAt: -1 });

export const FoodReferralSettings = mongoose.models.QCReferralSettings || mongoose.model('QCReferralSettings', referralSettingsSchema, 'qc_referral_settingses');

