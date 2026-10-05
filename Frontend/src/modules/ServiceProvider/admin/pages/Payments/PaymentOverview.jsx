import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  FiSearch,
  FiFilter,
  FiDownload,
  FiDollarSign,
  FiTrendingUp,
  FiTrendingDown,
  FiAlertCircle,
  FiCheckCircle,
  FiClock,
  FiXCircle
} from 'react-icons/fi';
import { adminTransactionService } from '@sp/services/adminTransactionService';
import toast from 'react-hot-toast';
import { exportToCSV } from '@sp/utils/csvExport';

const PaymentOverview = () => {
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalRefunds: 0,
    netRevenue: 0
  });

  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
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

      // Fetch stats and transactions in parallel
      const [statsRes, transactionsRes] = await Promise.all([
        adminTransactionService.getTransactionStats(),
        adminTransactionService.getAllTransactions({
          page: pagination.page,
          limit: pagination.limit,
          search: debouncedSearch,
          status: filters.status,
          type: filters.type
        })
      ]);

      if (statsRes.success) {
        setStats(statsRes.data);
      }

      if (transactionsRes.success) {
        setTransactions(transactionsRes.data);
        setPagination(prev => ({
          ...prev,
          total: transactionsRes.pagination.total,
          pages: transactionsRes.pagination.pages
        }));
      }
    } catch (error) {
      console.error('Error fetching payment data:', error);
      toast.error('Failed to load payment data');
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
    }).format(amount);
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
      case 'completed': return 'bg-green-100 text-green-700';
      case 'pending': return 'bg-yellow-100 text-yellow-700';
      case 'failed': return 'bg-red-100 text-red-700';
      case 'refunded': return 'bg-purple-100 text-purple-700';
      default: return 'bg-gray-100 text-gray-700';
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
      case 'payment': return 'text-blue-600 bg-blue-50 border-blue-100'; // Online Payment
      case 'cash_collected': return 'text-amber-600 bg-amber-50 border-amber-100'; // Cash
      case 'debit': return 'text-orange-600 bg-orange-50 border-orange-100';
      case 'refund': return 'text-purple-600 bg-purple-50 border-purple-100';
      default: return 'text-gray-600 bg-gray-50 border-gray-100';
    }
  };

  // Export transactions to CSV
  const handleExport = () => {
    if (!transactions || transactions.length === 0) {
      toast.error('No transactions to export');
      return;
    }
    exportToCSV(transactions, 'payment_transactions', [
      { key: '_id', label: 'Transaction ID' },
      { key: 'userId.name', label: 'User Name' },
      { key: 'userId.phone', label: 'Phone' },
      { key: 'userId.email', label: 'Email' },
      { key: 'type', label: 'Type' },
      { key: 'amount', label: 'Amount', type: 'currency' },
      { key: 'status', label: 'Status' },
      { key: 'createdAt', label: 'Date', type: 'datetime' },
      { key: 'razorpayOrderId', label: 'Razorpay Order ID' },
      { key: 'referenceId', label: 'Reference ID' },
      { key: 'description', label: 'Description' }
    ]);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Stats Cards
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">Total Revenue</p>
            <h3 className="text-2xl font-bold text-gray-800 mt-1">{formatCurrency(stats.totalRevenue)}</h3>
          </div>
          <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center text-green-600">
            <FiDollarSign className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">Total Refunds</p>
            <h3 className="text-2xl font-bold text-gray-800 mt-1">{formatCurrency(stats.totalRefunds)}</h3>
          </div>
          <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
            <FiTrendingDown className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">Net Revenue</p>
            <h3 className="text-2xl font-bold text-gray-800 mt-1">{formatCurrency(stats.netRevenue)}</h3>
          </div>
          <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
            <FiTrendingUp className="w-5 h-5" />
          </div>
        </div>
      </div>
      */}

      {/* Filters & Actions */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="relative w-full sm:w-64">
          <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search transactions..."
            value={filters.search}
            onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>

        <div className="flex gap-2 w-full sm:w-auto">
          <select
            value={filters.status}
            onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Status</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </select>

          <select
            value={filters.type}
            onChange={(e) => setFilters(prev => ({ ...prev, type: e.target.value }))}
            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Types</option>
            <option value="credit">Credit (Platform)</option>
            <option value="debit">Debit (Wallet)</option>
            <option value="payment">Online Payment</option>
            <option value="cash_collected">Cash Collected</option>
            <option value="refund">Refund</option>
          </select>

          <button
            onClick={handleExport}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 flex items-center gap-2 transition-colors"
          >
            <FiDownload className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Transaction ID</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">User / Entity</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Ref ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan="7" className="py-8 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                      <p className="text-sm">Loading transactions...</p>
                    </div>
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-8 text-center text-gray-500">
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
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800">
                            {tx.userId?.name || tx.vendorId?.businessName || tx.vendorId?.name || tx.workerId?.name || 'Unknown'}
                          </span>
                          {tx.userId && <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-medium">User</span>}
                          {tx.vendorId && <span className="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-medium">Vendor</span>}
                          {tx.workerId && <span className="text-[10px] bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded font-medium">Worker</span>}
                        </div>
                        <span className="text-xs text-gray-400">
                          {tx.userId?.email || tx.vendorId?.email || tx.workerId?.email || ''}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getTypeColor(tx.type)}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-sm font-semibold ${['credit', 'payment', 'cash_collected', 'commission', 'convenience_fee', 'worker_subscription', 'vendor_subscription', 'penalty'].includes(tx.type) ? 'text-green-600' : 'text-gray-800'}`}>
                        {formatCurrency(tx.amount)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(tx.status)}`}>
                        {getStatusIcon(tx.status)}
                        <span className="capitalize">{tx.status}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-gray-500">{formatDate(tx.createdAt)}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs text-gray-400 font-mono" title={tx.razorpayOrderId || tx.referenceId}>
                        {(tx.razorpayOrderId || tx.referenceId || '-').slice(0, 10)}...
                      </span>
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

export default PaymentOverview;
