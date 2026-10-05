const Vendor = require('../../models/Vendor');
const Worker = require('../../models/Worker');
const Transaction = require('../../models/Transaction');
const Settlement = require('../../models/Settlement');
const Withdrawal = require('../../models/Withdrawal');
const mongoose = require('mongoose');
const { recordSettlement, recordWithdrawal } = require('../../services/earningTrackerService');
const { withTransaction, abort } = require('../../utils/withTransaction');
const { effectiveCashLimit, effectiveCashLimits, recordCashLimit } = require('../../utils/cashLimit');

/**
 * Get all vendors with their wallet balances
 */
const getVendorBalances = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, filterDue, model } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const TargetModel = model === 'worker' ? Worker : Vendor;

    let matchQuery = { approvalStatus: 'approved' };
    if (search) {
      matchQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
      if (model !== 'worker') {
        matchQuery.$or.push({ businessName: { $regex: search, $options: 'i' } });
      }
    }

    // If filtering by vendors/workers who owe money
    if (filterDue === 'true') {
      matchQuery['wallet.dues'] = { $gt: 0 };
    }

    const selectFields = model === 'worker' 
      ? 'name phone email wallet profilePhoto'
      : 'name businessName phone email wallet profilePhoto';

    const vendors = await TargetModel.find(matchQuery)
      .select(selectFields)
      .sort({ 'wallet.dues': -1 }) // Highest dues first
      .skip(skip)
      .limit(parseInt(limit));

    const total = await TargetModel.countDocuments(matchQuery);

    // Calculate total amount due to admin
    const totalDueResult = await TargetModel.aggregate([
      { $match: { 'wallet.dues': { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$wallet.dues' } } }
    ]);

    const totalDueToAdmin = Math.abs(totalDueResult[0]?.total || 0);

    // Format data
    // One settings read for the whole page, not one per vendor.
    const limits = await effectiveCashLimits(vendors);
    const vendorData = vendors.map(v => ({
      _id: v._id,
      name: v.name,
      businessName: v.businessName || v.name,
      phone: v.phone,
      email: v.email,
      profilePhoto: v.profilePhoto,
      dues: v.wallet?.dues || 0,
      earnings: v.wallet?.earnings || 0,
      amountDue: v.wallet?.dues || 0,
      balance: (v.wallet?.earnings || 0) - (v.wallet?.dues || 0), // Net for reference
      totalCashCollected: v.wallet?.totalCashCollected || 0,
      cashLimit: limits.get(String(v._id))?.display ?? (v.wallet?.cashLimit || 10000),
      isBlocked: v.wallet?.isBlocked || false
    }));

    res.status(200).json({
      success: true,
      data: vendorData,
      summary: {
        totalDueToAdmin,
        vendorsWithDue: await TargetModel.countDocuments({ 'wallet.dues': { $gt: 0 } })
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get balances error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch balances'
    });
  }
};

/**
 * Get specific vendor's ledger/transactions
 */
const getVendorLedger = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { page = 1, limit = 50, type } = req.query;

    const vendor = await Vendor.findById(vendorId)
      .select('name businessName phone wallet');

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    const query = { vendorId: new mongoose.Types.ObjectId(vendorId) };
    if (type) query.type = type;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('bookingId', 'bookingNumber serviceName');

    const total = await Transaction.countDocuments(query);

    res.status(200).json({
      success: true,
      vendor: {
        _id: vendor._id,
        name: vendor.name,
        businessName: vendor.businessName,
        phone: vendor.phone,
        phone: vendor.phone,
        dues: vendor.wallet?.dues || 0,
        earnings: vendor.wallet?.earnings || 0,
        amountDue: vendor.wallet?.dues || 0
      },
      data: transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get vendor ledger error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor ledger'
    });
  }
};

/**
 * Get all pending settlement requests
 */
const getPendingSettlements = async (req, res) => {
  try {
    const { page = 1, limit = 20, model } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = { status: 'pending' };
    if (model === 'worker') {
      query.workerId = { $exists: true };
    } else {
      // By default or explicit vendor model, show vendor settlements
      // Handle legacy where workerId might not exist on older records
      query.$or = [{ vendorId: { $exists: true, $ne: null } }];
    }

    const settlements = await Settlement.find(query)
      .populate('vendorId', 'name businessName phone profilePhoto wallet.balance')
      .populate('workerId', 'name phone profilePhoto wallet.balance')
      .sort({ createdAt: 1 }) // Oldest first
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Settlement.countDocuments(query);

    // Calculate total pending settlement amount
    const totalPending = await Settlement.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    res.status(200).json({
      success: true,
      data: settlements,
      summary: {
        totalPendingAmount: totalPending[0]?.total || 0,
        pendingCount: total
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get pending settlements error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending settlements'
    });
  }
};

/**
 * Approve settlement request
 */
const approveSettlement = async (req, res) => {
  try {
    const { settlementId } = req.params;
    const { adminNotes } = req.body;
    const adminId = req.user.id;

    /*
     * Rewritten on the pattern approveWithdrawal below already uses. The previous
     * version had three faults, all live:
     *
     *  - It ended on `newDues: vendor.wallet.dues`, and `vendor` was never defined.
     *    Every approval reduced the dues, saved the settlement, and THEN threw --
     *    so the admin was shown "Failed to approve settlement" for every one that
     *    had in fact gone through.
     *  - It checked status by reading, then saved. Two approvals at once (a
     *    double-click, two admins) both read 'pending' and both reduced the dues.
     *  - It wrote dues as an absolute value computed from that read, so a cash
     *    collection $inc landing in between was silently overwritten.
     *
     * Now: the settlement is claimed atomically on 'pending', the dues move by a
     * server-side pipeline (clamped at zero, as before), and the movement is
     * recorded as a 'settlement' transaction row -- the type the worker dues-payment
     * flow already writes -- all in one transaction.
     */
    const outcome = await withTransaction(async (session) => {
      const settlement = await Settlement.findOneAndUpdate(
        { _id: settlementId, status: 'pending' },
        {
          $set: {
            status: 'approved',
            processedBy: adminId,
            processedAt: new Date(),
            adminNotes
          }
        },
        { new: true, session }
      );
      if (!settlement) {
        const exists = await Settlement.exists({ _id: settlementId }).session(session);
        abort(exists ? { notPending: true } : { notFound: true });
      }

      const isWorker = !!settlement.workerId;
      const targetId = isWorker ? settlement.workerId : settlement.vendorId;
      const TargetModel = isWorker ? Worker : Vendor;
      const amount = Number(settlement.amount) || 0;

      const before = await TargetModel.findById(targetId).select('wallet.dues wallet.cashLimit').session(session).lean();
      // The effective limit (Platform settings, else the partner's own field), as a number
      // the pipeline below can compare with.
      const unblockAt = before ? (await effectiveCashLimit({ _id: targetId, wallet: before.wallet })).limit : 0;
      if (!before) abort({ providerMissing: true });

      const userRecord = await TargetModel.findOneAndUpdate(
        { _id: targetId },
        [
          { $set: { 'wallet.dues': { $max: [0, { $subtract: [{ $ifNull: ['$wallet.dues', 0] }, amount] }] } } },
          {
            // Auto-unblock once dues are back within the limit -- the same rule as
            // before, now judged on the real post-update figure.
            $set: {
              'wallet.isBlocked': {
                $cond: [
                  { $and: ['$wallet.isBlocked', { $lte: ['$wallet.dues', unblockAt] }] },
                  false,
                  '$wallet.isBlocked'
                ]
              }
            }
          },
          ...(isWorker ? [] : [{ $set: { 'wallet.totalSettled': { $add: [{ $ifNull: ['$wallet.totalSettled', 0] }, amount] } } }])
        ],
        { new: true, session }
      );

      const duesBefore = Number(before.wallet?.dues) || 0;
      const duesAfter = Number(userRecord.wallet?.dues) || 0;
      if (!userRecord.wallet.isBlocked) {
        await TargetModel.updateOne(
          { _id: targetId, 'wallet.blockedAt': { $ne: null } },
          { $set: { 'wallet.blockedAt': null, 'wallet.blockReason': null } },
          { session }
        );
      }

      settlement.balanceAfter = duesAfter;
      await Settlement.updateOne({ _id: settlement._id }, { $set: { balanceAfter: duesAfter } }, { session });

      await Transaction.create([{
        [isWorker ? 'workerId' : 'vendorId']: targetId,
        type: 'settlement',
        amount,
        status: 'completed',
        paymentMethod: ['bank_transfer', 'cash'].includes(settlement.paymentMethod) ? settlement.paymentMethod : 'other',
        description: `Dues settlement approved. ₹${amount} applied against dues.`,
        referenceId: settlement.paymentReference || null,
        balanceBefore: duesBefore,
        balanceAfter: duesAfter,
        metadata: {
          settlementId: settlement._id,
          balanceField: 'wallet.dues',
          // What actually came off: less than amount when dues were already lower.
          appliedToDues: Math.round((duesBefore - duesAfter) * 100) / 100,
          processedBy: adminId
        }
      }], { session });

      return { settlement, userRecord, amount, duesAfter };
    });

    if (outcome?.notFound) {
      return res.status(404).json({ success: false, message: 'Settlement not found' });
    }
    if (outcome?.notPending) {
      return res.status(400).json({ success: false, message: 'Settlement is not in pending status' });
    }
    if (outcome?.providerMissing) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    const { settlement, userRecord, amount, duesAfter } = outcome;

    // Side effects only after the commit, so a rolled-back approval sends nothing.
    const { sendDuesPaymentApprovedEmail } = require('../../services/emailService');
    sendDuesPaymentApprovedEmail(userRecord, amount, duesAfter).catch(e => console.error(e));
    recordSettlement(new Date(), amount);

    res.status(200).json({
      success: true,
      message: 'Settlement approved successfully',
      data: {
        settlement,
        newDues: duesAfter
      }
    });
  } catch (error) {
    console.error('Approve settlement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve settlement'
    });
  }
};

/**
 * Reject settlement request
 */
const rejectSettlement = async (req, res) => {
  try {
    const { settlementId } = req.params;
    const { rejectionReason } = req.body;
    const adminId = req.user.id;

    if (!rejectionReason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    // Claimed on 'pending' in the write itself. Read-then-save let a reject that
    // raced an approve overwrite 'approved' with 'rejected' after the dues had
    // already been reduced -- a settled vendor told their payment was refused.
    const settlement = await Settlement.findOneAndUpdate(
      { _id: settlementId, status: 'pending' },
      {
        $set: {
          status: 'rejected',
          processedBy: adminId,
          processedAt: new Date(),
          rejectionReason
        }
      },
      { new: true }
    );
    if (!settlement) {
      const exists = await Settlement.exists({ _id: settlementId });
      return res.status(exists ? 400 : 404).json({
        success: false,
        message: exists ? 'Settlement is not in pending status' : 'Settlement not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Settlement rejected',
      data: settlement
    });
  } catch (error) {
    console.error('Reject settlement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject settlement'
    });
  }
};

/**
 * Get settlement history (all statuses)
 */
const getSettlementHistory = async (req, res) => {
  try {
    const { page = 1, limit = 50, status, vendorId, model } = req.query;
    const limitInt = parseInt(limit);
    const pageInt = parseInt(page);
    const skip = (pageInt - 1) * limitInt;

    // Build Settlement query
    const settlementQuery = {};
    if (status) settlementQuery.status = status;
    if (vendorId) settlementQuery.vendorId = vendorId;
    if (model === 'worker') {
      settlementQuery.workerId = { $exists: true };
    } else {
      settlementQuery.$or = [{ vendorId: { $exists: true, $ne: null } }];
    }

    // Build Withdrawal query
    const withdrawalQuery = {};
    if (status) {
      withdrawalQuery.status = status;
    } else {
      withdrawalQuery.status = { $in: ['approved', 'rejected'] };
    }
    if (vendorId) withdrawalQuery.vendorId = vendorId;
    if (model === 'worker') {
      withdrawalQuery.workerId = { $exists: true };
    } else {
      withdrawalQuery.$or = [{ vendorId: { $exists: true, $ne: null } }];
    }

    // Fetch both collections
    const [settlements, withdrawals] = await Promise.all([
      Settlement.find(settlementQuery)
        .populate('vendorId', 'name businessName phone')
        .populate('workerId', 'name phone')
        .populate('processedBy', 'name')
        .lean(),
      Withdrawal.find(withdrawalQuery)
        .populate('vendorId', 'name businessName phone')
        .populate('workerId', 'name phone')
        .populate('processedBy', 'name')
        .lean()
    ]);

    // Map to unified structure
    const unifiedHistory = [
      ...settlements.map(s => ({
        _id: s._id,
        type: 'settlement',
        amount: s.amount,
        status: s.status,
        paymentMethod: s.paymentMethod || 'upi',
        paymentReference: s.paymentReference,
        createdAt: s.createdAt,
        vendorId: s.vendorId,
        workerId: s.workerId,
        processedBy: s.processedBy,
        rejectionReason: s.rejectionReason
      })),
      ...withdrawals.map(w => ({
        _id: w._id,
        type: 'withdrawal',
        amount: w.amount,
        status: w.status,
        paymentMethod: 'bank_transfer',
        paymentReference: w.transactionReference,
        createdAt: w.processedDate || w.updatedAt,
        vendorId: w.vendorId,
        workerId: w.workerId,
        processedBy: w.processedBy,
        rejectionReason: w.rejectionReason
      }))
    ];

    // Sort by date descending
    unifiedHistory.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Paginate
    const paginatedHistory = unifiedHistory.slice(skip, skip + limitInt);
    const total = unifiedHistory.length;

    res.status(200).json({
      success: true,
      data: paginatedHistory,
      pagination: {
        page: pageInt,
        limit: limitInt,
        total,
        pages: Math.ceil(total / limitInt)
      }
    });
  } catch (error) {
    console.error('Get settlement history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settlement history'
    });
  }
};

/**
 * Dashboard summary for admin
 */
const getSettlementDashboard = async (req, res) => {
  try {
    const { model } = req.query;
    const TargetModel = model === 'worker' ? Worker : Vendor;
    
    // Total amount due to admin
    const totalDueResult = await TargetModel.aggregate([
      { $match: { 'wallet.dues': { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$wallet.dues' } } }
    ]);
    const totalDueToAdmin = totalDueResult[0]?.total || 0;

    // Pending settlements
    const pendingQuery = { status: 'pending' };
    if (model === 'worker') pendingQuery.workerId = { $exists: true };
    else pendingQuery.$or = [{ vendorId: { $exists: true, $ne: null } }];

    const pendingSettlements = await Settlement.aggregate([
      { $match: pendingQuery },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);

    // Today's cash collections
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cashQuery = {
      type: 'cash_collected',
      createdAt: { $gte: today }
    };
    if (model === 'worker') cashQuery.workerId = { $exists: true };
    else cashQuery.$or = [{ vendorId: { $exists: true, $ne: null } }];
    
    const todayCollections = await Transaction.aggregate([
      { $match: cashQuery },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // This week settlements
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    const weekQuery = {
      type: 'settlement',
      status: 'completed',
      createdAt: { $gte: weekStart }
    };
    if (model === 'worker') weekQuery.workerId = { $exists: true };
    else weekQuery.$or = [{ vendorId: { $exists: true, $ne: null } }];

    const weekSettlements = await Transaction.aggregate([
      { $match: weekQuery },
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
        totalDueToAdmin,
        vendorsWithDue: await TargetModel.countDocuments({ 'wallet.dues': { $gt: 0 } }),
        pendingSettlements: {
          amount: pendingSettlements[0]?.total || 0,
          count: pendingSettlements[0]?.count || 0
        },
        todayCashCollected: {
          amount: todayCollections[0]?.total || 0,
          count: todayCollections[0]?.count || 0
        },
        weeklySettlements: {
          amount: weekSettlements[0]?.total || 0,
          count: weekSettlements[0]?.count || 0
        }
      }
    });
  } catch (error) {
    console.error('Get settlement dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data'
    });
  }
};

/**
 * Block Vendor (Manual or auto-triggered)
 */
const blockVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { reason } = req.body;

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    vendor.wallet.isBlocked = true;
    vendor.wallet.blockedAt = new Date();
    vendor.wallet.blockReason = reason || 'Blocked by admin due to pending dues.';
    await vendor.save();

    res.status(200).json({ success: true, message: 'Vendor blocked successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Unblock Vendor
 */
const unblockVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    vendor.wallet.isBlocked = false;
    vendor.wallet.blockedAt = null;
    vendor.wallet.blockReason = null;
    await vendor.save();

    res.status(200).json({ success: true, message: 'Vendor unblocked successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update Vendor Cash Limit
 */
const updateCashLimit = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { limit } = req.body;

    if (!limit || limit < 0) {
      return res.status(400).json({ success: false, message: 'Invalid limit' });
    }

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    vendor.wallet.cashLimit = limit;


    // Auto unblock if new limit covers dues
    if (vendor.wallet.isBlocked && (vendor.wallet.dues || 0) <= limit) {
      vendor.wallet.isBlocked = false;
      vendor.wallet.blockedAt = null;
      vendor.wallet.blockReason = null;
    }

    await vendor.save();

    // Recorded only once the vendor save succeeded, so a failed save cannot leave an
    // override behind. It is what every reader now consults: without it this edit would
    // be shadowed by any vertical or global value set in Platform settings.
    await recordCashLimit({
      level: 'partner', scopeId: vendorId, value: Number(limit),
      updatedBy: req.user?.id, reason: 'Set from SP vendor cash limit screen',
    });

    res.status(200).json({ success: true, message: 'Cash limit updated successfully', limit });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getVendorBalances,
  getVendorLedger,
  getPendingSettlements,
  approveSettlement,
  rejectSettlement,
  getSettlementHistory,
  getSettlementDashboard,
  blockVendor,
  unblockVendor,
  updateCashLimit,

  // Withdrawal functions
  getWithdrawalRequests: async (req, res) => {
    try {
      const { page = 1, limit = 20, model } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const query = { status: 'pending' };
      if (model === 'worker') {
        query.workerId = { $exists: true };
      } else {
        query.$or = [{ vendorId: { $exists: true, $ne: null } }];
      }

      const withdrawals = await Withdrawal.find(query)
        .populate('vendorId', 'name businessName phone wallet.earnings')
        .populate('workerId', 'name phone wallet.balance wallet.earnings')
        .sort({ createdAt: 1 })
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
      res.status(500).json({ success: false, message: error.message });
    }
  },

  approveWithdrawal: async (req, res) => {
    try {
      const { withdrawalId } = req.params;
      const { transactionReference, notes } = req.body;
      const adminId = req.user.id;

      const Settings = require('../../models/Settings');

      // A payout deducts a wallet, flips the withdrawal to approved and writes up
      // to three ledger rows. Partially applying that either pays a provider whose
      // wallet was never debited, or debits one who never got marked paid.
      // Email and notification are deliberately fired after the commit.
      const outcome = await withTransaction(async (session) => {
        const existing = await Withdrawal.findById(withdrawalId).session(session);
        if (!existing) abort({ notFound: true });

        const isWorker = !!existing.workerId;

        // Fetch global settings for rates
        const settings = await Settings.findOne({ type: 'global' }).session(session);
        // Workers have no TDS/Platform fee under simplified flow
        const tdsRate = isWorker ? 0 : (settings?.tdsPercentage || 1);
        const platformFeeRate = isWorker ? 0 : (settings?.platformFeePercentage || 1);

        const targetId = isWorker ? existing.workerId : existing.vendorId;
        const TargetModel = isWorker ? Worker : Vendor;
        const userTypeField = isWorker ? 'workerId' : 'vendorId';

        // Calculate Deductions
        const grossAmount = existing.amount;
        const tdsAmount = Math.round((grossAmount * tdsRate) / 100);
        const platformFeeAmount = Math.round((grossAmount * platformFeeRate) / 100);
        const netAmount = grossAmount - tdsAmount - platformFeeAmount;

        // ATOMIC CLAIM on 'pending': two admins hitting approve at the same moment
        // would otherwise both pass a read-then-check and pay out twice.
        const withdrawal = await Withdrawal.findOneAndUpdate(
          { _id: withdrawalId, status: 'pending' },
          {
            $set: {
              status: 'approved',
              processedBy: adminId,
              processedDate: new Date(),
              transactionReference,
              adminNotes: notes,
              tdsRate,
              tdsAmount,
              platformFeeRate,
              platformFeeAmount,
              netAmount
            }
          },
          { new: true, session }
        );
        if (!withdrawal) abort({ notPending: true });

        // ATOMIC DEBIT: balance guard lives in the query so the wallet can never
        // go negative, whatever else is happening concurrently.
        const balanceField = isWorker ? 'wallet.balance' : 'wallet.earnings';
        const userRecord = await TargetModel.findOneAndUpdate(
          { _id: targetId, [balanceField]: { $gte: grossAmount } },
          {
            $inc: {
              [balanceField]: -grossAmount,
              'wallet.totalWithdrawn': grossAmount
            }
          },
          { new: true, session }
        );

        if (!userRecord) {
          const stillThere = await TargetModel.findById(targetId).select('wallet').session(session);
          abort(stillThere
            ? { insufficient: true, isWorker, available: isWorker ? stillThere.wallet?.balance : stillThere.wallet?.earnings }
            : { providerMissing: true });
        }

        // Transaction 1: Withdrawal Payout
        await Transaction.create([{
          [userTypeField]: userRecord._id,
          type: 'withdrawal',
          amount: grossAmount,
          status: 'completed',
          paymentMethod: 'bank_transfer',
          description: `Withdrawal payout processed. Gross: ₹${grossAmount}`,
          referenceId: transactionReference,
          metadata: {
            withdrawalId: withdrawal._id,
            tdsRate,
            tdsAmount,
            platformFeeRate,
            platformFeeAmount,
            netAmount
          }
        }], { session });

        // Transaction 2: TDS Deduction
        if (tdsAmount > 0) {
          await Transaction.create([{
            [userTypeField]: userRecord._id,
            type: 'tds_deduction',
            amount: tdsAmount,
            status: 'completed',
            paymentMethod: 'system',
            description: `TDS Deduction (${tdsRate}%) on withdrawal of ₹${grossAmount}`,
            referenceId: transactionReference,
            metadata: {
              withdrawalId: withdrawal._id,
              grossAmount,
              tdsRate,
              netAmountTransferred: netAmount
            }
          }], { session });
        }

        // Transaction 3: Platform Fee Deduction
        if (platformFeeAmount > 0) {
          await Transaction.create([{
            [userTypeField]: userRecord._id,
            type: 'platform_fee',
            amount: platformFeeAmount,
            status: 'completed',
            paymentMethod: 'system',
            description: `Platform Charge Fee (${platformFeeRate}%) on withdrawal of ₹${grossAmount}`,
            referenceId: transactionReference,
            metadata: {
              withdrawalId: withdrawal._id,
              grossAmount,
              platformFeeRate,
              netAmountTransferred: netAmount
            }
          }], { session });
        }

        return {
          withdrawal, userRecord, grossAmount, netAmount,
          tdsRate, tdsAmount, platformFeeRate, platformFeeAmount,
          isWorker, targetId
        };
      });

      if (outcome.notFound) return res.status(404).json({ success: false, message: 'Withdrawal not found' });
      if (outcome.notPending) return res.status(400).json({ success: false, message: 'Not pending' });
      if (outcome.providerMissing) return res.status(404).json({ success: false, message: 'Provider not found' });
      if (outcome.insufficient) {
        return res.status(400).json({
          success: false,
          message: `Insufficient ${outcome.isWorker ? 'balance' : 'earnings'}. Available: ₹${outcome.available ?? 0}`
        });
      }

      const {
        withdrawal, userRecord, grossAmount, netAmount,
        tdsRate, tdsAmount, platformFeeRate, platformFeeAmount,
        isWorker, targetId
      } = outcome;

      // ── Post-commit side effects (cannot be rolled back, so never inside the txn) ──

      // Record withdrawal payout in earning tracker
      recordWithdrawal(new Date(), grossAmount);

      // Send Withdrawal Approved Email
      const { sendWithdrawalApprovedEmail } = require('../../services/emailService');
      sendWithdrawalApprovedEmail(userRecord, grossAmount, transactionReference).catch(e => console.error(e));

      // Send Withdrawal Notification
      const { createNotification } = require('../notificationControllers/notificationController');
      createNotification({
        [isWorker ? 'workerId' : 'vendorId']: targetId,
        type: 'withdrawal_approved',
        title: 'Withdrawal Approved',
        message: `Your withdrawal request of ₹${grossAmount} has been successfully accepted.`,
        relatedId: withdrawal._id,
        relatedType: 'withdrawal',
        data: {
          amount: String(grossAmount),
          transactionReference: transactionReference || ''
        }
      }).catch(e => console.error('Withdrawal notification error:', e));

      res.status(200).json({
        success: true,
        message: 'Withdrawal approved with deductions',
        data: {
          grossAmount,
          tdsRate,
          tdsAmount,
          platformFeeRate,
          platformFeeAmount,
          netAmount,
          transactionReference
        }
      });
    } catch (error) {
      console.error('Approve withdrawal error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  },


  rejectWithdrawal: async (req, res) => {
    try {
      const { withdrawalId } = req.params;
      const { reason } = req.body;
      const adminId = req.user.id;

      // Only a PENDING withdrawal can be rejected, claimed in the write. With no
      // status check an approved -- already paid, already debited -- withdrawal
      // could be flipped to 'rejected': the partner is told the payout was refused
      // while the money has left, and the row no longer matches the wallet.
      const withdrawal = await Withdrawal.findOneAndUpdate(
        { _id: withdrawalId, status: 'pending' },
        {
          $set: {
            status: 'rejected',
            processedBy: adminId,
            processedAt: new Date(),
            rejectionReason: reason
          }
        },
        { new: true }
      );
      if (!withdrawal) {
        const current = await Withdrawal.findById(withdrawalId).select('status').lean();
        if (!current) return res.status(404).json({ success: false, message: 'Withdrawal not found' });
        return res.status(400).json({ success: false, message: `Withdrawal is already ${current.status}` });
      }

      // Send Withdrawal Rejection Notification
      const { createNotification } = require('../notificationControllers/notificationController');
      createNotification({
        [withdrawal.workerId ? 'workerId' : 'vendorId']: withdrawal.workerId || withdrawal.vendorId,
        type: 'withdrawal_rejected',
        title: 'Withdrawal Rejected',
        message: `Your withdrawal request of ₹${withdrawal.amount} has been rejected. Reason: ${reason}`,
        relatedId: withdrawal._id,
        relatedType: 'withdrawal',
        data: {
          amount: String(withdrawal.amount),
          reason: reason || ''
        }
      }).catch(e => console.error('Withdrawal rejection notification error:', e));



      res.status(200).json({ success: true, message: 'Withdrawal rejected' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
};
