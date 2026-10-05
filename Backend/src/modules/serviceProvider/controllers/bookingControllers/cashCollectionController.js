const crypto = require('crypto');
const Booking = require('../../models/Booking');
const Vendor = require('../../models/Vendor');
const Worker = require('../../models/Worker');
const Transaction = require('../../models/Transaction');
const { PAYMENT_STATUS, BOOKING_STATUS } = require('../../utils/constants');
const { recordBookingEarning } = require('../../services/earningTrackerService');
const { getCommissionRates } = require('../../utils/commission');
const { withTransaction, abort } = require('../../utils/withTransaction');
const { effectiveCashLimit } = require('../../utils/cashLimit');
const { createQRCode, getQRCodePayments } = require('../../services/razorpayService');

/**
 * Initiate Online Collection (Show QR Code)
 */
exports.initiateOnlineCollection = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Optional: Update final total and extra items if provided during initiation
    const { totalAmount, extraItems } = req.body;
    if (totalAmount !== undefined && !isNaN(parseFloat(totalAmount))) {
      booking.finalAmount = parseFloat(totalAmount);
      booking.userPayableAmount = parseFloat(totalAmount);
    }

    if (!booking.finalAmount || booking.finalAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment amount' });
    }

    // Store extra items for proper commission calculation
    if (extraItems && Array.isArray(extraItems) && extraItems.length > 0) {
      booking.workDoneDetails = {
        ...booking.workDoneDetails,
        items: extraItems.map(item => ({
          title: item.name || item.title,
          qty: Number(item.qty) || Number(item.quantity) || 1,
          price: Number(item.price) || 0
        }))
      };

      booking.extraCharges = extraItems.map(item => ({
        name: item.name || item.title,
        quantity: Number(item.qty) || Number(item.quantity) || 1,
        price: Number(item.price) || 0,
        total: (Number(item.qty) || Number(item.quantity) || 1) * (Number(item.price) || 0)
      }));

      booking.extraChargesTotal = booking.extraCharges.reduce((sum, item) => sum + item.total, 0);
      booking.markModified('workDoneDetails');
      booking.markModified('extraCharges');
    }

    // Create QR Code
    const qrResult = await createQRCode(
      booking.finalAmount,
      booking.bookingNumber,
      {
        bookingId: booking._id.toString(),
        type: 'worker_initiated_online'
      }
    );

    if (!qrResult.success) {
      return res.status(500).json({ success: false, message: qrResult.error });
    }

    // Reuse existing OTP or generate new one
    const otp = booking.paymentOtp || crypto.randomInt(1000, 10000).toString();
    booking.customerConfirmationOTP = otp;
    booking.paymentOtp = otp;

    // Store QR ID to track later
    booking.razorpayQrId = qrResult.qrCodeId;
    booking.paymentMethod = 'online'; // Mark as online as soon as QR is shown
    await booking.save();

    // Emit socket event to user with full bill details & OTP
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${booking.userId}`).emit('booking_updated', {
        bookingId: booking._id,
        finalAmount: booking.finalAmount,
        workDoneDetails: booking.workDoneDetails,
        qrPaymentInitiated: true,
        customerConfirmationOTP: otp,
        paymentOtp: otp
      });
    }

    // Send Push Notification with OTP
    try {
      const { createNotification } = require('../notificationControllers/notificationController');
      await createNotification({
        userId: booking.userId,
        type: 'work_done',
        title: 'Payment Request & Bill Ready',
        message: `Bill: ₹${booking.finalAmount}. OTP: ${otp}. Please verify bill and pay online or share OTP.`,
        relatedId: booking._id,
        relatedType: 'booking',
        priority: 'high',
        pushData: {
          type: 'work_done',
          bookingId: booking._id.toString(),
          paymentOtp: otp,
          link: `/user/booking/${booking._id}`
        }
      });
    } catch (notificationError) {
      console.error('Notification error in initiateOnlineCollection:', notificationError);
    }

    res.status(200).json({
      success: true,
      message: 'QR Code generated',
      data: {
        qrImageUrl: qrResult.imageUrl,
        paymentUrl: qrResult.paymentUrl,
        amount: booking.finalAmount,
        isManualUpi: qrResult.isManualUpi || false
      }
    });
  } catch (error) {
    console.error('Initiate online collection error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Initiate Cash Collection
 * Optional: Sends OTP to customer
 */
exports.initiateCashCollection = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Allow cash, pay_at_home, online (if user changes mind), AND plan_benefit (for final bill flow)
    const allowedMethods = ['cash', 'pay_at_home', 'plan_benefit', 'online'];
    if (!allowedMethods.includes(booking.paymentMethod)) {
      return res.status(400).json({ success: false, message: 'This booking is not eligible for cash collection' });
    }

    // Optional: Update final total and extra items if provided during initiation
    const { totalAmount, extraItems } = req.body;
    if (totalAmount !== undefined) {
      booking.finalAmount = Number(totalAmount);
      // Assuming no partial payment has been made yet (as status is pending/work_done)
      booking.userPayableAmount = Number(totalAmount);
    }

    // Store extra items for proper commission calculation
    if (extraItems && Array.isArray(extraItems) && extraItems.length > 0) {
      // 1. Update workDoneDetails (Frontend display)
      booking.workDoneDetails = {
        ...booking.workDoneDetails,
        items: extraItems.map(item => ({
          title: item.name || item.title,
          qty: Number(item.qty) || Number(item.quantity) || 1,
          price: Number(item.price) || 0
        }))
      };

      // 2. Update extraCharges (Backend calculation)
      booking.extraCharges = extraItems.map(item => {
        const name = item.name || item.title || 'Extra Item';
        const qty = Number(item.qty) || Number(item.quantity) || 1;
        const price = Number(item.price) || 0;

        return {
          name,
          quantity: qty,
          price,
          total: qty * price
        };
      });

      // 3. Update extraChargesTotal
      booking.extraChargesTotal = booking.extraCharges.reduce((sum, item) => sum + item.total, 0);
    }

    // Force mark modified for nested object (just in case)
    if (extraItems) {
      booking.markModified('workDoneDetails');
      booking.markModified('extraCharges');
    }

    // Reset QR payment flag and switch method if switching back to cash
    booking.qrPaymentInitiated = false;
    if (booking.paymentMethod === 'online') {
      booking.paymentMethod = 'cash';
    }

    // Reuse existing OTP or generate new one
    const otp = booking.paymentOtp || crypto.randomInt(1000, 10000).toString();
    booking.customerConfirmationOTP = otp;
    booking.paymentOtp = otp;
    await booking.save();

    // Emit socket event to user with full bill details and OTP
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`user_${booking.userId}`).emit('booking_updated', {
          bookingId: booking._id,
          finalAmount: booking.finalAmount,
          customerConfirmationOTP: booking.customerConfirmationOTP,
          paymentOtp: booking.paymentOtp,
          workDoneDetails: booking.workDoneDetails,
          qrPaymentInitiated: false
        });
      }
    } catch (socketErr) {
      console.error('[InitiateCash] Socket emission failed:', socketErr.message);
    }

    const { createNotification } = require('../notificationControllers/notificationController');
    createNotification({
      userId: booking.userId,
      type: 'work_done',
      title: 'Payment Request & Bill Ready',
      message: `Bill: ₹${booking.finalAmount}. OTP: ${otp}. Please verify bill and share OTP to complete payment.`,
      relatedId: booking._id,
      relatedType: 'booking',
      priority: 'high',
      pushData: {
        type: 'work_done',
        bookingId: booking._id.toString(),
        paymentOtp: otp,
        link: `/user/booking/${booking._id}`
      }
    }).catch(err => console.error('[InitiateCash] Notification failed:', err));

    res.status(200).json({
      success: true,
      message: 'Bill finalized',
      totalAmount: booking.finalAmount
    });
  } catch (error) {
    console.error('Initiate cash collection error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Confirm Cash Collection (by Vendor/Worker)
 * Uses VendorBill as the single source of truth for earnings.
 */
exports.confirmCashCollection = async (req, res) => {
  try {
    const { id } = req.params;
    const { otp, amount, extraItems } = req.body;
    const userId = req.user._id;
    const userRole = req.user.role;

    const VendorBill = require('../../models/VendorBill');

    // Cash collection touches four documents: the booking, the vendor/worker
    // wallet, and two ledger rows. Half-applying that is what produced "cash
    // collected but no earnings credited" states, so it all commits together.
    //
    // Everything — including the read — happens inside the callback: withTransaction()
    // retries on write conflicts, and a document loaded outside would keep its
    // "already saved" state on the retry, turning its .save() into a silent no-op.
    const outcome = await withTransaction(async (session) => {
      const booking = await Booking.findById(id).session(session);

      if (!booking) abort({ notFound: true });

      // OTP Verification
      const isPlanBenefitNoExtras = booking.paymentMethod === 'plan_benefit' && otp === '0000';

      // An issued OTP must be SENT and match. `&& otp &&` skipped the check whenever the
      // request simply left otp out -- confirming a collection the customer never saw.
      if (!isPlanBenefitNoExtras && booking.customerConfirmationOTP && booking.customerConfirmationOTP !== otp) {
        if (process.env.NODE_ENV !== 'development' || otp !== '0000') {
          console.warn(`[ConfirmCash] Invalid OTP attempt for booking ${id}`);
          abort({ badOtp: true });
        }
      }

      // --- ATOMIC LOCK AGAINST RACE CONDITIONS ---
      // Inside the transaction on purpose: if anything below fails, the lock is
      // rolled back too, instead of leaving the booking permanently unprocessable.
      const updateResult = await Booking.updateOne(
        { _id: booking._id, cashCollected: { $ne: true } },
        { $set: { cashCollected: true } },
        { session }
      );

      if (updateResult.modifiedCount === 0) {
        console.log(`[Race Condition Prevented] Booking ${booking._id} already processed.`);
        abort({ alreadyDone: true, bookingId: booking._id });
      }

      const collectionAmount = amount !== undefined ? Number(amount) : Number(booking.finalAmount);

      // Store extra items in workDoneDetails (for display)
      if (extraItems && Array.isArray(extraItems) && extraItems.length > 0) {
        booking.workDoneDetails = {
          ...booking.workDoneDetails,
          items: extraItems.map(item => ({
            title: item.name || item.title,
            qty: Number(item.qty) || Number(item.quantity) || 1,
            price: Number(item.price) || 0
          }))
        };

        booking.extraCharges = extraItems.map(item => ({
          name: item.name || item.title,
          quantity: Number(item.qty) || Number(item.quantity) || 1,
          price: Number(item.price) || 0,
          total: (Number(item.qty) || Number(item.quantity) || 1) * (Number(item.price) || 0)
        }));

        booking.extraChargesTotal = booking.extraCharges.reduce((sum, item) => sum + item.total, 0);
        booking.markModified('workDoneDetails');
        booking.markModified('extraCharges');
      }

      // Fetch VendorBill (single source of truth for earnings)
      const bill = await VendorBill.findOne({ bookingId: booking._id }).session(session);

      let vendorEarning = 0;
      let grandTotal = collectionAmount;

      if (bill) {
        const isWorkerBookingLocal = booking.bookingModel === 'worker';
        vendorEarning = isWorkerBookingLocal ? Number(bill.grandTotal) : (Number(bill.vendorTotalEarning) || 0);
        grandTotal = Number(bill.grandTotal) || 0;

        // Sync booking fields from bill to ensure data consistency
        booking.basePrice = bill.originalServiceBase;
        booking.tax = bill.originalGST + bill.vendorServiceGST + bill.partsGST;
        booking.visitingCharges = bill.visitingCharges;
        booking.finalAmount = bill.grandTotal;
        booking.userPayableAmount = bill.grandTotal;

        // Mark bill as paid
        bill.status = 'paid';
        bill.paidAt = new Date();
        await bill.save({ session });
      } else {
        const isWorkerBookingLocal = booking.bookingModel === 'worker';
        const { vendorShare } = await getCommissionRates();
        vendorEarning = isWorkerBookingLocal ? collectionAmount : collectionAmount * vendorShare;
      }

      // Update Booking
      booking.finalAmount = collectionAmount;
      booking.userPayableAmount = collectionAmount;
      booking.cashCollected = true;
      booking.cashCollectedAt = new Date();
      booking.cashCollectedBy = userRole === 'vendor' ? 'vendor' : 'worker';
      booking.cashCollectorId = userId;

      if (booking.paymentMethod === 'plan_benefit') {
        booking.paymentStatus = PAYMENT_STATUS.SUCCESS;
      } else {
        booking.paymentStatus = PAYMENT_STATUS.COLLECTED_BY_VENDOR;
        booking.paymentMethod = 'cash collected'; // Standardized label
      }

      if (booking.status === 'work_done' || booking.status === 'visited' || booking.status === 'in_progress') {
        booking.status = 'completed';
        booking.completedAt = new Date();
      }

      // Clear OTPs on completion
      booking.paymentOtp = undefined;
      booking.customerConfirmationOTP = undefined;

      await booking.save({ session });

      // Update Wallet (Vendor or Worker)
      const vendorId = booking.vendorId;
      const workerId = booking.workerId;

      if (vendorId) {
        const vendor = await Vendor.findById(vendorId).session(session).lean();
        if (vendor) {
          const newDues = (vendor.wallet?.dues || 0) + grandTotal;
          const newEarnings = (vendor.wallet?.earnings || 0) + vendorEarning;
          // Platform settings decide (Master > Platform settings); the vendor's own
          // field is the fallback. See utils/cashLimit.js.
          const cashLimit = (await effectiveCashLimit(vendor)).limit;
          const netOwed = newDues - newEarnings;
          const isOverLimit = netOwed > cashLimit;

          const walletUpdate = {
            $inc: {
              'wallet.dues': grandTotal,
              'wallet.earnings': vendorEarning,
              'wallet.totalCashCollected': grandTotal
            }
          };

          if (isOverLimit) {
            walletUpdate.$set = {
              'wallet.isBlocked': true,
              'wallet.blockedAt': new Date(),
              'wallet.blockReason': `Cash limit exceeded. Net owed: ₹${netOwed.toFixed(2)}, Limit: ₹${cashLimit}`
            };
          }

          await Vendor.findByIdAndUpdate(vendorId, walletUpdate, { runValidators: false, session });

          // Ledger rows are NOT wrapped in try/catch any more: a swallowed failure
          // here used to leave the wallet credited with no matching ledger entry.
          // Letting it throw rolls the whole collection back.
          await Transaction.create([{
            vendorId,
            userId: booking.userId,
            bookingId: booking._id,
            amount: grandTotal,
            type: 'cash_collected',
            paymentMethod: 'cash collected',
            description: `Cash ₹${grandTotal} collected for booking ${booking.bookingNumber}`,
            status: 'completed',
            metadata: {
              type: 'dues_increase',
              collectedBy: userRole,
              billId: bill?._id?.toString(),
              vendorEarning,
              companyRevenue: bill?.companyRevenue
            }
          }], { session });

          // Record Transaction - Earnings Credit
          if (vendorEarning > 0) {
            await Transaction.create([{
              vendorId,
              bookingId: booking._id,
              amount: vendorEarning,
              type: 'earnings_credit',
              paymentMethod: 'system',
              description: `Earnings ₹${vendorEarning} credited for booking ${booking.bookingNumber}`,
              status: 'completed',
              metadata: {
                type: 'earnings_increase',
                billId: bill?._id?.toString(),
                serviceEarning: bill?.vendorServiceEarning,
                partsEarning: bill?.vendorPartsEarning
              }
            }], { session });
          }
        }
      } else if (workerId) {
        // Direct Worker Flow
        const worker = await Worker.findById(workerId).session(session).lean();
        if (worker) {
          // For cash collection: Worker gets the money in hand, so they owe Admin the difference (Total - Earning)
          const isWorkerBookingLocal = booking.bookingModel === 'worker';
          const workerEarning = isWorkerBookingLocal ? grandTotal : vendorEarning;
          const adminShare = isWorkerBookingLocal ? 0 : (grandTotal - workerEarning);

          // LOGIC:
          // 1. Worker collected CASH: They have their share (workerEarning) in hand.
          //    For worker bookings, dues remain 0 because they keep 100% of cash.
          //    Otherwise they owe Admin the commission.
          //    We do NOT increase 'balance' (withdrawable money) because they already have it.
          // 2. We still track 'earnings' for lifetime reporting.
          const walletUpdate = {
            $inc: {
              'wallet.totalCashCollected': grandTotal,
              'wallet.earnings': workerEarning,
              'wallet.dues': adminShare
            }
          };

          await Worker.findByIdAndUpdate(workerId, walletUpdate, { runValidators: false, session });

          // 1. Cash Collected (Increases Dues)
          await Transaction.create([{
            workerId,
            userId: booking.userId,
            bookingId: booking._id,
            amount: grandTotal,
            type: 'cash_collected',
            paymentMethod: 'cash collected',
            description: `Cash ₹${grandTotal} collected by worker for booking ${booking.bookingNumber}`,
            status: 'completed',
            metadata: { type: 'dues_increase', collectedBy: 'worker' }
          }], { session });

          // 2. Earnings Credit (Increases Balance)
          if (workerEarning > 0) {
            await Transaction.create([{
              workerId,
              bookingId: booking._id,
              amount: workerEarning,
              type: 'earnings_credit',
              paymentMethod: 'system',
              description: `Earnings ₹${workerEarning} credited for booking ${booking.bookingNumber}`,
              status: 'completed',
              metadata: { type: 'earnings_increase' }
            }], { session });
          }
        }
      }

      return { booking, bill, vendorEarning, collectionAmount, grandTotal };
    });

    if (outcome.notFound) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (outcome.badOtp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP. Please enter the correct code shared by the customer.' });
    }
    if (outcome.alreadyDone) {
      return res.status(200).json({
        success: true,
        message: 'Cash collection already confirmed',
        data: { bookingId: outcome.bookingId }
      });
    }

    const { booking, bill, vendorEarning, collectionAmount, grandTotal } = outcome;

    // Record stats in the Daily Earning Tracker (Async, post-commit)
    const isWorkerBooking = booking.bookingModel === 'worker';
    const trackerRates = await getCommissionRates();
    recordBookingEarning({
      date: new Date(),
      totalRevenue: bill ? bill.grandTotal : collectionAmount,
      platformCommission: isWorkerBooking ? 0 : (bill ? (bill.companyRevenue || 0) : (collectionAmount * trackerRates.platformShare)),
      vendorEarnings: isWorkerBooking ? (bill ? bill.vendorTotalEarning : collectionAmount) : (vendorEarning > 0 ? vendorEarning : (collectionAmount * trackerRates.vendorShare)),
      totalGST: bill ? (bill.totalGST || 0) : 0,
      totalTDS: 0 // Captured separately during withdrawal
    }).catch(err => console.error('[ConfirmCash] Daily tracker failed:', err));

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${booking.userId}`).emit('booking_updated', {
        bookingId: booking._id,
        status: booking.status,
        cashCollected: true,
        message: 'Payment recorded and booking completed!'
      });
    }

    const { createNotification } = require('../notificationControllers/notificationController');
    createNotification({
      userId: booking.userId,
      type: 'payment_received',
      title: 'Payment Received (Cash)',
      message: `Payment of ₹${grandTotal} received in cash. Job Completed. Thanks!`,
      relatedId: booking._id,
      relatedType: 'booking',
      priority: 'high'
    }).catch(err => console.error('[ConfirmCash] Notification failed:', err));

    res.status(200).json({
      success: true,
      message: 'Cash collection confirmed and recorded in ledger',
      data: {
        bookingId: booking._id,
        amount: grandTotal
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Customer Confirm Payment (Optional flow for user to confirm they paid)
 */
exports.customerConfirmPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    booking.customerConfirmed = true;
    await booking.save();

    res.status(200).json({ success: true, message: 'Payment confirmed by customer' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get Cash Collection Status
 */
/**
 * Verify Online Payment & Complete Job
 * POST /api/bookings/cash/:id/verify-online
 */
exports.verifyOnlinePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (!booking.razorpayQrId) {
      return res.status(400).json({ success: false, message: 'No online payment initiated for this booking' });
    }

    // Only allow if status is WORK_DONE or already COMPLETED (idempotency)
    if (booking.status !== BOOKING_STATUS.WORK_DONE && booking.status !== BOOKING_STATUS.COMPLETED) {
      return res.status(400).json({ success: false, message: `Cannot verify payment for booking in ${booking.status} status` });
    }

    const qrRes = await getQRCodePayments(booking.razorpayQrId);

    if (qrRes.success && qrRes.payments && qrRes.payments.length > 0) {
      const capturedPayment = qrRes.payments.find(p => p.status === 'captured');

      if (capturedPayment) {
        console.log(`[QR Verify] Finalizing booking ${booking.bookingNumber}`);

        const VendorBill = require('../../models/VendorBill');

        // Booking, bill, partner wallet and both ledger rows commit together.
        // The Razorpay QR poll above stays outside — external calls must not run
        // inside a transaction.
        const outcome = await withTransaction(async (session) => {
          // Re-read and claim inside the transaction: only the first verify credits
          // the wallet, and a retry gets a fresh document whose .save() still works.
          const bk = await Booking.findOne({
            _id: id,
            paymentStatus: { $ne: PAYMENT_STATUS.SUCCESS }
          }).session(session);

          if (!bk) abort({ alreadyProcessed: true });

          // Handle Earnings & Wallet
          const bill = await VendorBill.findOne({ bookingId: bk._id }).session(session);

          let vendorEarning = 0;
          if (bill) {
            const isWorkerBooking = bk.bookingModel === 'worker';
            vendorEarning = isWorkerBooking ? bill.grandTotal : bill.vendorTotalEarning;

            // Sync booking fields from bill to ensure data consistency
            bk.basePrice = bill.originalServiceBase;
            bk.tax = bill.originalGST + bill.vendorServiceGST + bill.partsGST;
            bk.visitingCharges = bill.visitingCharges;
            bk.finalAmount = bill.grandTotal;
            bk.userPayableAmount = bill.grandTotal;

            bill.status = 'paid';
            bill.paidAt = new Date();
            await bill.save({ session });
          } else {
            const isWorkerBooking = bk.bookingModel === 'worker';
            const { vendorShare } = await getCommissionRates();
            vendorEarning = isWorkerBooking ? bk.finalAmount : bk.finalAmount * vendorShare;
          }

          // Update Booking. This save now happens AFTER the bill sync above —
          // previously it ran first, so every field copied from the bill
          // (finalAmount, tax, visitingCharges...) was silently discarded.
          bk.paymentStatus = PAYMENT_STATUS.SUCCESS;
          bk.paymentMethod = 'Qr online';
          bk.cashCollected = false; // Ensure it's not counted as cash
          bk.razorpayPaymentId = capturedPayment.id;
          bk.paymentId = capturedPayment.id;

          if (bk.status !== BOOKING_STATUS.COMPLETED) {
            bk.status = BOOKING_STATUS.COMPLETED;
            bk.completedAt = new Date();
          }

          // Clear OTPs on completion
          bk.paymentOtp = undefined;
          bk.customerConfirmationOTP = undefined;

          await bk.save({ session });

          const vendorId = bk.vendorId;
          const workerId = bk.workerId;

          if (vendorId) {
            await Vendor.findByIdAndUpdate(vendorId, {
              $inc: { 'wallet.earnings': vendorEarning }
            }, { session });
          } else if (workerId) {
            await Worker.findByIdAndUpdate(workerId, {
              $inc: {
                'wallet.earnings': vendorEarning,
                'wallet.balance': vendorEarning
              }
            }, { session });
          }

          // Transactions
          await Transaction.create([{
            userId: bk.userId,
            bookingId: bk._id,
            amount: bk.finalAmount,
            type: 'payment',
            paymentMethod: 'Qr online',
            status: 'completed',
            description: `Online QR payment for booking #${bk.bookingNumber}`,
            referenceId: capturedPayment.id,
            metadata: {
              source: 'vendor_qr',
              razorpayPaymentId: capturedPayment.id
            }
          }], { session });

          if (vendorEarning > 0) {
            await Transaction.create([{
              vendorId: bk.vendorId || undefined,
              workerId: !bk.vendorId ? bk.workerId : undefined,
              bookingId: bk._id,
              amount: vendorEarning,
              type: 'earnings_credit',
              paymentMethod: 'system',
              status: 'completed',
              description: `Earnings credited for online booking #${bk.bookingNumber}`,
              metadata: {
                type: 'online_earning',
                billId: bill?._id?.toString()
              }
            }], { session });
          }

          return { booking: bk, bill, vendorEarning };
        });

        if (outcome.alreadyProcessed) {
          return res.status(200).json({
            success: true,
            message: 'Payment already verified',
            status: 'completed'
          });
        }

        const { booking: bk, bill, vendorEarning } = outcome;

        // 4. Record Stats (Async, post-commit)
        const trackerRates = await getCommissionRates();
        recordBookingEarning({
          date: new Date(),
          totalRevenue: Number(bill ? bill.grandTotal : bk.finalAmount) || 0,
          platformCommission: Number(bill ? bill.companyRevenue : (bk.bookingModel === 'worker' ? 0 : bk.finalAmount * trackerRates.platformShare)) || 0,
          vendorEarnings: Number(vendorEarning) || 0,
          totalGST: Number(bill ? bill.totalGST : 0) || 0,
          totalTDS: 0
        }).catch(err => console.error('[ConfirmCash] Daily tracker failed:', err));

        // 5. Notify & Socket
        const io = req.app.get('io');
        if (io) {
          io.to(`user_${bk.userId}`).emit('booking_updated', {
            bookingId: bk._id,
            status: 'completed',
            paymentStatus: 'success'
          });
          io.to(`vendor_${bk.vendorId}`).emit('booking_updated', {
            bookingId: bk._id,
            status: 'completed'
          });
        }

        // Push Notifications
        const { createNotification } = require('../notificationControllers/notificationController');
        // Notify User
        await createNotification({
          userId: bk.userId,
          type: 'payment_received',
          title: 'Payment Successful!',
          message: `Payment of ₹${bk.finalAmount} received via Online QR. Job Completed. Thank you!`,
          relatedId: bk._id,
          relatedType: 'booking',
          priority: 'high',
          pushData: { type: 'payment_success', bookingId: bk._id.toString() }
        });

        // Notify Worker/Vendor
        await createNotification({
          vendorId: bk.vendorId || undefined,
          workerId: !bk.vendorId ? bk.workerId : undefined,
          type: 'earnings_credited',
          title: 'Payment Received!',
          message: `You have received ₹${vendorEarning} for booking #${bk.bookingNumber}.`,
          relatedId: bk._id,
          relatedType: 'booking',
          priority: 'high',
          pushData: { type: 'payment_received', bookingId: bk._id.toString() }
        });

        return res.status(200).json({
          success: true,
          message: 'Payment verified and job completed',
          status: 'completed'
        });
      }
    }

    return res.status(200).json({
      success: false,
      message: 'Payment not yet detected by Razorpay',
      paymentStatus: 'pending'
    });

  } catch (error) {
    console.error('Verify online payment error:', error);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
};

/**
 * Manually Confirm Online Payment (For Manual QR Fallback)
 * POST /api/bookings/cash/:id/confirm-manual-online
 */
exports.confirmManualOnlinePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { otp } = req.body;
    const userId = req.user._id;
    const userRole = req.user.role;

    const VendorBill = require('../../models/VendorBill');

    // Booking + bill + partner wallet + both ledger rows commit as one unit.
    const outcome = await withTransaction(async (session) => {
      // Claim on status inside the transaction: this both replaces the old
      // read-then-check race guard and gives a fresh doc on retry.
      const booking = await Booking.findById(id).session(session);

      if (!booking) abort({ notFound: true });

      // OTP Verification (Mandatory for manual confirmation to prevent accidents)
      // Mandatory, and required even if none was issued: nothing else in this path proves
      // any money was collected, yet it completes the booking and credits the partner.
      // `&& otp &&` used to skip the check entirely when otp was left out.
      if (!booking.customerConfirmationOTP || booking.customerConfirmationOTP !== otp) {
        if (process.env.NODE_ENV !== 'development' || otp !== '0000') {
          abort({ badOtp: true });
        }
      }

      const claim = await Booking.updateOne(
        { _id: booking._id, status: { $ne: BOOKING_STATUS.COMPLETED } },
        { $set: { status: BOOKING_STATUS.COMPLETED } },
        { session }
      );
      if (claim.modifiedCount === 0) abort({ alreadyCompleted: true });

      console.log(`[Manual QR Confirm] Finalizing booking ${booking.bookingNumber} manually`);

      // Handle Earnings & Wallet (Reuse logic)
      const bill = await VendorBill.findOne({ bookingId: booking._id }).session(session);

      let vendorEarning = 0;
      if (bill) {
        const isWorkerBooking = booking.bookingModel === 'worker';
        vendorEarning = isWorkerBooking ? bill.grandTotal : bill.vendorTotalEarning;

        // Sync booking fields from bill to ensure data consistency
        booking.basePrice = bill.originalServiceBase;
        booking.tax = bill.originalGST + bill.vendorServiceGST + bill.partsGST;
        booking.visitingCharges = bill.visitingCharges;
        booking.finalAmount = bill.grandTotal;
        booking.userPayableAmount = bill.grandTotal;

        bill.status = 'paid';
        bill.paidAt = new Date();
        await bill.save({ session });
      } else {
        const isWorkerBooking = booking.bookingModel === 'worker';
        const { vendorShare } = await getCommissionRates();
        vendorEarning = isWorkerBooking ? booking.finalAmount : booking.finalAmount * vendorShare;
      }

      // Update Booking. Saved AFTER the bill sync so the copied amounts persist —
      // the previous order saved first and threw those fields away.
      booking.paymentStatus = PAYMENT_STATUS.SUCCESS;
      booking.paymentMethod = 'Qr online';
      booking.cashCollected = false;
      booking.paymentId = `manual_conf_${Date.now()}`;
      booking.status = BOOKING_STATUS.COMPLETED;
      booking.completedAt = new Date();
      await booking.save({ session });

      // Handle Earnings & Wallet (Vendor or Worker)
      const vendorId = booking.vendorId;
      const workerId = booking.workerId;

      if (vendorId) {
        await Vendor.findByIdAndUpdate(vendorId, {
          $inc: { 'wallet.earnings': vendorEarning }
        }, { session });
      } else if (workerId) {
        await Worker.findByIdAndUpdate(workerId, {
          $inc: {
            'wallet.earnings': vendorEarning,
            'wallet.balance': vendorEarning
          }
        }, { session });
      }

      // Transactions
      await Transaction.create([{
        userId: booking.userId,
        bookingId: booking._id,
        amount: booking.finalAmount,
        type: 'payment',
        paymentMethod: 'Qr online',
        status: 'completed',
        description: `Manual confirmation of UPI QR payment for booking #${booking.bookingNumber}`,
        referenceId: booking.paymentId,
        metadata: { source: 'manual_vendor_confirm' }
      }], { session });

      if (vendorEarning > 0) {
        await Transaction.create([{
          vendorId: booking.vendorId,
          bookingId: booking._id,
          amount: vendorEarning,
          type: 'earnings_credit',
          paymentMethod: 'system',
          status: 'completed',
          description: `Earnings credited for manual online booking #${booking.bookingNumber}`,
          metadata: { type: 'online_earning', billId: bill?._id?.toString() }
        }], { session });
      }

      return { booking, bill, vendorEarning };
    });

    if (outcome.notFound) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (outcome.badOtp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP. Please enter the code sent to the customer.' });
    }
    if (outcome.alreadyCompleted) {
      return res.status(400).json({ success: false, message: 'Booking already completed' });
    }

    const { booking, bill, vendorEarning } = outcome;

    // 4. Record Stats (Async)
    const manualTrackerRates = await getCommissionRates();
    recordBookingEarning({
      date: new Date(),
      totalRevenue: Number(bill ? bill.grandTotal : booking.finalAmount) || 0,
      platformCommission: Number(bill ? bill.companyRevenue : (booking.bookingModel === 'worker' ? 0 : booking.finalAmount * manualTrackerRates.platformShare)) || 0,
      vendorEarnings: Number(vendorEarning) || 0,
      totalGST: Number(bill ? bill.totalGST : 0) || 0,
      totalTDS: 0
    }).catch(err => console.error('[ConfirmManual] Daily tracker failed:', err));

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${booking.userId}`).emit('booking_updated', {
        bookingId: booking._id,
        status: 'completed',
        paymentStatus: 'success'
      });
      io.to(`vendor_${booking.vendorId}`).emit('booking_updated', {
        bookingId: booking._id,
        status: 'completed',
        paymentMethod: 'online'
      });
    }

    // Push Notifications
    const { createNotification } = require('../notificationControllers/notificationController');
    // Notify User
    await createNotification({
      userId: booking.userId,
      type: 'payment_received',
      title: 'Payment Confirmed!',
      message: `Manual online payment of ₹${booking.finalAmount} confirmed. Job Completed.`,
      relatedId: booking._id,
      relatedType: 'booking',
      priority: 'high'
    });

    // Notify Worker/Vendor
    await createNotification({
      vendorId: booking.vendorId || undefined,
      workerId: !booking.vendorId ? booking.workerId : undefined,
      type: 'earnings_credited',
      title: 'Payment Confirmed!',
      message: `Manual online payment for booking #${booking.bookingNumber} has been recorded.`,
      relatedId: booking._id,
      relatedType: 'booking',
      priority: 'high'
    });

    return res.status(200).json({
      success: true,
      message: 'Payment confirmed manually and job completed',
      status: 'completed'
    });

  } catch (error) {
    console.error('Confirm manual online payment error:', error);
    res.status(500).json({ success: false, message: 'Manual confirmation failed' });
  }
};

/**
 * Get Cash / Payment Status
 * Read-only check for UI
 */
exports.getCashCollectionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const statusData = {
      bookingId: booking._id,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      paymentMethod: booking.paymentMethod,
      cashCollected: booking.cashCollected || false,
      isPaid: booking.paymentStatus === PAYMENT_STATUS.SUCCESS
    };

    if (booking.razorpayQrId && booking.paymentStatus === PAYMENT_STATUS.PENDING) {
      const qrRes = await getQRCodePayments(booking.razorpayQrId);
      if (qrRes.success && qrRes.payments && qrRes.payments.length > 0) {
        const captured = qrRes.payments.find(p => p.status === 'captured');
        if (captured) {
          statusData.paymentDetected = true;
          statusData.paymentId = captured.id;
        }
      }
    }

    res.status(200).json({
      success: true,
      data: statusData
    });

  } catch (error) {
    console.error('Get status error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch status' });
  }
};
