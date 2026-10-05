const { razorpayKeyId, razorpayKeySecret } = require('../../../../core/settings/platformCredentials.cjs');
const User = require('../../models/User');
const { validationResult } = require('express-validator');
const { createOrder } = require('../../services/razorpayService');
const { withTransaction, abort } = require('../../utils/withTransaction');
const { confirmGatewayPayment } = require('../../utils/confirmGatewayPayment');
const { claimPaymentReceipt, releasePaymentReceipt } = require('../../utils/paymentReceipt');

/**
 * Get wallet balance
 */
const getWalletBalance = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).select('wallet');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        balance: user.wallet.balance || 0
      }
    });
  } catch (error) {
    console.error('Get wallet balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wallet balance. Please try again.'
    });
  }
};

/**
 * Add money to wallet
 */
const addMoneyToWallet = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user.id;
    const { amount } = req.body;

    // Validate amount
    if (amount < 100) {
      return res.status(400).json({
        success: false,
        message: 'Minimum amount to add is ₹100'
      });
    }

    // Create Razorpay order for wallet top-up
    const orderResult = await createOrder(
      amount,
      'INR',
      `WALLET_${userId}_${Date.now()}`,
      {
        userId: userId.toString(),
        type: 'wallet_topup'
      }
    );

    if (!orderResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to create payment order'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Payment order created successfully',
      data: {
        orderId: orderResult.orderId,
        amount: orderResult.amount / 100,
        currency: orderResult.currency,
        key: razorpayKeyId()
      }
    });
  } catch (error) {
    console.error('Add money to wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order. Please try again.'
    });
  }
};

/**
 * Verify wallet top-up payment
 */
const verifyWalletTopup = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user.id;
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({ success: false, message: 'Missing payment details' });
    }

    // Verify signature
    const { verifyPayment } = require('../../services/razorpayService');
    const isValid = verifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature);

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature'
      });
    }

    // The credited amount comes from Razorpay, NOT from req.body. The signature
    // only proves the order/payment ids are genuine — it says nothing about the
    // amount, so trusting the client's number let anyone pay ₹100 and claim ₹100000.
    const confirmed = await confirmGatewayPayment({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id
    });
    if (!confirmed.ok) {
      return res.status(confirmed.status).json({ success: false, message: confirmed.message });
    }

    // The signature and the captured status say nothing about WHAT the payment
    // was for. Without this, any genuine payment -- a booking payment, a plan
    // purchase, someone else's top-up -- could be replayed here and credited to
    // the caller's wallet. addMoneyToWallet stamps { type, userId } into the
    // order notes; both are server-set and must match the caller.
    if (!confirmed.mock) {
      const notes = confirmed.notes || {};
      if (notes.type !== 'wallet_topup') {
        return res.status(400).json({ success: false, message: 'This payment is not a wallet top-up' });
      }
      if (!notes.userId || String(notes.userId) !== String(userId)) {
        return res.status(403).json({ success: false, message: 'This order belongs to a different account' });
      }
    }

    // Dev-mock orders can't be confirmed against a gateway, so they fall back to
    // the requested amount. isDevMockOrder() is hard-disabled in production.
    const amount = confirmed.mock ? Number(req.body.amount) : confirmed.amount;
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment amount' });
    }

    // Platform-wide single use: a payment id can be consumed by ONE flow for ONE
    // account. Claimed before any money moves; released if crediting fails.
    const claim = await claimPaymentReceipt({
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      purpose: 'wallet_topup',
      ownerId: userId,
      amount
    });
    if (claim.status === 'conflict') {
      return res.status(409).json({ success: false, message: 'This payment has already been used' });
    }
    if (claim.status === 'duplicate') {
      // Same payment, same account, same purpose: already credited. Idempotent success.
      const current = await User.findById(userId).select('wallet').lean();
      return res.status(200).json({
        success: true,
        message: 'This payment has already been credited',
        data: { balance: current?.wallet?.balance || 0, alreadyProcessed: true }
      });
    }

    const Transaction = require('../../models/Transaction');

    // Credit + ledger row commit together. The legacy ledger lookup still guards
    // payments credited before receipts existed.
    let outcome;
    try {
      outcome = await withTransaction(async (session) => {
        const alreadyCredited = await Transaction.findOne({
          referenceId: razorpay_payment_id
        }).session(session);

        if (alreadyCredited) abort({ alreadyCredited: true });

        const updated = await User.findByIdAndUpdate(
          userId,
          { $inc: { 'wallet.balance': amount } },
          { new: true, session }
        );

        if (!updated) abort({ notFound: true });

        const previousBalance = (updated.wallet.balance || 0) - amount;

        await Transaction.create([{
          userId: updated._id,
          type: 'credit',
          amount,
          status: 'completed',
          paymentMethod: 'razorpay', // or online
          description: 'Wallet Top-up',
          balanceBefore: previousBalance,
          balanceAfter: updated.wallet.balance,
          referenceId: razorpay_payment_id,
          metadata: {
            orderId: razorpay_order_id
          }
        }], { session });

        return { balance: updated.wallet.balance };
      });
    } catch (err) {
      await releasePaymentReceipt({ paymentId: razorpay_payment_id, purpose: 'wallet_topup', ownerId: userId });
      throw err;
    }

    if (outcome.notFound) {
      await releasePaymentReceipt({ paymentId: razorpay_payment_id, purpose: 'wallet_topup', ownerId: userId });
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    if (outcome.alreadyCredited) {
      // Consumed before receipts existed. Keep the receipt: the payment IS used.
      return res.status(409).json({
        success: false,
        message: 'This payment has already been used'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Money added to wallet successfully',
      data: {
        balance: outcome.balance
      }
    });
  } catch (error) {
    console.error('Verify wallet topup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add money to wallet. Please try again.'
    });
  }
};

/**
 * Get wallet transaction history
 */
const getWalletTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;

    const Transaction = require('../../models/Transaction');

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get transactions
    const transactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const total = await Transaction.countDocuments({ userId });

    // Format transactions
    const formattedTransactions = transactions.map(txn => ({
      id: txn._id,
      type: txn.type, // 'credit', 'debit', 'refund', 'penalty' etc.
      amount: txn.amount,
      description: txn.description,
      date: txn.createdAt,
      status: txn.status,
      balanceAfter: txn.balanceAfter
    }));

    res.status(200).json({
      success: true,
      data: formattedTransactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get wallet transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction history. Please try again.'
    });
  }
};

module.exports = {
  getWalletBalance,
  addMoneyToWallet,
  verifyWalletTopup,
  getWalletTransactions
};
