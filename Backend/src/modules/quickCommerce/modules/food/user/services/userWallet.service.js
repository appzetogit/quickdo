import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodUserWallet } from '../models/userWallet.model.js';
import { createRazorpayOrder, getRazorpayKeyId, isRazorpayConfigured, verifyPaymentSignature } from '../../orders/helpers/razorpay.helper.js';

const ensureWallet = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const oid = new mongoose.Types.ObjectId(id);
    const existing = await FoodUserWallet.findOne({ userId: oid });
    if (existing) return existing;
    return FoodUserWallet.create({ userId: oid, balance: 0, transactions: [] });
};

/**
 * One wallet move, applied atomically.
 *
 * Every move used to be load, mutate, save: read the balance, push a row onto
 * the embedded transactions array, write the whole document back. Two moves
 * landing together on one wallet then raced, and Mongoose's version key turned
 * the loser into a thrown VersionError -- "No matching document found for id
 * ... modifiedPaths transactions, balance". Two refunds on the same order,
 * which is one customer returning two items, was enough: the second refund
 * failed and the customer was paid once for two returns until someone noticed
 * and retried it. Without the version key it would have been worse -- a silent
 * lost update, one balance overwriting the other.
 *
 * `$inc` and `$push` are applied by the database in one step, so concurrent
 * moves queue rather than collide. `$position: 0` keeps the newest row first,
 * which is the order the wallet screen reads.
 *
 * `filter` narrows which document may be updated -- a debit passes
 * `{ balance: { $gte: amount } }` so an overdraft cannot happen between the
 * check and the write, which is exactly what a read-then-save allowed.
 */
const applyWalletMove = async (userId, { amount, transaction, filter = {} }) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const oid = new mongoose.Types.ObjectId(id);

    // The wallet has to exist before a conditional update can match it: an
    // upsert carrying `balance: { $gte: … }` in its filter would insert a
    // second wallet rather than fail the condition.
    await FoodUserWallet.updateOne(
        { userId: oid },
        { $setOnInsert: { userId: oid, balance: 0, transactions: [] } },
        { upsert: true },
    );

    return FoodUserWallet.findOneAndUpdate(
        { userId: oid, ...filter },
        {
            $inc: { balance: amount },
            $push: { transactions: { $each: [transaction], $position: 0 } },
        },
        { new: true },
    );
};

export const creditReferralReward = async (userId, amountInr, metadata = {}) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        return { wallet: await getUserWallet(userId) };
    }
    const wallet = await ensureWallet(userId);
    wallet.transactions.unshift({
        type: 'addition',
        amount,
        status: 'Completed',
        description: 'Referral reward',
        metadata: { source: 'referral_reward', ...(metadata || {}) }
    });
    wallet.balance = Number(wallet.balance || 0) + amount;
    wallet.referralEarnings = Number(wallet.referralEarnings || 0) + amount;
    await wallet.save();
    return { wallet: await getUserWallet(userId) };
};

export const getUserWallet = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const oid = new mongoose.Types.ObjectId(id);
    const wallet = await FoodUserWallet.findOne({ userId: oid });
    if (!wallet) {
        return { balance: 0, referralEarnings: 0, transactions: [] };
    }
    // Return newest first (UI expects recent transactions on top)
    const tx = Array.isArray(wallet.transactions) ? [...wallet.transactions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) : [];
    return {
        balance: Number(wallet.balance) || 0,
        referralEarnings: Number(wallet.referralEarnings) || 0,
        transactions: tx.map((t) => ({
            id: String(t._id),
            _id: t._id,
            // Shared with Food and Taxi now: taxi rows say `kind`/`title`, not `type`/`description`.
            type: t.type || (t.kind === 'debit' ? 'deduction' : 'addition'),
            amount: Number(t.amount) || 0,
            status: t.status || 'Completed',
            description: t.description || t.title || '',
            date: t.createdAt,
            createdAt: t.createdAt,
            metadata: t.metadata || {}
        }))
    };
};

export const createWalletTopupOrder = async (userId, amountInr) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Amount must be greater than 0');
    }
    if (amount > 50000) {
        throw new ValidationError('Maximum amount is 50,000');
    }

    const amountPaise = Math.round(amount * 100);

    if (!isRazorpayConfigured()) {
        // Dev fallback: return a compatible shape without writing to DB.
        const orderId = `order_dev_${Date.now()}`;
        return {
            razorpay: {
                key: getRazorpayKeyId() || 'rzp_test_dummy',
                orderId,
                amount: amountPaise,
                currency: 'INR'
            }
        };
    }

    const receipt = `wallet_topup_${String(userId).slice(-8)}_${Date.now()}`;
    const order = await createRazorpayOrder(amountPaise, 'INR', receipt);

    return {
        razorpay: {
            key: getRazorpayKeyId(),
            orderId: String(order.id),
            amount: Number(order.amount) || amountPaise,
            currency: order.currency || 'INR'
        }
    };
};

export const verifyWalletTopupPayment = async (userId, payload) => {
    const orderId = String(payload?.razorpayOrderId || '').trim();
    const paymentId = String(payload?.razorpayPaymentId || '').trim();
    const signature = String(payload?.razorpaySignature || '').trim();
    const amount = Number(payload?.amount);

    if (!orderId) throw new ValidationError('razorpayOrderId is required');
    if (!paymentId) throw new ValidationError('razorpayPaymentId is required');
    if (!signature) throw new ValidationError('razorpaySignature is required');
    if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError('amount is required');

    const wallet = await ensureWallet(userId);
    const existing = wallet.transactions.find((t) => String(t.razorpayOrderId || '') === orderId);
    if (existing && String(existing.status).toLowerCase() === 'completed') {
        return { wallet: await getUserWallet(userId) };
    }

    // If razorpay not configured (dev), accept and credit wallet.
    const ok = isRazorpayConfigured()
        ? verifyPaymentSignature(orderId, paymentId, signature)
        : true;
    if (!ok) {
        throw new ValidationError('Payment verification failed');
    }

    // Store ONLY after payment is verified.
    wallet.transactions.unshift({
        type: 'addition',
        amount,
        status: 'Completed',
        description: isRazorpayConfigured() ? 'Wallet top-up' : 'Wallet top-up (dev)',
        metadata: { source: 'wallet_topup', mode: isRazorpayConfigured() ? 'razorpay' : 'dev' },
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: signature
    });

    wallet.balance = Number(wallet.balance || 0) + amount;
    await wallet.save();

    return { wallet: await getUserWallet(userId) };
};

export const deductWalletBalance = async (userId, amountInr, description = 'Order payment', metadata = {}) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Invalid deduction amount');
    }

    /*
     * The balance check is the update's own filter, not a read before it. Two
     * orders paid from one wallet at the same moment both passed a separate
     * check and both saved, taking the balance negative between them.
     */
    const updated = await applyWalletMove(userId, {
        amount: -amount,
        filter: { balance: { $gte: amount } },
        transaction: {
            type: 'deduction',
            amount,
            status: 'Completed',
            description,
            metadata: { source: 'order_payment', ...(metadata || {}) }
        },
    });
    if (!updated) {
        throw new ValidationError('Insufficient wallet balance');
    }

    return { wallet: await getUserWallet(userId) };
};

export const refundWalletBalance = async (userId, amountInr, description = 'Order refund', metadata = {}) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        return { wallet: await getUserWallet(userId) };
    }

    await applyWalletMove(userId, {
        amount,
        transaction: {
            type: 'refund',
            amount,
            status: 'Completed',
            description,
            metadata: { source: 'order_refund', ...(metadata || {}) }
        },
    });

    return { wallet: await getUserWallet(userId) };
};

