import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodDeliveryPartner } from '../models/deliveryPartner.model.js';
import { FoodReferralSettings } from '../../admin/models/referralSettings.model.js';
import { DeliveryBonusTransaction } from '../../admin/models/deliveryBonusTransaction.model.js';

import { referralSettingsFor } from '../../../../core/referral/referralSettings.service.js';
export const getDeliveryReferralStats = async (deliveryPartnerId) => {
    const id = String(deliveryPartnerId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Delivery partner not found');
    }
    const oid = new mongoose.Types.ObjectId(id);
    const [partner, settingsDoc, bonusAgg] = await Promise.all([
        FoodDeliveryPartner.findById(oid).select('_id referralCount referralCode').lean(),
        referralSettingsFor('food', FoodReferralSettings),
        DeliveryBonusTransaction.aggregate([
            { $match: { deliveryPartnerId: oid, reference: { $regex: /referral/i } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ])
    ]);

    const totalReferralEarnings = bonusAgg?.[0] ? Number(bonusAgg[0].total) : 0;

    return {
        referralCount: Number(partner?.referralCount) || 0,
        totalReferralEarnings,
        rewardAmount: Math.max(0, Number(settingsDoc?.referralRewardDelivery) || 0)
    };
};

