import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodDeliveryPartner } from '../models/deliveryPartner.model.js';
import { FoodReferralSettings } from '../../admin/models/referralSettings.model.js';
import { DeliveryBonusTransaction } from '../../admin/models/deliveryBonusTransaction.model.js';
import { FoodReferralLog } from '../../admin/models/referralLog.model.js';
import { logger } from '../../../../utils/logger.js';
import { config } from '../../../../config/env.js';

import { referralSettingsFor } from '../../../../../../core/referral/referralSettings.service.js';
/** Fallback path when only an origin is configured (no {code} template). */
const REFERRAL_SIGNUP_PATH = '/food/delivery/signup';

/**
 * Build the shareable invite link from an admin-configured template.
 *
 * `template` comes from referral settings (referralLinkDelivery / referralLinkUser) and may
 * contain {code}, so admins can point invites at a web signup OR a store listing:
 *   https://suvio.example.com/food/delivery/signup?ref={code}
 *   https://play.google.com/store/apps/details?id=com.example.app&referrer={code}
 * With no {code}, ?ref=<code> is appended. A bare origin gets the signup path added.
 *
 * Returns '' when nothing usable is configured (or it still points at localhost), so the
 * app shares the bare code rather than a dead URL.
 */
export const buildReferralLinkFromTemplate = (template, referralCode, defaultPath = REFERRAL_SIGNUP_PATH) => {
    const code = String(referralCode || '').trim();
    if (!code) return '';

    const raw = String(template || '').trim() || String(config.publicWebUrl || '').trim();
    if (!raw) return '';
    if (!/^https?:\/\//i.test(raw)) return '';
    if (/localhost|127\.0\.0\.1/i.test(raw)) return '';

    const encoded = encodeURIComponent(code);
    if (raw.includes('{code}')) return raw.replace(/\{code\}/g, encoded);

    // No placeholder: treat a path-less origin as needing the default signup path.
    let base = raw.replace(/\/+$/, '');
    try {
        const u = new URL(base);
        if (!u.pathname || u.pathname === '/') base = `${base}${defaultPath}`;
    } catch {
        return '';
    }
    return `${base}${base.includes('?') ? '&' : '?'}ref=${encoded}`;
};

const buildReferralLink = (referralCode, template) =>
    buildReferralLinkFromTemplate(template, referralCode);

const maskPhone = (phone) => {
    const p = String(phone || '').trim();
    if (p.length < 6) return p;
    return `${p.slice(0, 2)}${'*'.repeat(Math.max(0, p.length - 6))}${p.slice(-4)}`;
};

export const getDeliveryReferralStats = async (deliveryPartnerId) => {
    const id = String(deliveryPartnerId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Delivery partner not found');
    }
    const oid = new mongoose.Types.ObjectId(id);
    const [partner, settingsDoc, bonusAgg, logs] = await Promise.all([
        FoodDeliveryPartner.findById(oid).select('_id referralCount referralCode').lean(),
        referralSettingsFor('quickCommerce', FoodReferralSettings),
        DeliveryBonusTransaction.aggregate([
            { $match: { deliveryPartnerId: oid, reference: { $regex: /referral/i } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        FoodReferralLog.find({ referrerId: oid, role: 'DELIVERY_PARTNER' })
            .sort({ createdAt: -1 })
            .lean()
    ]);

    const totalReferralEarnings = bonusAgg?.[0] ? Number(bonusAgg[0].total) : 0;
    const reward = Math.max(0, Number(settingsDoc?.referralRewardDelivery) || 0);
    const limit = Math.max(0, Number(settingsDoc?.referralLimitDelivery) || 0);

    // Riders who signed up with this partner's code but haven't triggered the reward yet
    // (not approved, or no completed delivery). They have no log row until the decision.
    const decidedRefereeIds = new Set((logs || []).map((l) => String(l.refereeId)));
    const invitedRaw = await FoodDeliveryPartner.find({ referredBy: oid })
        .select('_id name phone status totalDeliveries createdAt')
        .sort({ createdAt: -1 })
        .lean();

    const invited = (invitedRaw || []).map((p) => {
        const log = (logs || []).find((l) => String(l.refereeId) === String(p._id));
        const status = log?.status === 'credited'
            ? 'credited'
            : log?.status === 'rejected'
                ? 'rejected'
                : 'pending';
        return {
            id: String(p._id),
            name: String(p.name || '').trim() || 'Partner',
            phone: maskPhone(p.phone),
            partnerStatus: p.status,                       // pending | approved | rejected
            deliveriesCompleted: Number(p.totalDeliveries) || 0,
            status,                                        // reward status
            reason: log?.reason || '',
            rewardAmount: Math.max(0, Number(log?.rewardAmount) || 0),
            earnedAmount: status === 'credited' ? Math.max(0, Number(log?.rewardAmount) || 0) : 0,
            invitedAt: p.createdAt || null
        };
    });

    const creditedCount = invited.filter((i) => i.status === 'credited').length;

    return {
        // referralCode is what the rider shares — it is the value another rider passes
        // as `ref` when registering.
        referralCode: String(partner?.referralCode || partner?._id || ''),
        // Ready-to-share URL. Empty string when no public origin is configured — the app
        // should then fall back to sharing referralCode alone.
        referralLink: buildReferralLink(
            partner?.referralCode || partner?._id,
            settingsDoc?.referralLinkDelivery,
        ),
        referralCount: Number(partner?.referralCount) || 0,
        totalReferralEarnings,
        rewardAmount: reward,
        referralLimit: limit,
        remainingReferrals: limit > 0 ? Math.max(0, limit - (Number(partner?.referralCount) || 0)) : 0,
        totalInvited: invited.length,
        creditedCount,
        pendingCount: invited.filter((i) => i.status === 'pending').length,
        rejectedCount: invited.filter((i) => i.status === 'rejected').length,
        // Explains the earning condition so the app can render it without hardcoding.
        rewardCondition: 'Your referral must be approved and complete 1 delivery.',
        invitedPartners: invited,
        decidedCount: decidedRefereeIds.size
    };
};

/**
 * Credit the referrer once the referred rider completes their FIRST delivery.
 *
 * Idempotent: FoodReferralLog has a unique index on { refereeId, role }, so at most one
 * credit decision is ever recorded per referred rider — safe to call on every delivery.
 * Never throws; a referral problem must not fail a completed delivery.
 *
 * @param {string} refereePartnerId the rider who just completed a delivery
 */
export const creditDeliveryReferralOnFirstDelivery = async (refereePartnerId) => {
    try {
        const id = String(refereePartnerId || '');
        if (!id || !mongoose.Types.ObjectId.isValid(id)) return { credited: false, reason: 'invalid_referee' };

        const referee = await FoodDeliveryPartner.findById(id)
            .select('_id referredBy status name')
            .lean();
        if (!referee?.referredBy) return { credited: false, reason: 'no_referrer' };

        // Already decided for this rider — nothing to do (this is the idempotency gate).
        const existing = await FoodReferralLog.findOne({
            refereeId: referee._id,
            role: 'DELIVERY_PARTNER'
        }).lean();
        if (existing) return { credited: false, reason: 'already_decided' };

        const [settingsDoc, referrer] = await Promise.all([
            referralSettingsFor('quickCommerce', FoodReferralSettings),
            FoodDeliveryPartner.findById(referee.referredBy)
                .select('_id referralCount status')
                .lean()
        ]);

        const reward = Math.max(0, Number(settingsDoc?.referralRewardDelivery) || 0);
        const limit = Math.max(0, Number(settingsDoc?.referralLimitDelivery) || 0);

        const rejectReason = !referrer
            ? 'referrer_not_found'
            : referrer.status !== 'approved'
                ? 'referrer_not_approved'
                : reward <= 0
                    ? 'reward_disabled'
                    : limit <= 0
                        ? 'limit_disabled'
                        : Number(referrer.referralCount || 0) >= limit
                            ? 'limit_reached'
                            : '';

        if (rejectReason) {
            await FoodReferralLog.create({
                referrerId: new mongoose.Types.ObjectId(String(referee.referredBy)),
                refereeId: referee._id,
                role: 'DELIVERY_PARTNER',
                rewardAmount: reward,
                status: 'rejected',
                reason: rejectReason
            }).catch(() => {});
            logger.info(`Delivery referral not credited for referee ${id}: ${rejectReason}`);
            return { credited: false, reason: rejectReason };
        }

        // Write the log FIRST — the unique index makes it the lock. If two deliveries race,
        // the loser throws E11000 here and never pays a second bonus.
        await FoodReferralLog.create({
            referrerId: referrer._id,
            refereeId: referee._id,
            role: 'DELIVERY_PARTNER',
            rewardAmount: reward,
            status: 'credited'
        });

        const { addDeliveryPartnerBonus } = await import('../../admin/services/admin.service.js');
        await Promise.all([
            FoodDeliveryPartner.updateOne({ _id: referrer._id }, { $inc: { referralCount: 1 } }),
            addDeliveryPartnerBonus(
                {
                    deliveryPartnerId: String(referrer._id),
                    amount: reward,
                    reference: 'Referral bonus'
                },
                null
            )
        ]);

        // Tell the referrer they earned it.
        try {
            const { notifyOwnerSafely } = await import('../../orders/services/order.helpers.js');
            void notifyOwnerSafely(
                { ownerType: 'DELIVERY_PARTNER', ownerId: String(referrer._id) },
                {
                    title: 'Referral bonus earned! 🎉',
                    body: `${String(referee.name || 'Your referral').trim()} completed their first delivery. ₹${reward} has been added to your earnings.`,
                    data: {
                        type: 'referral_bonus',
                        amount: String(reward),
                        refereeId: String(referee._id)
                    }
                }
            );
        } catch {
            /* notification failure must not affect the credit */
        }

        logger.info(`Delivery referral credited: referrer ${referrer._id} +${reward} for referee ${id}`);
        return { credited: true, amount: reward, referrerId: String(referrer._id) };
    } catch (e) {
        if (e?.code === 11000) return { credited: false, reason: 'already_decided' };
        logger.warn(`creditDeliveryReferralOnFirstDelivery failed: ${e?.message || e}`);
        return { credited: false, reason: 'error' };
    }
};
