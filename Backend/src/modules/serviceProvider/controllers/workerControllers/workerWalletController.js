const Worker = require('../../models/Worker');
const Transaction = require('../../models/Transaction');
const Booking = require('../../models/Booking');
const { createOrder, verifyPayment } = require('../../services/razorpayService');
const { withTransaction, abort } = require('../../utils/withTransaction');
const { effectiveCashLimit } = require('../../utils/cashLimit');
const { withdrawalBankDetails } = require('../../utils/providerOnboarding');
const { confirmGatewayPayment } = require('../../utils/confirmGatewayPayment');
const { claimPaymentReceipt, releasePaymentReceipt } = require('../../utils/paymentReceipt');
const PlatformEarning = require('../../models/PlatformEarning');

/**
 * Get worker wallet with ledger balance
 */
const getWallet = async (req, res) => {
  try {
    const workerId = req.user.id;
    const worker = await Worker.findById(workerId).lean();

    if (!worker) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    // List of bookings pending payment (excluding cash collected and direct worker bookings)
    const pendingBookings = await Booking.find({
      workerId: workerId,
      status: 'completed', // Only completed jobs
      workerPaymentStatus: 'PENDING',
      paymentMethod: { $nin: ['cash', 'hand_to_hand'] },
      cashCollected: { $ne: true },
      vendorId: { $ne: null } // Exclude direct worker bookings
    })
      .select('bookingNumber serviceName completedAt vendorId finalAmount vendorBillId')
      .sort({ completedAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: {
        balance: worker.wallet?.balance || 0,
        dues: worker.wallet?.dues || 0,
        cashLimit: (await effectiveCashLimit(worker)).display,
        isBlocked: worker.wallet?.isBlocked || false,
        pendingBookings: pendingBookings
      }
    });

  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch wallet info' });
  }
};

/**
 * Get worker transactions
 */
const getTransactions = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { page = 1, limit = 20, type } = req.query;

    const query = { workerId };

    // Filter by type if provided
    if (type && type !== 'all') {
      query.type = type;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Run find and count in parallel for faster response
    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Transaction.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
  }
};

const { sendPushNotification } = require('../../services/firebaseAdmin');

/**
 * Request payout from vendor for a specific booking
 */
const requestPayout = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { bookingId } = req.body;
    const worker = await Worker.findById(workerId);

    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'Booking ID is required' });
    }

    const booking = await Booking.findOne({
      _id: bookingId,
      workerId: workerId,
      status: 'completed',
      workerPaymentStatus: 'PENDING'
    }).populate('vendorId'); // Ensure vendor is populated to access tokens

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found or already paid' });
    }

    if (!booking.vendorId) {
      return res.status(400).json({ success: false, message: 'No vendor associated with this booking' });
    }

    const vendor = booking.vendorId;
    const message = `Worker ${worker.name} has requested payment for Booking #${booking.bookingNumber}.`;
    const title = '💸 Payout Request';

    // Use createNotification helper for proper notification delivery
    const { createNotification } = require('../notificationControllers/notificationController');
    await createNotification({
      vendorId: vendor._id,
      type: 'payout_requested',
      title: title,
      message: message,
      relatedId: booking._id,
      relatedType: 'booking',
      priority: 'high',
      pushData: {
        type: 'payout_requested',
        bookingId: booking._id.toString(),
        link: `/vendor/booking/${booking._id}`
      }
    });

    res.status(200).json({ success: true, message: 'Payment request sent to vendor' });

  } catch (error) {
    console.error('Request payout error:', error);
    res.status(500).json({ success: false, message: 'Failed to send payout request' });
  }
};

const Withdrawal = require('../../models/Withdrawal');

/**
 * Request withdrawal of entire wallet balance to admin
 */
const requestWithdrawal = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { amount, bankDetails } = req.body;

    const withdrawAmount = Number(amount);
    if (!Number.isFinite(withdrawAmount) || withdrawAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal amount' });
    }

    // The balance check, the "one pending request" check and the insert have to
    // see the same snapshot, otherwise two concurrent requests both pass and the
    // worker ends up with more requested than they hold.
    const outcome = await withTransaction(async (session) => {
      const worker = await Worker.findById(workerId).session(session);
      if (!worker) abort({ notFound: true });

      if ((worker.wallet?.balance || 0) < withdrawAmount) {
        abort({ insufficient: true });
      }

      // Check for existing pending withdrawal
      const existingPending = await Withdrawal.findOne({
        workerId,
        status: 'pending'
      }).session(session);

      if (existingPending) abort({ alreadyPending: true });

      // Provided (validated) or saved profile bank details (plan §3.3).
      const payout = withdrawalBankDetails(bankDetails, worker.bankDetails);
      if (payout.error) abort({ bankError: payout.error });

      // Create withdrawal request
      const [created] = await Withdrawal.create([{
        workerId,
        amount: withdrawAmount,
        bankDetails: payout.value,
        status: 'pending',
        requestDate: new Date()
      }], { session });

      return { withdrawal: created, worker };
    });

    if (outcome.notFound) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }
    if (outcome.bankError) {
      return res.status(400).json({ success: false, message: outcome.bankError });
    }
    if (outcome.insufficient) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }
    if (outcome.alreadyPending) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending withdrawal request'
      });
    }

    const { withdrawal, worker } = outcome;

    // Notify Admin
    const { createNotification } = require('../notificationControllers/notificationController');
    await createNotification({
      type: 'withdrawal_requested',
      title: '💰 New Withdrawal Request',
      message: `Worker ${worker.name} has requested a withdrawal of ₹${withdrawAmount}.`,
      relatedId: withdrawal._id,
      relatedType: 'withdrawal',
      priority: 'high'
    });

    res.status(200).json({ 
      success: true, 
      message: 'Withdrawal request submitted successfully',
      data: withdrawal
    });

  } catch (error) {
    console.error('Request withdrawal error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit withdrawal request' });
  }
};

/**
 * Create a Razorpay order to pay platform dues
 */
const createDuesPaymentOrder = async (req, res) => {
  try {
    const workerId = req.user.id;
    const worker = await Worker.findById(workerId);
    
    if (!worker) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    const duesAmount = worker.wallet?.dues || 0;
    
    if (duesAmount <= 0) {
      return res.status(400).json({ success: false, message: 'You do not have any pending dues to pay' });
    }

    // Minimum amount for Razorpay is usually ₹1 (100 paise)
    if (duesAmount < 1) {
      return res.status(400).json({ success: false, message: 'Dues amount is too small to process online' });
    }

    // Create Razorpay order.
    // Signature is createOrder(amount, currency, receipt, notes) — the description
    // used to be passed as `currency`, which made Razorpay reject the order.
    const orderResult = await createOrder(
      duesAmount,
      'INR',
      `DUES_${workerId}_${Date.now()}`,
      { workerId: workerId.toString(), type: 'worker_dues', workerName: worker.name }
    );
    
    if (!orderResult.success) {
      return res.status(500).json({ success: false, message: 'Failed to create payment order' });
    }

    res.status(200).json({
      success: true,
      data: {
        orderId: orderResult.orderId,
        amount: duesAmount,
        currency: 'INR'
      }
    });
  } catch (error) {
    console.error('Create dues order error:', error);
    res.status(500).json({ success: false, message: 'Failed to initiate payment' });
  }
};

/**
 * Verify Razorpay payment and clear dues
 */
const verifyDuesPayment = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing payment verification details' });
    }

    const isValid = verifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Payment verification failed' });
    }

    // Read what was actually captured rather than assuming the full dues were
    // paid: dues can grow between order creation and payment, and zeroing them
    // regardless would wipe a balance the worker never settled.
    const confirmed = await confirmGatewayPayment({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id
    });
    if (!confirmed.ok) {
      return res.status(confirmed.status).json({ success: false, message: confirmed.message });
    }

    // A payment with no workerId in its notes (a booking payment, a wallet
    // top-up) used to pass this check and clear dues. createDuesPaymentOrder has
    // always written { type: 'worker_dues', workerId }, so both are required.
    if (!confirmed.mock) {
      const notes = confirmed.notes || {};
      if (notes.type !== 'worker_dues') {
        return res.status(400).json({ success: false, message: 'This payment is not a dues payment' });
      }
      if (!notes.workerId || String(notes.workerId) !== String(workerId)) {
        return res.status(403).json({ success: false, message: 'This order belongs to a different account' });
      }
    }

    // Platform-wide single use, claimed before dues move; released if applying fails.
    const claim = await claimPaymentReceipt({
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      purpose: 'worker_dues',
      ownerId: workerId,
      amount: confirmed.amount
    });
    if (claim.status !== 'claimed') {
      return res.status(claim.status === 'duplicate' ? 400 : 409).json({
        success: false,
        message: claim.status === 'duplicate' ? 'This payment has already been applied' : 'This payment has already been used'
      });
    }

    // Dues reduction and its ledger row commit together.
    let outcome;
    try {
      outcome = await withTransaction(async (session) => {
        const already = await Transaction.findOne({
          'metadata.transactionId': razorpay_payment_id,
          type: 'settlement'
        }).session(session);
        if (already) abort({ alreadyApplied: true });

        const worker = await Worker.findById(workerId).session(session);
        if (!worker) abort({ notFound: true });

        const currentDues = worker.wallet?.dues || 0;
        // Dev-mock orders have no gateway amount to read, so they settle the full
        // dues as before. isDevMockOrder() is hard-disabled in production.
        const paidAmount = confirmed.mock ? currentDues : confirmed.amount;
        // Never drive dues negative if the worker overpays.
        const applied = Math.min(paidAmount, currentDues);

        worker.wallet.dues = currentDues - applied;

        // Unblock once the outstanding balance is back within the cash limit
        if (worker.wallet.isBlocked && worker.wallet.dues <= (await effectiveCashLimit(worker)).limit) {
          worker.wallet.isBlocked = false;
          worker.wallet.blockedAt = null;
          worker.wallet.blockReason = null;
        }

        await worker.save({ session });

        const [transaction] = await Transaction.create([{
          workerId: worker._id,
          type: 'settlement',
          amount: applied, // The amount actually applied against dues
          description: `Paid platform dues via Razorpay`,
          status: 'completed',
          metadata: {
            paymentMethod: 'razorpay',
            transactionId: razorpay_payment_id,
            orderId: razorpay_order_id,
            amountPaid: paidAmount,
            notes: 'Worker cleared their platform dues'
          }
        }], { session });

        return {
          transaction,
          applied,
          dues: worker.wallet.dues,
          isBlocked: worker.wallet.isBlocked
        };
      });
    } catch (err) {
      await releasePaymentReceipt({ paymentId: razorpay_payment_id, purpose: 'worker_dues', ownerId: workerId });
      throw err;
    }

    if (outcome.notFound) {
      await releasePaymentReceipt({ paymentId: razorpay_payment_id, purpose: 'worker_dues', ownerId: workerId });
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }
    if (outcome.alreadyApplied) {
      return res.status(400).json({ success: false, message: 'This payment has already been applied' });
    }

    res.status(200).json({
      success: true,
      message: 'Dues paid successfully',
      data: {
        transactionId: outcome.transaction._id,
        amount: outcome.applied,
        dues: outcome.dues,
        isBlocked: outcome.isBlocked
      }
    });

  } catch (error) {
    console.error('Verify dues payment error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify payment' });
  }
};

module.exports = {
  getWallet,
  getTransactions,
  requestPayout,
  requestWithdrawal,
  createDuesPaymentOrder,
  verifyDuesPayment
};
