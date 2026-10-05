import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiShoppingBag, FiPieChart, FiBarChart2, FiDownload } from 'react-icons/fi';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { toast } from 'react-hot-toast';
import adminReportService from '@sp/services/adminReportService';
import CardShell from '../UserCategories/components/CardShell';
import { exportToCSV } from '@sp/utils/csvExport';

const BookingReport = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await adminReportService.getBookingReport();
      if (res.success) {
        setData(res.data);
      }
    } catch (error) {
      console.error('Booking report error:', error);
      toast.error('Failed to load booking report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Export monthly trends
  const handleExportMonthly = () => {
    if (!data?.monthlyTrends || data.monthlyTrends.length === 0) {
      toast.error('No monthly data to export');
      return;
    }
    exportToCSV(data.monthlyTrends, 'booking_monthly_trends', [
      { key: '_id', label: 'Month' },
      { key: 'total', label: 'Total Bookings', type: 'number' },
      { key: 'completed', label: 'Completed', type: 'number' },
      { key: 'cancelled', label: 'Cancelled', type: 'number' }
    ]);
  };

  // Export status distribution
  const handleExportStatus = () => {
    if (!data?.statusDistribution || data.statusDistribution.length === 0) {
      toast.error('No status data to export');
      return;
    }
    exportToCSV(data.statusDistribution, 'booking_status_distribution', [
      { key: '_id', label: 'Status' },
      { key: 'count', label: 'Count', type: 'number' }
    ]);
  };

  // Export service distribution
  const handleExportService = () => {
    if (!data?.serviceDistribution || data.serviceDistribution.length === 0) {
      toast.error('No service data to export');
      return;
    }
    exportToCSV(data.serviceDistribution, 'booking_by_service', [
      { key: '_id', label: 'Service' },
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

  const COLORS = ['#2874F0', '#10B981', '#F59E0B', '#EF4444', '#6366F1'];

  return (
    <div className="space-y-4">
      {/* Export All Button */}
      <div className="flex justify-start">
        <button
          onClick={handleExportMonthly}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 flex items-center gap-2 transition-colors"
        >
          <FiDownload className="w-4 h-4" />
          Export Monthly Trends
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution */}
        <CardShell className="bg-white p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <FiPieChart className="text-primary-600" />
              Booking Status Distribution
            </h3>
            <button onClick={handleExportStatus} className="text-xs text-gray-500 hover:text-green-600 flex items-center gap-1">
              <FiDownload className="w-3 h-3" /> Export
            </button>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data?.statusDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="count"
                  nameKey="_id"
                >
                  {data?.statusDistribution?.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardShell>

        {/* Service Distribution */}
        <CardShell className="bg-white p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <FiBarChart2 className="text-amber-600" />
              Bookings by Service
            </h3>
            <button onClick={handleExportService} className="text-xs text-gray-500 hover:text-green-600 flex items-center gap-1">
              <FiDownload className="w-3 h-3" /> Export
            </button>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.serviceDistribution}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="_id" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 10 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} />
                <Tooltip cursor={{ fill: 'transparent' }} />
                <Bar dataKey="count" fill="#2874F0" radius={[4, 4, 0, 0]}>
                  {data?.serviceDistribution?.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardShell>

        {/* Monthly Trends */}
        <CardShell className="bg-white lg:col-span-2 p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <FiShoppingBag className="text-indigo-600" />
              Monthly Booking Trends
            </h3>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.monthlyTrends}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="_id" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} />
                <Tooltip />
                <Legend iconType="circle" />
                <Bar dataKey="total" name="Total Bookings" fill="#6366F1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="completed" name="Completed" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cancelled" name="Cancelled" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardShell>
      </div>
    </div>
  );
};

export default BookingReport;


