const { razorpayKeyId, razorpayKeySecret } = require('../../../../core/settings/platformCredentials.cjs');
const Booking = require('../../models/Booking');
const User = require('../../models/User');
const Settings = require('../../models/Settings');
const Plan = require('../../models/Plan');
const { validationResult } = require('express-validator');
const { PAYMENT_STATUS, BOOKING_STATUS, refundableAmountOf } = require('../../utils/constants');
const { createOrder, verifyPayment, refundPayment } = require('../../services/razorpayService');
const { createNotification } = require('../notificationControllers/notificationController');
const { recordBookingEarning } = require('../../services/earningTrackerService');
const { withTransaction, abort } = require('../../utils/withTransaction');
const { confirmGatewayPayment } = require('../../utils/confirmGatewayPayment');

/**
 * Create Razorpay order for booking payment
 */
const createPaymentOrder = async (req, res) => {
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
    const { bookingId } = req.body;

    // Get booking
    const booking = await Booking.findOne({ _id: bookingId, userId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if payment already done
    if (booking.paymentStatus === PAYMENT_STATUS.SUCCESS) {
      return res.status(400).json({
        success: false,
        message: 'Payment already completed for this booking'
      });
    }

    // Create Razorpay order
    console.log('Creating Razorpay order with amount:', booking.finalAmount);
    const orderResult = await createOrder(
      booking.finalAmount,
      'INR',
      booking.bookingNumber,
      {
        bookingId: booking._id.toString(),
        userId: userId.toString(),
        bookingNumber: booking.bookingNumber
      }
    );

    console.log('Razorpay order result:', orderResult);

    if (!orderResult.success) {
      console.error('Razorpay order creation failed:', orderResult.error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create payment order',
        error: orderResult.error || 'Unknown error'
      });
    }

    // Update booking with Razorpay order ID
    booking.razorpayOrderId = orderResult.orderId;
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Payment order created successfully',
      data: {
        orderId: orderResult.orderId,
        amount: orderResult.amount / 100, // Convert back to rupees
        currency: orderResult.currency,
        key: razorpayKeyId(),
        bookingId: booking._id
      }
    });
  } catch (error) {
    console.error('Create payment order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order. Please try again.',
      error: error.message
    });
  }
};

/**
 * Verify payment (webhook handler)
 */
const verifyPaymentWebhook = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    // Verify signature
    const isValid = verifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature);

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature'
      });
    }

    const Transaction = require('../../models/Transaction');
    const Vendor = require('../../models/Vendor');
    const Worker = require('../../models/Worker');
    const VendorBill = require('../../models/VendorBill');

    /*
     * The signature proves order|payment came from Razorpay; it says nothing about
     * how much was paid. And a booking's razorpayOrderId is never cleared, while its
     * finalAmount is rewritten when the bill is generated -- so an order created at
     * checkout for Rs 1 could be paid AFTER a Rs 2000 bill, and this handler marked
     * the booking paid and credited the partner the full bill.
     *
     * So the captured amount is read back from the gateway and must equal the
     * booking's CURRENT finalAmount, checked inside the claim. It is also recorded as
     * paidAmount, the cap for every later refund.
     */
    const gateway = await confirmGatewayPayment({ orderId: razorpay_order_id, paymentId: razorpay_payment_id });
    if (!gateway.ok) {
      return res.status(gateway.status).json({ success: false, message: gateway.message });
    }
    const amountFilter = gateway.mock
      ? {}
      : { $expr: { $lt: [{ $abs: { $subtract: [{ $ifNull: ['$finalAmount', 0] }, gateway.amount] } }, 0.01] } };

    // Booking claim + user transaction + bill + partner wallet credit all commit
    // together or not at all. Notifications and socket emits stay outside — they
    // can't be rolled back, and the callback may be retried on write conflicts.
    const outcome = await withTransaction(async (session) => {
      // ATOMIC CLAIM: a valid signature can be replayed by the client. Claiming the
      // booking in the query means only the first call proceeds to credit wallets —
      // every replay falls through to the "already verified" branch below.
      const booking = await Booking.findOneAndUpdate(
        {
          razorpayOrderId: razorpay_order_id,
          paymentStatus: { $ne: PAYMENT_STATUS.SUCCESS },
          ...amountFilter
        },
        [
          {
            $set: {
              paymentStatus: PAYMENT_STATUS.SUCCESS,
              paymentMethod: 'online',
              razorpayPaymentId: { $literal: razorpay_payment_id },
              paymentId: { $literal: razorpay_payment_id },
              paidAmount: gateway.mock ? '$finalAmount' : gateway.amount
            }
          }
        ],
        { new: true, session }
      );

      if (!booking) {
        // No such order, already verified -- or the amount no longer matches.
        const existing = await Booking.findOne({ razorpayOrderId: razorpay_order_id })
          .select('_id paymentStatus finalAmount bookingNumber')
          .session(session);
        return { booking: null, existing };
      }

      // Update booking status based on current state
      if (booking.status === BOOKING_STATUS.WORK_DONE) {
        booking.status = BOOKING_STATUS.COMPLETED;
        booking.completedAt = new Date();
        await booking.save({ session });
      }

      // User payment transaction
      await Transaction.create([{
        userId: booking.userId,
        bookingId: booking._id,
        amount: booking.finalAmount,
        type: 'payment',
        paymentMethod: 'razorpay',
        status: 'completed',
        description: `Online payment for booking ${booking.bookingNumber}`,
        referenceId: razorpay_payment_id
      }], { session });

      // Fetch VendorBill for earnings (only if bill exists = post-completion payment)
      const bill = await VendorBill.findOne({ bookingId: booking._id }).session(session);

      const isWorkerBooking = booking.bookingModel === 'worker';

      if (bill) {
        const partnerEarning = isWorkerBooking ? bill.grandTotal : bill.vendorTotalEarning;

        // Mark bill as paid
        bill.status = 'paid';
        bill.paidAt = new Date();
        await bill.save({ session });

        // Online payment: only earnings increase, NO dues (platform holds the money)
        if (isWorkerBooking && booking.workerId) {
          await Worker.findByIdAndUpdate(booking.workerId, {
            $inc: { 'wallet.earnings': partnerEarning, 'wallet.balance': partnerEarning }
          }, { session });

          // Earnings credit transaction for Worker
          if (partnerEarning > 0) {
            await Transaction.create([{
              workerId: booking.workerId,
              bookingId: booking._id,
              amount: partnerEarning,
              type: 'earnings_credit',
              paymentMethod: 'system',
              status: 'completed',
              description: `Earnings ₹${partnerEarning} credited for booking ${booking.bookingNumber} (online payment)`,
              metadata: {
                type: 'earnings_increase',
                billId: bill._id.toString()
              }
            }], { session });
          }
        } else if (booking.vendorId) {
          await Vendor.findByIdAndUpdate(booking.vendorId, {
            $inc: { 'wallet.earnings': partnerEarning }
          }, { session });

          // Earnings credit transaction for Vendor
          if (partnerEarning > 0) {
            await Transaction.create([{
              vendorId: booking.vendorId,
              bookingId: booking._id,
              amount: partnerEarning,
              type: 'earnings_credit',
              paymentMethod: 'system',
              status: 'completed',
              description: `Earnings ₹${partnerEarning} credited for booking ${booking.bookingNumber} (online payment)`,
              metadata: {
                type: 'earnings_increase',
                billId: bill._id.toString(),
                serviceEarning: bill.vendorServiceEarning,
                partsEarning: bill.vendorPartsEarning
              }
            }], { session });
          }
        }

        console.log(`[Payment] Credited ₹${partnerEarning} to ${isWorkerBooking ? 'worker' : 'vendor'}`);
      }

      return { booking, bill };
    });

    if (!outcome.booking) {
      if (outcome.existing && outcome.existing.paymentStatus !== PAYMENT_STATUS.SUCCESS) {
        // Captured at the gateway, but not for what the booking now costs -- the order
        // predates the bill, or the amounts were tampered with. Not marked paid; the
        // money sits at Razorpay for an admin to refund or reconcile.
        console.error(
          `[Payment] AMOUNT MISMATCH booking ${outcome.existing.bookingNumber}: captured ₹${gateway.amount} `
          + `for order ${razorpay_order_id} (payment ${razorpay_payment_id}), booking total ₹${outcome.existing.finalAmount}. Not marked paid.`
        );
        return res.status(409).json({
          success: false,
          message: 'The amount paid does not match the current booking total. Please contact support.'
        });
      }
      if (outcome.existing) {
        return res.status(200).json({
          success: true,
          message: 'Payment already verified',
          data: { bookingId: outcome.existing._id, alreadyProcessed: true }
        });
      }
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const { booking, bill } = outcome;

    // Record stats in the Daily Earning Tracker (Async)
    recordBookingEarning({
      date: new Date(),
      totalRevenue: Number(bill ? bill.grandTotal : booking.finalAmount) || 0,
      platformCommission: Number(bill ? bill.companyRevenue : 0) || 0,
      vendorEarnings: Number(bill ? bill.vendorTotalEarning : 0) || 0,
      totalGST: Number(bill ? bill.totalGST : 0) || 0,
      totalTDS: 0 // Tracked in withdrawals
    }).catch(err => console.error('[Payment] Daily tracker failed:', err));

    // Send notification to user
    await createNotification({
      userId: booking.userId,
      type: 'payment_success',
      title: 'Payment Successful',
      message: `Payment of ₹${booking.finalAmount} for booking ${booking.bookingNumber} was successful. Thank you!`,
      relatedId: booking._id,
      relatedType: 'payment',
      priority: 'high'
    });

    // Notify vendor & worker
    let vendorTitle = 'Booking Confirmed';
    let vendorMsg = `Payment received for booking ${booking.bookingNumber}. The service is now confirmed.`;

    if (booking.status === BOOKING_STATUS.COMPLETED) {
      vendorTitle = 'Payment Received (Online)';
      vendorMsg = `User paid ₹${booking.finalAmount} online for booking ${booking.bookingNumber}. Job Completed!`;
    }

    if (booking.vendorId) {
      await createNotification({
        vendorId: booking.vendorId,
        type: 'payment_success',
        title: vendorTitle,
        message: vendorMsg,
        relatedId: booking._id,
        relatedType: 'booking',
        priority: 'high'
      });
    }

    // --- SOCKET EMISSION ---
    const io = req.app.get('io');
    if (io) {
      const bookingIdStr = booking._id.toString();
      const workerIdStr = booking.workerId ? booking.workerId.toString() : '';
      const vendorIdStr = booking.vendorId ? booking.vendorId.toString() : '';
      const userIdStr = booking.userId ? booking.userId.toString() : '';

      // Emit to booking-specific room
      io.to(`booking_${bookingIdStr}`).emit('payment_success', {
        bookingId: bookingIdStr,
        paymentStatus: 'SUCCESS',
        status: booking.status
      });

      if (workerIdStr) {
        io.to(`worker_${workerIdStr}`).emit('payment_success', {
          bookingId: bookingIdStr,
          paymentStatus: 'SUCCESS',
          status: booking.status
        });
      }
      if (vendorIdStr) {
        io.to(`vendor_${vendorIdStr}`).emit('payment_success', {
          bookingId: bookingIdStr,
          paymentStatus: 'SUCCESS',
          status: booking.status
        });
      }
      io.to(`user_${userIdStr}`).emit('payment_success', {
        bookingId: bookingIdStr,
        paymentStatus: 'SUCCESS',
        status: booking.status
      });
    }

    res.status(200).json({
      success: true,
      message: 'Payment verified successfully'
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment'
    });
  }
};

/**
 * Process wallet payment
 */
const processWalletPayment = async (req, res) => {
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
    const { bookingId } = req.body;

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const Transaction = require('../../models/Transaction');
    const Vendor = require('../../models/Vendor');
    const Worker = require('../../models/Worker');
    const VendorBill = require('../../models/VendorBill');

    // The user debit and the partner credit are the two halves of one payment.
    // Committing one without the other either loses the customer's money or
    // pays a partner who was never charged.
    //
    // Everything is read INSIDE the callback on purpose: withTransaction() retries
    // on write conflicts, and a document fetched outside would keep its "already
    // saved" state on the second pass, making its .save() a silent no-op.
    const walletOutcome = await withTransaction(async (session) => {
      // Claim the booking and mark it paid in one step, so a double-submit can't
      // debit the wallet twice for the same booking.
      const booking = await Booking.findOneAndUpdate(
        { _id: bookingId, userId, paymentStatus: { $ne: PAYMENT_STATUS.SUCCESS } },
        [
          {
            $set: {
              paymentStatus: PAYMENT_STATUS.SUCCESS,
              paymentMethod: 'wallet',
              paymentId: `WALLET_${Date.now()}`,
              // What the debit below takes, recorded as the refund cap.
              paidAmount: '$finalAmount'
            }
          }
        ],
        { new: true, session }
      );

      if (!booking) {
        const exists = await Booking.findOne({ _id: bookingId, userId })
          .select('_id')
          .session(session);
        abort(exists ? { alreadyPaid: true } : { notFound: true });
      }

      // ATOMIC DEBIT: the balance check lives in the query, so two concurrent
      // requests can't both pass it and overdraw the wallet.
      const debitedUser = await User.findOneAndUpdate(
        { _id: userId, 'wallet.balance': { $gte: booking.finalAmount } },
        { $inc: { 'wallet.balance': -booking.finalAmount } },
        { new: true, session }
      );

      // abort(), not return — a plain return would COMMIT the booking claim above
      // and hand the customer a paid booking they were never charged for.
      if (!debitedUser) abort({ insufficient: true });

      await Transaction.create([{
        userId,
        bookingId: booking._id,
        amount: booking.finalAmount,
        type: 'debit',
        paymentMethod: 'wallet',
        status: 'completed',
        description: `Wallet payment for booking ${booking.bookingNumber}`,
        balanceAfter: debitedUser.wallet.balance
      }], { session });

      // Update booking status
      if (booking.status === BOOKING_STATUS.WORK_DONE) {
        booking.status = BOOKING_STATUS.COMPLETED;
        booking.completedAt = new Date();
        await booking.save({ session });
      }

      // ── Credit Partner Wallet from VendorBill (single source of truth) ──
      const bill = await VendorBill.findOne({ bookingId: booking._id }).session(session);

      const isWorkerBooking = booking.bookingModel === 'worker';

      if (bill) {
        const partnerEarning = isWorkerBooking ? bill.grandTotal : bill.vendorTotalEarning;

        // Mark bill as paid
        bill.status = 'paid';
        bill.paidAt = new Date();
        await bill.save({ session });

        // Wallet payment: only earnings increase, NO dues (platform holds the money)
        if (isWorkerBooking && booking.workerId) {
          await Worker.findByIdAndUpdate(booking.workerId, {
            $inc: { 'wallet.earnings': partnerEarning, 'wallet.balance': partnerEarning }
          }, { session });

          if (partnerEarning > 0) {
            await Transaction.create([{
              workerId: booking.workerId,
              bookingId: booking._id,
              amount: partnerEarning,
              type: 'earnings_credit',
              paymentMethod: 'system',
              status: 'completed',
              description: `Earnings ₹${partnerEarning} credited for booking ${booking.bookingNumber} (wallet payment)`,
              metadata: {
                type: 'earnings_increase',
                billId: bill._id.toString()
              }
            }], { session });
          }
        } else if (booking.vendorId) {
          await Vendor.findByIdAndUpdate(booking.vendorId, {
            $inc: { 'wallet.earnings': partnerEarning }
          }, { session });

          if (partnerEarning > 0) {
            await Transaction.create([{
              vendorId: booking.vendorId,
              bookingId: booking._id,
              amount: partnerEarning,
              type: 'earnings_credit',
              paymentMethod: 'system',
              status: 'completed',
              description: `Earnings ₹${partnerEarning} credited for booking ${booking.bookingNumber} (wallet payment)`,
              metadata: {
                type: 'earnings_increase',
                billId: bill._id.toString(),
                serviceEarning: bill.vendorServiceEarning,
                partsEarning: bill.vendorPartsEarning
              }
            }], { session });
          }
        }

        console.log(`[Wallet Payment] Credited ₹${partnerEarning} to ${isWorkerBooking ? 'worker' : 'vendor'}`);
      }

      return { bill, booking };
    });

    if (walletOutcome.notFound) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    if (walletOutcome.alreadyPaid) {
      return res.status(400).json({
        success: false,
        message: 'Payment already completed for this booking'
      });
    }
    if (walletOutcome.insufficient) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance'
      });
    }

    const { bill, booking } = walletOutcome;

    // Record stats in the Daily Earning Tracker (Async)
    recordBookingEarning({
      date: new Date(),
      totalRevenue: Number(bill ? bill.grandTotal : booking.finalAmount) || 0,
      platformCommission: Number(bill ? bill.companyRevenue : 0) || 0,
      vendorEarnings: Number(bill ? bill.vendorTotalEarning : 0) || 0,
      totalGST: Number(bill ? bill.totalGST : 0) || 0,
      totalTDS: 0 // Tracked in withdrawals
    }).catch(err => console.error('[Wallet Payment] Daily tracker failed:', err));

    // Send notification to user
    await createNotification({
      userId,
      type: 'payment_success',
      title: 'Payment Successful',
      message: `Payment of ₹${booking.finalAmount} for booking ${booking.bookingNumber} was successful.`,
      relatedId: booking._id,
      relatedType: 'payment',
      priority: 'high'
    });

    // Notify vendor & worker
    let vendorTitle = 'Booking Confirmed';
    let vendorMsg = `Payment received for booking ${booking.bookingNumber}. The service is now confirmed.`;

    if (booking.status === BOOKING_STATUS.COMPLETED) {
      vendorTitle = 'Payment Received (Wallet)';
      vendorMsg = `User paid ₹${booking.finalAmount} via wallet for booking ${booking.bookingNumber}. Job Completed!`;
    }

    if (booking.vendorId) {
      await createNotification({
        vendorId: booking.vendorId,
        type: 'payment_success',
        title: vendorTitle,
        message: vendorMsg,
        relatedId: booking._id,
        relatedType: 'booking',
        priority: 'high'
      });
    }
    // --- SOCKET EMISSION ---
    const io = req.app.get('io');
    if (io) {
      const bookingIdStr = booking._id.toString();
      const workerIdStr = booking.workerId ? booking.workerId.toString() : '';
      const vendorIdStr = booking.vendorId ? booking.vendorId.toString() : '';
      const userIdStr = booking.userId ? booking.userId.toString() : '';

      // Emit to booking-specific room
      io.to(`booking_${bookingIdStr}`).emit('payment_success', {
        bookingId: bookingIdStr,
        paymentStatus: 'SUCCESS',
        status: booking.status
      });

      if (workerIdStr) {
        io.to(`worker_${workerIdStr}`).emit('payment_success', {
          bookingId: bookingIdStr,
          paymentStatus: 'SUCCESS',
          status: booking.status
        });
      }
      if (vendorIdStr) {
        io.to(`vendor_${vendorIdStr}`).emit('payment_success', {
          bookingId: bookingIdStr,
          paymentStatus: 'SUCCESS',
          status: booking.status
        });
      }
      io.to(`user_${userIdStr}`).emit('payment_success', {
        bookingId: bookingIdStr,
        paymentStatus: 'SUCCESS',
        status: booking.status
      });
    }

    res.status(200).json({
      success: true,
      message: 'Payment processed successfully',
      data: {
        bookingId: booking._id,
        amount: booking.finalAmount,
        remainingBalance: user.wallet.balance
      }
    });
  } catch (error) {
    console.error('Process wallet payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payment. Please try again.'
    });
  }
};

/**
 * Process refund
 */
const processRefund = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { bookingId } = req.body;
    const { amount } = req.body; // Optional: partial refund

    // Get booking
    const booking = await Booking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if payment was successful
    if (booking.paymentStatus !== PAYMENT_STATUS.SUCCESS) {
      return res.status(400).json({
        success: false,
        message: 'Payment not completed for this booking'
      });
    }

    // Never refund more than the customer actually paid
    // What was actually received -- not finalAmount, which a bill can raise after payment.
    const paidAmount = refundableAmountOf(booking);
    const refundAmount = amount === undefined || amount === null ? paidAmount : Number(amount);

    if (!Number.isFinite(refundAmount) || refundAmount <= 0 || refundAmount > paidAmount) {
      return res.status(400).json({
        success: false,
        message: `Invalid refund amount. Must be between 1 and ${paidAmount}.`
      });
    }

    // 'online' is what verifyPaymentWebhook stores for a Razorpay payment; checking
    // only 'razorpay' told an admin that every such booking could not be refunded.
    const isGatewayPaid = ['razorpay', 'online'].includes(booking.paymentMethod) && !!booking.razorpayPaymentId;
    if (booking.paymentMethod !== 'wallet' && !isGatewayPaid) {
      return res.status(400).json({
        success: false,
        message: 'Refund not supported for this payment method'
      });
    }

    // Claiming SUCCESS -> REFUNDED in the query is what stops a double-submit from
    // refunding twice; only the first request past this point moves any money.
    const claimRefund = (session) => Booking.findOneAndUpdate(
      { _id: bookingId, paymentStatus: PAYMENT_STATUS.SUCCESS },
      { $set: { paymentStatus: PAYMENT_STATUS.REFUNDED, refundedAmount: refundAmount } },
      { new: true, session }
    );

    if (booking.paymentMethod === 'wallet') {
      // Wallet refund: booking status and the wallet credit are two documents, so
      // they commit together or not at all.
      const outcome = await withTransaction(async (session) => {
        const claimed = await claimRefund(session);
        if (!claimed) abort({ alreadyRefunded: true });

        const user = await User.findByIdAndUpdate(claimed.userId, {
          $inc: { 'wallet.balance': refundAmount }
        }, { new: true, session });
        // Without this the booking was marked refunded and the credit went nowhere.
        if (!user) abort({ userMissing: true });

        // The refund had no row, so it was invisible in the customer's history and
        // to any reconciliation.
        const Transaction = require('../../models/Transaction');
        const balanceAfter = Number(user.wallet?.balance) || 0;
        await Transaction.create([{
          userId: user._id,
          bookingId: claimed._id,
          type: 'refund',
          amount: refundAmount,
          status: 'completed',
          paymentMethod: 'wallet',
          description: `Refund for booking #${claimed.bookingNumber}`,
          balanceBefore: Math.round((balanceAfter - refundAmount) * 100) / 100,
          balanceAfter,
          metadata: { source: 'admin_refund', adminId: req.user?.id || null }
        }], { session });

        return { claimed };
      });

      if (outcome.alreadyRefunded) {
        return res.status(400).json({
          success: false,
          message: 'This booking has already been refunded'
        });
      }
      if (outcome.userMissing) {
        return res.status(404).json({
          success: false,
          message: 'Customer not found; nothing was refunded'
        });
      }
      booking.paymentStatus = PAYMENT_STATUS.REFUNDED;
    } else {
      // Razorpay refund hits an external API. That call cannot be rolled back and
      // must not hold a transaction open across a network round trip, so instead:
      // claim first (single document, already atomic), then call out, then undo the
      // claim if the gateway rejected it.
      const claimed = await claimRefund();
      if (!claimed) {
        return res.status(400).json({
          success: false,
          message: 'This booking has already been refunded'
        });
      }

      const refundResult = await refundPayment(
        booking.razorpayPaymentId,
        refundAmount,
        {
          bookingId: booking._id.toString(),
          reason: 'Booking cancellation'
        }
      );

      if (!refundResult.success) {
        // Compensate: give the booking its refundable state back
        await Booking.updateOne(
          { _id: bookingId },
          { $set: { paymentStatus: PAYMENT_STATUS.SUCCESS, refundedAmount: 0 } }
        );
        return res.status(500).json({
          success: false,
          message: 'Failed to process refund'
        });
      }
      // Record the gateway refund. No platform wallet moved -- the money went back
      // to the customer's card or account -- so it is marked as such.
      try {
        const Transaction = require('../../models/Transaction');
        await Transaction.create({
          userId: claimed.userId,
          bookingId: claimed._id,
          type: 'refund',
          amount: refundAmount,
          status: 'completed',
          paymentMethod: 'razorpay',
          description: `Refund for booking #${claimed.bookingNumber} to original payment method`,
          referenceId: refundResult.refund?.id || refundResult.refundId || null,
          metadata: { source: 'admin_refund', adminId: req.user?.id || null, razorpayPaymentId: booking.razorpayPaymentId, movesWallet: false }
        });
      } catch (rowErr) {
        // The refund has happened at the gateway; a missing row must not turn that
        // into a 500 that invites a retry. Logged loudly instead.
        console.error(`[Refund] gateway refund succeeded for booking ${bookingId} but the row failed: ${rowErr.message}`);
      }
      booking.paymentStatus = PAYMENT_STATUS.REFUNDED;
    }

    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      data: {
        bookingId: booking._id,
        refundAmount
      }
    });
  } catch (error) {
    console.error('Process refund error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process refund. Please try again.'
    });
  }
};

/**
 * Get payment history
 */
const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get bookings with successful payments
    const bookings = await Booking.find({
      userId,
      paymentStatus: PAYMENT_STATUS.SUCCESS
    })
      .populate('serviceId', 'title iconUrl')
      .populate('vendorId', 'name businessName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const total = await Booking.countDocuments({
      userId,
      paymentStatus: PAYMENT_STATUS.SUCCESS
    });

    res.status(200).json({
      success: true,
      data: bookings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history. Please try again.'
    });
  }
};

/**
 * Confirm Pay at Home option
 */
const confirmPayAtHome = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookingId } = req.body;

    const booking = await Booking.findOne({ _id: bookingId, userId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.paymentStatus === PAYMENT_STATUS.SUCCESS) {
      return res.status(400).json({
        success: false,
        message: 'Payment already completed for this booking'
      });
    }

    // Only a booking still waiting on its payment choice. This set CONFIRMED
    // whatever the status, so it reopened cancelled or refunded bookings and
    // rolled an in-progress job back to confirmed.
    const choosable = [BOOKING_STATUS.PENDING, BOOKING_STATUS.AWAITING_PAYMENT, BOOKING_STATUS.REQUESTED, BOOKING_STATUS.SEARCHING, BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.CONFIRMED]
      .filter(Boolean);
    if (!choosable.includes(booking.status) || booking.paymentStatus === PAYMENT_STATUS.REFUNDED) {
      return res.status(400).json({
        success: false,
        message: 'This booking can no longer change its payment method'
      });
    }

    // Update booking status — NO earnings set (VendorBill handles that later)
    booking.paymentMethod = 'pay_at_home';
    booking.paymentStatus = PAYMENT_STATUS.PENDING;
    booking.status = BOOKING_STATUS.CONFIRMED;

    await booking.save();

    // Notify Vendor that booking is confirmed
    await createNotification({
      vendorId: booking.vendorId,
      type: 'booking_confirmed',
      title: 'Booking Confirmed (Pay at Home)',
      message: `Booking ${booking.bookingNumber} has been confirmed. Payment method: Pay at Home.`,
      relatedId: booking._id,
      relatedType: 'booking'
    });

    res.status(200).json({
      success: true,
      message: 'Booking confirmed with Pay at Home option',
      data: booking
    });
  } catch (error) {
    console.error('Confirm Pay at Home error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm booking. Please try again.'
    });
  }
};

const calculateUpgradeAmount = (currentPlan, newPlanPrice) => {
  if (!currentPlan || !currentPlan.isActive) return { amount: newPlanPrice, credit: 0 };

  const now = new Date();
  const expiry = new Date(currentPlan.expiry);

  if (expiry <= now) return { amount: newPlanPrice, credit: 0 };

  const totalDuration = 30 * 24 * 60 * 60 * 1000;
  const remainingTime = expiry.getTime() - now.getTime();

  let remainingRatio = remainingTime / totalDuration;
  if (remainingRatio > 1) remainingRatio = 1;
  if (remainingRatio < 0) remainingRatio = 0;

  const credit = Math.floor((currentPlan.price || 0) * remainingRatio);

  if (credit <= 0) return { amount: newPlanPrice, credit: 0 };

  let finalAmount = newPlanPrice - credit;
  if (finalAmount < 0) finalAmount = 0;

  return { amount: Math.ceil(finalAmount), credit };
};

const getUpgradeDetails = async (req, res) => {
  try {
    const { planId } = req.query;
    if (!planId) return res.status(400).json({ success: false, message: 'Plan ID required' });

    const newPlan = await Plan.findById(planId);
    if (!newPlan) return res.status(404).json({ success: false, message: 'Plan not found' });

    const user = await User.findById(req.user.id);
    const { amount, credit } = calculateUpgradeAmount(user.plans, newPlan.price);

    res.status(200).json({
      success: true,
      data: {
        originalPrice: newPlan.price,
        credit,
        finalAmount: amount
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};






const createPlanOrder = async (req, res) => {
  try {
    const { planId } = req.body;
    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    const user = await User.findById(req.user.id);

    // Calculate dynamic pricing
    const { amount } = calculateUpgradeAmount(user.plans, plan.price);

    // Add 18% Tax
    const amountWithTax = Math.ceil(amount * 1.18);

    const orderResult = await createOrder(
      amountWithTax,
      'INR',
      `PLAN_${Date.now()}`,
      { type: 'plan', planId, userId: req.user.id }
    );
    if (!orderResult.success) {
      return res.status(500).json({ success: false, message: 'Order creation failed' });
    }

    res.status(200).json({
      success: true,
      data: {
        orderId: orderResult.orderId,
        amount: orderResult.amount / 100,
        key: razorpayKeyId()
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const verifyPlanPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const userId = req.user.id;

    if (!razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({ success: false, message: 'Missing payment details' });
    }

    // Import verifyPayment if needed, but it's destructured at top
    const isValid = verifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) return res.status(400).json({ success: false, message: 'Invalid signature' });

    // Confirm with the gateway. The signature alone doesn't say WHICH plan was
    // paid for, so taking planId from the body let anyone buy the cheapest plan
    // and activate the most expensive one.
    const confirmed = await confirmGatewayPayment({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id
    });
    if (!confirmed.ok) {
      return res.status(confirmed.status).json({ success: false, message: confirmed.message });
    }

    // createPlanOrder stamps { type:'plan', planId, userId } into the order notes.
    // Outside dev-mock those notes are the only trusted source of the plan id.
    const notes = confirmed.notes || {};
    const planId = confirmed.mock ? req.body.planId : notes.planId;

    if (!planId) {
      return res.status(400).json({ success: false, message: 'Order is not a plan purchase' });
    }
    if (!confirmed.mock && notes.userId && String(notes.userId) !== String(userId)) {
      return res.status(403).json({ success: false, message: 'This order belongs to a different account' });
    }

    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    const Transaction = require('../../models/Transaction');
    const paidAmount = confirmed.mock ? plan.price : confirmed.amount;

    // Plan activation and its ledger row commit together; the referenceId lookup
    // makes a replayed request a no-op instead of a free extension.
    const outcome = await withTransaction(async (session) => {
      const already = await Transaction.findOne({
        referenceId: razorpay_payment_id,
        type: 'plan_purchase'
      }).session(session);
      if (already) abort({ alreadyActivated: true });

      const validityDays = plan.validityDays || 30;
      const expiry = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          $set: {
            plans: {
              isActive: true,
              name: plan.name,
              expiry,
              price: plan.price
            }
          }
        },
        { new: true, session }
      );
      if (!updatedUser) abort({ notFound: true });

      await Transaction.create([{
        userId,
        type: 'plan_purchase',
        amount: paidAmount,
        status: 'completed',
        paymentMethod: 'razorpay',
        description: `Plan purchase: ${plan.name} (${validityDays} days)`,
        referenceId: razorpay_payment_id,
        metadata: {
          orderId: razorpay_order_id,
          planId: plan._id.toString(),
          expiry
        }
      }], { session });

      return { expiry };
    });

    if (outcome.notFound) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (outcome.alreadyActivated) {
      return res.status(400).json({ success: false, message: 'This payment has already been applied' });
    }

    res.status(200).json({
      success: true,
      message: 'Plan activated',
      data: { name: plan.name, expiry: outcome.expiry }
    });
  } catch (error) {
    console.error('Verify plan payment error:', error);
    res.status(500).json({ success: false, message: 'Failed to activate plan' });
  }
};

module.exports = {
  createPaymentOrder,
  verifyPaymentWebhook,
  processWalletPayment,
  processRefund,
  getPaymentHistory,
  confirmPayAtHome,
  createPlanOrder,
  verifyPlanPayment,
  getUpgradeDetails
};

