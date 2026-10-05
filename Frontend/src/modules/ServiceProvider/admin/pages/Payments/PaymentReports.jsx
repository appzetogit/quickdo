import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FiFileText,
  FiDownload,
  FiCalendar,
  FiDollarSign,
  FiTrendingUp,
  FiAlertTriangle,
  FiPercent,
  FiCreditCard,
  FiUsers,
  FiRefreshCw,
  FiChevronDown,
  FiX,
  FiCheck
} from 'react-icons/fi';
import api from '@sp/services/api';
import { getSettings } from '../../services/settingsService';
import { toast } from 'react-hot-toast';

// Report Card Component
const ReportCard = ({ title, description, icon: Icon, color, status, onGenerate, loading }) => {
  const colorClasses = {
    blue: {
      bg: 'bg-blue-50',
      text: 'text-blue-600',
      hover: 'hover:border-blue-500',
      hoverBg: 'group-hover:bg-blue-100',
      btn: 'text-blue-600 hover:text-blue-800'
    },
    green: {
      bg: 'bg-green-50',
      text: 'text-green-600',
      hover: 'hover:border-green-500',
      hoverBg: 'group-hover:bg-green-100',
      btn: 'text-green-600 hover:text-green-800'
    },
    purple: {
      bg: 'bg-purple-50',
      text: 'text-purple-600',
      hover: 'hover:border-purple-500',
      hoverBg: 'group-hover:bg-purple-100',
      btn: 'text-purple-600 hover:text-purple-800'
    },
    orange: {
      bg: 'bg-orange-50',
      text: 'text-orange-600',
      hover: 'hover:border-orange-500',
      hoverBg: 'group-hover:bg-orange-100',
      btn: 'text-orange-600 hover:text-orange-800'
    },
    red: {
      bg: 'bg-red-50',
      text: 'text-red-600',
      hover: 'hover:border-red-500',
      hoverBg: 'group-hover:bg-red-100',
      btn: 'text-red-600 hover:text-red-800'
    },
    teal: {
      bg: 'bg-teal-50',
      text: 'text-teal-600',
      hover: 'hover:border-teal-500',
      hoverBg: 'group-hover:bg-teal-100',
      btn: 'text-teal-600 hover:text-teal-800'
    }
  };

  const classes = colorClasses[color] || colorClasses.blue;

  return (
    <div className={`border border-gray-200 rounded-xl p-5 ${classes.hover} transition-all cursor-pointer group hover:shadow-md`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`p-3 ${classes.bg} ${classes.text} rounded-xl ${classes.hoverBg} transition-colors`}>
          <Icon className="w-6 h-6" />
        </div>
        <span className={`${status === 'available' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'} text-xs px-2.5 py-1 rounded-full font-medium`}>
          {status === 'available' ? 'Ready' : 'Beta'}
        </span>
      </div>
      <h3 className="font-semibold text-gray-800 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 mb-4 line-clamp-2">{description}</p>
      <button
        onClick={onGenerate}
        disabled={loading}
        className={`${classes.btn} text-sm font-medium flex items-center disabled:opacity-50`}
      >
        {loading ? (
          <FiRefreshCw className="mr-1.5 animate-spin" />
        ) : (
          <FiDownload className="mr-1.5" />
        )}
        {loading ? 'Generating...' : 'Download CSV'}
      </button>
    </div>
  );
};

// Stats Card Component
const StatsCard = ({ title, value, subtitle, icon: Icon, color, trend }) => {
  const colorMap = {
    blue: 'from-blue-500 to-blue-600',
    green: 'from-green-500 to-green-600',
    purple: 'from-purple-500 to-purple-600',
    orange: 'from-orange-500 to-orange-600',
    red: 'from-red-500 to-red-600',
    teal: 'from-teal-500 to-teal-600',
    indigo: 'from-indigo-500 to-indigo-600',
    emerald: 'from-emerald-500 to-emerald-600'
  };

  return (
    <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colorMap[color] || 'from-gray-500 to-gray-600'} flex items-center justify-center`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {trend && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${trend > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {trend > 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500 mt-1">{title}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  );
};

// Data Table Component
const DataTable = ({ data, columns, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <FiRefreshCw className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <FiFileText className="w-12 h-12 mx-auto text-gray-300 mb-3" />
        <p>No data available for the selected period</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {columns.map((col, idx) => (
              <th key={idx} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.slice(0, 20).map((row, idx) => (
            <tr key={idx} className="hover:bg-gray-50 transition-colors">
              {columns.map((col, cidx) => (
                <td key={cidx} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > 20 && (
        <div className="text-center py-3 text-sm text-gray-500 bg-gray-50 border-t">
          Showing 20 of {data.length} records. Download CSV for full data.
        </div>
      )}
    </div>
  );
};

const PaymentReports = () => {
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState(null);
  const [activeReport, setActiveReport] = useState('transactions');
  const [reportData, setReportData] = useState([]);
  const [reportSummary, setReportSummary] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(null);

  // Date filters
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [settings, setSettings] = useState(null);

  const isWorkerMode = settings?.bookingModel === 'worker';
  const providerLabel = isWorkerMode ? 'Worker' : 'Vendor';
  const providersLabel = isWorkerMode ? 'Workers' : 'Vendors';

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await getSettings();
        if (res.success) {
          setSettings(res.settings);
        }
      } catch (error) {
        console.error('Failed to fetch settings:', error);
      }
    };
    fetchSettings();
  }, []);

  // Fetch Overview Stats
  useEffect(() => {
    fetchOverview();
  }, [startDate, endDate]);

  // Fetch Report Data when tab changes
  useEffect(() => {
    fetchReportData();
  }, [activeReport, startDate, endDate]);

  const fetchOverview = async () => {
    try {
      setLoading(true);
      const modelParam = settings?.bookingModel ? `&model=${settings.bookingModel}` : '';
      const response = await api.get(`/admin/payments/overview?startDate=${startDate}&endDate=${endDate}${modelParam}`);
      if (response.data.success) {
        setOverview(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch overview:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchReportData = async () => {
    try {
      setReportLoading(true);
      const token = localStorage.getItem('adminToken') || sessionStorage.getItem('adminToken');

      const modelParam = settings?.bookingModel ? `&model=${settings.bookingModel}` : '';
      let endpoint = '';
      switch (activeReport) {
        case 'transactions':
          endpoint = `/admin/payments/reports?startDate=${startDate}&endDate=${endDate}${modelParam}`;
          break;
        case 'gst':
          endpoint = `/admin/payments/reports/gst?startDate=${startDate}&endDate=${endDate}${modelParam}`;
          break;
        case 'tds':
          endpoint = `/admin/payments/reports/tds?startDate=${startDate}&endDate=${endDate}${modelParam}`;
          break;
        case 'cod':
          endpoint = `/admin/payments/reports/cod?startDate=${startDate}&endDate=${endDate}${modelParam}`;
          break;
        default:
          endpoint = `/admin/payments/reports?startDate=${startDate}&endDate=${endDate}${modelParam}`;
      }

      const response = await api.get(endpoint);
      const data = response.data;

      if (data.success) {
        setReportData(data.data || []);
        setReportSummary(data.summary || data.totals || null);
      }
    } catch (error) {
      console.error('Failed to fetch report:', error);
      toast.error('Failed to load report data');
    } finally {
      setReportLoading(false);
    }
  };

  const downloadReport = async (reportType) => {
    try {
      setDownloadingReport(reportType);
      const token = localStorage.getItem('adminToken') || sessionStorage.getItem('adminToken');

      const modelParam = settings?.bookingModel ? `&model=${settings.bookingModel}` : '';
      let endpoint = '';
      switch (reportType) {
        case 'transactions':
          endpoint = `/admin/payments/reports?startDate=${startDate}&endDate=${endDate}&format=csv${modelParam}`;
          break;
        case 'gst':
          endpoint = `/admin/payments/reports/gst?startDate=${startDate}&endDate=${endDate}&format=csv${modelParam}`;
          break;
        case 'tds':
          endpoint = `/admin/payments/reports/tds?startDate=${startDate}&endDate=${endDate}&format=csv${modelParam}`;
          break;
        case 'cod':
          endpoint = `/admin/payments/reports/cod?startDate=${startDate}&endDate=${endDate}&format=csv${modelParam}`;
          break;
        default:
          endpoint = `/admin/payments/reports?startDate=${startDate}&endDate=${endDate}&format=csv${modelParam}`;
      }

      const response = await api.get(endpoint, {
        responseType: 'blob'
      });

      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportType}_report_${startDate}_to_${endDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success('Report downloaded successfully!');
    } catch (error) {
      console.error('Download failed:', error);
      toast.error('Failed to download report');
    } finally {
      setDownloadingReport(null);
    }
  };

  // Report configurations
  const reports = [
    {
      id: 'transactions',
      title: 'Transaction Report',
      description: 'All payment transactions with booking details, amounts, and payment methods.',
      icon: FiCreditCard,
      color: 'blue',
      status: 'available'
    },
    {
      id: 'gst',
      title: 'GSTR-1 Sales Report',
      description: 'GST compliant sales report with CGST, SGST, IGST breakdown for filing returns.',
      icon: FiPercent,
      color: 'green',
      status: 'available'
    },
    {
      id: 'tds',
      title: 'TDS Report (194-O)',
      description: 'E-commerce TDS liability report based on Admin Settings rate (Default 1%).',
      icon: FiUsers,
      color: 'purple',
      status: 'available'
    },
    {
      id: 'cod',
      title: `Cash Collected by ${providerLabel}`,
      description: `Track cash collected by ${providersLabel.toLowerCase()} vs commission owed. Identify high-risk ${providersLabel.toLowerCase()}.`,
      icon: FiAlertTriangle,
      color: 'orange',
      status: 'available'
    }
  ];

  // Column configurations for each report type
  const getColumns = () => {
    switch (activeReport) {
      case 'transactions':
        return [
          { key: 'date', header: 'Date', render: (val) => val ? new Date(val).toLocaleDateString('en-IN') : '-' },
          { key: 'bookingNumber', header: 'Booking ID' },
          { key: 'service', header: 'Service' },
          { key: 'customer', header: 'Customer' },
          { key: 'providerName', header: providerLabel },
          { key: 'amount', header: 'Amount', render: (val) => `₹${(val || 0).toLocaleString('en-IN')}` },
          { key: 'platformFee', header: 'Platform Fee', render: (val) => `₹${(val || 0).toLocaleString('en-IN')}` },
          { key: 'paymentMethod', header: 'Method' },
          {
            key: 'bookingStatus', header: 'Status', render: (val) => (
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${val === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                val === 'CANCELLED' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>{val}</span>
            )
          }
        ];
      case 'gst':
        return [
          { key: 'invoiceDate', header: 'Invoice Date' },
          { key: 'invoiceNumber', header: 'Invoice No.' },
          { key: 'customerName', header: 'Customer' },
          { key: 'placeOfSupply', header: 'Place of Supply' },
          { key: 'hsnSac', header: 'HSN/SAC' },
          { key: 'taxableValue', header: 'Taxable Value', render: (val) => `₹${(val || 0).toLocaleString('en-IN')}` },
          { key: 'gstRate', header: 'GST Rate' },
          { key: 'totalTax', header: 'Total Tax', render: (val) => `₹${(val || 0).toLocaleString('en-IN')}` },
          { key: 'invoiceValue', header: 'Total', render: (val) => `₹${(val || 0).toLocaleString('en-IN')}` }
        ];
      case 'tds':
        return [
          { key: 'providerName', header: `${providerLabel} Name` },
          { key: 'panNumber', header: 'PAN Number' },
          { key: 'grossSales', header: 'Gross Sales', render: (val) => `₹${(val || 0).toLocaleString('en-IN')}` },
          { key: 'tdsRate', header: 'Rate (%)', render: (val) => `${val}%` },
          { key: 'tdsAmount', header: 'TDS Deducted', render: (val) => `₹${(val || 0).toLocaleString('en-IN')}` },
          { key: 'bookingCount', header: 'Bookings' }
        ];
      case 'cod':
        return [
          { key: 'vendorName', header: `${providerLabel} Name` },
          { key: 'phone', header: 'Phone' },
          { key: 'totalCashCollected', header: 'Cash Collected', render: (val) => `₹${(val || 0).toLocaleString('en-IN')}` },
          {
            key: 'walletBalance', header: 'Wallet Balance', render: (val) => (
              <span className={val < 0 ? 'text-red-500 font-bold' : 'text-green-600'}>
                {val < 0 ? '-' : ''}₹{Math.abs(val || 0).toLocaleString('en-IN')}
              </span>
            )
          },
          { key: 'outstandingDues', header: 'Liability', render: (val) => `₹${(val || 0).toLocaleString('en-IN')}` },
          {
            key: 'riskLevel', header: 'Risk', render: (val) => (
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${val === 'HIGH' ? 'bg-red-100 text-red-700' :
                val === 'MEDIUM' ? 'bg-orange-100 text-orange-700' :
                  'bg-green-100 text-green-700'
                }`}>{val}</span>
            )
          }
        ];
      default:
        return [];
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-4">
        {/* Row 1: Revenue Core */}
        <StatsCard
          title="Total Revenue"
          value={`₹${(overview?.revenue?.totalTransactionValue || 0).toLocaleString('en-IN')}`}
          subtitle={`${overview?.revenue?.count || 0} Transactions`}
          icon={FiTrendingUp}
          color="blue"
        />
        <StatsCard
          title="Platform Earnings"
          value={`₹${(overview?.revenue?.totalPlatformRevenue || 0).toLocaleString('en-IN')}`}
          subtitle="Commission Earned"
          icon={FiDollarSign}
          color="green"
        />
        <StatsCard
          title="GST Collected"
          value={`₹${(overview?.revenue?.totalTaxCollected || 0).toLocaleString('en-IN')}`}
          subtitle="Tax Liability"
          icon={FiPercent}
          color="purple"
        />
        <StatsCard
          title="TDS Deducted"
          value={`₹${(overview?.revenue?.totalTDSCollected || 0).toLocaleString('en-IN')}`}
          subtitle="From Payouts"
          icon={FiPercent}
          color="indigo"
        />
        <StatsCard
          title={`${providerLabel} Earnings`}
          value={`₹${(overview?.revenue?.totalVendorEarnings || 0).toLocaleString('en-IN')}`}
          subtitle={`Total ${providersLabel} Gross`}
          icon={FiDollarSign}
          color="teal"
        />

        {/* Row 2: Settlements & Payouts */}
        <StatsCard
          title="Settlements Received"
          value={`₹${(overview?.revenue?.totalSettlementReceived || 0).toLocaleString('en-IN')}`}
          subtitle={`${providersLabel} paid Platform`}
          icon={FiTrendingUp}
          color="emerald"
        />
        <StatsCard
          title="Pending Settlements (Owed)"
          value={`₹${(overview?.revenue?.totalPendingSettlement || 0).toLocaleString('en-IN')}`}
          subtitle={`${providersLabel} negative balance`}
          icon={FiAlertTriangle}
          color="orange"
        />
        <StatsCard
          title="Payouts Completed"
          value={`₹${(overview?.revenue?.totalAmountPaidToVendors || 0).toLocaleString('en-IN')}`}
          subtitle={`Platform paid ${providersLabel}`}
          icon={FiCheck}
          color="blue"
        />
        <StatsCard
          title="Pending Payouts"
          value={`₹${(overview?.revenue?.totalPendingPayout || 0).toLocaleString('en-IN')}`}
          subtitle={`${providersLabel} awaiting withdrawal`}
          icon={FiAlertTriangle}
          color="red"
        />
      </div>

      {/* Quick Download Cards */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Quick Export Reports</h2>

          {/* Date Range Filter */}
          <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl p-2">
            <div className="flex items-center gap-2">
              <FiCalendar className="text-gray-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border-0 bg-transparent text-sm focus:ring-0 text-gray-700"
              />
            </div>
            <span className="text-gray-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border-0 bg-transparent text-sm focus:ring-0 text-gray-700"
            />
            <button
              onClick={() => { fetchOverview(); fetchReportData(); }}
              className="p-2 bg-white rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
            >
              <FiRefreshCw className={`w-4 h-4 text-gray-600 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              {...report}
              loading={downloadingReport === report.id}
              onGenerate={() => downloadReport(report.id)}
            />
          ))}
        </div>
      </div>

      {/* Detailed Report View */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Report Tabs */}
        <div className="border-b border-gray-200">
          <div className="flex overflow-x-auto">
            {reports.map((report) => (
              <button
                key={report.id}
                onClick={() => setActiveReport(report.id)}
                className={`px-6 py-4 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeReport === report.id
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
              >
                <report.icon className="w-4 h-4 inline-block mr-2" />
                {report.title}
              </button>
            ))}
          </div>
        </div>

        {/* Report Summary */}
        {reportSummary && (
          <div className="p-4 bg-gray-50 border-b border-gray-200">
            <div className="flex flex-wrap gap-6 text-sm">
              {activeReport === 'gst' && (
                <>
                  <div><span className="text-gray-500">Taxable Value:</span> <span className="font-semibold">₹{(reportSummary.totalTaxableValue || 0).toLocaleString('en-IN')}</span></div>
                  <div><span className="text-gray-500">CGST:</span> <span className="font-semibold">₹{(reportSummary.totalCGST || 0).toLocaleString('en-IN')}</span></div>
                  <div><span className="text-gray-500">SGST:</span> <span className="font-semibold">₹{(reportSummary.totalSGST || 0).toLocaleString('en-IN')}</span></div>
                  <div><span className="text-gray-500">Total Tax:</span> <span className="font-semibold text-green-600">₹{(reportSummary.totalTax || 0).toLocaleString('en-IN')}</span></div>
                </>
              )}
              {activeReport === 'tds' && (
                <>
                  <div><span className="text-gray-500">Total Gross Sales:</span> <span className="font-semibold">₹{(reportSummary.totalGrossSales || 0).toLocaleString('en-IN')}</span></div>
                  <div><span className="text-gray-500">Total TDS Liability:</span> <span className="font-semibold text-purple-600">₹{(reportSummary.totalTDS || 0).toFixed(2)}</span></div>
                  <div><span className="text-gray-500">{providersLabel}:</span> <span className="font-semibold">{reportSummary.vendorCount || 0}</span></div>
                </>
              )}
              {activeReport === 'cod' && (
                <div className="flex gap-8 items-center w-full">
                  <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                    <span className="block text-gray-500 text-xs uppercase font-bold tracking-wide">Total Cash Collected</span>
                    <span className="block text-2xl font-bold text-gray-800 mt-1">₹{(reportSummary.totalCashCollected || 0).toLocaleString('en-IN')}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-xs">Outstanding Dues</span>
                    <span className="font-semibold text-red-600 text-lg">₹{(reportSummary.totalOutstandingDues || 0).toLocaleString('en-IN')}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-xs">High Risk {providersLabel}</span>
                    <span className="font-semibold text-red-600 text-lg">{reportSummary.highRiskCount || 0}</span>
                  </div>
                </div>
              )}
              {activeReport === 'transactions' && (
                <>
                  <div><span className="text-gray-500">Total Amount:</span> <span className="font-semibold">₹{(reportSummary.totalAmount || 0).toLocaleString('en-IN')}</span></div>
                  <div><span className="text-gray-500">Platform Commission:</span> <span className="font-semibold text-green-600">₹{(reportSummary.totalCommission || 0).toLocaleString('en-IN')}</span></div>
                  <div><span className="text-gray-500">{providerLabel} Earnings:</span> <span className="font-semibold">₹{(reportSummary.totalVendorEarnings || 0).toLocaleString('en-IN')}</span></div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Data Table */}
        <DataTable
          data={reportData}
          columns={getColumns()}
          loading={reportLoading}
        />

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {Math.min(reportData.length, 20)} of {reportData.length} records
          </p>
          <button
            onClick={() => downloadReport(activeReport)}
            disabled={downloadingReport === activeReport || reportData.length === 0}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors flex items-center disabled:opacity-50"
          >
            <FiDownload className="mr-2" />
            Export Full Report (CSV)
          </button>
        </div>
      </div>

      {/* Indian Tax Compliance Notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <FiAlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800">Indian Tax Compliance Notes</p>
            <ul className="mt-2 text-amber-700 space-y-1">
              <li>• <strong>GSTR-1</strong>: Monthly sales return to be filed by the 11th of the following month.</li>
              <li>• <strong>TDS u/s 194-O</strong>: 1% TDS on vendor gross sales (if annual sales exceed ₹5 Lakhs). Deposit by 7th of next month.</li>
              <li>• <strong>HSN/SAC Code 9988</strong>: Used for "Other Professional, Technical and Business Services".</li>
              <li>• This report is for reference. Please consult your CA for official filing.</li>
            </ul>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default PaymentReports;
