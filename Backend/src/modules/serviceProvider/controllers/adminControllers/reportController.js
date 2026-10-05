const Booking = require('../../models/Booking');
const VendorBill = require('../../models/VendorBill');
const Settlement = require('../../models/Settlement');
const Vendor = require('../../models/Vendor');
const Worker = require('../../models/Worker');
const User = require('../../models/User');
const Settings = require('../../models/Settings');
const PlatformEarning = require('../../models/PlatformEarning');
const { BOOKING_STATUS, PAYMENT_STATUS } = require('../../utils/constants');
const { getCommissionRates } = require('../../utils/commission');

/**
 * Get Financial Dashboard Overview
 * Quick stats for the top cards
 */
const getFinanceOverview = async (req, res) => {
  try {
    const { startDate, endDate, model = 'vendor' } = req.query;

    const isWorker = model === 'worker';
    const providerIdField = isWorker ? 'workerId' : 'vendorId';

    // Build date filter string for PlatformEarning Model (YYYY-MM-DD)
    const dateFilter = {};
    if (startDate && endDate) {
      // Create strings like '2026-03-01' from the ISO formats
      const startStr = new Date(startDate).toISOString().split('T')[0];
      const endStr = new Date(endDate).toISOString().split('T')[0];
      dateFilter.date = { $gte: startStr, $lte: endStr };
    }

    // 1. Fetch Aggregated Revenue Data INSTANTLY from the new Model
    const revenueDocs = await PlatformEarning.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalTransactionValue: { $sum: '$totalRevenue' },
          totalPlatformRevenue: { $sum: '$platformCommission' },
          totalVendorEarnings: { $sum: '$vendorEarnings' },
          totalTaxCollected: { $sum: '$totalGST' },
          totalTDSCollected: { $sum: '$totalTDS' },
          count: { $sum: '$totalBookings' },
          totalSettlementReceived: { $sum: '$totalSettlementReceived' },
          totalAmountPaidToVendors: { $sum: '$totalAmountPaidToVendors' }
        }
      }
    ]);

    let revenueStats = revenueDocs[0] || {
      totalTransactionValue: 0,
      totalPlatformRevenue: 0,
      totalVendorEarnings: 0,
      totalTaxCollected: 0,
      totalTDSCollected: 0,
      count: 0,
      totalSettlementReceived: 0,
      totalAmountPaidToVendors: 0
    };

    // Grab the live "Pending" snapshot from the latest today record to avoid manual calc
    const todayStr = new Date().toISOString().split('T')[0];
    const latestSnapshot = await PlatformEarning.findOne({ date: todayStr });

    // Mount the extra stats securely
    revenueStats.totalPendingSettlement = latestSnapshot?.totalPendingSettlement || 0;
    revenueStats.totalPendingPayout = latestSnapshot?.totalPendingAmountToVendors || 0;

    // 2. Pending Settlements (What we owe providers)
    const settlementQuery = { status: 'PENDING' };
    
    // In worker mode, we look for pending withdrawals by workers.
    // In vendor mode, we look for pending settlements by vendors.
    // Assuming Settlement model has workerId or vendorId.
    settlementQuery[providerIdField] = { $ne: null };

    const pendingSettlements = await Settlement.aggregate([
      {
        $match: settlementQuery
      },
      {
        $group: {
          _id: null,
          totalPendingAmount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // 3. Payment Method Breakdown (Keep this based on Booking model)
    const paymentMethods = await Booking.aggregate([
      {
        $match: {
          status: BOOKING_STATUS.COMPLETED
        }
      },
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          amount: { $sum: '$finalAmount' }
        }
      }
    ]);

    // 4. Daily Revenue Trend (last 30 days) from optimized model
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysStr = thirtyDaysAgo.toISOString().split('T')[0];

    const dailyRevenue = await PlatformEarning.find({ date: { $gte: thirtyDaysStr } })
      .select('date totalRevenue platformCommission')
      .sort({ date: 1 })
      .lean();

    const formattedDaily = dailyRevenue.map(d => ({
      _id: d.date,
      revenue: d.totalRevenue,
      commission: d.platformCommission
    }));

    res.status(200).json({
      success: true,
      data: {
        revenue: revenueStats,
        pendingSettlements: pendingSettlements[0] || { totalPendingAmount: 0, count: 0 },
        paymentMethods,
        dailyRevenue: formattedDaily
      }
    });

  } catch (error) {
    console.error('Finance overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch finance overview' });
  }
};

/**
 * Get Payment Transactions (Main Report)
 * Detailed transaction log
 */
const getPaymentTransactions = async (req, res) => {
  try {
    const { startDate, endDate, paymentMethod, status, page = 1, limit = 50, format = 'json', model = 'vendor' } = req.query;

    const isWorker = model === 'worker';
    const providerIdField = isWorker ? 'workerId' : 'vendorId';

    const query = {};

    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
      };
    }

    if (paymentMethod) query.paymentMethod = paymentMethod;
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const bookings = await Booking.find(query)
      .populate('userId', 'name phone')
      .populate(providerIdField, isWorker ? 'name phone' : 'businessName phone')
      .populate('serviceId', 'title')
      .select('bookingNumber finalAmount paymentMethod paymentStatus status createdAt completedAt razorpayPaymentId vendorBillId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Booking.countDocuments(query);

    // Fetch VendorBills for these bookings
    const bookingIds = bookings.map(b => b._id);
    const bills = await VendorBill.find({ bookingId: { $in: bookingIds } }).lean();
    const billMap = {};
    bills.forEach(b => { billMap[b.bookingId.toString()] = b; });

    // Bills are the source of truth; these rates only cover bookings billed before
    // a VendorBill existed, so they must match the configured split, not a literal.
    const { vendorShare, platformShare } = await getCommissionRates();

    const reportData = bookings.map(b => {
      const bill = billMap[b._id.toString()];
      return {
        date: b.createdAt,
        bookingNumber: b.bookingNumber,
        service: b.serviceId?.title || 'N/A',
        customer: b.userId?.name || 'Guest',
        providerName: b[providerIdField]?.name || b[providerIdField]?.businessName || 'Unassigned',
        amount: bill?.grandTotal || b.finalAmount || 0,
        platformFee: bill?.companyRevenue || (b.finalAmount ? b.finalAmount * platformShare : 0),
        vendorEarnings: bill?.vendorTotalEarning || (b.finalAmount ? b.finalAmount * vendorShare : 0),
        tax: bill?.totalGST || 0,
        paymentMethod: b.paymentMethod || 'N/A',
        paymentStatus: b.paymentStatus || 'N/A',
        bookingStatus: b.status,
        transactionId: b.razorpayPaymentId || '-'
      };
    });

    // Calculate totals matching exactly what is mapped above
    const totalsResult = reportData.reduce((acc, row) => {
      acc.totalAmount += row.amount;
      acc.totalCommission += row.platformFee;
      acc.totalVendorEarnings += row.vendorEarnings;
      acc.totalTax += row.tax;
      return acc;
    }, { totalAmount: 0, totalCommission: 0, totalVendorEarnings: 0, totalTax: 0 });

    if (format === 'csv') {
      return sendCSV(res, reportData, 'payment_transactions');
    }

    res.status(200).json({
      success: true,
      data: reportData,
      totals: totalsResult,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Payment transactions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch payment transactions' });
  }
};

/**
 * Get GSTR-1 Style Report (Sales)
 * Uses global GST Settings (Common GST)
 */
const getGSTRReport = async (req, res) => {
  try {
    const { startDate, endDate, format = 'json' } = req.query;

    // Fetch global GST setting
    const settings = await Settings.findOne({ type: 'global' });
    const gstRate = settings?.serviceGstPercentage || 18; // Default 18% if not set

    // CGST/SGST split logic implies 50-50 split of the total GST rate
    const halfRate = gstRate / 2;

    const query = {
      status: BOOKING_STATUS.COMPLETED
    };

    if (startDate && endDate) {
      query.completedAt = {
        $gte: new Date(startDate),
        $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
      };
    }

    // Fetch bills alongside bookings for GST data
    const bookings = await Booking.find(query)
      .populate('userId', 'name phone')
      .select('bookingNumber finalAmount completedAt paymentMethod address vendorBillId')
      .sort({ completedAt: -1 })
      .lean();

    // Get VendorBills for these bookings
    const billBookingIds = bookings.map(b => b._id);
    const gstBills = await VendorBill.find({ bookingId: { $in: billBookingIds } }).lean();
    const gstBillMap = {};
    gstBills.forEach(b => { gstBillMap[b.bookingId.toString()] = b; });

    // Map to GSTR format
    const reportData = bookings.map(b => {
      const bill = gstBillMap[b._id.toString()];

      // Use VendorBill GST data if available, otherwise fallback
      let taxAmount = bill?.totalGST || 0;
      let taxableValue = (bill?.totalServiceBase || 0) + (bill?.totalPartsBase || 0);

      // Fallback if no bill exists
      if (!bill && b.finalAmount > 0) {
        taxableValue = b.finalAmount / (1 + (gstRate / 100));
        taxAmount = b.finalAmount - taxableValue;
      }

      return {
        invoiceDate: b.completedAt ? new Date(b.completedAt).toISOString().split('T')[0] : '',
        invoiceNumber: b.bookingNumber,
        customerName: b.userId?.name || 'Guest',
        placeOfSupply: b.address?.state || 'Madhya Pradesh',
        hsnSac: '9988',
        taxableValue: parseFloat(taxableValue.toFixed(2)),
        gstRate: `${gstRate}%`,
        cgst: parseFloat((taxAmount / 2).toFixed(2)),
        sgst: parseFloat((taxAmount / 2).toFixed(2)),
        igst: 0,
        totalTax: parseFloat(taxAmount.toFixed(2)),
        invoiceValue: bill?.grandTotal || b.finalAmount,
        paymentMode: b.paymentMethod
      };
    });

    // Summary totals
    const summary = reportData.reduce((acc, row) => {
      acc.totalTaxableValue += row.taxableValue;
      acc.totalCGST += row.cgst;
      acc.totalSGST += row.sgst;
      acc.totalIGST += row.igst;
      acc.totalTax += row.totalTax;
      acc.totalInvoiceValue += row.invoiceValue;
      return acc;
    }, { totalTaxableValue: 0, totalCGST: 0, totalSGST: 0, totalIGST: 0, totalTax: 0, totalInvoiceValue: 0 });

    if (format === 'csv') {
      return sendCSV(res, reportData, 'gstr1_sales_report');
    }

    res.status(200).json({
      success: true,
      data: reportData,
      summary
    });

  } catch (error) {
    console.error('GSTR report error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate GSTR report' });
  }
};

/**
 * Get TDS Report
 * Uses global TDS Settings from Admin
 */
const getTDSReport = async (req, res) => {
  try {
    const { startDate, endDate, format = 'json', model = 'vendor' } = req.query;

    const isWorker = model === 'worker';
    const providerIdField = isWorker ? 'workerId' : 'vendorId';
    const collectionName = isWorker ? 'workers' : 'vendors';

    // Fetch TDS setting
    const settings = await Settings.findOne({ type: 'global' });
    const tdsRate = settings?.tdsPercentage || 1; // Default 1% if not set

    const query = {
      status: BOOKING_STATUS.COMPLETED
    };
    query[providerIdField] = { $ne: null };

    if (startDate && endDate) {
      query.completedAt = {
        $gte: new Date(startDate),
        $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
      };
    }

    // Group by Vendor for the period
    const vendorStats = await Booking.aggregate([
      { $match: query },
      {
        $group: {
          _id: `$${providerIdField}`,
          grossSales: { $sum: '$finalAmount' },
          bookingCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: collectionName,
          localField: '_id',
          foreignField: '_id',
          as: 'provider'
        }
      },
      { $unwind: '$provider' },
      {
        $project: {
          providerName: isWorker ? '$provider.name' : '$provider.businessName',
          providerPhone: '$provider.phone',
          panNumber: { $ifNull: ['$provider.panNumber', 'Not Provided'] },
          grossSales: 1,
          tdsRate: { $literal: tdsRate },
          tdsAmount: { $multiply: ['$grossSales', (tdsRate / 100)] }, // Use Admin Setting Rate
          bookingCount: 1
        }
      },
      { $sort: { grossSales: -1 } }
    ]);

    // Summary
    const summary = vendorStats.reduce((acc, row) => {
      acc.totalGrossSales += row.grossSales;
      acc.totalTDS += row.tdsAmount;
      acc.vendorCount++;
      return acc;
    }, { totalGrossSales: 0, totalTDS: 0, vendorCount: 0 });

    if (format === 'csv') {
      return sendCSV(res, vendorStats, 'tds_report_admin');
    }

    res.status(200).json({
      success: true,
      data: vendorStats,
      summary
    });

  } catch (error) {
    console.error('TDS report error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate TDS report' });
  }
};

/**
 * Get Cash Collected Report (formerly COD Reconciliation)
 * Track Cash Collected by Vendor vs Commission Owed
 */
const getCODReport = async (req, res) => {
  try {
    const { startDate, endDate, format = 'json', model = 'vendor' } = req.query;

    const isWorker = model === 'worker';
    const providerIdField = isWorker ? 'workerId' : 'vendorId';

    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.status = BOOKING_STATUS.COMPLETED; // Ensure completed
      // We can use completedAt or cashCollectedAt
      dateFilter.completedAt = {
        $gte: new Date(startDate),
        $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
      };
    }

    // Get all providers (even if blocked/unapproved, as they might owe money)
    const providers = isWorker 
      ? await Worker.find({}).select('name phone wallet.dues').lean()
      : await Vendor.find({}).select('businessName phone walletBalance').lean();

    // For each provider, calculate their cash-related bookings
    const reportData = await Promise.all(providers.map(async (v) => {
      // Build match query
      const matchQuery = {
        [providerIdField]: v._id,
        $or: [
          { cashCollected: true },
          { paymentMethod: { $in: ['pay_at_home', 'cash', 'COD', 'cod'] } }
        ],
        status: BOOKING_STATUS.COMPLETED
      };

      // Add date filter if present
      if (startDate && endDate) {
        matchQuery.completedAt = dateFilter.completedAt;
      }

      const cashBookings = await Booking.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            totalCashCollected: { $sum: '$finalAmount' },
            count: { $sum: 1 }
          }
        }
      ]);

      // Get company revenue from VendorBills for these cash bookings
      const vendorBillStats = await VendorBill.aggregate([
        { $match: { [providerIdField]: v._id, status: 'paid' } },
        {
          $group: {
            _id: null,
            platformCommission: { $sum: '$companyRevenue' }
          }
        }
      ]);

      const cashData = cashBookings[0] || { totalCashCollected: 0, count: 0 };
      const billData = vendorBillStats[0] || { platformCommission: 0 };

      // Outstanding dues
      let outstandingDues = 0;
      let walletBalance = 0;
      if (isWorker) {
        outstandingDues = v.wallet?.dues || 0;
        walletBalance = -outstandingDues;
      } else {
        outstandingDues = v.walletBalance < 0 ? Math.abs(v.walletBalance) : 0;
        walletBalance = v.walletBalance;
      }
      
      const riskLevel = outstandingDues > 5000 ? 'HIGH' : (outstandingDues > 1000 ? 'MEDIUM' : 'LOW');

      return {
        vendorName: isWorker ? v.name : (v.businessName || 'Unknown'),
        phone: v.phone,
        totalCashCollected: cashData.totalCashCollected,
        platformCommissionDue: billData.platformCommission,
        cashBookingCount: cashData.count,
        walletBalance: walletBalance, // Current live wallet status
        outstandingDues,
        riskLevel
      };
    }));

    // Filter to show only vendors with cash dealings or outstanding dues
    const filteredData = reportData.filter(r => r.totalCashCollected > 0 || r.outstandingDues > 0);

    // Sort by outstanding dues (highest first)
    filteredData.sort((a, b) => b.outstandingDues - a.outstandingDues);

    // Summary
    const summary = filteredData.reduce((acc, row) => {
      acc.totalCashCollected += row.totalCashCollected;
      acc.totalOutstandingDues += row.outstandingDues;
      if (row.riskLevel === 'HIGH') acc.highRiskCount++;
      return acc;
    }, { totalCashCollected: 0, totalOutstandingDues: 0, highRiskCount: 0 });

    if (format === 'csv') {
      return sendCSV(res, filteredData, 'cash_collected_report');
    }

    res.status(200).json({
      success: true,
      data: filteredData,
      summary
    });

  } catch (error) {
    console.error('Cash collected report error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate cash report' });
  }
};

/**
 * Get Revenue Breakdown
 */
const getRevenueBreakdown = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.completedAt = {
        $gte: new Date(startDate),
        $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
      };
    }

    // Revenue by Service Category — use VendorBill with lookup
    const billDateFilter = {};
    if (startDate && endDate) {
      billDateFilter.paidAt = {
        $gte: new Date(startDate),
        $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
      };
    }

    const byService = await VendorBill.aggregate([
      {
        $match: {
          ...billDateFilter,
          status: 'paid'
        }
      },
      {
        $lookup: {
          from: 'bookings',
          localField: 'bookingId',
          foreignField: '_id',
          as: 'booking'
        }
      },
      { $unwind: { path: '$booking', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'services',
          localField: 'booking.serviceId',
          foreignField: '_id',
          as: 'service'
        }
      },
      { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$service.title',
          revenue: { $sum: '$grandTotal' },
          commission: { $sum: '$companyRevenue' },
          count: { $sum: 1 }
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    // Revenue by Payment Method
    const byPaymentMethod = await VendorBill.aggregate([
      {
        $match: {
          ...billDateFilter,
          status: 'paid'
        }
      },
      {
        $lookup: {
          from: 'bookings',
          localField: 'bookingId',
          foreignField: '_id',
          as: 'booking'
        }
      },
      { $unwind: { path: '$booking', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$booking.paymentMethod',
          revenue: { $sum: '$grandTotal' },
          commission: { $sum: '$companyRevenue' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Revenue by City/State
    const byLocation = await VendorBill.aggregate([
      {
        $match: {
          ...billDateFilter,
          status: 'paid'
        }
      },
      {
        $lookup: {
          from: 'bookings',
          localField: 'bookingId',
          foreignField: '_id',
          as: 'booking'
        }
      },
      { $unwind: { path: '$booking', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$booking.address.city',
          revenue: { $sum: '$grandTotal' },
          commission: { $sum: '$companyRevenue' },
          count: { $sum: 1 }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 }
    ]);

    res.status(200).json({
      success: true,
      data: {
        byService,
        byPaymentMethod,
        byLocation
      }
    });

  } catch (error) {
    console.error('Revenue breakdown error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch revenue breakdown' });
  }
};

/**
 * Helper to send CSV
 */
const sendCSV = (res, data, filename) => {
  if (!data || data.length === 0) {
    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename="${filename}_${Date.now()}.csv"`);
    return res.send('No data available');
  }

  const headers = Object.keys(data[0]);
  const csvRows = [];

  // Header row
  csvRows.push(headers.join(','));

  // Data rows
  data.forEach(row => {
    const values = headers.map(header => {
      const val = row[header] !== undefined ? row[header] : '';
      return `"${String(val).replace(/"/g, '""')}"`;
    });
    csvRows.push(values.join(','));
  });

  const csvString = csvRows.join('\n');

  res.header('Content-Type', 'text/csv');
  res.header('Content-Disposition', `attachment; filename="${filename}_${Date.now()}.csv"`);
  res.send(csvString);
};

module.exports = {
  getFinanceOverview,
  getPaymentTransactions,
  getGSTRReport,
  getTDSReport,
  getCODReport,
  getRevenueBreakdown
};
