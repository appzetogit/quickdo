import mongoose from 'mongoose';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodTransaction } from '../../orders/models/foodTransaction.model.js';
import { FoodDeliveryWithdrawal } from '../models/foodDeliveryWithdrawal.model.js';
import { FoodDeliveryCashDeposit } from '../models/foodDeliveryCashDeposit.model.js';
import { FoodDeliveryPartner } from '../models/deliveryPartner.model.js';
import { DeliveryBonusTransaction } from '../../admin/models/deliveryBonusTransaction.model.js';
import { getDeliveryCashLimitSettings } from '../../admin/services/admin.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { createRazorpayCheckoutOrder, fetchRazorpayPayment, isRazorpayConfigured, verifyPaymentSignature } from '../../orders/helpers/razorpay.helper.js';
import { getRiderFinance } from '../../../../core/finance/riderFinance.service.js';
import { withFinanceLock, riderWithdrawalLockKey } from '../../../../core/finance/financeLock.js';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Enhanced wallet fetch for delivery partners.
 * Integrates:
 * 1. Historical orders (earnings)
 * 2. Admin bonuses
 * 3. Withdrawals (pending/payout)
 * 4. Cash collected vs limit
 */
export const getDeliveryPartnerWalletEnhanced = async (deliveryPartnerId) => {
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        throw new ValidationError('Invalid delivery partner ID');
    }

    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
    const partner = await FoodDeliveryPartner.findById(partnerId).lean();
    if (!partner) throw new ValidationError('Delivery partner not found');

    const [cashLimitSettings, earningsAgg, cashCollectedAgg, cashDepositsAgg, bonusAgg, withdrawalAgg, withdrawalsList, depositList] = await Promise.all([
        getDeliveryCashLimitSettings(),
        // 1. Total Earnings from Delivered Orders
        FoodOrder.aggregate([
            { $match: { 'dispatch.deliveryPartnerId': partnerId, orderStatus: 'delivered' } },
            { $group: { _id: null, totalEarned: { $sum: { $ifNull: ['$riderEarning', 0] } } } }
        ]),
        // 2. Gross cash collected (COD orders)
        FoodOrder.aggregate([
            { 
                $match: { 
                    'dispatch.deliveryPartnerId': partnerId, 
                    orderStatus: 'delivered', 
                    'payment.method': 'cash'
                } 
            },
            { $group: { _id: null, cashCollected: { $sum: { $ifNull: ['$pricing.total', 0] } } } }
        ]),
        // 3. Cash deposits (deduct from cash-in-hand)
        FoodDeliveryCashDeposit.aggregate([
            {
                $match: {
                    deliveryPartnerId: partnerId,
                    status: 'Completed'
                }
            },
            { $group: { _id: null, depositedCash: { $sum: { $ifNull: ['$amount', 0] } } } }
        ]),
        // 4. Admin Bonuses
        DeliveryBonusTransaction.aggregate([
            { $match: { deliveryPartnerId: partnerId } },
            { $group: { _id: null, total: { $sum: { $ifNull: ['$amount', 0] } } } }
        ]),
        // 5. Withdrawal Aggregates (Approved vs Pending)
        FoodDeliveryWithdrawal.aggregate([
            { $match: { deliveryPartnerId: partnerId } },
            { 
                $group: { 
                    _id: null, 
                    totalWithdrawn: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, '$amount', 0] } },
                    pendingWithdrawals: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } }
                } 
            }
        ]),
        // 6. Recent Withdrawals for History
        FoodDeliveryWithdrawal.find({ deliveryPartnerId: partnerId })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean(),
        FoodDeliveryCashDeposit.find({ deliveryPartnerId: partnerId })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean()
    ]);

    const totalEarned = Number(earningsAgg?.[0]?.totalEarned) || 0;
    const grossCashCollected = Number(cashCollectedAgg?.[0]?.cashCollected) || 0;
    const totalDepositedCash = Number(cashDepositsAgg?.[0]?.depositedCash) || 0;
    const cashInHand = Math.max(0, grossCashCollected - totalDepositedCash);
    const totalBonus = Number(bonusAgg?.[0]?.total) || 0;
    const totalWithdrawn = Number(withdrawalAgg?.[0]?.totalWithdrawn) || 0;
    const pendingWithdrawals = Number(withdrawalAgg?.[0]?.pendingWithdrawals) || 0;

    const totalCashLimit = Number(cashLimitSettings.deliveryCashLimit) || 0;
    const deliveryWithdrawalLimit = Number(cashLimitSettings.deliveryWithdrawalLimit) || 100;

    // Pocket Balance = (Earnings + Bonus) - Total Withdrawn (approved) - Pending Withdrawals
    // Wait, usually pocket balance subtracts pending too so user knows how much is "left" to request.
    const pocketBalance = Math.max(0, (totalEarned + totalBonus) - (totalWithdrawn + pendingWithdrawals));

    // Fetch transactions for UI (Orders, Bonuses, Withdrawals)
    const [ordersTx] = await Promise.all([
        FoodOrder.find({ 'dispatch.deliveryPartnerId': partnerId, orderStatus: 'delivered' })
            .sort({ createdAt: -1 })
            .select('orderId riderEarning riderBasePay riderDeliveryFeeShare riderSurgePay riderIncentivePay riderTotalPayout pricing payment orderStatus createdAt')
            .limit(20)
            .lean(),
    ]);

    const transactions = [
        ...(ordersTx || []).map(o => {
            const riderBasePay = Number(o.riderBasePay || o.pricing?.deliveryFeeBreakdown?.basePayout || 0);
            const riderDeliveryFeeShare = Number(o.riderDeliveryFeeShare || o.pricing?.riderDeliveryEarningAfterAdminCommission || 0);
            const riderSurgePay = Number(o.riderSurgePay || o.pricing?.surgeAmount || 0);
            const riderIncentivePay = Number(o.riderIncentivePay || o.pricing?.deliveryPartnerIncentiveAmount || 0);
            const computedPayout = Math.round((riderBasePay + riderDeliveryFeeShare + riderSurgePay + riderIncentivePay) * 100) / 100;
            const riderTotalPayout = Number(o.riderTotalPayout || computedPayout || o.riderEarning || 0);

            return {
                id: o._id,
                type: 'payment',
                amount: riderTotalPayout,
                riderBasePay,
                riderDeliveryFeeShare,
                riderSurgePay,
                riderIncentivePay,
                riderTotalPayout,
                status: 'Completed',
                date: o.createdAt,
                description: o.payment?.method === 'cash' ? 'COD delivery earning' : 'Online delivery earning',
                orderId: o.orderId
            };
        }),
        ...(withdrawalsList || []).map(w => ({
            id: w._id,
            type: 'withdrawal',
            amount: w.amount,
            status: w.status === 'pending' ? 'Pending' : (w.status === 'approved' ? 'Completed' : 'Rejected'),
            date: w.createdAt,
            description: `Withdrawal Request - ${w.paymentMethod}`,
            payoutMethod: w.paymentMethod
        })),
        ...(depositList || []).map(d => ({
            id: d._id,
            type: 'deposit',
            amount: d.amount,
            status: d.status || 'Pending',
            date: d.createdAt,
            description: 'Cash limit settlement',
            paymentMethod: d.paymentMethod || 'cash',
            razorpayPaymentId: d.razorpayPaymentId || '',
            razorpayOrderId: d.razorpayOrderId || ''
        }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    /*
     * The money figures come from the unified rider finance service, not from the
     * food-only arithmetic above.
     *
     * The rider delivering this order is the same person driving the taxi, and they
     * were being shown two unrelated balances: this endpoint's food figure and
     * taxidrivers.wallet.balance. pocketBalance is now ONE balance across rides,
     * deliveries and groceries, and cashInHand is the cash they hold from any of
     * them, measured against a single shared ceiling.
     *
     * Every key keeps its name and its meaning, because six call sites read this --
     * including the COD gate in order.service.js, which now compares an order
     * against a rider's real combined headroom rather than their food-only one.
     *
     * The food-only aggregates above are still computed: they build the transaction
     * list, and they are returned under `breakdown` so a disagreement between the
     * two verticals stays diagnosable.
     */
    const finance = await getRiderFinance(partnerId);

    /*
     * Ride ledger rows belong in this history too. One wallet with one balance and
     * a history that silently omitted every taxi movement would leave a rider
     * unable to account for their own total.
     */
    let taxiTransactions = [];
    if (finance.driverId) {
        try {
            const { WalletTransaction } = await import('../../../taxi/driver/models/WalletTransaction.js');
            const rows = await WalletTransaction.find({ driverId: finance.driverId })
                .sort({ createdAt: -1 })
                .limit(50)
                .lean();

            const labels = {
                ride_earning: 'Ride earning',
                commission_deduction: 'Commission on cash ride',
                top_up: 'Wallet top-up',
                adjustment: 'Wallet adjustment',
            };

            taxiTransactions = (rows || []).map((t) => ({
                id: t._id,
                _id: t._id,
                // Signed on the taxi side: a negative amount is money taken from the
                // rider, which this list expresses as a deduction.
                type: Number(t.amount) < 0 ? 'deduction' : 'payment',
                amount: Math.abs(Number(t.amount) || 0),
                status: 'Completed',
                date: t.createdAt,
                createdAt: t.createdAt,
                description: t.description || labels[t.type] || 'Taxi wallet movement',
                source: 'taxi',
                balanceAfter: t.balanceAfter,
            }));
        } catch (err) {
            // A missing ride history must not take down the wallet screen.
            taxiTransactions = [];
        }
    }

    const mergedTransactions = [...transactions, ...taxiTransactions]
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    return {
        // Lifetime gross across both streams, which is what this key always meant.
        totalBalance: round2(totalEarned + totalBonus + finance.breakdown.taxi.walletPortion),
        pocketBalance: finance.walletBalance, // ONE balance, available to withdraw
        cashInHand: finance.cashInHand, // combined cash owed back to the platform
        totalWithdrawn, // Actually paid out
        pendingWithdrawals, // In process
        totalEarned,
        totalBonus,
        totalCashLimit: finance.cashLimit, // the shared ceiling
        availableCashLimit: finance.availableCashLimit,
        deliveryWithdrawalLimit: finance.rules.withdrawalLimit || deliveryWithdrawalLimit,
        isBlocked: finance.isBlocked,
        blockReason: finance.blockReason,
        driverId: finance.driverId,
        breakdown: finance.breakdown,
        transactions: mergedTransactions.slice(0, 50)
    };
};

/**
 * Submits a new withdrawal request for a delivery partner.
 */
export const requestDeliveryWithdrawal = async (deliveryPartnerId, payload) => {
    const amount = Number(payload?.amount);
    const { bankDetails, paymentMethod = 'bank_transfer' } = payload || {};

    if (!Number.isFinite(amount) || amount < 1) throw new ValidationError('Invalid amount');

    // 24 hours after payout details change, and only to the details on file.
    {
        const { FoodDeliveryPartner } = await import('../models/deliveryPartner.model.js');
        const p = await FoodDeliveryPartner.findById(deliveryPartnerId)
            .select('bankDetailsChangedAt bankAccountNumber upiId')
            .lean();
        const changedAt = p?.bankDetailsChangedAt ? new Date(p.bankDetailsChangedAt).getTime() : 0;
        const waitMs = changedAt + 24 * 60 * 60 * 1000 - Date.now();
        if (waitMs > 0) {
            const hours = Math.ceil(waitMs / 3600000);
            throw new ValidationError(`Your payout details changed recently. For your safety, withdrawals open again in about ${hours} hour${hours === 1 ? '' : 's'}.`);
        }
        const inlineAccount = String(bankDetails?.accountNumber || '').trim();
        if (inlineAccount && p?.bankAccountNumber && inlineAccount !== String(p.bankAccountNumber).trim()) {
            throw new ValidationError('Withdrawals go to the bank account in your profile. Update it there first.');
        }
    }

    /*
     * The balance check and the insert run under one per-rider lock.
     *
     * The balance is derived on every read, so "read it, then create the
     * request" had a gap: two Rs 400 requests against Rs 500, sent together,
     * both read 500 and both were created -- Rs 800 pending. Under the lock the
     * second request waits for the first to be written, then reads the balance
     * again (now Rs 100) and is refused. The key is the PERSON, so a request
     * from the quick-commerce app queues behind this one too.
     */
    const lockKey = await riderWithdrawalLockKey(deliveryPartnerId);
    return withFinanceLock(lockKey, async () => {
        const wallet = await getDeliveryPartnerWalletEnhanced(deliveryPartnerId);
        if (amount < wallet.deliveryWithdrawalLimit) {
            throw new ValidationError(`Minimum withdrawal amount is ₹${wallet.deliveryWithdrawalLimit}`);
        }
        if (amount > wallet.pocketBalance) {
            throw new ValidationError('Insufficient balance for this withdrawal');
        }

        const partner = await FoodDeliveryPartner.findById(deliveryPartnerId).lean();
        if (!partner) throw new ValidationError('Delivery partner not found');

        return FoodDeliveryWithdrawal.create({
            deliveryPartnerId,
            amount,
            paymentMethod,
            bankDetails: bankDetails || {
                accountNumber: partner.bankAccountNumber,
                ifscCode: partner.bankIfscCode,
                bankName: partner.bankName,
                accountHolderName: partner.bankAccountHolderName
            },
            upiId: partner.upiId,
            upiQrCode: partner.upiQrCode,
            status: 'pending'
        });
    }, { busyMessage: 'Another withdrawal is being processed. Please try again.' });
};

export const createDeliveryCashDepositOrder = async (deliveryPartnerId, amountInr) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount < 1) {
        throw new ValidationError('Amount must be at least ₹1');
    }
    if (amount > 500000) {
        throw new ValidationError('Maximum deposit is ₹5,00,000');
    }

    const wallet = await getDeliveryPartnerWalletEnhanced(deliveryPartnerId);
    if (amount > wallet.cashInHand) {
        throw new ValidationError('Deposit amount cannot exceed cash in hand');
    }

    const amountPaise = Math.round(amount * 100);
    const receipt = `cash_deposit_${String(deliveryPartnerId).slice(-8)}_${Date.now()}`;

    if (!isRazorpayConfigured()) {
        throw new ValidationError('Razorpay payment gateway is not configured');
    }

    try {
        const razorpay = await createRazorpayCheckoutOrder(amountPaise, 'INR', receipt);
        return { razorpay };
    } catch (error) {
        throw new ValidationError(error?.message || 'Payment gateway error');
    }
};

export const verifyDeliveryCashDepositPayment = async (deliveryPartnerId, payload = {}) => {
    const orderId = String(payload?.razorpayOrderId || '').trim();
    const paymentId = String(payload?.razorpayPaymentId || '').trim();
    const signature = String(payload?.razorpaySignature || '').trim();
    const amount = Number(payload?.amount);

    if (!orderId) throw new ValidationError('razorpayOrderId is required');
    if (!paymentId) throw new ValidationError('razorpayPaymentId is required');
    if (!signature) throw new ValidationError('razorpaySignature is required');
    if (!Number.isFinite(amount) || amount < 1) throw new ValidationError('amount is required');

    const existing = await FoodDeliveryCashDeposit.findOne({
        deliveryPartnerId,
        $or: [
            { razorpayPaymentId: paymentId },
            { razorpayOrderId: orderId }
        ]
    }).lean();

    if (existing?.status === 'Completed') {
        return { deposit: existing, wallet: await getDeliveryPartnerWalletEnhanced(deliveryPartnerId) };
    }

    const wallet = await getDeliveryPartnerWalletEnhanced(deliveryPartnerId);
    if (amount > wallet.cashInHand) {
        throw new ValidationError('Deposit amount cannot exceed cash in hand');
    }

    if (!isRazorpayConfigured()) {
        throw new ValidationError('Razorpay payment gateway is not configured');
    }

    const isValid = verifyPaymentSignature(orderId, paymentId, signature);

    if (!isValid) {
        throw new ValidationError('Payment verification failed');
    }

    /*
     * Settle what the gateway says was paid, never what the client asked for.
     *
     * The signature is HMAC over "orderId|paymentId" and carries no amount, and
     * createDeliveryCashDepositOrder stores nothing locally to compare against.
     * So a genuine Rs 1 payment posted with `amount: 50000` cleared fifty
     * thousand rupees of cash owed -- the cap above only limited it to the cash
     * the rider was actually holding, which is exactly the money at stake.
     *
     * Same pattern as order.service.js: the payment must belong to the order it
     * claims, be captured, and set the amount itself.
     */
    let settledAmount = amount;
    if (!paymentId.startsWith('mock_')) {
        let rzpPayment;
        try {
            rzpPayment = await fetchRazorpayPayment(paymentId);
        } catch {
            throw new ValidationError('Unable to verify payment with gateway. Please try again.');
        }
        if (String(rzpPayment?.order_id || '') !== orderId) {
            throw new ValidationError('Payment verification failed: order mismatch');
        }
        if (!['captured', 'authorized'].includes(String(rzpPayment?.status || ''))) {
            throw new ValidationError('Payment verification failed: payment not captured');
        }
        const capturedPaise = Number(rzpPayment?.amount || 0);
        if (!Number.isFinite(capturedPaise) || capturedPaise <= 0) {
            throw new ValidationError('Payment verification failed: amount missing');
        }
        settledAmount = Math.round(capturedPaise) / 100;
        // Re-checked against the gateway figure: the earlier cap tested the
        // client's number, which is no longer the one being recorded.
        if (settledAmount > wallet.cashInHand) {
            throw new ValidationError('Deposit amount cannot exceed cash in hand');
        }
    }

    /*
     * Only one row may ever become Completed for a payment.
     *
     * The findOne above and a create here were two steps with a gap, and nothing
     * in the database forbade a second row. Two verifications of one Rs 200
     * payment sent together both found nothing and both created a Completed
     * deposit: cash-in-hand went 302 -> 0 instead of 102, so a rider could replay
     * one genuine signature and clear all their COD cash.
     *
     * Now the write itself is the claim: an upsert keyed on razorpayPaymentId,
     * backed by the unique index on the model. Whoever loses the race gets the
     * winner's row back instead of writing a second one.
     */
    const fields = {
        amount: settledAmount,
        paymentMethod: 'razorpay',
        status: 'Completed',
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId
    };

    let deposit = null;
    try {
        if (existing) {
            deposit = await FoodDeliveryCashDeposit.findOneAndUpdate(
                { _id: existing._id, status: { $ne: 'Completed' } },
                { $set: fields },
                { new: true }
            );
        } else {
            const claim = await FoodDeliveryCashDeposit.findOneAndUpdate(
                { razorpayPaymentId: paymentId },
                { $setOnInsert: { deliveryPartnerId, ...fields } },
                { upsert: true, new: true, includeResultMetadata: true }
            );
            deposit = claim?.lastErrorObject?.upserted ? claim.value : null;
        }
    } catch (err) {
        if (err?.code !== 11000) throw err;
    }

    if (!deposit) {
        // Somebody else recorded this payment first. Hand back their row if it is
        // this rider's; a payment belonging to another rider is never theirs to settle.
        const winner = await FoodDeliveryCashDeposit.findOne({ razorpayPaymentId: paymentId }).lean();
        if (!winner || winner.status !== 'Completed' || String(winner.deliveryPartnerId) !== String(deliveryPartnerId)) {
            throw new ValidationError('This payment has already been used');
        }
        deposit = winner;
    }

    return {
        deposit,
        wallet: await getDeliveryPartnerWalletEnhanced(deliveryPartnerId)
    };
};
