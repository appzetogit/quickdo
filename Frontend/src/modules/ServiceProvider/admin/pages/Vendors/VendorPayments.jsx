import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiDollarSign, FiLoader, FiArrowUpRight, FiArrowDownLeft, FiCreditCard } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import CardShell from '../UserCategories/components/CardShell';
import adminVendorService from '@sp/services/adminVendorService';

const VendorPayments = () => {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPayments();
  }, []);

  const loadPayments = async () => {
    try {
      setLoading(true);
      const response = await adminVendorService.getVendorPayments();
      if (response.success) {
        setVendors(response.data);
      }
    } catch (error) {
      console.error('Error loading vendor payments:', error);
      toast.error('Failed to load vendor payments');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 rounded-2xl text-white shadow-lg shadow-blue-200">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-white/20 rounded-lg">
              <FiDollarSign className="w-6 h-6" />
            </div>
            <span className="text-xs font-bold bg-white/20 px-2 py-1 rounded">Total Platform Balance</span>
          </div>
          <h3 className="text-3xl font-bold mb-1">
            ₹{vendors.reduce((acc, v) => acc + (v.wallet?.balance || 0), 0).toLocaleString()}
          </h3>
          <p className="text-blue-100 text-sm">Across {vendors.length} vendors</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-50 rounded-lg text-green-600">
              <FiArrowUpRight className="w-5 h-5" />
            </div>
            <span className="text-sm font-medium text-gray-500">Total Vendor Earnings</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">
            ₹{vendors.reduce((acc, v) => acc + (v.wallet?.totalEarnings || 0), 0).toLocaleString()}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-red-50 rounded-lg text-red-600">
              <FiArrowDownLeft className="w-5 h-5" />
            </div>
            <span className="text-sm font-medium text-gray-500">Total Pending Payouts</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">
            ₹{vendors.reduce((acc, v) => acc + (v.wallet?.balance > 0 ? v.wallet.balance : 0), 0).toLocaleString()}
          </div>
        </div>
      </div>

      <CardShell
        icon={FiCreditCard}
      >
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <FiLoader className="w-8 h-8 text-gray-400 animate-spin mr-3" />
              <span className="text-gray-600">Loading payment data...</span>
            </div>
          ) : vendors.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No vendor payment data available</div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Vendor</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Current Balance</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Total Earnings</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {vendors.map((vendor) => (
                  <tr key={vendor._id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-gray-900">{vendor.businessName || vendor.name}</span>
                        <span className="text-xs text-gray-500">{vendor.phone}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-bold text-gray-900">₹{vendor.wallet?.balance?.toLocaleString() || 0}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-600">₹{vendor.wallet?.totalEarnings?.toLocaleString() || 0}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${vendor.approvalStatus === 'approved' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                        }`}>
                        {vendor.approvalStatus}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${vendor.wallet?.balance > 0
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          }`}
                        disabled={!(vendor.wallet?.balance > 0)}
                      >
                        Settle Now
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </CardShell>
    </div>
  );
};

export default VendorPayments;

