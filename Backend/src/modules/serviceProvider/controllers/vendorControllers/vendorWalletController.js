const Vendor = require('../../models/Vendor');
const Transaction = require('../../models/Transaction');
const Settlement = require('../../models/Settlement');
const Withdrawal = require('../../models/Withdrawal');
const Booking = require('../../models/Booking');
const Worker = require('../../models/Worker');
const { uploadPaymentScreenshot } = require('../../utils/cloudinaryUpload');
const { withTransaction, abort } = require('../../utils/withTransaction');
const { effectiveCashLimit } = require('../../utils/cashLimit');

/**
 * Get vendor wallet with ledger balance
 * Get vendor wallet with ledger details
 * dues = Amount owed to admin
 * earnings = Amount admin owes vendor
 */
const getWallet = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const vendor = await Vendor.findById(vendorId).select('wallet name businessName');

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    const dues = vendor.wallet?.dues || 0;
    const earnings = vendor.wallet?.earnings || 0;
    const totalWithdrawn = vendor.wallet?.totalWithdrawn || 0;

    // Get pending settlements count
    const pendingSettlements = await Settlement.countDocuments({
      vendorId,
      status: 'pending'
    });

    // Get total cash collected (sum of all cash_collected transactions)
    const cashCollectedResult = await Transaction.aggregate([
      {
        $match: {
          vendorId: vendor._id,
          type: 'cash_collected',
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);

    // Get total settled amount
    const settledResult = await Transaction.aggregate([
      {
        $match: {
          vendorId: vendor._id,
          type: 'settlement',
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);

    const totalCashCollected = cashCollectedResult[0]?.total || 0;
    const totalSettled = settledResult[0]?.total || 0;

    res.status(200).json({
      success: true,
      data: {
        dues,
        earnings,
        amountDue: dues, // Clarification for frontend but 'dues' is self-explanatory
        balance: earnings - dues, // Net position for reference (optional)
        totalWithdrawn,
        totalCashCollected,
        totalSettled,
        pendingSettlements,
        cashLimit: (await effectiveCashLimit(vendor)).display,
        vendor: {
          name: vendor.name,
          businessName: vendor.businessName
        }
      }
    });
  } catch (error) {
    console.error('Get vendor wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wallet'
    });
  }
};

/**
 * Get vendor transactions/ledger
 */
const getTransactions = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { page = 1, limit = 20, type, status } = req.query;

    const query = { vendorId };
    if (type) query.type = type;
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('bookingId', 'bookingNumber serviceName scheduledDate');

    const total = await Transaction.countDocuments(query);

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
    console.error('Get vendor transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions'
    });
  }
};

/**
 * RETIRED: POST /vendor/wallet/cash-collection.
 *
 * Cash collection is recorded by collectSelfCash (POST /vendor/bookings/:id/self/
 * payment/collect), which verifies the customer's OTP, requires the work to be done,
 * takes the amount from the VendorBill and commits booking, bill, wallet and rows in
 * one transaction. Nothing in the frontend calls this endpoint and the production
 * API log shows no calls, but it was reachable, and it was unsafe:
 *
 *  - earnings were credited the bill's full vendorTotalEarning while dues rose by
 *    the CLIENT-supplied amount, with no status guard and no idempotency. Called
 *    repeatedly with amount 1, it grew what the platform owed the vendor without
 *    limit -- money the vendor could then withdraw.
 *  - it $inc'd the wallet and then saved paymentStatus 'collected by vendor', not
 *    in the enum, so every call threw AFTER the money moved, with no transaction
 *    row written, and a retry added it all again.
 *
 * Kept as a route answering 410 so an old client gets a clear answer, not a 404.
 */
const recordCashCollection = async (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'This endpoint has been retired. Record cash collection with POST /vendor/bookings/:id/self/payment/collect.',
  });
};

/**
 * Request settlement (vendor pays admin to clear negative balance)
 */
const requestSettlement = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { amount, paymentMethod, paymentReference, paymentProof, notes } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    const currentDues = vendor.wallet?.dues || 0;

    if (amount > currentDues) {
      return res.status(400).json({
        success: false,
        message: `Settlement amount (₹${amount}) cannot exceed current dues (₹${currentDues})`
      });
    }

    // Check for existing pending settlement
    const existingPending = await Settlement.findOne({
      vendorId,
      status: 'pending'
    });

    if (existingPending) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending settlement request. Please wait for it to be processed.'
      });
    }

    // Create settlement request
    const settlement = await Settlement.create({
      vendorId,
      amount,
      balanceBefore: currentDues,
      balanceAfter: currentDues - amount, // Dues will decrease
      paymentMethod: paymentMethod || 'upi',
      paymentReference,
      paymentProof,
      vendorNotes: notes,
      status: 'pending'
    });

    // 🔔 NOTIFY ALL ADMINS about settlement request
    try {
      const { createNotification } = require('../notificationControllers/notificationController');
      const Admin = require('../../models/Admin');

      const admins = await Admin.find({ isActive: true }).select('_id');

      for (const admin of admins) {
        await createNotification({
          adminId: admin._id,
          type: 'vendor_settlement_request',
          title: '💰 Settlement Request',
          message: `${vendor.businessName || vendor.name} submitted settlement of ₹${amount}`,
          relatedId: settlement._id,
          relatedType: 'settlement',
          data: {
            vendorId: vendor._id,
            vendorName: vendor.businessName || vendor.name,
            amount,
            settlementId: settlement._id
          },
          pushData: {
            type: 'admin_alert',
            link: '/admin/settlements'
          }
        });
      }
      console.log(`[Settlement] Notified ${admins.length} admins about settlement request from ${vendor.name}`);
    } catch (notifyErr) {
      console.error('[Settlement] Failed to notify admins:', notifyErr);
    }

    res.status(200).json({
      success: true,
      message: 'Settlement request submitted successfully. Pending admin approval.',
      data: settlement
    });
  } catch (error) {
    console.error('Request settlement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit settlement request'
    });
  }
};

/**
 * Request Withdrawal (Vendor requests payout of earnings)
 */
const requestWithdrawal = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { bankDetails, notes } = req.body;
    const amount = Number(req.body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }

    // Reading the pending total and inserting the new request inside one
    // transaction is what makes "requested <= available" actually hold; the
    // previous insert-then-verify could only detect a conflict after the fact.
    const outcome = await withTransaction(async (session) => {
      const vendor = await Vendor.findById(vendorId).session(session);
      if (!vendor) abort({ notFound: true });

      const currentEarnings = vendor.wallet?.earnings || 0;

      const pendingWithdrawals = await Withdrawal.aggregate([
        { $match: { vendorId: vendor._id, status: 'pending' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]).session(session);

      const pendingAmount = pendingWithdrawals[0]?.total || 0;
      const availableEarnings = currentEarnings - pendingAmount;

      if (amount > availableEarnings) {
        abort({ insufficient: true, availableEarnings, pendingAmount });
      }

      const [created] = await Withdrawal.create([{
        vendorId,
        amount,
        bankDetails,
        adminNotes: notes,
        status: 'pending'
      }], { session });

      return { withdrawal: created, vendor };
    });

    if (outcome.notFound) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    if (outcome.insufficient) {
      return res.status(400).json({
        success: false,
        message: `Insufficient earnings. Available: ₹${outcome.availableEarnings} (Pending: ₹${outcome.pendingAmount})`
      });
    }

    const { withdrawal, vendor } = outcome;

    // 🔔 NOTIFY ALL ADMINS about withdrawal request
    try {
      const { createNotification } = require('../notificationControllers/notificationController');
      const Admin = require('../../models/Admin');

      const admins = await Admin.find({ isActive: true }).select('_id');

      for (const admin of admins) {
        await createNotification({
          adminId: admin._id,
          type: 'vendor_withdrawal_request',
          title: '💸 Withdrawal Request',
          message: `${vendor.businessName || vendor.name} requested withdrawal of ₹${amount}`,
          relatedId: withdrawal._id,
          relatedType: 'withdrawal',
          data: {
            vendorId: vendor._id,
            vendorName: vendor.businessName || vendor.name,
            amount,
            withdrawalId: withdrawal._id
          },
          pushData: {
            type: 'admin_alert',
            link: '/admin/settlements'
          }
        });
      }
      console.log(`[Withdrawal] Notified ${admins.length} admins about withdrawal request from ${vendor.name}`);
    } catch (notifyErr) {
      console.error('[Withdrawal] Failed to notify admins:', notifyErr);
    }

    res.status(200).json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      data: withdrawal
    });

  } catch (error) {
    console.error('Request withdrawal error:', error);
    res.status(500).json({ success: false, message: 'Failed to request withdrawal' });
  }
};

/**
 * Get vendor's settlement history
 */
const getSettlements = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { page = 1, limit = 20, status } = req.query;

    const query = { vendorId };
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const settlements = await Settlement.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Settlement.countDocuments(query);

    res.status(200).json({
      success: true,
      data: settlements,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get settlements error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settlements'
    });
  }
};

/**
 * Get wallet summary for dashboard
 */
const getWalletSummary = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const vendor = await Vendor.findById(vendorId).select('wallet');

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    const balance = vendor.wallet?.balance || 0;

    // Get today's cash collections
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCollections = await Transaction.aggregate([
      {
        $match: {
          vendorId: vendor._id,
          type: 'cash_collected',
          createdAt: { $gte: today }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get this week's collections
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);

    const weekCollections = await Transaction.aggregate([
      {
        $match: {
          vendorId: vendor._id,
          type: 'cash_collected',
          createdAt: { $gte: weekStart }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        dues: vendor.wallet?.dues || 0,
        earnings: vendor.wallet?.earnings || 0,
        amountDue: vendor.wallet?.dues || 0,
        today: {
          amount: todayCollections[0]?.total || 0,
          count: todayCollections[0]?.count || 0
        },
        thisWeek: {
          amount: weekCollections[0]?.total || 0,
          count: weekCollections[0]?.count || 0
        }
      }
    });
  } catch (error) {
    console.error('Get wallet summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wallet summary'
    });
  }
};

/**
 * Pay worker for a booking
 */
const payWorker = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { bookingId, amount, notes, transactionId, screenshot, paymentMethod = 'cash' } = req.body;

    if (!bookingId || !amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid booking ID and amount are required'
      });
    }

    const booking = await Booking.findOne({ _id: bookingId, vendorId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not authorized'
      });
    }

    if (!booking.workerId) {
      return res.status(400).json({
        success: false,
        message: 'No worker assigned to this booking'
      });
    }

    if (booking.workerPaymentStatus === 'PAID') {
      return res.status(400).json({
        success: false,
        message: 'Worker already paid for this booking'
      });
    }

    const worker = await Worker.findById(booking.workerId);
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found'
      });
    }

    // Upload screenshot to Cloudinary if provided
    let screenshotUrl = null;
    if (screenshot) {
      try {
        // Check if screenshot is base64
        if (screenshot.startsWith('data:image')) {
          screenshotUrl = await uploadPaymentScreenshot(screenshot, bookingId);
          console.log('Payment screenshot uploaded to Cloudinary:', screenshotUrl);
        } else {
          // If already a URL, use it as is
          screenshotUrl = screenshot;
        }
      } catch (uploadError) {
        console.error('Failed to upload payment screenshot:', uploadError);
        // Continue without screenshot rather than failing the entire payment
        screenshotUrl = null;
      }
    }

    /*
     * The vendor paid the worker DIRECTLY -- cash or UPI, with a screenshot as proof.
     * This records that; it does not move platform money.
     *
     * It used to also do `worker.wallet.balance += amount`. wallet.balance is what a
     * worker WITHDRAWS from the platform (approveWithdrawal pays out of it), so every
     * recorded payment let the worker be paid the same money a second time, by the
     * platform, while the vendor's own wallet was never debited.
     *
     * And the three writes ran as Promise.all with no transaction: a paymentMethod
     * outside the Transaction enum (e.g. 'upi', unvalidated) failed the row while the
     * worker and booking saves went through; and the "already paid" check was a
     * read, so a double-submit recorded it twice.
     */
    const amountPaid = parseFloat(amount);
    const ROW_METHODS = ['cash', 'bank_transfer', 'online', 'other'];
    const outcome = await withTransaction(async (session) => {
      const claimed = await Booking.findOneAndUpdate(
        { _id: booking._id, vendorId, workerId: { $ne: null }, workerPaymentStatus: { $ne: 'PAID' } },
        [
          {
            $set: {
              workerPaymentStatus: 'PAID',
              isWorkerPaid: true,
              workerPaidAt: '$$NOW',
              status: 'completed', // Job is fully done and paid
              completedAt: { $ifNull: ['$completedAt', '$$NOW'] }
            }
          }
        ],
        { new: true, session }
      );
      if (!claimed) abort({ alreadyPaid: true });

      const [row] = await Transaction.create([{
        vendorId,
        workerId: worker._id,
        bookingId: booking._id,
        type: 'worker_payment',
        amount: amountPaid,
        status: 'completed',
        paymentMethod: ROW_METHODS.includes(paymentMethod) ? paymentMethod : 'other',
        description: `Payment for booking #${booking.bookingNumber}. ${notes || ''}`,
        referenceId: transactionId || null,
        metadata: {
          notes,
          transactionId,
          screenshot: screenshotUrl, // Store Cloudinary URL instead of base64
          paymentMethod,
          // Paid vendor -> worker outside the platform; no platform wallet moved.
          movesWallet: false
        }
      }], { session });

      return { transaction: row };
    });

    if (outcome.alreadyPaid) {
      return res.status(400).json({
        success: false,
        message: 'Worker already paid for this booking'
      });
    }

    // Notify worker about payment
    const { createNotification } = require('../notificationControllers/notificationController');
    await createNotification({
      workerId: worker._id,
      type: 'payment_received',
      title: '💰 Payment Received',
      message: `You received ₹${amount.toLocaleString()} from ${booking.vendorId?.businessName || 'vendor'} for booking #${booking.bookingNumber}`,
      relatedId: booking._id,
      relatedType: 'booking',
      priority: 'high',
      pushData: {
        type: 'payment_received',
        bookingId: booking._id.toString(),
        amount: parseFloat(amount),
        link: `/worker/wallet`
      }
    });

    res.status(200).json({
      success: true,
      message: `Payment of ₹${amount} recorded for ${worker.name}`,
      data: {
        bookingId: booking._id,
        workerName: worker.name,
        amount: parseFloat(amount),
        screenshotUploaded: !!screenshotUrl
      }
    });
  } catch (error) {
    console.error('Pay worker error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record payment'
    });
  }
};

/**
 * Get vendor's withdrawal history
 */
const getWithdrawals = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { page = 1, limit = 20, status } = req.query;

    const query = { vendorId };
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const withdrawals = await Withdrawal.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Withdrawal.countDocuments(query);

    res.status(200).json({
      success: true,
      data: withdrawals,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get withdrawals error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch withdrawals'
    });
  }
};

module.exports = {
  getWallet,
  getTransactions,
  recordCashCollection,
  requestSettlement,
  getSettlements,
  getWalletSummary,
  payWorker,
  requestWithdrawal,
  getWithdrawals
};
