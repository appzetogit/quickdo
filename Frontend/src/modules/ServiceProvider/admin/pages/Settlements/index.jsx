import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FiDollarSign, FiCheck, FiX, FiEye, FiClock, FiUsers, FiTrendingUp, FiAlertCircle, FiDownload } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import Modal from '../../components/Modal';
import Button from '../../components/Button';
import adminSettlementService from '@sp/services/adminSettlementService';
import { getSettings } from '../../services/settingsService';
import { exportToCSV } from '@sp/utils/csvExport';

const SettlementManagement = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pending');
  const [dashboard, setDashboard] = useState(null);
  const [pendingSettlements, setPendingSettlements] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [history, setHistory] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [settings, setSettings] = useState(null);

  // Modal State
  const [activeModal, setActiveModal] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [modalInput, setModalInput] = useState('');
  const [modalInput2, setModalInput2] = useState('');

  const isWorkerMode = settings?.bookingModel === 'worker';
  const providerLabel = isWorkerMode ? 'Worker' : 'Vendor';
  const providersLabel = isWorkerMode ? 'Workers' : 'Vendors';
  const providerIdField = isWorkerMode ? 'workerId' : 'vendorId';

  // Determine active tab from URL
  useEffect(() => {
    const path = location.pathname.split('/').pop();
    if (['pending', 'vendors', 'history', 'withdrawals'].includes(path)) {
      setActiveTab(path);
    } else {
      setActiveTab('pending');
    }
  }, [location.pathname]);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    try {
      setLoading(true);

      // 1. Fetch settings to know if we are in Worker Mode
      let currentBookingModel = 'vendor';
      const setRes = await getSettings();
      if (setRes.success) {
        setSettings(setRes.settings);
        currentBookingModel = setRes.settings.bookingModel || 'vendor';
      }
      
      const queryParams = { model: currentBookingModel };

      // 2. Load dashboard
      const dashRes = await adminSettlementService.getDashboard(queryParams);
      if (dashRes.success) {
        setDashboard(dashRes.data);
      }

      // 3. Load tab specific data
      if (activeTab === 'pending') {
        const res = await adminSettlementService.getPendingSettlements(queryParams);
        if (res.success) setPendingSettlements(res.data || []);
      } else if (activeTab === 'vendors') {
        const res = await adminSettlementService.getVendorBalances({ ...queryParams, filterDue: 'true' });
        if (res.success) setVendors(res.data || []);
      } else if (activeTab === 'history') {
        const res = await adminSettlementService.getSettlementHistory(queryParams);
        if (res.success) setHistory(res.data || []);
      } else if (activeTab === 'withdrawals') {
        const res = await adminSettlementService.getWithdrawalRequests(queryParams);
        if (res.success) setWithdrawals(res.data || []);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // --- Modal Openers ---
  const openApproveSettlement = (item) => {
    setSelectedItem(item);
    setActiveModal('approve_settlement');
  };

  const openRejectSettlement = (item) => {
    setSelectedItem(item);
    setModalInput('');
    setActiveModal('reject_settlement');
  };

  const openBlockVendor = (vendor) => {
    setSelectedItem(vendor);
    setModalInput('');
    setActiveModal('block_vendor');
  };

  const openUnblockVendor = (vendor) => {
    setSelectedItem(vendor);
    setActiveModal('unblock_vendor');
  };

  const openUpdateLimit = (vendor) => {
    setSelectedItem(vendor);
    setModalInput(vendor.cashLimit || 10000);
    setActiveModal('update_limit');
  };

  const openApproveWithdrawal = (item) => {
    setSelectedItem(item);
    setModalInput('');
    setActiveModal('approve_withdrawal');
  };

  const openRejectWithdrawal = (item) => {
    setSelectedItem(item);
    setModalInput('');
    setActiveModal('reject_withdrawal');
  };

  const closeModals = () => {
    setActiveModal(null);
    setSelectedItem(null);
    setModalInput('');
    setModalInput2('');
  };

  // --- Action Handlers ---
  const handleApproveSettlement = async () => {
    try {
      setActionLoading(true);
      const res = await adminSettlementService.approveSettlement(selectedItem._id);
      if (res.success) {
        toast.success('Settlement approved!');
        loadData();
        closeModals();
      } else {
        toast.error(res.message || 'Failed to approve');
      }
    } catch (error) {
      toast.error('Failed to approve');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectSettlement = async () => {
    if (!modalInput.trim()) return toast.error('Rejection reason is required');
    try {
      setActionLoading(true);
      const res = await adminSettlementService.rejectSettlement(selectedItem._id, modalInput);
      if (res.success) {
        toast.success('Settlement rejected');
        loadData();
        closeModals();
      }
    } catch (error) {
      toast.error('Failed to reject');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBlockVendor = async () => {
    if (!modalInput.trim()) return toast.error('Blocking reason is required');
    try {
      setActionLoading(true);
      const res = await adminSettlementService.blockVendor(selectedItem._id, modalInput);
      if (res.success) {
        toast.success('Vendor blocked');
        loadData();
        closeModals();
      }
    } catch (error) {
      toast.error('Failed to block');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateLimitSubmit = async () => {
    if (!modalInput || isNaN(modalInput)) return toast.error('Valid limit required');
    try {
      setActionLoading(true);
      const res = await adminSettlementService.updateCashLimit(selectedItem._id, parseInt(modalInput));
      if (res.success) {
        toast.success('Limit updated');
        loadData();
        closeModals();
      }
    } catch (error) {
      toast.error('Failed to update limit');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnblockVendorSubmit = async () => {
    try {
      setActionLoading(true);
      const res = await adminSettlementService.unblockVendor(selectedItem._id);
      if (res.success) {
        toast.success('Vendor unblocked');
        loadData();
        closeModals();
      }
    } catch (error) {
      toast.error('Failed to unblock');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveWithdrawalSubmit = async () => {
    const ref = modalInput.trim() || `MANUAL-${Date.now()}`;
    try {
      setActionLoading(true);
      const res = await adminSettlementService.approveWithdrawal(selectedItem._id, { transactionReference: ref });
      if (res.success) {
        toast.success('Withdrawal approved');
        loadData();
        closeModals();
      }
    } catch (error) {
      toast.error('Failed to approve');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectWithdrawalSubmit = async () => {
    if (!modalInput.trim()) return toast.error('Rejection reason required');
    try {
      setActionLoading(true);
      const res = await adminSettlementService.rejectWithdrawal(selectedItem._id, modalInput);
      if (res.success) {
        toast.success('Withdrawal rejected');
        loadData();
        closeModals();
      }
    } catch (error) {
      toast.error('Failed to reject');
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleExport = () => {
    const isWorkerMode = settings?.bookingModel === 'worker';
    const userTypeLabel = isWorkerMode ? 'Worker Name' : 'Vendor Name';
    const userTypeKey = isWorkerMode ? 'workerId.name' : 'vendorId.name';
    const businessNameKey = isWorkerMode ? 'workerId.name' : 'vendorId.businessName'; // Worker usually doesn't have businessName
    
    if (activeTab === 'history' && history.length > 0) {
      exportToCSV(history, 'settlement_history', [
        { key: userTypeKey, label: userTypeLabel },
        { key: businessNameKey, label: isWorkerMode ? 'Phone' : 'Business Name' },
        { key: 'amount', label: 'Amount', type: 'currency' },
        { key: 'paymentMethod', label: 'Payment Method' },
        { key: 'paymentReference', label: 'Reference' },
        { key: 'status', label: 'Status' },
        { key: 'createdAt', label: 'Date', type: 'datetime' }
      ]);
    } else if (activeTab === 'vendors' && vendors.length > 0) {
      exportToCSV(vendors, isWorkerMode ? 'worker_dues' : 'vendor_dues', [
        { key: 'name', label: userTypeLabel },
        { key: 'businessName', label: isWorkerMode ? 'Name' : 'Business Name' },
        { key: 'phone', label: 'Phone', type: 'phone' },
        { key: 'amountDue', label: 'Amount Due', type: 'currency' },
        { key: 'cashLimit', label: 'Cash Limit', type: 'currency' },
        { key: 'isBlocked', label: 'Blocked' }
      ]);
    } else if (activeTab === 'withdrawals' && withdrawals.length > 0) {
      exportToCSV(withdrawals, 'withdrawal_requests', [
        { key: userTypeKey, label: userTypeLabel },
        { key: businessNameKey, label: isWorkerMode ? 'Phone' : 'Business Name' },
        { key: 'amount', label: 'Amount', type: 'currency' },
        { key: 'status', label: 'Status' },
        { key: 'requestDate', label: 'Request Date', type: 'date' }
      ]);
    } else if (activeTab === 'pending' && pendingSettlements.length > 0) {
      exportToCSV(pendingSettlements, 'pending_settlements', [
        { key: userTypeKey, label: userTypeLabel },
        { key: businessNameKey, label: isWorkerMode ? 'Phone' : 'Business Name' },
        { key: 'amount', label: 'Amount', type: 'currency' },
        { key: 'paymentMethod', label: 'Payment Method' },
        { key: 'paymentReference', label: 'Reference' },
        { key: 'createdAt', label: 'Date', type: 'datetime' }
      ]);
    } else {
      toast.error('No data to export');
    }
  };

  /* --- Dynamic Dashboard Card Renderer --- */
  const renderDashboardCards = () => {
    if (loading && !dashboard) return null;

    let cards = [];

    if (activeTab === 'withdrawals') {
      // Withdrawals specific stats
      const pendingCount = withdrawals.length;
      const pendingAmount = withdrawals.reduce((sum, w) => sum + (w.amount || 0), 0);

      cards = [
        {
          title: 'Total Pending Amount',
          value: `₹${pendingAmount.toLocaleString()}`,
          icon: FiDollarSign,
          color: 'text-orange-600',
          bg: 'bg-orange-50',
          border: 'border-orange-100'
        },
        {
          title: 'Pending Requests',
          value: pendingCount,
          icon: FiClock,
          color: 'text-blue-600',
          bg: 'bg-blue-50',
          border: 'border-blue-100'
        },
        // Fallback to dashboard stats if available, or static
        {
          title: 'Avg. Payout',
          value: pendingCount > 0 ? `₹${Math.round(pendingAmount / pendingCount).toLocaleString()}` : '₹0',
          icon: FiTrendingUp,
          color: 'text-green-600',
          bg: 'bg-green-50',
          border: 'border-green-100'
        },
        {
          title: 'Processing Status',
          value: 'Active',
          icon: FiCheck,
          color: 'text-purple-600',
          bg: 'bg-purple-50',
          border: 'border-purple-100'
        }
      ];
    } else if (activeTab === 'vendors') {
      // Vendor Payables stats
      const totalVendors = vendors.length;
      const totalDue = vendors.reduce((sum, v) => sum + (v.amountDue || 0), 0);
      const blockedCount = vendors.filter(v => v.isBlocked).length;
      const totalLimit = vendors.reduce((sum, v) => sum + (v.cashLimit || 0), 0);

      cards = [
        {
          title: `Total Due from ${providersLabel}`,
          value: `₹${totalDue.toLocaleString()}`,
          icon: FiDollarSign,
          color: 'text-red-600',
          bg: 'bg-red-50',
          border: 'border-red-100'
        },
        {
          title: `${providersLabel} with Dues`,
          value: totalVendors,
          icon: FiUsers,
          color: 'text-blue-600',
          bg: 'bg-blue-50',
          border: 'border-blue-100'
        },
        {
          title: `Blocked ${providersLabel}`,
          value: blockedCount,
          icon: FiAlertCircle,
          color: 'text-orange-600',
          bg: 'bg-orange-50',
          border: 'border-orange-100'
        },
        {
          title: 'Total Cash Limit',
          value: `₹${(totalLimit / 100000).toFixed(1)}L`,
          icon: FiCheck,
          color: 'text-indigo-600',
          bg: 'bg-indigo-50',
          border: 'border-indigo-100'
        }
      ];
    } else if (activeTab === 'history') {
      // History stats
      const totalTxns = history.length;
      const totalSettled = history.reduce((sum, h) => h.status === 'approved' ? sum + (h.amount || 0) : 0, 0);
      const approvedCount = history.filter(h => h.status === 'approved').length;
      const rejectedCount = history.filter(h => h.status === 'rejected').length;

      cards = [
        {
          title: 'Total Settled Amount',
          value: `₹${totalSettled.toLocaleString()}`,
          icon: FiCheck,
          color: 'text-green-600',
          bg: 'bg-green-50',
          border: 'border-green-100'
        },
        {
          title: 'Total Transactions',
          value: totalTxns,
          icon: FiTrendingUp,
          color: 'text-blue-600',
          bg: 'bg-blue-50',
          border: 'border-blue-100'
        },
        {
          title: 'Approved Requests',
          value: approvedCount,
          icon: FiCheck,
          color: 'text-teal-600',
          bg: 'bg-teal-50',
          border: 'border-teal-100'
        },
        {
          title: 'Rejected Requests',
          value: rejectedCount,
          icon: FiX,
          color: 'text-red-600',
          bg: 'bg-red-50',
          border: 'border-red-100'
        }
      ];
    } else {
      // Default Pending Tab (use dashboard data)
      if (!dashboard) return null;
      cards = [
        {
          title: 'Total Due to Admin',
          value: `₹${dashboard.totalDueToAdmin?.toLocaleString() || 0}`,
          icon: FiDollarSign,
          color: 'text-red-600',
          bg: 'bg-red-50',
          border: 'border-red-100'
        },
        {
          title: 'Pending Settlements',
          value: dashboard.pendingSettlements?.count || 0,
          icon: FiClock,
          color: 'text-orange-600',
          bg: 'bg-orange-50',
          border: 'border-orange-100'
        },
        {
          title: "Today's Collection",
          value: `₹${dashboard.todayCashCollected?.amount?.toLocaleString() || 0}`,
          icon: FiTrendingUp,
          color: 'text-blue-600',
          bg: 'bg-blue-50',
          border: 'border-blue-100'
        },
        {
          title: 'Weekly Collection',
          value: `₹${dashboard.weeklySettlements?.amount?.toLocaleString() || 0}`,
          icon: FiCheck,
          color: 'text-green-600',
          bg: 'bg-green-50',
          border: 'border-green-100'
        }
      ];
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card, index) => (
          <div key={index} className={`bg-white rounded-xl p-4 shadow-sm border hover:shadow-md transition-all ${card.border}`}>
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{card.title}</p>
                <h3 className="text-2xl font-black text-gray-800 tracking-tight">{card.value}</h3>
              </div>
              <div className={`p-3 rounded-xl ${card.bg} ${card.color}`}>
                <card.icon className="w-5 h-5" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };
  const getPageTitle = () => {
    switch (activeTab) {
      case 'pending': return 'Pending Settlements';
      case 'vendors': return `${providerLabel} Balances & Limits`;
      case 'history': return 'Settlement History';
      case 'withdrawals': return 'Withdrawal Requests';
      default: return 'Settlements';
    }
  };

  // --- Render Helpers ---

  const renderPendingSettlements = () => (
    pendingSettlements.length === 0 ? (
      <div className="text-center py-10">
        <FiClock className="w-12 h-12 mx-auto mb-3 text-gray-200" />
        <p className="text-gray-500 text-sm font-medium">No pending settlements</p>
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {pendingSettlements.map(settlement => {
          const providerObj = settlement[providerIdField] || {};
          return (
          <div key={settlement._id} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-all">
            <div className="flex justify-between items-start gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-gray-900">{providerObj.name || `Unknown ${providerLabel}`}</h3>
                  {!isWorkerMode && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{providerObj.businessName}</span>}
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <p className="text-2xl font-bold text-blue-600">₹{settlement.amount?.toLocaleString()}</p>
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold uppercase rounded">{settlement.paymentMethod}</span>
                </div>

                {settlement.paymentReference && (
                  <p className="text-xs text-gray-500 font-mono bg-gray-50 px-2 py-1 rounded inline-block">Ref: {settlement.paymentReference}</p>
                )}

                <p className="text-xs text-gray-400 mt-2">{formatDate(settlement.createdAt)}</p>
              </div>

              <div className="flex flex-col gap-2 shrink-0">
                {settlement.paymentProof && (
                  <a
                    href={settlement.paymentProof}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-200 text-center transition-colors mb-2"
                  >
                    View Proof
                  </a>
                )}
                <button
                  onClick={() => openApproveSettlement(settlement)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-bold uppercase hover:bg-green-700 shadow-sm transition-all"
                >
                  Approve
                </button>
                <button
                  onClick={() => openRejectSettlement(settlement)}
                  className="px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg text-xs font-bold uppercase hover:bg-red-50 transition-all"
                >
                  Reject
                </button>
              </div>
            </div>
            {settlement.vendorNotes && (
              <div className="mt-3 pt-3 border-t border-gray-50">
                <p className="text-xs text-gray-500 italic">"{settlement.vendorNotes}"</p>
              </div>
            )}
          </div>
        )})}
      </div>
    )
  );

  const renderVendorsList = () => (
    vendors.length === 0 ? (
      <div className="text-center py-10">
        <FiCheck className="w-12 h-12 mx-auto mb-3 text-gray-200" />
        <p className="text-gray-500 text-sm font-medium">All {providersLabel.toLowerCase()} are settled!</p>
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{providerLabel} Details</th>
              <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Cash Limit Status</th>
              <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Amount Due</th>
              <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {vendors.map(vendor => (
              <tr key={vendor._id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${vendor.isBlocked ? 'bg-red-500' : 'bg-blue-600'}`}>
                      {vendor.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-bold text-gray-900 text-sm">{vendor.name}</p>
                      <p className="text-xs text-gray-500">{vendor.businessName} • {vendor.phone}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex flex-col items-end">
                    <p className="text-xs font-semibold text-gray-700 mb-1">
                      ₹{Math.abs(vendor.balance).toLocaleString()} <span className="text-gray-400">/</span> ₹{vendor.cashLimit?.toLocaleString()}
                    </p>
                    <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${vendor.isBlocked ? 'bg-red-500' : 'bg-blue-500'}`}
                        style={{ width: `${Math.min((vendor.amountDue / vendor.cashLimit) * 100, 100)}%` }}
                      />
                    </div>
                    {vendor.isBlocked && <span className="text-[10px] text-red-600 font-bold mt-1 uppercase tracking-wide">Blocked</span>}
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="font-bold text-red-600 text-base">
                    ₹{vendor.amountDue?.toLocaleString() || 0}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => navigate(`/admin/settlements/vendor/${vendor._id}`)}
                      className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="View Ledger"
                    >
                      <FiEye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => openUpdateLimit(vendor)}
                      className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Update Limit"
                    >
                      <FiDollarSign className="w-4 h-4" />
                    </button>
                    {vendor.isBlocked ? (
                      <button
                        onClick={() => openUnblockVendor(vendor)}
                        className="px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-xs font-bold uppercase hover:bg-orange-200 transition-colors"
                      >
                        Unblock
                      </button>
                    ) : (
                      <button
                        onClick={() => openBlockVendor(vendor)}
                        className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold uppercase hover:bg-red-100 transition-colors"
                      >
                        Block
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  const renderHistoryList = () => (
    history.length === 0 ? (
      <div className="text-center py-10">
        <FiTrendingUp className="w-12 h-12 mx-auto mb-3 text-gray-200" />
        <p className="text-gray-500 text-sm font-medium">No settlement history found</p>
      </div>
    ) : (
      <div className="space-y-3">
        {history.map(settlement => {
          const providerObj = settlement[providerIdField] || {};
          return (
          <div
            key={settlement._id}
            className={`bg-white rounded-xl p-4 border transition-all hover:shadow-md ${settlement.status === 'approved' ? 'border-l-4 border-l-green-500 border-gray-100' :
              settlement.status === 'rejected' ? 'border-l-4 border-l-red-500 border-gray-100' :
                'border-l-4 border-l-orange-500 border-gray-100'
              }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${settlement.status === 'approved' ? 'bg-green-100 text-green-600' :
                  settlement.status === 'rejected' ? 'bg-red-100 text-red-600' :
                    'bg-orange-100 text-orange-600'
                  }`}>
                  {settlement.status === 'approved' ? <FiCheck /> : settlement.status === 'rejected' ? <FiX /> : <FiClock />}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-gray-900">
                    {settlement.type === 'withdrawal' ? (
                      <>Payout to {providerObj.name || 'Unknown'} <span className="font-normal text-gray-500">of</span> ₹{settlement.amount?.toLocaleString()}</>
                    ) : (
                      <>{providerObj.name || 'Unknown'} <span className="font-normal text-gray-500">paid</span> ₹{settlement.amount?.toLocaleString()}</>
                    )}
                  </h4>
                  <p className="text-xs text-gray-500">{formatDate(settlement.createdAt)} • via {settlement.paymentMethod === 'bank_transfer' ? 'Bank Transfer' : settlement.paymentMethod?.toUpperCase()}</p>
                </div>
              </div>
              <div className="text-right">
                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${settlement.status === 'approved' ? 'bg-green-50 text-green-700' :
                  settlement.status === 'rejected' ? 'bg-red-50 text-red-700' :
                    'bg-orange-50 text-orange-700'
                  }`}>
                  {settlement.status}
                </span>
                {settlement.rejectionReason && (
                  <p className="text-xs text-red-500 mt-1 max-w-[200px] truncate" title={settlement.rejectionReason}>{settlement.rejectionReason}</p>
                )}
              </div>
            </div>
          </div>
        )})}
      </div>
    )
  );

  const renderWithdrawalsList = () => (
    withdrawals.length === 0 ? (
      <div className="text-center py-10">
        <FiCheck className="w-12 h-12 mx-auto mb-3 text-gray-200" />
        <p className="text-gray-500 text-sm font-medium">No pending withdrawal requests. All settled!</p>
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {withdrawals.map(request => {
          const providerObj = request[providerIdField] || {};
          return (
          <div key={request._id} className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 hover:border-green-200 transition-all group">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-green-50 text-green-600 flex items-center justify-center font-bold text-lg">
                  {providerObj.name?.charAt(0)}
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">{providerObj.name}</h3>
                  <div className="text-xs text-gray-500 flex flex-col mt-0.5">
                    {!isWorkerMode && providerObj.businessName && <span>{providerObj.businessName}</span>}
                    {providerObj.phone && <span>{providerObj.phone}</span>}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-green-600">₹{request.amount?.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mt-1">Requested Amount</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-3 mb-4 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">
                  {isWorkerMode ? 'Available Balance' : 'Available Earnings'}
                </span>
                <span className="font-bold text-gray-700">
                  ₹{isWorkerMode 
                    ? (providerObj.wallet?.balance?.toLocaleString() || 0)
                    : (providerObj.wallet?.earnings?.toLocaleString() || 0)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Requested Date</span>
                <span className="font-medium text-gray-700">{formatDate(request.requestDate)}</span>
              </div>
              {request.bankDetails && (
                <div className="pt-2 border-t border-gray-200 mt-2">
                  <p className="text-xs font-bold text-gray-400 uppercase mb-1">Bank Details</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {Object.entries(request.bankDetails).map(([key, val]) => (
                      <div key={key}>
                        <span className="text-gray-500 capitalize">{key}:</span> <span className="text-gray-800 font-medium">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => openApproveWithdrawal(request)}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg font-bold text-sm shadow-sm hover:bg-green-700 hover:shadow transform active:scale-95 transition-all"
              >
                Approve & Pay
              </button>
              <button
                onClick={() => openRejectWithdrawal(request)}
                className="flex-1 py-2.5 bg-white border border-red-200 text-red-600 rounded-lg font-bold text-sm hover:bg-red-50 active:scale-95 transition-all"
              >
                Reject
              </button>
            </div>
            {request.adminNotes && (
              <p className="mt-3 text-xs text-gray-500 italic text-center">"{request.adminNotes}"</p>
            )}
          </div>
        )})}
      </div>
    )
  );

  return (
    <div className="space-y-6">
      {/* Dynamic Dashboard Cards */}
      {renderDashboardCards()}

      <div className="flex justify-end gap-3">
        <button
          onClick={handleExport}
          className="px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2 shadow-sm transition-all"
        >
          <FiDownload className="w-4 h-4" />
          Export CSV
        </button>
        <button
          onClick={() => loadData()}
          className="px-3 py-2.5 bg-blue-50 text-blue-600 rounded-lg text-sm hover:bg-blue-100 transition-colors"
        >
          <FiClock className="w-4 h-4" />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden min-h-[400px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-500 mt-4 font-medium">Loading data...</p>
          </div>
        ) : (
          <div className="p-6">
            {activeTab === 'pending' && renderPendingSettlements()}
            {activeTab === 'vendors' && renderVendorsList()}
            {activeTab === 'history' && renderHistoryList()}
            {activeTab === 'withdrawals' && renderWithdrawalsList()}
          </div>
        )}
      </div>

      {/* --- Modals --- */}
      {/* Approve Settlement Modal */}
      <Modal
        isOpen={activeModal === 'approve_settlement'}
        onClose={closeModals}
        title="Approve Settlement"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            Are you sure you want to approve this settlement of
            <span className="font-bold text-gray-900 mx-1">₹{selectedItem?.amount?.toLocaleString()}</span>
            from {selectedItem?.[providerIdField]?.name}?
          </p>
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="ghost" onClick={closeModals}>Cancel</Button>
            <Button
              onClick={handleApproveSettlement}
              isLoading={actionLoading}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              Confirm Approval
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reject Settlement Modal */}
      <Modal
        isOpen={activeModal === 'reject_settlement'}
        onClose={closeModals}
        title="Reject Settlement"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">Please provide a reason for rejecting this settlement.</p>
          <textarea
            value={modalInput}
            onChange={(e) => setModalInput(e.target.value)}
            placeholder="e.g., Transaction ID not found, Invalid screenshot..."
            className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all"
            rows={3}
          />
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="ghost" onClick={closeModals}>Cancel</Button>
            <Button
              onClick={handleRejectSettlement}
              isLoading={actionLoading}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Reject Settlement
            </Button>
          </div>
        </div>
      </Modal>

      {/* Block Vendor Modal */}
      <Modal
        isOpen={activeModal === 'block_vendor'}
        onClose={closeModals}
        title={`Block ${providerLabel}`}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            Blocking <span className="font-bold">{selectedItem?.name}</span> will prevent them from accepting new cash jobs.
          </p>
          <textarea
            value={modalInput}
            onChange={(e) => setModalInput(e.target.value)}
            placeholder="Reason for blocking..."
            className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all"
            rows={3}
          />
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="ghost" onClick={closeModals}>Cancel</Button>
            <Button
              onClick={handleBlockVendor}
              isLoading={actionLoading}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Block {providerLabel}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Unblock Vendor Modal */}
      <Modal
        isOpen={activeModal === 'unblock_vendor'}
        onClose={closeModals}
        title={`Unblock ${providerLabel}`}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            Are you sure you want to unblock <span className="font-bold text-gray-900">{selectedItem?.name}</span>?
            Their cash limit and blocking status will be reset.
          </p>
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="ghost" onClick={closeModals}>Cancel</Button>
            <Button
              onClick={handleUnblockVendorSubmit}
              isLoading={actionLoading}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              Confirm Unblock
            </Button>
          </div>
        </div>
      </Modal>

      {/* Update Limit Modal */}
      <Modal
        isOpen={activeModal === 'update_limit'}
        onClose={closeModals}
        title="Update Cash Limit"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">Set a new cash collection limit for {selectedItem?.name}.</p>
          <div className="relative">
            <span className="absolute left-3 top-3 text-gray-500 font-bold">₹</span>
            <input
              type="number"
              value={modalInput}
              onChange={(e) => setModalInput(e.target.value)}
              className="w-full p-3 pl-8 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="ghost" onClick={closeModals}>Cancel</Button>
            <Button
              onClick={handleUpdateLimitSubmit}
              isLoading={actionLoading}
            >
              Update Limit
            </Button>
          </div>
        </div>
      </Modal>

      {/* Approve Withdrawal Modal */}
      <Modal
        isOpen={activeModal === 'approve_withdrawal'}
        onClose={closeModals}
        title="Approve Withdrawal"
        size="md"
      >
        <div className="space-y-5">
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white font-black text-sm">
              {selectedItem?.[providerIdField]?.name?.charAt(0) || providerLabel.charAt(0)}
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm">{selectedItem?.[providerIdField]?.name}</p>
              {!isWorkerMode && <p className="text-xs text-gray-500">{selectedItem?.[providerIdField]?.businessName}</p>}
            </div>
          </div>

          {/* Payout Amount */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <div className="flex justify-between items-center">
              <span className="font-bold text-gray-800">Payout Amount</span>
              <span className="text-xl font-black text-green-600">
                ₹{selectedItem?.amount?.toLocaleString()}
              </span>
            </div>
          </div>


          <div className="flex justify-end gap-3 mt-4">
            <Button variant="ghost" onClick={closeModals}>Cancel</Button>
            <Button
              onClick={handleApproveWithdrawalSubmit}
              isLoading={actionLoading}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              Confirm Payment
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reject Withdrawal Modal */}
      <Modal
        isOpen={activeModal === 'reject_withdrawal'}
        onClose={closeModals}
        title="Reject Withdrawal"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">Reason for rejection:</p>
          <textarea
            value={modalInput}
            onChange={(e) => setModalInput(e.target.value)}
            placeholder="Reason for rejecting withdrawal..."
            className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 outline-none"
            rows={3}
          />
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="ghost" onClick={closeModals}>Cancel</Button>
            <Button
              onClick={handleRejectWithdrawalSubmit}
              isLoading={actionLoading}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Reject Request
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  );
};

export default SettlementManagement;

