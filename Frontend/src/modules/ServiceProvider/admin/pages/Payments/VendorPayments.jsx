import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  FiSearch,
  FiFilter,
  FiDownload,
  FiBriefcase,
  FiCheckCircle,
  FiClock,
  FiXCircle,
  FiAlertCircle,
  FiDollarSign,
  FiRefreshCcw
} from 'react-icons/fi';
import { adminTransactionService } from '@sp/services/adminTransactionService';
import toast from 'react-hot-toast';
import { exportToCSV } from '@sp/utils/csvExport';

const VendorPayments = () => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalPayouts: 0,
    netDue: 0
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0
  });

  const [filters, setFilters] = useState({
    search: '',
    status: 'all',
    type: 'all'
  });

  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search);
    }, 500);
    return () => clearTimeout(timer);
  }, [filters.search]);

  useEffect(() => {
    fetchData();
  }, [pagination.page, debouncedSearch, filters.status, filters.type]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [response, statsRes] = await Promise.all([
        adminTransactionService.getAllTransactions({
          page: pagination.page,
          limit: pagination.limit,
          search: debouncedSearch,
          status: filters.status,
          type: filters.type,
          entity: 'vendor'
        }),
        adminTransactionService.getTransactionStats({ entity: 'vendor' })
      ]);

      if (response.success) {
        setTransactions(response.data);
        if (response.pagination) {
          setPagination(prev => ({
            ...prev,
            total: response.pagination.total,
            pages: response.pagination.pages
          }));
        }
      }

      if (statsRes.success) {
        setStats(statsRes.data);
      }
    } catch (error) {
      console.error('Error fetching vendor transactions:', error);
      toast.error('Failed to load vendor transactions');
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.pages) {
      setPagination(prev => ({ ...prev, page: newPage }));
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0
    }).format(amount || 0);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-700 border-green-200';
      case 'pending': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'failed': return 'bg-red-100 text-red-700 border-red-200';
      case 'refunded': return 'bg-purple-100 text-purple-700 border-purple-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return <FiCheckCircle className="w-3.5 h-3.5 mr-1" />;
      case 'pending': return <FiClock className="w-3.5 h-3.5 mr-1" />;
      case 'failed': return <FiXCircle className="w-3.5 h-3.5 mr-1" />;
      case 'refunded': return <FiAlertCircle className="w-3.5 h-3.5 mr-1" />;
      default: return null;
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'credit': return 'text-green-600 bg-green-50 border-green-100';
      case 'earnings_credit': return 'text-green-600 bg-green-50 border-green-100';
      case 'debit': return 'text-orange-600 bg-orange-50 border-orange-100';
      case 'withdrawal': return 'text-red-600 bg-red-50 border-red-100';
      case 'cash_collected': return 'text-amber-600 bg-amber-50 border-amber-100';
      case 'tds_deduction': return 'text-pink-600 bg-pink-50 border-pink-100';
      case 'settlement': return 'text-blue-600 bg-blue-50 border-blue-100';
      case 'platform_fee': return 'text-rose-600 bg-rose-50 border-rose-100';
      default: return 'text-gray-600 bg-gray-50 border-gray-100';
    }
  };

  // Export transactions to CSV
  const handleExport = () => {
    if (!transactions || transactions.length === 0) {
      toast.error('No transactions to export');
      return;
    }
    exportToCSV(transactions, 'vendor_transactions', [
      { key: '_id', label: 'Transaction ID' },
      { key: 'vendorId.businessName', label: 'Business Name' },
      { key: 'vendorId.name', label: 'Vendor Name' },
      { key: 'vendorId.phone', label: 'Phone' },
      { key: 'type', label: 'Type' },
      { key: 'amount', label: 'Amount', type: 'currency' },
      { key: 'status', label: 'Status' },
      { key: 'createdAt', label: 'Date', type: 'datetime' },
      { key: 'description', label: 'Description' }
    ]);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-green-50 rounded-xl">
              <FiDollarSign className="w-6 h-6 text-green-600" />
            </div>
          </div>
          <p className="text-gray-500 text-sm font-medium">Total Revenue</p>
          <h3 className="text-2xl font-bold text-gray-900 mt-1">
            {loading ? (
              <div className="h-8 w-24 bg-gray-100 animate-pulse rounded"></div>
            ) : (
              formatCurrency(stats.totalRevenue)
            )}
          </h3>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-red-50 rounded-xl">
              <FiRefreshCcw className="w-6 h-6 text-red-600" />
            </div>
          </div>
          <p className="text-gray-500 text-sm font-medium">Total Payouts</p>
          <h3 className="text-2xl font-bold text-red-600 mt-1">
            {loading ? (
              <div className="h-8 w-24 bg-gray-100 animate-pulse rounded"></div>
            ) : (
              formatCurrency(stats.totalPayouts || stats.totalRefunds) // Fallback if API returns different key
            )}
          </h3>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-primary-50 rounded-xl">
              <FiDollarSign className="w-6 h-6 text-primary-600" />
            </div>
          </div>
          <p className="text-gray-500 text-sm font-medium">Net Due</p>
          <h3 className="text-2xl font-bold text-gray-900 mt-1">
            {loading ? (
              <div className="h-8 w-24 bg-gray-100 animate-pulse rounded"></div>
            ) : (
              formatCurrency(stats.netDue || stats.netRevenue)
            )}
          </h3>
        </motion.div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by ID, vendor, or phone..."
            value={filters.search}
            onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <select
            value={filters.status}
            onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
            className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all text-sm font-medium text-gray-600 min-w-[150px]"
          >
            <option value="all">All Status</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>

          <select
            value={filters.type}
            onChange={(e) => setFilters(prev => ({ ...prev, type: e.target.value }))}
            className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all text-sm font-medium text-gray-600 min-w-[150px]"
          >
            <option value="all">All Types</option>
            <option value="earnings_credit">Earnings</option>
            <option value="cash_collected">Cash Collected</option>
            <option value="settlement">Settlement</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="tds_deduction">TDS Deduction</option>
            <option value="platform_fee">Platform Charge</option>
          </select>

          <button
            onClick={handleExport}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-2 transition-colors shadow-sm"
          >
            <FiDownload className="w-4 h-4" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Transaction ID</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Vendor</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                      <p className="text-sm">Loading transactions...</p>
                    </div>
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-gray-500">
                    <p className="text-sm">No transactions found</p>
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx._id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4">
                      <span className="text-xs font-mono text-gray-500">#{tx._id.slice(-6).toUpperCase()}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center">
                        <div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 mr-3">
                          <FiBriefcase className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-800">{tx.vendorId?.businessName || tx.vendorId?.name || 'Unknown'}</div>
                          <div className="text-xs text-gray-500">{tx.vendorId?.phone}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getTypeColor(tx.type)}`}>
                        {tx.type === 'tds_deduction' ? 'TDS Deduction' : tx.type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-sm font-semibold ${['earnings_credit', 'settlement'].includes(tx.type) ? 'text-green-600' : 'text-gray-800'}`}>
                        {['earnings_credit', 'settlement'].includes(tx.type) ? '+' : '-'}{formatCurrency(tx.amount)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(tx.status)}`}>
                        {getStatusIcon(tx.status)}
                        <span className="capitalize">{tx.status}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-500">
                      {formatDate(tx.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && transactions.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50">
            <div className="text-xs text-gray-500">
              Showing <span className="font-medium">{((pagination.page - 1) * pagination.limit) + 1}</span> to <span className="font-medium">{Math.min(pagination.page * pagination.limit, pagination.total)}</span> of <span className="font-medium">{pagination.total}</span> results
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page === 1}
                className="px-3 py-1 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page === pagination.pages}
                className="px-3 py-1 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default VendorPayments;
