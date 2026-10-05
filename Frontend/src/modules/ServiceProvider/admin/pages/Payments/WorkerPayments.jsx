import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  FiSearch,
  FiFilter,
  FiDownload,
  FiUser,
  FiDollarSign,
  FiBriefcase,
  FiCheckCircle,
  FiAlertCircle,
  FiArrowUpRight,
  FiLoader,
  FiActivity
} from 'react-icons/fi';
import adminWorkerService from '@sp/services/adminWorkerService';
import toast from 'react-hot-toast';
import { exportToCSV } from '@sp/utils/csvExport';
import { formatCurrency } from '../../utils/adminHelpers';

const WorkerPayments = () => {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalWorkers: 0,
    totalEarnings: 0,
    totalPending: 0
  });

  const [filters, setFilters] = useState({
    search: '',
    status: 'all'
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await adminWorkerService.getWorkerPayments();
      if (response.success) {
        setWorkers(response.data);

        // Calculate stats
        const data = response.data;
        const totalEarn = data.reduce((sum, w) => sum + (w.wallet?.totalEarnings || 0), 0);
        const totalPend = data.reduce((sum, w) => sum + (w.wallet?.balance || 0), 0);

        setStats({
          totalWorkers: data.length,
          totalEarnings: totalEarn,
          totalPending: totalPend
        });
      }
    } catch (error) {
      console.error('Error fetching worker payments:', error);
      toast.error('Failed to load worker payment data');
    } finally {
      setLoading(false);
    }
  };

  const filteredWorkers = workers.filter(worker => {
    const matchesSearch =
      worker.name.toLowerCase().includes(filters.search.toLowerCase()) ||
      worker.phone.includes(filters.search);

    const matchesStatus = filters.status === 'all' || worker.approvalStatus === filters.status;

    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved': return 'bg-green-100 text-green-700 border-green-200';
      case 'pending': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'suspended': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const handleExport = () => {
    if (!filteredWorkers || filteredWorkers.length === 0) {
      toast.error('No records to export');
      return;
    }
    const dataToExport = filteredWorkers.map(w => ({
      Name: w.name,
      Phone: w.phone,
      Service: w.serviceCategory,
      'Wallet Balance': w.wallet?.balance || 0,
      'Total Earnings': w.wallet?.totalEarnings || 0,
      Status: w.approvalStatus
    }));
    exportToCSV(dataToExport, 'worker_payments');
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
            <div className="p-3 bg-blue-50 rounded-xl">
              <FiUser className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          <p className="text-gray-500 text-sm font-medium">Total Workers</p>
          <h3 className="text-2xl font-bold text-gray-900 mt-1">
            {loading ? (
              <div className="h-8 w-24 bg-gray-100 animate-pulse rounded"></div>
            ) : (
              stats.totalWorkers
            )}
          </h3>
        </motion.div>

        {/* Commented out Total Lifetime Earnings card
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-green-50 rounded-xl">
              <FiDollarSign className="w-6 h-6 text-green-600" />
            </div>
          </div>
          <p className="text-gray-500 text-sm font-medium">Total Lifetime Earnings</p>
          <h3 className="text-2xl font-bold text-green-600 mt-1">
            {loading ? (
              <div className="h-8 w-24 bg-gray-100 animate-pulse rounded"></div>
            ) : (
              formatCurrency(stats.totalEarnings)
            )}
          </h3>
        </motion.div>
        */}

        {/* Commented out Pending Payouts card
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-orange-50 rounded-xl">
              <FiActivity className="w-6 h-6 text-orange-600" />
            </div>
          </div>
          <p className="text-gray-500 text-sm font-medium">Pending Payouts</p>
          <h3 className="text-2xl font-bold text-gray-900 mt-1">
            {loading ? (
              <div className="h-8 w-24 bg-gray-100 animate-pulse rounded"></div>
            ) : (
              formatCurrency(stats.totalPending)
            )}
          </h3>
        </motion.div>
        */}
      </div>

      {/* Filters & Search */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search worker by name or phone..."
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
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
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

      {/* Workers Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <FiLoader className="w-8 h-8 text-gray-400 animate-spin mr-3" />
              <span className="text-gray-600">Loading payment data...</span>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Worker</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Wallet Balance</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredWorkers.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="px-6 py-8 text-center text-gray-500">No payment records found</td>
                  </tr>
                ) : (
                  filteredWorkers.map((worker) => (
                    <motion.tr
                      key={worker._id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="hover:bg-gray-50/50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900">{worker.name}</span>
                          <span className="text-xs text-gray-500">{worker.phone}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`font-bold ${worker.wallet?.balance > 0 ? 'text-green-600' : 'text-gray-900'}`}>
                          {formatCurrency(worker.wallet?.balance)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor(worker.approvalStatus)}`}>
                          {worker.approvalStatus.toUpperCase()}
                        </span>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default WorkerPayments;
