import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiDollarSign, FiTrendingUp, FiPieChart, FiDownload } from 'react-icons/fi';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, Cell, PieChart, Pie
} from 'recharts';
import { toast } from 'react-hot-toast';
import adminReportService from '@sp/services/adminReportService';
import CardShell from '../UserCategories/components/CardShell';
import { exportToCSV } from '@sp/utils/csvExport';

const RevenueReport = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState('monthly');

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await adminReportService.getRevenueReport({ period });
      if (res.success) {
        setData(res.data);
      }
    } catch (error) {
      console.error('Revenue report error:', error);
      toast.error('Failed to load revenue report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [period]);

  // Export revenue trends as CSV
  const handleExportTrends = () => {
    if (!data?.revenueTrends || data.revenueTrends.length === 0) {
      toast.error('No revenue data to export');
      return;
    }
    exportToCSV(data.revenueTrends, `revenue_trends_${period}`, [
      { key: '_id', label: 'Period' },
      { key: 'revenue', label: 'Total Revenue (₹)', type: 'currency' },
      { key: 'commission', label: 'Commission (₹)', type: 'currency' },
      { key: 'bookings', label: 'Total Bookings', type: 'number' }
    ]);
  };

  // Export revenue by service as CSV
  const handleExportByService = () => {
    if (!data?.revenueByService || data.revenueByService.length === 0) {
      toast.error('No service data to export');
      return;
    }
    exportToCSV(data.revenueByService, `revenue_by_service_${period}`, [
      { key: '_id', label: 'Service' },
      { key: 'revenue', label: 'Revenue (₹)', type: 'currency' },
      { key: 'count', label: 'Bookings', type: 'number' }
    ]);
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const COLORS = ['#2874F0', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <button
          onClick={handleExportTrends}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 flex items-center gap-2 transition-colors"
        >
          <FiDownload className="w-4 h-4" />
          Export CSV
        </button>
        <div className="bg-white p-1 rounded-xl shadow-sm border border-slate-200 flex">
          {['daily', 'weekly', 'monthly'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${period === p
                ? 'bg-primary-600 text-white shadow-md'
                : 'text-slate-500 hover:text-slate-700'
                }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Trends */}
        <CardShell className="bg-white p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <FiTrendingUp className="text-primary-600" />
              Revenue & Commission Trends
            </h3>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.revenueTrends}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="_id" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={(v) => `₹${v}`} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                <Legend iconType="circle" />
                <Area type="monotone" dataKey="revenue" name="Total Revenue" stroke="#2874F0" fill="#2874F0" fillOpacity={0.1} strokeWidth={3} />
                <Area type="monotone" dataKey="commission" name="Commission" stroke="#10B981" fill="#10B981" fillOpacity={0.1} strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardShell>

        {/* Revenue by Service */}
        <CardShell className="bg-white p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <FiPieChart className="text-amber-600" />
              Revenue by Service
            </h3>
            <button onClick={handleExportByService} className="text-xs text-gray-500 hover:text-green-600 flex items-center gap-1">
              <FiDownload className="w-3 h-3" /> Export
            </button>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.revenueByService} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v}`} tick={{ fontSize: 11 }} />
                <YAxis dataKey="_id" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 10 }} width={80} />
                <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '12px', border: 'none' }} />
                <Bar dataKey="revenue" fill="#2874F0" radius={[0, 4, 4, 0]}>
                  {data?.revenueByService?.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardShell>
      </div>
    </div>
  );
};

export default RevenueReport;


