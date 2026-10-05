import { FoodReferralSettings } from '../../admin/models/referralSettings.model.js';

import { referralSettingsFor } from '../../../../core/referral/referralSettings.service.js';
export async function getPublicReferralSettingsController(req, res, next) {
    try {
        // What is actually paid: Master's amounts when set, else this service's.
        const settings = await referralSettingsFor('food', FoodReferralSettings);
        // Expose only the fields needed by clients.
        const payload = settings
            ? {
                referralRewardUser: Number(settings.referralRewardUser) || 0,
                referralRewardDelivery: Number(settings.referralRewardDelivery) || 0,
                referralLimitUser: Number(settings.referralLimitUser) || 0,
                referralLimitDelivery: Number(settings.referralLimitDelivery) || 0
            }
            : null;
        return res.status(200).json({ success: true, message: 'Referral settings fetched successfully', data: { referralSettings: payload } });
    } catch (error) {
        next(error);
    }
}

