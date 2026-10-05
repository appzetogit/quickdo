import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodUserWallet } from '../models/userWallet.model.js';
import { FoodCashbackSettings } from '../../admin/models/cashbackSettings.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { logger } from '../../../../utils/logger.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const getActiveCashbackSettings = async () => {
    const doc = await FoodCashbackSettings.findOne({ isActive: true })
        .sort({ createdAt: -1 })
        .lean();
    return (
        doc || {
            isEnabled: false,
            cashbackType: 'percentage',
            cashbackValue: 0,
            minOrderValue: 0,
            maxCashback: 0,
            firstOrderOnly: false,
            perUserLimit: 0
        }
    );
};

/** Preview the cashback an order would earn. Pure — no writes. */
export const computeCashbackAmount = (settings, subtotal) => {
    if (!settings?.isEnabled) return 0;
    const base = Number(subtotal) || 0;
    if (base <= 0) return 0;
    if (base < (Number(settings.minOrderValue) || 0)) return 0;

    const value = Number(settings.cashbackValue) || 0;
    if (value <= 0) return 0;

    let amount = settings.cashbackType === 'flat' ? value : (base * value) / 100;
    const cap = Number(settings.maxCashback) || 0;
    if (settings.cashbackType === 'percentage' && cap > 0) amount = Math.min(amount, cap);

    return Math.max(0, Math.floor(amount)); // whole rupees, never round up in our favour
};

/**
 * Award cashback for a delivered order and credit the customer's wallet.
 *
 * Idempotent by order: the wallet transaction carries metadata.orderId, and we refuse to
 * write a second cashback row for the same order. Never throws — a cashback failure must
 * not affect the delivery.
 */
export const awardOrderCashback = async (orderId) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(String(orderId))) {
            return { awarded: false, reason: 'invalid_order' };
        }
        const order = await FoodOrder.findById(orderId)
            .select('_id order_id userId pricing orderStatus')
            .lean();
        if (!order) return { awarded: false, reason: 'order_not_found' };
        if (String(order.orderStatus) !== 'delivered') {
            return { awarded: false, reason: 'not_delivered' };
        }

        const settings = await getActiveCashbackSettings();
        if (!settings.isEnabled) return { awarded: false, reason: 'disabled' };

        const amount = computeCashbackAmount(settings, order.pricing?.subtotal);
        if (amount <= 0) return { awarded: false, reason: 'not_eligible' };

        const userOid = new mongoose.Types.ObjectId(String(order.userId));

        // First-order-only / per-user limit checks against previously awarded cashback.
        const wallet = await FoodUserWallet.findOne({ userId: userOid });
        const priorAwards = (wallet?.transactions || []).filter(
            (t) => t?.metadata?.source === 'cashback'
        );

        // Idempotency: already awarded for this order?
        if (priorAwards.some((t) => String(t?.metadata?.orderId || '') === String(order._id))) {
            return { awarded: false, reason: 'already_awarded' };
        }

        if (settings.firstOrderOnly) {
            const deliveredCount = await FoodOrder.countDocuments({
                userId: userOid,
                orderStatus: 'delivered'
            });
            if (deliveredCount > 1) return { awarded: false, reason: 'not_first_order' };
        }

        const perUserLimit = Number(settings.perUserLimit) || 0;
        if (perUserLimit > 0 && priorAwards.length >= perUserLimit) {
            return { awarded: false, reason: 'per_user_limit_reached' };
        }

        const target = wallet || (await FoodUserWallet.create({ userId: userOid, balance: 0, transactions: [] }));
        target.transactions.unshift({
            type: 'addition',
            amount,
            status: 'Completed',
            description: `Cashback on order ${order.order_id || order._id}`,
            metadata: {
                source: 'cashback',
                orderId: String(order._id),
                orderDisplayId: order.order_id || String(order._id)
            }
        });
        target.balance = round2(Number(target.balance || 0) + amount);
        await target.save();

        try {
            const { notifyOwnerSafely } = await import('../../orders/services/order.helpers.js');
            void notifyOwnerSafely(
                { ownerType: 'USER', ownerId: String(order.userId) },
                {
                    title: 'Cashback credited! 🎁',
                    body: `₹${amount} cashback added to your wallet for order ${order.order_id || ''}.`,
                    data: { type: 'cashback_credited', amount: String(amount), orderId: String(order._id) }
                }
            );
        } catch {
            /* notification failure must not affect the credit */
        }

        logger.info(`Cashback ₹${amount} credited to user ${order.userId} for order ${order._id}`);
        return { awarded: true, amount };
    } catch (e) {
        logger.warn(`awardOrderCashback failed: ${e?.message || e}`);
        return { awarded: false, reason: 'error' };
    }
};

/** Cashback-only slice of the wallet ledger. */
export const getCashbackHistory = async (userId, query = {}) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('User not found');

    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);

    const wallet = await FoodUserWallet.findOne({ userId: new mongoose.Types.ObjectId(id) })
        .select('transactions')
        .lean();

    const all = (wallet?.transactions || [])
        .filter((t) => t?.metadata?.source === 'cashback')
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const totalEarned = all.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const items = all.slice((page - 1) * limit, page * limit).map((t) => ({
        id: String(t._id),
        amount: Number(t.amount) || 0,
        description: t.description || '',
        orderId: t?.metadata?.orderId || null,
        orderDisplayId: t?.metadata?.orderDisplayId || null,
        status: t.status || 'Completed',
        date: t.createdAt,
        createdAt: t.createdAt
    }));

    return {
        totalEarned,
        items,
        pagination: {
            page,
            limit,
            total: all.length,
            totalPages: Math.max(1, Math.ceil(all.length / limit))
        }
    };
};

/**
 * Refund history across ALL of the user's orders (previously only per-order was exposed).
 * Sourced from the authoritative order payment records, enriched with the matching wallet
 * refund transaction when the money went back to the wallet.
 */
export const getUserRefundHistory = async (userId, query = {}) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('User not found');

    const oid = new mongoose.Types.ObjectId(id);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);

    const filter = {
        userId: oid,
        $or: [
            { 'payment.refund.status': { $in: ['pending', 'processed', 'failed'] } },
            { 'payment.status': 'refunded' }
        ]
    };

    const [docs, total, wallet] = await Promise.all([
        FoodOrder.find(filter)
            .select('order_id orderId pricing payment orderStatus cancellationReason updatedAt createdAt restaurantId')
            .populate('restaurantId', 'restaurantName profileImage')
            .sort({ updatedAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        FoodOrder.countDocuments(filter),
        FoodUserWallet.findOne({ userId: oid }).select('transactions').lean()
    ]);

    const walletRefunds = (wallet?.transactions || []).filter((t) => t?.type === 'refund');

    const refunds = docs.map((o) => {
        const r = o.payment?.refund || {};
        const walletRow = walletRefunds.find(
            (t) => String(t?.metadata?.orderId || '') === String(o._id)
        );
        const amount = Number(r.amount) || Number(walletRow?.amount) || Number(o.pricing?.total) || 0;
        return {
            orderId: String(o._id),
            orderDisplayId: o.order_id || String(o._id),
            restaurantName: o.restaurantId?.restaurantName || '',
            amount,
            // 'processed' once the money is back with the customer.
            status: String(r.status && r.status !== 'none' ? r.status : (o.payment?.status === 'refunded' ? 'processed' : 'pending')),
            method: o.payment?.method || '',
            refundId: r.refundId || '',
            reason: o.cancellationReason || '',
            creditedToWallet: Boolean(walletRow),
            processedAt: r.processedAt || null,
            orderStatus: o.orderStatus,
            createdAt: o.createdAt,
            updatedAt: o.updatedAt
        };
    });

    return {
        totalRefunded: refunds
            .filter((r) => r.status === 'processed')
            .reduce((s, r) => s + (Number(r.amount) || 0), 0),
        refunds,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    };
};
